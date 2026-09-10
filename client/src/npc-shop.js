import { profileError } from "./profile-validation.js";
import { inventoryType, isRechargeable, itemCount } from "./inventory-model.js";
import {
  applyShopQuote,
  buyQuote,
  rechargeCost,
  rechargeQuote,
  saleEntry,
  saleItem,
  salePrice,
  sellQuote,
  shopInteger,
  shopRows,
  shopTemplate,
  SHOP_LIMITS,
  SHOP_PITCH_ITEM,
} from "./npc-shop-rules.js";

const PROMPTS = Object.freeze({
  buy: {
    number: "How many are you willing to buy?",
    confirm: "Are you sure you want to buy it?",
  },
  sell: {
    number: "How many are you willing to sell?",
    confirm: "Are you sure you want to sell it?",
  },
  recharge: { confirm: "Are you sure you want to recharge it?" },
});

function failure(error) {
  return {
    ok: false,
    code: error.code ?? "shop-failed",
    reason: error.message,
  };
}

function sameInstance(left, right) {
  return (
    left &&
    right &&
    left.uid === right.uid &&
    left.id === right.id &&
    left.count === right.count &&
    left.slot === right.slot &&
    left.owner === right.owner &&
    left.flags === right.flags &&
    left.expiresAt === right.expiresAt
  );
}

function callHook(context, name, value) {
  // Explicit event enum, not arbitrary source-method dispatch.
  try {
    if (name === "change") context.onChange?.(value);
    else if (name === "transaction") context.onTransaction?.(value);
    else if (name === "close") context.onClose?.(value);
    else context.onError?.(value);
  } catch (error) {
    console.error("NPC shop observer failed", error);
  }
}

/** Replaceable single-profile authority. Main admits routes and owns the pending NPC lease.
 * Context: {shopId,npc:{id,name},rows,isCurrent,isBusy,prompt?,onChange?,onError?,onTransaction?,onClose?}.
 * prompt receives {kind:'number'|'confirm',operation,text,min,max,defaultValue,itemId,signal}.
 * It resolves {ok:true,value?:integer} or {ok:false}; cancellation never enters commitProfile.
 */
export class NpcShop {
  constructor(store, catalog, context) {
    if (
      !store?.profile ||
      !catalog?.ui?.items ||
      typeof context?.isCurrent !== "function" ||
      typeof context.isBusy !== "function" ||
      !context.npc ||
      typeof context.npc.name !== "string" ||
      !context.npc.name
    ) {
      throw profileError(
        "shop-context",
        "An admitted NPC, original name, item catalog and live ownership hooks are required.",
      );
    }
    shopInteger(context.npc.id, 1, SHOP_LIMITS.mesos, "NPC ID");
    this.store = store;
    this.items = catalog.ui.items;
    this.context = context;
    this.rows = shopRows(context);
    this.npc = Object.freeze({ id: context.npc.id, name: context.npc.name });
    this.listeners = new Set();
    this.phase = "idle";
    this.closed = false;
    this.destroyed = false;
    this.promptController = null;
    this.rowViews = Object.freeze(
      this.rows.map((row, index) => this.rowView(row, index)),
    );
    this.admit(store.profile);
    this.unsubscribeStore = store.subscribe(() => this.notify());
  }

  /** Only the durable phase holds Main's scene/profile/NPC ownership lease. */
  get pending() {
    return this.phase === "committing";
  }

  rowView(row, index) {
    try {
      const template = shopTemplate(this.items, row.itemId);
      const currency = row.price > 0 ? "meso" : "pitch";
      return Object.freeze({
        ...row,
        row: index,
        template,
        currency,
        pricePerUnit: row.price > 0 ? row.price : row.pitch,
        rechargeable: isRechargeable(row.itemId),
        available: row.price > 0 || row.pitch > 0,
      });
    } catch (error) {
      return Object.freeze({
        ...row,
        row: index,
        template: null,
        available: false,
        reason: error.message,
      });
    }
  }

  snapshot() {
    const profile = this.store.profile;
    const inventory = [];
    if (profile) {
      for (const entry of profile.inventory) {
        this.appendInventoryView(inventory, entry);
      }
      inventory.sort((a, b) => a.type - b.type || a.slot - b.slot);
    }
    return Object.freeze({
      shopId: this.context.shopId,
      npc: this.npc,
      rows: this.rowViews,
      self: profile
        ? Object.freeze({
            level: profile.level,
            job: profile.job,
            gender: profile.gender,
          })
        : null,
      inventory: Object.freeze(inventory),
      mesos: profile?.meso ?? 0,
      pitch: profile ? itemCount(profile, SHOP_PITCH_ITEM) : 0,
      lastTransaction: this.lastTransaction ?? null,
      closed: this.closed,
      pending: this.phase !== "idle",
      committing: this.pending,
    });
  }

  appendInventoryView(inventory, entry) {
    try {
      const { template } = saleEntry(entry, this.items);
      const rechargeable = isRechargeable(entry.id);
      inventory.push(
        Object.freeze({
          ...entry,
          template,
          type: inventoryType(entry.id),
          rechargeable,
          unitPrice: salePrice(template, rechargeable ? entry.count : 1),
          rechargePrice: rechargeable
            ? this.rechargeAmount(entry, template)
            : null,
        }),
      );
    } catch (error) {
      if (error.code !== "item-not-saleable" && error.code !== "item-price") {
        inventory.push(
          Object.freeze({
            ...entry,
            template: this.items[entry.id] ?? null,
            type: inventoryType(entry.id),
            unavailable: true,
            reason: error.message,
          }),
        );
      }
    }
  }

  rechargeAmount(entry, template) {
    try {
      return rechargeCost(this.store.profile, template, entry.count).amount;
    } catch (error) {
      if (
        error.code === "already-recharged" ||
        error.code === "recharge-price"
      ) {
        return null;
      }
      throw error;
    }
  }

  subscribe(listener) {
    if (
      typeof listener !== "function" ||
      this.listeners.size >= SHOP_LIMITS.listeners
    ) {
      throw profileError("shop-listeners", "Invalid shop subscription.");
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    if (this.destroyed) return;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        callHook(this.context, "error", error);
      }
    }
    callHook(this.context, "change");
  }

  admit(profile) {
    if (this.closed || this.destroyed || !this.context.isCurrent()) {
      throw profileError("stale-shop", "This NPC shop is no longer current.");
    }
    if (!profile || profile.hp <= 0 || this.context.isBusy()) {
      throw profileError(
        "shop-busy",
        "The character cannot use this shop now.",
      );
    }
  }

  quote(kind, profile, payload) {
    if (kind === "buy") {
      return buyQuote(
        profile,
        this.items,
        this.rows[payload.row],
        payload.count,
      );
    }
    if (kind === "sell") {
      return sellQuote(profile, this.items, payload.uid, payload.count);
    }
    return rechargeQuote(profile, this.items, payload.uid);
  }

  /** count omitted invokes the native quantity/confirmation hook; a supplied count is an already-admitted intent. */
  buy({ row, count } = {}) {
    return this.execute("buy", { row, count });
  }
  sell({ uid, count } = {}) {
    return this.execute("sell", { uid, count });
  }
  recharge(uid) {
    return this.execute("recharge", { uid });
  }

  selection(kind, payload) {
    if (kind === "buy") {
      shopInteger(payload.row, 0, this.rows.length - 1, "selected row");
      const template = shopTemplate(this.items, this.rows[payload.row].itemId);
      const single =
        isRechargeable(template.id) || inventoryType(template.id) === 1;
      return {
        itemId: template.id,
        maximum: single ? 1 : SHOP_LIMITS.quantity,
        single,
        instance: null,
      };
    }
    const { entry } = saleItem(this.store.profile, this.items, payload.uid);
    if (kind === "sell" && entry.flags & 1) {
      throw profileError(
        "item-sealed",
        "Sealed items cannot be\r\nsold, traded, or dropped.",
      );
    }
    return {
      itemId: entry.id,
      maximum: entry.count,
      single: isRechargeable(entry.id) || inventoryType(entry.id) === 1,
      instance: { ...entry },
    };
  }

  async request(kind, payload, selection) {
    const needsPrompt = kind === "recharge" || payload.count === undefined;
    if (!needsPrompt) return payload;
    if (typeof this.context.prompt !== "function") {
      throw profileError(
        "shop-prompt",
        "The native shop prompt owner is unavailable.",
      );
    }
    const controller = new AbortController();
    this.promptController = controller;
    this.phase = "prompting";
    this.notify();
    const number = kind !== "recharge" && !selection.single;
    const result = await this.context.prompt(
      this.promptOptions(kind, selection, controller.signal),
    );
    if (controller.signal.aborted || !result?.ok) {
      throw profileError("cancelled", "The shop operation was cancelled.");
    }
    if (number) {
      shopInteger(result.value, 1, selection.maximum, "quantity response");
    }
    return {
      ...payload,
      count: number ? result.value : kind === "sell" ? selection.maximum : 1,
    };
  }

  promptOptions(kind, selection, signal) {
    const number = kind !== "recharge" && !selection.single;
    return {
      kind: number ? "number" : "confirm",
      operation: kind,
      text: number ? PROMPTS[kind].number : PROMPTS[kind].confirm,
      min: 1,
      max: Math.max(1, selection.maximum),
      defaultValue: kind === "sell" ? Math.max(1, selection.maximum) : 1,
      itemId: selection.itemId,
      signal,
    };
  }

  revalidate(kind, profile, payload, selection) {
    this.admit(profile);
    if (selection.instance) {
      const current = profile.inventory.find(
        (entry) => entry.uid === payload.uid,
      );
      if (!sameInstance(selection.instance, current)) {
        throw profileError(
          "stale-item",
          "The selected item changed while the shop prompt was open.",
        );
      }
    }
    return this.quote(kind, profile, payload);
  }

  async execute(kind, payload) {
    if (this.phase !== "idle" || this.store.profileTransactionPending) {
      return {
        ok: false,
        code: "shop-busy",
        reason: "A transaction is already pending.",
      };
    }
    this.phase = "preparing";
    let outcome;
    try {
      this.admit(this.store.profile);
      const selection = this.selection(kind, payload);
      const intent = await this.request(kind, payload, selection);
      this.revalidate(kind, this.store.profile, intent, selection);
      this.phase = "committing";
      this.notify();
      let quote;
      await this.store.commitProfile((draft) => {
        quote = this.revalidate(kind, draft, intent, selection);
        applyShopQuote(draft, quote);
      });
      outcome = {
        ok: true,
        kind,
        itemId: quote.itemId,
        uid: quote.uid,
        count: quote.units,
        amount: quote.amount,
        currency: quote.currency,
        revision: this.store.revision,
      };
      this.lastTransaction = Object.freeze(outcome);
      callHook(this.context, "transaction", outcome);
    } catch (error) {
      outcome = failure(error);
      if (error.code !== "cancelled") callHook(this.context, "error", error);
    } finally {
      this.promptController = null;
      this.phase = "idle";
      this.notify();
    }
    return outcome;
  }

  close() {
    if (this.pending) {
      return {
        ok: false,
        code: "shop-busy",
        reason: "Wait for the current transaction to finish.",
      };
    }
    if (this.closed) return { ok: true, code: "closed" };
    this.closed = true;
    this.promptController?.abort();
    this.notify();
    callHook(this.context, "close");
    return { ok: true, code: "closed" };
  }

  destroy() {
    const outcome = this.close();
    if (!outcome.ok) return outcome;
    this.destroyed = true;
    this.unsubscribeStore();
    this.listeners.clear();
    return outcome;
  }
}
