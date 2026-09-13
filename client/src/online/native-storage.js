import { StoragePresentation } from "../npc/npc-storage-presentation.js";
import { storageRequire } from "../npc/npc-storage-rules.js";

/** Reuse original selection, quantity, fee confirmations and cancellation; replace only authority ports. */
export class NativeStorage extends StoragePresentation {
  constructor(owner, event) {
    const context = {
      fees: event.fees,
      npc: { id: event.npcId, name: event.npcName },
      isCurrent: () =>
        owner.storage?.event.storageSession === event.storageSession,
      isBusy: () => owner.pending > 0,
      onError: (error) => owner.report(error),
      onClose: () => owner.ui.close("Trunk", true),
      prompt: async (request) => {
        const value = await owner.ui.prompt({
          kind: request.kind,
          text: request.text,
          min: request.min,
          max: request.max,
          value: request.defaultValue,
          signal: request.signal,
          owner: owner.storage,
        });
        return { ok: value !== null && value !== false, value };
      },
    };
    super(owner.store, owner.catalog, context);
    this.owner = owner;
    this.event = event;
    this.account = event.account;
    this.phase = "idle";
  }
  snapshot() {
    return {
      account: this.account,
      inventory: this.store.profile.inventory,
      meso: this.store.profile.meso,
      pending: this.phase !== "idle",
      committing: this.pending,
      npc: this.context.npc,
    };
  }
  update(event) {
    if (event.storageSession !== this.event.storageSession) {
      throw new Error("Storage lease changed");
    }
    this.event = event;
    this.account = event.account;
    this.notify();
  }
  async open() {
    this.admit(this.store.profile);
    storageRequire(this.account, "Account storage has not loaded.");
  }
  async execute(input) {
    if (this.phase !== "idle") return { ok: false, reason: "Storage is busy." };
    const request = { ...input };
    const storageRevision = this.account.revision;
    const characterRevision = this.owner.transport.revisions.character;
    try {
      this.admit(this.store.profile);
      this.phase = "preparing";
      await this.prepare(request);
      this.admit(this.store.profile);
      this.phase = "committing";
      this.notify();
      const result = await this.owner.request(
        {
          kind: "storage.execute",
          storageSession: this.event.storageSession,
          storageRevision,
          request: storageWireRequest(request),
        },
        characterRevision,
      );
      if (!result.ok) {
        await this.reject({ code: result.code, message: result.reason });
      }
      return result;
    } catch (error) {
      await this.reject(error);
      return { ok: false, code: error.code, reason: error.message };
    } finally {
      this.phase = "idle";
      this.notify();
    }
  }
  close() {
    if (this.pending) return { ok: false };
    if (this.closed) return { ok: true };
    this.closed = true;
    this.controller.abort();
    this.owner
      .request({
        kind: "storage.close",
        storageSession: this.event.storageSession,
      })
      .then((result) => {
        if (!result.ok) this.owner.report(result.reason);
      })
      .catch((error) => this.owner.report(error));
    this.context.onClose();
    return { ok: true };
  }
  /** Server retirement is unconditional, including a pending command; never send another close. */
  destroy() {
    this.closed = true;
    this.controller.abort();
    this.unsubscribe();
    this.listeners.clear();
    return { ok: true };
  }
}

function storageWireRequest(request) {
  switch (request.kind) {
    case "deposit":
      return { kind: request.kind, uid: request.uid, count: request.count };
    case "withdraw":
      return { kind: request.kind, uid: request.uid };
    case "deposit-meso":
    case "withdraw-meso":
      return { kind: request.kind, count: request.count };
    case "sort":
      return { kind: request.kind };
    default:
      throw new Error("Unsupported storage operation.");
  }
}
