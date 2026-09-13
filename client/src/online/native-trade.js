import { makeAppearanceProfile } from "./read-model.js";
import { UPGRADE_STATS } from "../profile/profile-item-state.js";
import {
  TRADE_SLOTS,
  tradeFee,
  tradeInteger,
  tradeRechargeable,
  admitTradeMesoProposal,
  tradeConfirmation,
} from "../social/local-trade-rules.js";
import { tradeOutcomePresentation } from "../ui/ui-trading-room.js";
import {
  TRADE_CHAT_LENGTH,
  TRADE_TERMINAL_STATES,
} from "../../../shared/trade-protocol.js";

const STAT_KEYS = [
  "str",
  "dex",
  "int",
  "luk",
  "hp",
  "mp",
  "pad",
  "mad",
  "pdd",
  "mdd",
  "acc",
  "eva",
  "speed",
  "jump",
];
const STATES = { confirmed: "open", committed: "completed" };

function failure(error) {
  return {
    ok: false,
    code: error.code ?? "trade-error",
    reason: error.message,
  };
}

function refuse(code, message) {
  throw Object.assign(new Error(message), { code });
}

/** Trade views are server escrow observations, never local participant stores. */
export class NativeTrade {
  constructor(owner, event) {
    this.owner = owner;
    this.catalog = owner.catalog;
    this.listeners = new Set();
    this.pending = false;
    this.prompting = false;
    this.inflight = null;
    this.disposed = false;
    this.controller = new AbortController();
    this.update(event);
  }
  update(event) {
    if (
      this.event &&
      (event.tradeId !== this.event.tradeId ||
        event.revision < this.event.revision ||
        (this.terminal && !TRADE_TERMINAL_STATES.includes(event.state)))
    )
      {return;}
    this.event = event;
    this.state = STATES[event.state] ?? event.state;
    this.stores = event.participants.map((id) => {
      const member = event.members.find((entry) => entry.id === id);
      const offer = event.offers.find((entry) => entry.ownerId === id);
      if (!member || !offer)
        {throw new Error("Trade participant view is unavailable.");}
      return {
        id,
        profile: {
          ...makeAppearanceProfile(member.appearance),
          inventory: offer.items.map((entry) => this.item(entry)),
        },
      };
    });
    if (this.terminal) this.controller.abort();
    this.changed();
  }
  get terminal() {
    return TRADE_TERMINAL_STATES.includes(this.event?.state);
  }
  get result() {
    const result = this.event.result;
    return result?.code === "trade-failed"
      ? { ...result, code: result.cause }
      : result;
  }
  /** The root uses this only when no existing native room owns terminal presentation. */
  terminalPresentation() {
    if (!this.result) return null;
    const side = this.event.participants.indexOf(this.owner.store.id);
    if (
      (this.result.code === "trade-cancelled" ||
        this.result.code === "trade-declined") &&
      this.result.side === side
    )
      {return null;}
    return { ...this.result, ...tradeOutcomePresentation(this.result, side) };
  }
  item(entry) {
    const item = entry.item;
    const result = {
      uid: item.id,
      id: item.templateId,
      count: item.quantity,
      slot: item.location.slot,
      owner: item.owner,
      flags: item.flags,
      expiresAt: item.expiresAt,
    };
    if (item.equipment) {
      result.upgrade = {
        slots: item.equipment.upgradesRemaining,
        level: item.equipment.upgradesUsed,
        stats: Object.fromEntries(
          item.equipment.stats.map((stat) => [
            UPGRADE_STATS[STAT_KEYS.indexOf(stat.key)],
            stat.value,
          ]),
        ),
      };
    }
    return result;
  }
  subscribe(listener) {
    if (
      typeof listener !== "function" ||
      this.listeners.size >= 32 ||
      this.disposed
    ) {
      throw new Error("Trade observer is unavailable.");
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  changed() {
    for (const listener of this.listeners) listener();
  }
  snapshot() {
    const participants = this.stores.map((store, side) => {
      const offer = this.event.offers.find(
        (entry) => entry.ownerId === store.id,
      );
      const offers = Array(TRADE_SLOTS).fill(null);
      for (const entry of offer.items) {
        offers[entry.slot - 1] = {
          slot: entry.slot,
          item: this.item(entry),
          count: entry.quantity,
        };
      }
      const self = store.id === this.owner.store.id;
      return {
        id: store.id,
        side,
        name: store.profile.name,
        mesos: offer.mesos,
        fee: tradeFee(offer.mesos),
        wallet: self ? this.owner.store.profile.meso : null,
        offers,
        locked: offer.confirmed,
        prompting: self && (this.pending || this.prompting),
      };
    });
    return {
      state: this.state,
      version: this.event.revision,
      participants,
      messages: this.event.messages,
      chatSupported: true,
      chatPending: this.pending,
      result: this.result,
    };
  }
  selfSide() {
    return this.event.participants.indexOf(this.owner.store.id);
  }
  admitSession() {
    if (
      this.owner.destroyed ||
      this.disposed ||
      this.owner.trade !== this ||
      this.owner.transport.status !== "active" ||
      this.terminal
    ) {
      refuse("SESSION_EXPIRED", "This server trade is no longer available.");
    }
  }
  admit(side, editable = false) {
    this.admitSession();
    if (side !== this.selfSide()) {
      refuse("NOT_ALLOWED", "You cannot act for another trade participant.");
    }
    if (this.pending || this.prompting)
      {refuse("CHARACTER_BUSY", "A trade request or dialog is pending.");}
    if (
      editable &&
      (this.state !== "open" || this.event.offers[side].confirmed)
    ) {
      refuse("trade-locked", "This trade offer can no longer be changed.");
    }
  }
  accept(side = this.selfSide()) {
    if (side !== 1 || side !== this.selfSide()) {
      return Promise.resolve({
        ok: false,
        code: "NOT_ALLOWED",
        reason: "Only the invitee can accept.",
      });
    }
    return this.run({
      kind: "trade.answer",
      invitationId: this.event.tradeId,
      accept: true,
    });
  }
  decline(side = this.selfSide()) {
    if (side !== 1 || side !== this.selfSide()) {
      return Promise.resolve({
        ok: false,
        code: "NOT_ALLOWED",
        reason: "Only the invitee can decline.",
      });
    }
    return this.run({
      kind: "trade.answer",
      invitationId: this.event.tradeId,
      accept: false,
    });
  }
  async confirm(side = this.selfSide()) {
    try {
      this.admit(side, true);
      const items = this.event.offers[1 - side].items.map((entry) =>
        this.item(entry),
      );
      const answer = await this.prompt(side, tradeConfirmation(items));
      if (answer !== true) return { ok: false, code: "prompt-cancelled" };
      return await this.run({
        kind: "trade.confirm",
        tradeId: this.event.tradeId,
      });
    } catch (error) {
      return failure(error);
    }
  }
  async cancel(side = this.selfSide()) {
    if (this.terminal) return this.result;
    if (side !== this.selfSide()) {
      return {
        ok: false,
        code: "NOT_ALLOWED",
        reason: "You cannot cancel for another participant.",
      };
    }
    this.controller.abort();
    await Promise.resolve();
    const result = await this.run({
      kind: "trade.cancel",
      tradeId: this.event.tradeId,
    });
    if (!this.terminal) this.controller = new AbortController();
    return result;
  }
  observedOffer() {
    const offer = this.event.offers.find(
      (entry) => entry.ownerId === this.owner.store.id,
    );
    return {
      kind: "trade.offer",
      tradeId: this.event.tradeId,
      mesos: offer.mesos,
      items: offer.items.map((entry) => ({
        itemId: entry.item.id,
        quantity: entry.quantity,
        slot: entry.slot,
      })),
    };
  }
  itemSource(side, proposal) {
    this.admit(side, true);
    tradeInteger(proposal?.slot, 1, TRADE_SLOTS, "slot");
    const offered = this.observedOffer().items;
    if (offered.some((entry) => entry.slot === proposal.slot)) {
      refuse("trade-slot-occupied", "This trade slot is occupied.");
    }
    if (offered.some((entry) => entry.itemId === proposal.uid)) {
      refuse("trade-item-offered", "This item is already offered.");
    }
    const item = this.owner.inventory.item(proposal.uid);
    if (!item)
      {refuse("trade-item-missing", "The selected inventory item is missing.");}
    return item;
  }
  async offerItem(side, proposal) {
    try {
      const item = this.itemSource(side, proposal);
      tradeInteger(proposal.count, 1, item.count, "quantity");
      if (tradeRechargeable(item.id) && proposal.count !== item.count) {
        refuse(
          "trade-rechargeable",
          "Throwing stars and bullets must be traded as a whole stack.",
        );
      }
      const action = this.observedOffer();
      action.items.push({
        itemId: item.uid,
        quantity: proposal.count,
        slot: proposal.slot,
      });
      return await this.run(action);
    } catch (error) {
      return failure(error);
    }
  }
  async promptItem(side, proposal) {
    try {
      const item = this.itemSource(side, proposal);
      const count =
        item.count === 1 || tradeRechargeable(item.id)
          ? item.count
          : await this.prompt(side, {
              kind: "number",
              stringId: 0x377,
              text: "How many will you trade?",
              value: item.count,
              min: 1,
              max: item.count,
            });
      if (count === null) return { ok: false, code: "prompt-cancelled" };
      return await this.offerItem(side, { ...proposal, count });
    } catch (error) {
      return failure(error);
    }
  }
  async offerMesos(side, amount) {
    try {
      this.admit(side, true);
      const action = this.observedOffer();
      tradeInteger(
        amount,
        1,
        this.owner.store.profile.meso - action.mesos,
        "mesos",
      );
      admitTradeMesoProposal(this.owner.store.profile.level, amount);
      action.mesos += amount;
      return await this.run(action);
    } catch (error) {
      return failure(error);
    }
  }
  async promptMesos(side) {
    try {
      this.admit(side, true);
      const max = this.owner.store.profile.meso - this.observedOffer().mesos;
      tradeInteger(max, 1, 2147483647, "available amount");
      const amount = await this.prompt(side, {
        kind: "number",
        stringId: 0x19c,
        text: "How much money will you put up?",
        value: 1,
        min: 1,
        max,
      });
      if (amount === null) return { ok: false, code: "prompt-cancelled" };
      return await this.offerMesos(side, amount);
    } catch (error) {
      return failure(error);
    }
  }
  removeOffer(side, slot) {
    try {
      this.admit(side, true);
      tradeInteger(slot, 1, TRADE_SLOTS, "slot");
      if (!this.observedOffer().items.some((entry) => entry.slot === slot)) {
        refuse("trade-empty-slot", "This trade slot is empty.");
      }
      return this.cancel(side);
    } catch (error) {
      return Promise.resolve(failure(error));
    }
  }
  async prompt(side, request) {
    this.admit(side, true);
    const revision = this.event.revision;
    this.prompting = true;
    this.changed();
    let answer;
    try {
      answer = await this.owner.ui.prompt({
        ...request,
        side,
        owner: this,
        signal: this.controller.signal,
      });
    } finally {
      this.prompting = false;
      this.changed();
    }
    if (answer === null || answer === false) return null;
    this.admit(side, true);
    if (revision !== this.event.revision) {
      refuse(
        "trade-proposal-changed",
        "The trade changed while the dialog was open. Review the offers again.",
      );
    }
    return answer;
  }
  sendChat(side, text) {
    if (
      side !== this.selfSide() ||
      typeof text !== "string" ||
      !text.trim() ||
      text.length > TRADE_CHAT_LENGTH ||
      /[^\u0020-\u007e\u0080-\uffff]/u.test(text)
    ) {
      return Promise.resolve({
        ok: false,
        code: "trade-chat",
        reason: "Enter a message of at most 256 characters.",
      });
    }
    return this.run({ kind: "trade.chat", tradeId: this.event.tradeId, text });
  }
  receiveResult(value) {
    if (value?.kind !== "trade.result" || value.tradeId !== this.event.tradeId)
      {return;}
    const states = {
      "trade-completed": "committed",
      "trade-declined": "declined",
      "trade-cancelled": "cancelled",
      "trade-failed": "failed",
    };
    this.update({
      ...this.event,
      state: states[value.code],
      revision: value.revision,
      result: value,
    });
  }
  async run(action) {
    try {
      this.admit(this.selfSide());
    } catch (error) {
      return failure(error);
    }
    this.pending = true;
    this.changed();
    try {
      this.inflight = this.owner.request(action, this.event.revision);
      const outcome = await this.inflight;
      const value = outcome.receipt?.value;
      this.receiveResult(value);
      if (value?.kind === "trade.feedback") return { ...outcome, ...value };
      if (value?.kind === "trade.result") return { ...outcome, ...this.result };
      return outcome;
    } finally {
      this.inflight = null;
      this.pending = false;
      this.changed();
    }
  }
  async destroy() {
    if (this.disposed) return;
    this.controller.abort();
    this.listeners.clear();
    if (this.inflight) await this.inflight;
    if (
      !this.terminal &&
      !this.owner.destroyed &&
      this.owner.trade === this &&
      this.owner.transport.status === "active"
    ) {
      this.prompting = false;
      await this.cancel();
    }
    this.disposed = true;
  }
}
