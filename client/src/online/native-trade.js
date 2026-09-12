import { makeAppearanceProfile } from "./read-model.js";
import { unsupported } from "./native-source.js";
import { UPGRADE_STATS } from "../profile/profile-item-state.js";

const STAT_KEYS = ["str", "dex", "int", "luk", "hp", "mp", "pad", "mad", "pdd", "mdd", "acc", "eva", "speed", "jump"];

const STATES = { confirmed: "open", committed: "completed" };

/** Trade views are server escrow observations, never local participant stores. */
export class NativeTrade {
  constructor(owner, event) {
    this.owner = owner;
    this.catalog = owner.catalog;
    this.listeners = new Set();
    this.pending = false;
    this.update(event);
  }
  update(event) {
    this.event = event;
    this.state = STATES[event.state] ?? event.state;
    this.stores = event.participants.map((id) => {
      const member = event.members.find((entry) => entry.id === id);
      if (!member) throw new Error("Trade participant appearance is unavailable.");
      const publicProfile = makeAppearanceProfile(member.appearance);
      const offer = event.offers.find((entry) => entry.ownerId === id);
      return { id, profile: { ...publicProfile, inventory: (offer?.items ?? []).map((entry) => this.item(entry)) } };
    });
    this.changed();
  }
  item(entry) {
    const item = entry.item;
    const result = { uid: item.id, id: item.templateId, count: item.quantity, slot: item.location.slot, owner: item.owner, flags: item.flags, expiresAt: item.expiresAt };
    if (item.equipment) {
      result.upgrade = { slots: item.equipment.upgradesRemaining, level: item.equipment.upgradesUsed, stats: Object.fromEntries(item.equipment.stats.map((stat) => [UPGRADE_STATS[STAT_KEYS.indexOf(stat.key)], stat.value])) };
    }
    return result;
  }
  subscribe(listener) {
    if (this.listeners.size >= 32) throw new Error("Trade observer budget exceeded");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  changed() { for (const listener of this.listeners) listener(); }
  snapshot() {
    const participants = this.stores.map((store, side) => {
      const offer = this.event.offers.find((entry) => entry.ownerId === store.id);
      const offers = Array(9).fill(null);
      for (let index = 0; index < (offer?.items.length ?? 0); index++) {
        const entry = offer.items[index];
        offers[index] = { slot: index + 1, item: this.item(entry), count: entry.quantity };
      }
      return { side, name: store.profile.name, mesos: offer?.mesos ?? 0, wallet: store.id === this.owner.store.id ? this.owner.store.profile.meso : null, offers, locked: Boolean(offer?.confirmed), prompting: this.pending };
    });
    return { state: this.state, participants, messages: [], chatSupported: false, result: this.state === "completed" ? { ok: true, code: "OK" } : { ok: false, code: "trade-cancelled" } };
  }
  accept() { return this.run({ kind: "trade.answer", invitationId: this.event.tradeId, accept: true }); }
  decline() { return this.run({ kind: "trade.answer", invitationId: this.event.tradeId, accept: false }); }
  confirm() { return this.run({ kind: "trade.confirm", tradeId: this.event.tradeId }); }
  cancel() {
    if (this.state === "cancelled" || this.state === "completed") return Promise.resolve({ ok: true });
    return this.run({ kind: "trade.cancel", tradeId: this.event.tradeId });
  }
  observedOffer() {
    const offer = this.event.offers.find((entry) => entry.ownerId === this.owner.store.id);
    return { kind: "trade.offer", tradeId: this.event.tradeId, mesos: offer?.mesos ?? 0, items: (offer?.items ?? []).map((entry) => ({ itemId: entry.item.id, quantity: entry.quantity })) };
  }
  async promptItem(side, proposal) {
    if (this.stores[side]?.id !== this.owner.store.id) return unsupported("acting for another trade participant");
    const item = this.owner.inventory.item(proposal.uid);
    const revision = this.event.revision;
    const quantity = item.count === 1 ? 1 : await this.owner.ui.prompt({ kind: "number", text: "How many will you offer?", value: 1, min: 1, max: item.count, owner: this });
    if (quantity === null) return { ok: false, code: "prompt-cancelled" };
    if (revision !== this.event.revision) return { ok: false, reason: "The trade changed while the quantity prompt was open." };
    const action = this.observedOffer();
    if (action.items.some((entry) => entry.itemId === item.uid)) return { ok: false, reason: "This item is already offered." };
    action.items.push({ itemId: item.uid, quantity });
    return this.run(action);
  }
  async promptMesos(side) {
    if (this.stores[side]?.id !== this.owner.store.id) return unsupported("acting for another trade participant");
    const revision = this.event.revision;
    const value = await this.owner.ui.prompt({ kind: "number", text: "How many mesos will you offer?", value: this.observedOffer().mesos, min: 0, max: this.owner.store.profile.meso, owner: this });
    if (value === null) return { ok: false, code: "prompt-cancelled" };
    if (revision !== this.event.revision) return { ok: false, reason: "The trade changed while the mesos prompt was open." };
    return this.run({ ...this.observedOffer(), mesos: value });
  }
  sendChat() { return unsupported("trade-room chat"); }
  async run(action) {
    if (this.owner.destroyed || this.owner.trade !== this) return { ok: false, code: "SESSION_EXPIRED", reason: "This server trade is no longer observed." };
    if (this.pending) return { ok: false, reason: "A trade request is pending." };
    this.pending = true;
    this.changed();
    try { return await this.owner.request(action, this.event.revision); }
    finally { this.pending = false; this.changed(); }
  }
  async destroy() {
    this.listeners.clear();
    if (!this.owner.destroyed && this.owner.trade === this && this.owner.transport.status === "active") await this.cancel();
  }
}
