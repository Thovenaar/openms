import { applyStorageTransfer, storageRequire } from "./npc-storage-rules.js";
import { StoragePresentation } from "./npc-storage-presentation.js";

/** One active NPC lease; durable account ownership belongs exclusively to ProfileStore. */
export class NpcStorage extends StoragePresentation {
  async open() {
    try {
      this.admit(this.store.profile);
      const account = await this.store.readStorage();
      this.admit(this.store.profile);
      this.account = account;
    } finally {
      this.phase = "idle";
    }
  }

  snapshot() {
    return {
      account: this.store.storageSnapshot(),
      inventory: structuredClone(this.store.profile.inventory),
      meso: this.store.profile.meso,
      pending: this.phase !== "idle",
      committing: this.pending,
      npc: this.context.npc,
    };
  }

  async execute(input) {
    if (this.phase !== "idle") return { ok: false, reason: "Storage is busy." };
    const request = { ...input };
    try {
      this.admit(this.store.profile);
      storageRequire(
        [
          "deposit",
          "withdraw",
          "deposit-meso",
          "withdraw-meso",
          "sort",
        ].includes(request.kind),
        "Unsupported storage operation.",
      );
      storageRequire(this.account, "Account storage has not loaded.");
      this.phase = "preparing";
      await this.prepare(request);
      this.admit(this.store.profile);
      this.phase = "committing";
      this.notify();
      const account = await this.store.commitStorage((draft, storage) => {
        this.admit(draft, true);
        applyStorageTransfer(draft, storage, request, this);
      }, this.account);
      this.account = account;
      this.publish();
      return { ok: true };
    } catch (error) {
      await this.reject(error);
      return { ok: false, code: error.code, reason: error.message };
    } finally {
      this.phase = "idle";
      this.notify();
    }
  }

  publish() {
    try {
      if (!this.closed && this.context.isCurrent()) {
        this.context.onTransaction();
      }
    } catch (error) {
      // Observer failures cannot relabel a durably committed transfer as rolled back.
      console.error("Storage publication observer failed", error);
    }
  }
}
