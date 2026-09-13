import {
  cashFailure,
  cashPurchasePlan,
  deliverCashPurchase,
} from "../items/cash-commerce.js";

/** Native CashShopService consumer API; proposals never write the published profile. */
export class NativeCashShop {
  constructor(owner) {
    this.owner = owner;
    this.store = owner.store;
    this.catalog = owner.catalog;
    this.pending = false;
    this.closed = false;
    this.destroyed = false;
    this.listeners = new Set();
    this.hooks = {
      preparePreview: (request) => owner.avatars.preparePreview(request),
      socialSnapshot: () => owner.social.snapshot(),
      getParticipant: (id) => owner.social.getParticipant(id),
    };
    this.unsubscribe = this.store.subscribe(() => this.publish());
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
    if (typeof listener !== "function" || this.listeners.size >= 64)
      {throw new Error("Invalid cash subscriber");}
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publish() {
    if (this.destroyed) return;
    for (const listener of this.listeners) listener(this);
  }
  /** Synchronous native price preview; the server recomputes the complete plan on purchase. */
  quote(request) {
    try {
      if (this.closed || this.destroyed)
        {throw new Error("The Cash Shop is closed.");}
      const plan = cashPurchasePlan(
        this.store.profile,
        this.catalog,
        request,
        Date.now(),
      );
      deliverCashPurchase(
        structuredClone(this.store.profile),
        this.catalog,
        plan,
      );
      return {
        ok: true,
        sn: request.sn,
        price: plan.price,
        currency: request.currency,
      };
    } catch (error) {
      return cashFailure(error.code ?? "cash-error", error.message);
    }
  }
  async run(action) {
    if (this.closed || this.destroyed)
      {return cashFailure("cash-closed", "The Cash Shop is closed.");}
    if (this.pending)
      {return cashFailure("save-busy", "A cash transaction is pending.");}
    this.pending = true;
    this.publish();
    try {
      const result = await this.owner.request(action);
      return result.ok && result.value
        ? { ...result, ...result.value }
        : result;
    } finally {
      this.pending = false;
      this.publish();
    }
  }
  async resolveRecipients(names) {
    const result = await this.run({ kind: "cash.recipients", names });
    if (!result.ok) throw new Error(result.reason);
    return result.recipients;
  }
  buy({ sn, currency }) {
    return this.run({ kind: "cash.buy", sn, currency });
  }
  buyAvatar({ sns, currency }) {
    return this.run({ kind: "cash.buy-avatar", sns, currency });
  }
  expandInventory({ type, currency }) {
    return this.run({ kind: "cash.expand-inventory", type, currency });
  }
  gift(request) {
    return this.giftMany({ ...request, targetIds: [request.targetId] });
  }
  giftMany({ sn, currency, targetIds, message }) {
    return this.run({ kind: "cash.gift", sn, currency, targetIds, message });
  }
  setWishlist(sns) {
    return this.run({ kind: "cash.wishlist", sns });
  }
  claimGift(uid) {
    return this.run({ kind: "cash.claim-gift", uid });
  }
  moveToInventory(uid) {
    return this.run({ kind: "cash.move-to-inventory", uid });
  }
  moveToLocker(uid) {
    return this.run({ kind: "cash.move-to-locker", uid });
  }
  charge() {
    return Promise.resolve(
      cashFailure(
        "unsupported",
        "Payments require an external authorized payment service.",
      ),
    );
  }
  close() {
    if (this.pending || this.store.profileTransactionPending)
      {return cashFailure(
        "save-busy",
        "Wait for the pending cash transaction before leaving.",
      );}
    this.closed = true;
    this.publish();
    return { ok: true, action: "close" };
  }
  destroy() {
    this.destroyed = true;
    this.closed = true;
    this.unsubscribe();
    this.listeners.clear();
  }
}
