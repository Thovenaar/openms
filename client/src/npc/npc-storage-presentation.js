import { isRechargeable } from "../items/inventory-model.js";
import {
  storageRequire,
  storageInteger,
  storageSelection,
} from "./npc-storage-rules.js";

/** Original storage selection and prompts; concrete adapters own durable transfers. */
export class StoragePresentation {
  constructor(store, catalog, context) {
    this.store = store;
    this.context = context;
    this.items = catalog.ui.items;
    this.fees = context.fees;
    storageInteger(this.fees?.putFee, 0, 2147483647);
    storageInteger(this.fees?.getFee, 0, 2147483647);
    this.account = null;
    this.phase = "loading";
    this.closed = false;
    this.listeners = new Set();
    this.controller = new AbortController();
    this.unsubscribe = store.subscribe(() => this.notify());
  }

  get pending() {
    return this.phase === "committing" || this.phase === "loading";
  }

  admit(profile, committing = false) {
    storageRequire(
      !this.closed && profile?.hp > 0 && this.context.isCurrent(),
      "The storage NPC no longer owns this character.",
      "storage-ownership",
    );
    storageRequire(
      !this.context.isBusy() &&
        (committing || !this.store.profileTransactionPending),
      "The character is busy.",
      "storage-busy",
    );
    storageRequire(
      profile.level >= 15,
      "You may only use the storage once you have reached level 15.",
      "storage-level",
    );
  }
  subscribe(listener) {
    storageRequire(
      this.listeners.size < 64,
      "Storage observer limit exceeded.",
    );
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        this.context.onError(error);
      }
    }
  }
  async prompt(request) {
    this.phase = "prompting";
    this.notify();
    const result = await this.context.prompt({
      ...request,
      signal: this.controller.signal,
    });
    storageRequire(
      !this.closed && !this.controller.signal.aborted && result.ok,
      "The storage operation was cancelled.",
      "cancelled",
    );
    return result.value;
  }

  async prepare(request) {
    if (request.kind === "sort") return;
    if (request.kind === "deposit-meso" || request.kind === "withdraw-meso") {
      await this.prepareMeso(request);
      return;
    }
    const { item } = storageSelection(
      this.store.profile,
      this.account,
      request,
      this.items,
    );
    request.instance = { ...item };
    const deposit = request.kind === "deposit";
    if (
      deposit &&
      request.count === undefined &&
      item.count > 1 &&
      !isRechargeable(item.id)
    ) {
      request.count = await this.prompt({
        kind: "number",
        text: "How many will you store?",
        min: 1,
        max: item.count,
        defaultValue: item.count,
      });
    }
    request.count ??= item.count;
    const fee = deposit ? this.fees.putFee : this.fees.getFee;
    const text = deposit
      ? `Storing this will cost ${fee} mesos. Are you sure you want to store this?`
      : `Recovering the items will cost ${fee} mesos. Are you sure you want to recover this?`;
    await this.prompt({ kind: "confirm", text });
  }

  async prepareMeso(request) {
    const deposit = request.kind === "deposit-meso";
    const maximum = deposit ? this.store.profile.meso : this.account.meso;
    storageRequire(
      maximum > 0,
      "You do not have enough mesos.",
      "insufficient-mesos",
    );
    request.count ??= await this.prompt({
      kind: "number",
      text: deposit ? "How much will you save?" : "How much will you take out?",
      min: 1,
      max: maximum,
      defaultValue: 1,
    });
  }
  async reject(error) {
    if (error.code === "cancelled" || this.closed) return;
    this.context.onError(error);
    if (!this.context.isCurrent()) return;
    try {
      await this.prompt({ kind: "notice", text: error.message });
    } catch (noticeError) {
      if (noticeError.code !== "cancelled") this.context.onError(noticeError);
    }
  }

  close() {
    if (this.pending) return { ok: false };
    this.closed = true;
    this.controller.abort();
    this.context.onClose();
    return { ok: true };
  }

  destroy() {
    if (this.pending) return { ok: false };
    this.closed = true;
    this.controller.abort();
    this.unsubscribe();
    this.listeners.clear();
    return { ok: true };
  }
}
