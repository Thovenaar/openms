import { nativeOutcome } from "./native-source.js";

const READ_ATTEMPTS = 3;

/** Server-only MTS consumer. Read results are replaced atomically; published profiles are never edited. */
export class NativeMarket {
  constructor(owner) {
    this.owner = owner;
    this.store = owner.store;
    this.catalog = owner.catalog;
    this.query = { tab: "sale", query: "", page: 0, category: 0 };
    this.value = {
      listings: [],
      owned: [],
      transfers: [],
      cart: [],
      balance: 0,
      page: 0,
      more: false,
    };
    this.listeners = new Set();
    this.pending = false;
    this.destroyed = false;
    this.error = "";
    this.timer = null;
    this.queuedQuery = null;
    this.unsubscribe = this.store.subscribe(() => this.publish());
  }

  subscribe(listener) {
    if (this.listeners.size >= 8) {
      throw new Error("MTS observer capacity exceeded");
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish() {
    for (const listener of this.listeners) listener();
  }

  async read(changes = {}) {
    if (this.destroyed) return;
    if (this.pending) {
      this.queuedQuery = { ...this.query, ...this.queuedQuery, ...changes };
      return;
    }
    clearTimeout(this.timer);
    this.timer = null;
    this.query = { ...this.query, ...this.queuedQuery, ...changes };
    this.queuedQuery = null;
    this.pending = true;
    this.publish();
    try {
      const result = await this.requestPage();
      if (this.destroyed) return;
      if (result.ok) {
        this.value = result.value;
        this.error = "";
      } else this.error = result.reason;
    } catch (error) {
      this.error = error.message;
    } finally {
      this.pending = false;
      this.publish();
      if (this.queuedQuery) this.invalidate();
    }
  }

  /** Read-only contention gets a bounded retry; mutation outcomes are never retried here. */
  async requestPage() {
    let result;
    for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
      if (this.destroyed) return { ok: false, reason: "Closed" };
      result = nativeOutcome(
        await this.owner.transport.command({ kind: "mts.read", ...this.query }),
      );
      if (!["SERVER_BUSY", "STALE_REVISION"].includes(result.code)) {
        return result;
      }
      if (attempt + 1 < READ_ATTEMPTS) {
        await new Promise((resolve) => {
          setTimeout(resolve, 150 * (attempt + 1));
        });
      }
    }
    return result;
  }

  async run(action) {
    if (this.pending || this.destroyed) {
      return { ok: false, reason: "Please wait for the current request." };
    }
    this.pending = true;
    this.publish();
    let result;
    try {
      result = await this.owner.request(action);
      this.error = result.ok ? "" : result.reason;
    } catch (error) {
      this.error = error.message;
      result = { ok: false, reason: error.message };
    } finally {
      this.pending = false;
    }
    await this.read();
    return result;
  }

  invalidate() {
    if (this.destroyed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pending) this.invalidate();
      else void this.read();
    }, 150);
  }

  destroy() {
    this.destroyed = true;
    this.queuedQuery = null;
    clearTimeout(this.timer);
    this.unsubscribe();
    this.listeners.clear();
  }
}
