import { ProfileStore } from "../profile/profile-store.js";
import { PROFILE_LIMITS, profileError } from "../profile/profile-validation.js";
import {
  TRADE_MESO_LIMIT,
  TRADE_SLOTS,
  tradeFee,
  tradeInteger,
  tradeParticipants,
  tradeTemplate,
  tradeItemAllowed,
  tradeRechargeable,
  revalidateOffer,
  applyTradeItems,
  applyTradeMesos,
} from "./local-trade-rules.js";

const MAX_LISTENERS = 32;
const MAX_CHAT_LINES = 256; // Bounded browser transcript retention, not a native protocol limit.
const CHAT_LENGTH = 256; // Original edit control construction sets +0x50 to 0x100.
const LOW_LEVEL_MESO_LIMIT = 1000000; // Cosmic Trade.completeTrade, levels below15.
const TERMINAL = new Set(["completed", "cancelled", "declined", "failed"]);

/** One owner per local simulation lifetime; never reconstruct this authority for each room.
 * Cosmic's 'per day' message actually uses Character.mesosTraded's loaded-character lifetime.
 * Counters intentionally follow loaded handles, not an invented durable calendar schema.
 */
export class LocalTradeSession {
  constructor() {
    this.rooms = new Map();
    this.received = new WeakMap();
  }

  claim(room) {
    for (const store of room.stores) {
      if (this.rooms.has(store.id)) {
        throw profileError(
          "trade-busy",
          "A character already has a trade invitation or room.",
        );
      }
    }
    if (this.rooms.size + 2 > PROFILE_LIMITS.characters) {
      throw profileError(
        "trade-room-limit",
        "The local character room limit was reached.",
      );
    }
    for (const store of room.stores) this.rooms.set(store.id, room);
  }

  release(room) {
    for (const store of room.stores) {
      if (this.rooms.get(store.id) === room) this.rooms.delete(store.id);
    }
  }

  isBusy(id) {
    return this.rooms.has(id);
  }

  admit(stores, profiles, mesos) {
    for (let side = 0; side < 2; side++) {
      if (profiles[side].level >= 15) continue;
      const total = (this.received.get(stores[side]) ?? 0) + mesos[1 - side];
      if (total > LOW_LEVEL_MESO_LIMIT) {
        throw profileError(
          "trade-low-level-limit",
          "Characters under level 15 may not receive more than 1 million mesos in this local character session.",
        );
      }
    }
  }

  publish(stores, profiles, mesos) {
    for (let side = 0; side < 2; side++) {
      if (profiles[side].level < 15) {
        this.received.set(
          stores[side],
          (this.received.get(stores[side]) ?? 0) + mesos[1 - side],
        );
      }
    }
  }

  /** Accepted durable work drains; earlier phases cancel without any item/meso debit. */
  async destroy() {
    const rooms = new Set(this.rooms.values());
    await Promise.all(Array.from(rooms, (room) => room.destroy()));
  }
}

function validateStores(stores, catalog, hooks) {
  if (
    !Array.isArray(stores) ||
    stores.length !== 2 ||
    !stores.every((store) => store instanceof ProfileStore && store.profile) ||
    stores[0] === stores[1] ||
    stores[0].id === stores[1].id ||
    stores[0].temporary !== stores[1].temporary
  ) {
    throw profileError(
      "invalid-trade-participants",
      "Two distinct compatible loaded local characters are required.",
    );
  }
  if (!catalog?.ui?.items || !(hooks.session instanceof LocalTradeSession)) {
    throw profileError(
      "trade-authority-missing",
      "The shared LocalTradeSession and original item catalog are required.",
    );
  }
}

function failure(error) {
  return {
    ok: false,
    code: error.code ?? "trade-error",
    reason: error.message ?? String(error),
  };
}

/** Ordinary two-person room. Side0 is the requesting store; side1 alone accepts/declines.
 * hooks.prompt(request)->Promise<boolean|number|null> owns the actual native modal;
 * request contains kind,stringId,text,side,signal and number min/max/value when applicable.
 * hooks.isBusy(store) and hooks.isCurrent(store) must be synchronous scene-authority checks.
 * There is no inventory reservation/debit before the single terminal commitCharacters call.
 */
export class LocalTrade {
  constructor(stores, catalog, hooks = {}) {
    validateStores(stores, catalog, hooks);
    this.stores = Object.freeze(stores.slice());
    this.catalog = catalog;
    this.hooks = hooks;
    this.session = hooks.session;
    this.state = "created";
    this.mapId = stores[0].profile.location.mapId;
    this.offers = [
      Array(TRADE_SLOTS).fill(null),
      Array(TRADE_SLOTS).fill(null),
    ];
    this.mesos = [0, 0];
    this.locked = [false, false];
    this.prompting = [false, false];
    this.messages = [];
    this.listeners = new Set();
    this.controller = new AbortController();
    this.version = 0;
    this.result = null;
    this.pending = null;
    this.disposed = false;
    this.unsubscribers = [];
    this._onStoreChange = this._storeChanged.bind(this);
  }

  subscribe(listener) {
    if (
      typeof listener !== "function" ||
      this.disposed ||
      this.listeners.size >= MAX_LISTENERS
    ) {
      throw profileError(
        "trade-listener",
        "Cannot subscribe to this local trade.",
      );
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    return {
      state: this.state,
      version: this.version,
      mapId: this.mapId,
      participants: this.stores.map((store, side) => ({
        id: store.id,
        name: store.profile.name,
        level: store.profile.level,
        side,
        locked: this.locked[side],
        prompting: this.prompting[side],
        mesos: this.mesos[side],
        fee: tradeFee(this.mesos[side]),
        wallet: store.profile.meso,
        offers: this.offers[side].map(
          (offer) =>
            offer && {
              slot: offer.slot,
              count: offer.count,
              item: { ...offer.item },
            },
        ),
      })),
      messages: this.messages.map((message) => ({ ...message })),
      result: this.result && { ...this.result },
    };
  }

  invite() {
    return this._action(() => {
      if (this.state !== "created") {
        throw profileError(
          "trade-state",
          "This trade request was already sent.",
        );
      }
      this._available();
      try {
        this.session.claim(this);
        for (const store of this.stores) {
          this.unsubscribers.push(store.subscribe(this._onStoreChange));
        }
      } catch (error) {
        return this._finish("failed", failure(error));
      }
      this.state = "invited";
      this._notify();
      return { ok: true, state: this.state, targetId: this.stores[1].id };
    });
  }

  accept(side = 1) {
    return this._action(() => {
      this._invitation(side);
      this._available();
      this.state = "open";
      this._notify();
      return { ok: true, state: this.state };
    });
  }

  decline(side = 1) {
    return this._action(() => {
      this._invitation(side);
      return this._finish("declined", {
        ok: true,
        code: "trade-declined",
        side,
      });
    });
  }

  offerItem(side, proposal) {
    return this._action(() => {
      const item = this._offerSource(side, proposal);
      const slot = proposal.slot;
      const count = tradeInteger(proposal.count, 1, item.count, "quantity");
      if (tradeRechargeable(item.id) && count !== item.count) {
        throw profileError(
          "trade-rechargeable",
          "Throwing stars and bullets must be traded as a whole stack.",
        );
      }
      this.offers[side][slot - 1] = { slot, count, item: { ...item } };
      this._notify();
      return { ok: true };
    });
  }

  /** Ordinary native room has no remove-item request. Removing an offer cancels the room. */
  removeOffer(side, slot) {
    return this._action(() => {
      this._editable(side);
      tradeInteger(slot, 1, TRADE_SLOTS, "slot");
      if (!this.offers[side][slot - 1]) {
        throw profileError("trade-empty-slot", "This trade slot is empty.");
      }
      return this.cancel(side);
    });
  }

  /** Native SET_MESO adds to the current proposal; amount is not a replacement total. */
  offerMesos(side, amount) {
    return this._action(() => {
      this._editable(side);
      const available = this.stores[side].profile.meso - this.mesos[side];
      tradeInteger(amount, 1, available, "mesos");
      // 007c38f9..007c391e: native levels1..15 limit each admitted mesos proposal.
      if (
        this.stores[side].profile.level <= 15 &&
        amount > LOW_LEVEL_MESO_LIMIT
      ) {
        throw profileError(
          "trade-low-level-offer",
          "Players that are Level 15 and below may only trade 1 million mesos at a time.",
        );
      }
      this.mesos[side] += amount;
      this._notify();
      return { ok: true };
    });
  }

  async promptMesos(side) {
    try {
      this._editable(side);
      return await this._prompt(
        side,
        {
          kind: "number",
          stringId: 0x19c,
          text: "How much money will you put up?",
          min: 1,
          max: this.stores[side].profile.meso - this.mesos[side],
          value: 1,
        },
        (amount) => this.offerMesos(side, amount),
      );
    } catch (error) {
      return failure(error);
    }
  }

  /** Carry is transient; source quantity dialog acceptance does not itself reserve or debit. */
  async promptItem(side, proposal) {
    try {
      const item = this._offerSource(side, proposal);
      if (item.count === 1 || tradeRechargeable(item.id)) {
        return this.offerItem(side, { ...proposal, count: item.count });
      }
      return await this._prompt(
        side,
        {
          kind: "number",
          stringId: 0x377,
          text: "How many will you trade?",
          min: 1,
          max: item.count,
          value: item.count,
        },
        (count) => this.offerItem(side, { ...proposal, count }),
      );
    } catch (error) {
      return failure(error);
    }
  }

  /** 007c39a0: Yes first locks only this side; the second lock starts the one durable transfer. */
  async confirm(side) {
    try {
      this._editable(side);
      const bound = this.offers[1 - side].some(
        (offer) =>
          offer &&
          offer.item.flags &
            (Math.floor(offer.item.id / 1000000) === 1 ? 0x10 : 0x02),
      );
      return await this._prompt(
        side,
        {
          kind: "confirm",
          stringId: bound ? 0x1236 : 0x19d,
          text: bound
            ? "Some items you are trying to barter\r\ncannot be traded once received.\r\nWould you still like to proceed?"
            : "Are you sure you want to trade?",
        },
        () => this._lock(side),
      );
    } catch (error) {
      return failure(error);
    }
  }

  cancel(side = 0) {
    return this._action(() => {
      tradeInteger(side, 0, 1, "participant");
      if (this.state === "committing") {
        throw profileError(
          "trade-committing",
          "The accepted trade is being saved.",
        );
      }
      if (TERMINAL.has(this.state)) {
        return { ok: false, code: "trade-ended", state: this.state };
      }
      return this._finish("cancelled", {
        ok: true,
        code: "trade-cancelled",
        side,
      });
    });
  }

  sendChat(side, text) {
    return this._action(() => {
      tradeInteger(side, 0, 1, "participant");
      if (this.state !== "open") {
        throw profileError("trade-state", "The trade room is not open.");
      }
      if (
        typeof text !== "string" ||
        !text.trim() ||
        text.length > CHAT_LENGTH ||
        /[^\u0020-\u007e\u0080-\uffff]/.test(text)
      ) {
        throw profileError(
          "trade-chat",
          "Enter a message of at most 256 characters.",
        );
      }
      if (this.messages.length === MAX_CHAT_LINES) this.messages.shift();
      this.messages.push({ side, name: this.stores[side].profile.name, text });
      this._notify(false);
      return { ok: true };
    });
  }

  _action(operation) {
    try {
      if (this.disposed) {
        throw profileError("trade-closed", "This trade room is closed.");
      }
      return operation();
    } catch (error) {
      return failure(error);
    }
  }

  _invitation(side) {
    if (side !== 1 || this.state !== "invited") {
      throw profileError(
        "trade-invitation",
        "Only the invited participant can answer this request.",
      );
    }
  }

  _available() {
    if (this.disposed) {
      throw profileError("trade-closed", "This trade room is closed.");
    }
    tradeParticipants(
      this.stores.map((store) => store.profile),
      this.mapId,
    );
    for (const store of this.stores) {
      if (
        store.profileTransactionPending ||
        store.status === "closed" ||
        store.error ||
        this.hooks.isBusy?.(store)
      ) {
        throw profileError(
          "trade-busy",
          "A participating character is busy or unavailable.",
        );
      }
      if (this.hooks.isCurrent?.(store) === false) {
        throw profileError(
          "trade-map",
          "A character is no longer in this map.",
        );
      }
    }
  }

  _editable(side) {
    tradeInteger(side, 0, 1, "participant");
    this._available();
    if (this.state !== "open" || this.locked[side] || this.prompting[side]) {
      throw profileError(
        "trade-locked",
        "This trade offer can no longer be changed.",
      );
    }
  }

  _offerSource(side, proposal) {
    this._editable(side);
    const slot = tradeInteger(proposal?.slot, 1, TRADE_SLOTS, "slot");
    if (this.offers[side][slot - 1]) {
      throw profileError("trade-slot-occupied", "This trade slot is occupied.");
    }
    const item = this.stores[side].profile.inventory.find(
      (entry) => entry.uid === proposal.uid,
    );
    if (!item) {
      throw profileError(
        "trade-item-missing",
        "The selected inventory item is missing.",
      );
    }
    if (this.offers[side].some((offer) => offer?.item.uid === item.uid)) {
      throw profileError("trade-item-offered", "This item is already offered.");
    }
    tradeItemAllowed(item, tradeTemplate(this.catalog, item), Date.now());
    return item;
  }

  async _prompt(side, request, apply) {
    try {
      this._editable(side);
      if (typeof this.hooks.prompt !== "function") {
        throw profileError(
          "trade-prompt-missing",
          "The native trade dialog owner is unavailable.",
        );
      }
      if (request.kind === "number") {
        tradeInteger(
          request.max,
          request.min,
          TRADE_MESO_LIMIT,
          "available amount",
        );
      }
      const version = this.version;
      this.prompting[side] = true;
      this._notify(false);
      const answer = await this.hooks.prompt({
        ...request,
        side,
        signal: this.controller.signal,
      });
      this.prompting[side] = false;
      this._notify(false);
      if (answer === null || answer === false) {
        return { ok: false, code: "prompt-cancelled" };
      }
      this._editable(side);
      if (this.version !== version) {
        throw profileError(
          "trade-proposal-changed",
          "The trade changed while the dialog was open. Review the offers again.",
        );
      }
      if (request.kind === "confirm" && answer !== true) {
        throw profileError(
          "trade-confirmation",
          "The trade was not confirmed.",
        );
      }
      return await apply(answer);
    } catch (error) {
      if (side === 0 || side === 1) this.prompting[side] = false;
      this._notify(false);
      return failure(error);
    }
  }

  _lock(side) {
    this._editable(side);
    this.locked[side] = true;
    if (!this.locked[1 - side]) {
      this._notify();
      return { ok: true, state: "locked", side };
    }
    this.state = "committing";
    this.pending = this._commit();
    this._notify();
    return this.pending;
  }

  async _commit() {
    // Publish the pending gate before synchronous transaction admission can reject.
    await Promise.resolve();
    try {
      // Reject ordinary capacity/offer failures before opening a durable transaction.
      // InventoryActions uses the same detached-admission, locked-revalidation boundary.
      this._applyOffers(
        this.stores.map((store) => structuredClone(store.profile)),
      );
      await ProfileStore.commitCharacters(this.stores, (profiles) =>
        this._applyOffers(profiles),
      );
      this.session.publish(
        this.stores,
        this.stores.map((store) => store.profile),
        this.mesos,
      );
      const fees = this.mesos.map(tradeFee);
      return this._finish("completed", {
        ok: true,
        code: "trade-completed",
        fees,
        participantIds: this.stores.map((store) => store.id),
        netReceived: [this.mesos[1] - fees[1], this.mesos[0] - fees[0]],
      });
    } catch (error) {
      return this._finish("failed", failure(error));
    }
  }

  _applyOffers(profiles) {
    const now = Date.now();
    tradeParticipants(profiles, this.mapId);
    for (const store of this.stores) {
      if (this.hooks.isCurrent?.(store) === false) {
        throw profileError("trade-map", "A character left the trade map.");
      }
    }
    this.session.admit(this.stores, profiles, this.mesos);
    const records = this.offers.map((offers, side) =>
      offers
        .filter(Boolean)
        .map((offer) =>
          revalidateOffer(profiles[side], offer, this.catalog, now),
        ),
    );
    applyTradeItems(profiles, records);
    applyTradeMesos(profiles, this.mesos);
  }

  _storeChanged() {
    if (TERMINAL.has(this.state) || this.state === "committing") return;
    try {
      this._available();
    } catch (error) {
      this._finish("cancelled", failure(error));
    }
  }

  _notify(changed = true) {
    if (changed) this.version++;
    for (const listener of this.listeners) {
      try {
        listener(this);
      } catch (error) {
        console.error("Trade observer failed", error);
      }
    }
  }

  _finish(state, result) {
    this.state = state;
    this.result = result;
    this.pending = null;
    this.controller.abort();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.session.release(this);
    this._notify();
    return result;
  }

  async destroy() {
    if (this.disposed) return;
    if (this.state === "committing") await this.pending;
    else if (!TERMINAL.has(this.state)) this.cancel();
    this.disposed = true;
    this.listeners.clear();
  }
}
