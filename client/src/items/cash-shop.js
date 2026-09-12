import { ProfileStore } from "../profile/profile-store.js";
import { profileError } from "../profile/profile-validation.js";
import { grantItem } from "./inventory-model.js";
import {
  CASH_POLICY,
  cashFailure,
  cashCurrency,
  cashOffer,
  cashPurchasePlan,
  deliverCashPurchase,
  debitCashPurchase,
  deliverCashGift,
  claimCashGift,
  addCashItems,
  admitCashTransfer,
} from "./cash-commerce.js";

export { CASH_CURRENCIES, CASH_POLICY } from "./cash-commerce.js";

function clock(hooks) {
  const now = hooks.now ? hooks.now() : Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw profileError(
      "cash-clock",
      "Cash commerce requires a valid wall clock.",
    );
  }
  return now;
}

function requestCopy(request) {
  if (!request || typeof request !== "object") {
    throw profileError("cash-request", "Invalid cash purchase request.");
  }
  return { sn: request.sn, currency: request.currency };
}

function reportObserver(hooks, error) {
  try {
    if (hooks.onError) hooks.onError(error);
    else console.error("Cash Shop observer failed", error);
  } catch (reportError) {
    console.error("Cash Shop observer failed", error, reportError);
  }
}

/** Local, durable commerce. The native UI cannot mint funds; charge is external simulation only. */
export class CashShopService {
  constructor(store, catalog, hooks = {}) {
    if (!catalog?.ui?.cashShop?.commodities || !catalog.ui.cashShop.packages) {
      throw profileError(
        "cash-catalog",
        "Original Commodity.img and CashPackage.img data are unavailable.",
      );
    }
    this.store = store;
    this.catalog = catalog;
    this.hooks = hooks;
    this.listeners = new Set();
    this.pending = false;
    this.closed = false;
    this.destroyed = false;
    this.unsubscribeStore = store.subscribe(() => this.publish());
  }

  snapshot() {
    const profile = this.store.profile;
    return {
      self: {
        id: this.store.id,
        name: profile.name,
        level: profile.level,
        gender: profile.gender,
        job: profile.job,
      },
      balances: profile.cash.balances,
      meso: profile.meso,
      locker: profile.cash.locker,
      gifts: profile.cash.gifts,
      wishlist: profile.cash.wishlist,
      inventory: profile.inventory,
      equipment: profile.equipment,
      pending: this.pending || this.store.profileTransactionPending,
      closed: this.closed,
    };
  }

  subscribe(listener) {
    if (
      typeof listener !== "function" ||
      this.listeners.size >= CASH_POLICY.subscribers
    ) {
      throw new Error("Invalid cash subscriber");
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish() {
    if (this.destroyed) return;
    for (const listener of this.listeners) {
      try {
        listener(this);
      } catch (error) {
        reportObserver(this.hooks, error);
      }
    }
    try {
      this.hooks.onChange?.(this);
    } catch (error) {
      reportObserver(this.hooks, error);
    }
  }

  admit(profile = this.store.profile) {
    if (this.closed || this.destroyed) {
      throw profileError("cash-closed", "The Cash Shop is closed.");
    }
    if (!profile?.cash) {
      throw profileError("cash-profile", "A local cash profile is not loaded.");
    }
    if (profile.hp <= 0) {
      throw profileError("character-dead", "You cannot shop while dead.");
    }
    if (this.hooks.isBusy?.()) {
      throw profileError(
        "save-busy",
        "Finish the current character action first.",
      );
    }
  }

  /** Returns admission/price without reserving, debiting, granting or changing save revisions. */
  quote(request) {
    try {
      this.admit();
      const copy = requestCopy(request);
      const plan = cashPurchasePlan(
        this.store.profile,
        this.catalog,
        copy,
        clock(this.hooks),
      );
      const draft = structuredClone(this.store.profile);
      deliverCashPurchase(draft, this.catalog, plan);
      return {
        ok: true,
        sn: copy.sn,
        price: plan.price,
        currency: copy.currency,
      };
    } catch (error) {
      return cashFailure(error.code ?? "cash-error", error.message);
    }
  }

  async transact(stores, transform, detail = {}) {
    let acquired = false;
    try {
      this.admit();
      if (
        this.pending ||
        stores.some((store) => store.profileTransactionPending)
      ) {
        throw profileError(
          "save-busy",
          "A cash transaction is already pending.",
        );
      }
      this.pending = true;
      acquired = true;
      this.publish();
      if (stores.length === 1) {
        await this.store.commitProfile((draft) => {
          this.admit(draft);
          transform([draft]);
        });
      } else {
        await ProfileStore.commitCharacters(stores, (drafts) => {
          this.admit(drafts[0]);
          transform(drafts);
        });
      }
      return { ok: true, ...detail };
    } catch (error) {
      return cashFailure(error.code ?? "cash-error", error.message);
    } finally {
      if (acquired) {
        this.pending = false;
        this.publish();
      }
    }
  }

  async buy(request) {
    let copy;
    try {
      copy = requestCopy(request);
    } catch (error) {
      return cashFailure(error.code, error.message);
    }
    return this.transact(
      [this.store],
      ([draft]) => {
        const plan = cashPurchasePlan(
          draft,
          this.catalog,
          copy,
          clock(this.hooks),
        );
        deliverCashPurchase(draft, this.catalog, plan);
        debitCashPurchase(draft, copy.currency, plan);
      },
      { action: "buy", sn: copy.sn },
    );
  }

  /** Buy Avatar: every newly tried-on commodity settles together, or none does. */
  buyAvatar(request = {}) {
    const { sns, currency } = request ?? {};
    if (
      !Array.isArray(sns) ||
      !sns.length ||
      sns.length > 30 ||
      new Set(sns).size !== sns.length
    ) {
      return Promise.resolve(
        cashFailure(
          "cash-avatar",
          "Choose a bounded set of different tried-on commodities.",
        ),
      );
    }
    const copy = sns.slice();
    return this.transact(
      [this.store],
      ([draft]) => {
        cashCurrency(currency);
        const now = clock(this.hooks);
        for (const sn of copy) {
          const plan = cashPurchasePlan(
            draft,
            this.catalog,
            { sn, currency },
            now,
          );
          deliverCashPurchase(draft, this.catalog, plan);
          debitCashPurchase(draft, currency, plan);
        }
      },
      { action: "buy-avatar", sns: copy },
    );
  }

  /** Cosmic SERVER-reference action0x06; native004ba419 caps ordinary bags at96. */
  expandInventory(request = {}) {
    const { type, currency } = request ?? {};
    if (!Number.isInteger(type) || type < 1 || type > 4) {
      return Promise.resolve(
        cashFailure(
          "cash-inventory-type",
          "Select an ordinary inventory category.",
        ),
      );
    }
    return this.transact(
      [this.store],
      ([draft]) => {
        cashCurrency(currency);
        if (draft.inventorySlots[type - 1] + 4 > 96) {
          throw profileError(
            "inventory-cap",
            "This inventory cannot be expanded beyond 96 slots.",
          );
        }
        if (draft.cash.balances[currency] < 4000) {
          throw profileError(
            "cash-insufficient",
            "You do not have enough funds for this expansion.",
          );
        }
        draft.inventorySlots[type - 1] += 4;
        draft.cash.balances[currency] -= 4000;
      },
      { action: "expand-inventory", type },
    );
  }

  gift(request) {
    return this.giftMany({ ...request, targetIds: [request?.targetId] });
  }

  /** Native CSGift accepts semicolon-separated names. One local batch has one atomic commit. */
  async giftMany(request) {
    let gift;
    try {
      gift = this.#giftRequest(request);
    } catch (error) {
      return cashFailure(error.code ?? "cash-gift", error.message);
    }
    const { copy, recipients, message } = gift;
    return this.transact(
      [this.store, ...recipients],
      (drafts) => {
        const sender = drafts[0],
          now = clock(this.hooks);
        for (let index = 1; index < drafts.length; index++) {
          const plan = cashPurchasePlan(
            sender,
            this.catalog,
            { ...copy, gift: true },
            now,
          );
          if (plan.meso || plan.expansionType) {
            throw profileError(
              "cash-gift-restricted",
              "This commodity cannot be gifted.",
            );
          }
          deliverCashGift(drafts[index], this.catalog, plan, {
            id: this.store.id,
            name: sender.name,
            message,
          });
          debitCashPurchase(sender, copy.currency, plan);
        }
      },
      {
        action: "gift",
        targetIds: recipients.map((recipient) => recipient.id),
        sn: copy.sn,
      },
    );
  }

  #giftRequest(request) {
    const copy = requestCopy(request);
    if (copy.currency !== "prepaid") {
      throw profileError(
        "cash-gift-currency",
        "Gifts can only be purchased with NX Prepaid.",
      );
    }
    const message = request.message;
    if (
      typeof message !== "string" ||
      !message.trim() ||
      message.length > CASH_POLICY.message
    ) {
      throw profileError(
        "cash-gift-message",
        "Enter a gift message of 1 to 72 characters.",
      );
    }
    const ids = request.targetIds;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 31 ||
      new Set(ids).size !== ids.length
    ) {
      throw profileError(
        "cash-recipient",
        "Choose up to 31 different loaded local recipients.",
      );
    }
    return {
      copy,
      recipients: ids.map((id) => this.giftRecipient(id)),
      message,
    };
  }

  giftRecipient(id) {
    const recipient = this.hooks.getParticipant?.(id);
    if (!(recipient instanceof ProfileStore) || recipient.id !== id) {
      throw profileError(
        "cash-recipient",
        "Select an actual loaded local recipient.",
      );
    }
    if (recipient.id === this.store.id) {
      throw profileError(
        "cash-self-gift",
        "You cannot send gifts to yourself.",
      );
    }
    if (recipient.temporary !== this.store.temporary) {
      throw profileError(
        "cash-recipient",
        "Temporary and durable characters cannot exchange gifts.",
      );
    }
    return recipient;
  }

  moveToInventory(uid) {
    return this.transact(
      [this.store],
      ([draft]) => {
        const index = draft.cash.locker.findIndex((item) => item.uid === uid);
        const item = draft.cash.locker[index];
        const template = admitCashTransfer(
          this.catalog,
          item,
          clock(this.hooks),
        );
        draft.cash.locker.splice(index, 1);
        grantItem(draft, template, item.count, item);
      },
      { action: "move-to-inventory", uid },
    );
  }

  moveToLocker(uid) {
    return this.transact(
      [this.store],
      ([draft]) => {
        const index = draft.inventory.findIndex((item) => item.uid === uid);
        const item = draft.inventory[index];
        if (
          draft.pets.some(
            (pet) => pet.itemUid === uid && pet.summonedSlot !== null,
          )
        ) {
          throw profileError(
            "pet-summoned",
            "Dismiss the pet before moving it to Cash Inventory.",
          );
        }
        admitCashTransfer(this.catalog, item, clock(this.hooks));
        addCashItems(draft, [item]);
        draft.inventory.splice(index, 1);
      },
      { action: "move-to-locker", uid },
    );
  }

  setWishlist(sns) {
    if (
      !Array.isArray(sns) ||
      sns.length > CASH_POLICY.wishlist ||
      new Set(sns).size !== sns.length
    ) {
      return Promise.resolve(
        cashFailure(
          "cash-wishlist",
          "The Wish List holds at most 10 different commodities.",
        ),
      );
    }
    const copy = sns.slice();
    return this.transact(
      [this.store],
      ([draft]) => {
        for (const sn of copy) {
          const offer = cashOffer(this.catalog, sn);
          if (offer.category === 8) {
            throw profileError(
              "cash-wishlist",
              "Meso commodities cannot be added to the Wish List.",
            );
          }
        }
        draft.cash.wishlist = copy;
      },
      { action: "wishlist" },
    );
  }

  claimGift(uid) {
    return this.transact(
      [this.store],
      ([draft]) => {
        const index = draft.cash.gifts.findIndex((gift) => gift.uid === uid);
        const gift = draft.cash.gifts[index];
        if (!gift) {
          throw profileError(
            "cash-gift-missing",
            "This gift was already received or is no longer available.",
          );
        }
        draft.cash.gifts.splice(index, 1);
        claimCashGift(draft, this.catalog, gift, clock(this.hooks));
      },
      { action: "claim-gift", uid },
    );
  }

  /** Explicit outside-game LOCAL SIMULATION API. Never call from the native Charge button. */
  charge(request = {}) {
    const { currency, amount } = request ?? {};
    try {
      cashCurrency(currency);
      if (
        !Number.isSafeInteger(amount) ||
        amount < 1 ||
        amount > CASH_POLICY.balance
      ) {
        throw profileError(
          "cash-charge",
          "The simulation charge must be a positive bounded integer.",
        );
      }
    } catch (error) {
      return Promise.resolve(cashFailure(error.code, error.message));
    }
    return this.transact(
      [this.store],
      ([draft]) => {
        if (draft.cash.balances[currency] + amount > CASH_POLICY.balance) {
          throw profileError(
            "cash-balance-cap",
            "This simulated charge exceeds the balance limit.",
          );
        }
        draft.cash.balances[currency] += amount;
      },
      { action: "simulation-charge", currency, amount },
    );
  }

  close() {
    if (this.pending || this.store.profileTransactionPending) {
      return cashFailure(
        "save-busy",
        "Wait for the pending cash transaction before leaving.",
      );
    }
    this.closed = true;
    this.publish();
    return { ok: true, action: "close" };
  }

  destroy() {
    this.destroyed = true;
    this.closed = true;
    this.unsubscribeStore();
    this.listeners.clear();
  }
}
