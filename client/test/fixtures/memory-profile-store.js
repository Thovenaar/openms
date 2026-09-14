import {
  profileError,
  validateKeyBindings,
  validateProfile,
} from "../../src/profile/profile-validation.js";

function transactionError(error) {
  if (error?.name === "ProfileError") return error;
  return profileError(
    "storage-failure",
    `Memory transaction failed: ${error?.message ?? String(error)}`,
    error,
  );
}

/** Minimal transactional profile owner for rule tests; it has no browser persistence. */
export class ProfileStore {
  constructor(profile, options = {}) {
    this.id = options.id ?? "test-character";
    this.items = options.items;
    validateProfile(profile, this.items);
    this.profile = structuredClone(profile);
    this.revision = 0;
    this.error = null;
    this.status = "saved";
    this.dirty = false;
    this.listeners = new Set();
    this.pending = null;
    this.destroyed = false;
  }

  static memory(profile, options) {
    return new ProfileStore(profile, options);
  }

  get profileTransactionPending() {
    return this.pending !== null;
  }

  subscribe(listener) {
    if (this.destroyed) throw profileError("store-closed", "Store is closed.");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) listener(this);
  }

  commitKeyBindings(bindings) {
    validateKeyBindings(bindings);
    return this.commitProfile((draft) => {
      draft.keyBindings = structuredClone(bindings);
    });
  }

  commitProfile(transform) {
    if (typeof transform !== "function") {
      throw new TypeError("Profile transform must be a function.");
    }
    if (this.pending || this.destroyed) {
      return Promise.reject(profileError("save-busy", "Store is busy or closed."));
    }
    const original = structuredClone(this.profile);
    const operation = this.commit(transform, original);
    this.pending = operation;
    this.notify();
    return operation;
  }

  async commit(transform, original) {
    await Promise.resolve();
    try {
      if (this.revision === Number.MAX_SAFE_INTEGER) {
        throw profileError("revision-exhausted", "Profile revision limit reached.");
      }
      const draft = structuredClone(this.profile);
      if (transform(draft) !== undefined) {
        throw profileError(
          "invalid-transform",
          "Profile transform must return nothing.",
        );
      }
      validateProfile(draft, this.items);
      this.profile = structuredClone(draft);
      this.revision++;
      this.dirty = false;
      this.error = null;
      this.status = "saved";
      return this.snapshot();
    } catch (error) {
      this.profile = original;
      this.error = transactionError(error);
      this.status = "error";
      throw this.error;
    } finally {
      this.pending = null;
      this.notify();
    }
  }

  markDirty() {
    if (this.pending || this.destroyed) {
      throw profileError("save-busy", "Store is busy or closed.");
    }
    validateProfile(this.profile, this.items);
    this.dirty = true;
    this.notify();
  }

  async flush() {
    if (this.pending) await this.pending;
    if (this.destroyed) throw profileError("store-closed", "Store is closed.");
    if (this.dirty) {
      if (this.revision === Number.MAX_SAFE_INTEGER) {
        throw profileError("revision-exhausted", "Profile revision limit reached.");
      }
      validateProfile(this.profile, this.items);
      this.revision++;
      this.dirty = false;
      this.error = null;
      this.status = "saved";
      this.notify();
    } else if (this.error) {
      throw this.error;
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      profile: this.profile,
      revision: this.revision,
      status: this.status,
      error: this.error,
      dirty: this.dirty,
    };
  }

  async destroy() {
    if (this.pending) await this.pending;
    if (this.dirty) await this.flush();
    this.destroyed = true;
    this.listeners.clear();
    if (this.error) throw this.error;
    return this.snapshot();
  }
}
