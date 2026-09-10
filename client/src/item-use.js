import { consumeItem, firstItem } from "./inventory-model.js";
import { applyItemVitals, prepareItemSpec } from "./item-effects.js";

const USE_INTERVAL_MS = 200; // 004efd25, call004f0400 -> 00485bf7(200, 0).
const OK = Object.freeze({ ok: true });

/** Prepared local authority: no transient effect or vital change before durable completion. */
export class ItemUse {
  constructor(store, catalog, hooks) {
    this.store = store;
    this.catalog = catalog;
    this.hooks = hooks;
    this.lastUse = -Infinity;
    this.pending = null;
    this.lastResult = null;
    this.destroyed = false;
  }

  admissionError(profile, now, committing = false) {
    if (
      this.destroyed ||
      !profile ||
      profile.hp <= 0 ||
      (!committing && this.hooks.isBlocked(this))
    ) {
      return "Character is dead, unavailable or input is modal";
    }
    if (!committing && this.store.profileTransactionPending) {
      return "A profile operation is already pending";
    }
    if (!Number.isFinite(now) || now - this.lastUse < USE_INTERVAL_MS) {
      return "Item admission interval is active";
    }
    return null;
  }

  stack(profile, id, uid) {
    const entry =
      uid === null
        ? firstItem(profile, id)
        : profile.inventory.find((record) => record.uid === uid);
    if (
      !entry ||
      entry.id !== id ||
      entry.count < 1 ||
      (entry.expiresAt !== null && entry.expiresAt <= Date.now())
    ) {
      throw new Error("Selected item instance is missing or expired");
    }
    return entry;
  }

  /** Promise always settles to an outcome, including abort/conflict and teardown. */
  use(id, uid = null) {
    if (this.pending) {
      return Promise.resolve(
        this.finish({
          ok: false,
          reason: "An item operation is already pending",
        }),
      );
    }
    const denied = this.admissionError(this.store.profile, this.hooks.now());
    if (denied) {
      return Promise.resolve(this.finish({ ok: false, reason: denied }));
    }
    if (!Number.isSafeInteger(id) || Math.floor(id / 1000000) !== 2) {
      return Promise.resolve(
        this.finish({ ok: false, reason: "Invalid consumable ID" }),
      );
    }
    try {
      uid = this.stack(this.store.profile, id, uid).uid;
    } catch (error) {
      return Promise.resolve(this.finish({ ok: false, reason: error.message }));
    }
    const operation = this.consume(id, uid);
    this.pending = operation;
    return operation;
  }

  async consume(id, uid) {
    let prepared = null;
    // The first boundary lets use() establish its pending gate even for preparation failures.
    await Promise.resolve();
    try {
      const entry = this.stack(this.store.profile, id, uid);
      const selectedUid = entry.uid;
      const effect = prepareItemSpec(this.catalog.ui.items[id]);
      if (!effect) {
        throw new Error(
          "This item's original effects or restrictions are not supported locally",
        );
      }
      if (effect.state) prepared = await this.prepareEffect(effect.state);
      const now = this.hooks.now();
      const denied = this.admissionError(this.store.profile, now);
      if (denied) throw new Error(denied);
      if (prepared && prepared.authority.destroyed) {
        throw new Error("Temporary stat owner was destroyed");
      }
      await this.store.commitProfile((draft) => {
        // Input was admitted immediately before commitProfile acquired its lock.
        // isBlocked includes that same lock: never reject our own accepted transaction.
        const reason = this.admissionError(draft, now, true);
        if (reason) throw new Error(reason);
        this.stack(draft, id, selectedUid);
        consumeItem(draft, selectedUid, 1);
        applyItemVitals(draft, effect.values);
      });
      // No await, callbacks or resource work between durable success and reserved publication.
      if (prepared) prepared.authority.publish(prepared);
      this.lastUse = now;
      return this.finish(OK);
    } catch (error) {
      if (prepared) prepared.authority.abort(prepared);
      return this.finish({ ok: false, reason: error.message });
    } finally {
      this.pending = null;
    }
  }

  async prepareEffect(state) {
    const system = this.hooks.skillSystem?.();
    if (
      !system ||
      system.store !== this.store ||
      system.destroyed ||
      typeof this.hooks.prepareTemporaryStat !== "function"
    ) {
      throw new Error("Temporary item effect authority is unavailable");
    }
    const prepared = system.effects.reserve(state);
    try {
      await this.hooks.prepareTemporaryStat("item", state.id);
      if (prepared.authority.destroyed || this.destroyed) {
        throw new Error("Temporary item effect preparation was cancelled");
      }
      return prepared;
    } catch (error) {
      prepared.authority.abort(prepared);
      throw error;
    }
  }

  finish(result) {
    this.lastResult = result;
    if (!result.ok) {
      try {
        this.hooks.report(result.reason);
      } catch (error) {
        console.error("Item use report failed", error);
      }
    }
    return result;
  }

  destroy() {
    this.destroyed = true;
  }
}
