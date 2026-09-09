import {
  createProfile,
  migrateProfile,
  profileError,
  validateProfile,
  validateKeyBindings,
  validateProfileRecord,
} from "./profile-validation.js";

const DATABASE = "maple-offline-save";
const DATABASE_VERSION = 1;
const PROFILE_ID = "local";
const AUTOSAVE_MS = 250;
const OPEN_TIMEOUT_MS = 10000;
const TRANSACTION_TIMEOUT_MS = 15000;
const MAX_FLUSH_PASSES = 64;
const MAX_SUBSCRIBERS = 64;

function storageError(error) {
  if (error?.name === "ProfileError") return error;
  const codes = {
    QuotaExceededError: "storage-quota",
    VersionError: "future-database-version",
    AbortError: "storage-aborted",
    SecurityError: "storage-unavailable",
  };
  return profileError(
    codes[error?.name] ?? "storage-failure",
    `Offline save failed: ${error?.message ?? String(error)}`,
    error,
  );
}

/** Opening never deletes an old database or retries with a lower version. */
function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(
        profileError(
          "storage-unavailable",
          "IndexedDB is unavailable; offline progress cannot be saved.",
        ),
      );
      return;
    }
    let settled = false;
    const request = indexedDB.open(DATABASE, DATABASE_VERSION);
    const timer = setTimeout(onTimeout, OPEN_TIMEOUT_MS);
    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
    function onTimeout() {
      fail(
        profileError(
          "storage-timeout",
          "Opening the offline save timed out. Close other tabs and retry.",
        ),
      );
    }
    request.onblocked = function onBlocked() {
      fail(
        profileError(
          "storage-blocked",
          "Another tab blocks the offline save database upgrade. Close it and reload.",
        ),
      );
    };
    request.onupgradeneeded = function onUpgrade(event) {
      if (settled) {
        request.transaction.abort();
        return;
      }
      if (event.oldVersion === 0) {
        request.result.createObjectStore("profiles", { keyPath: "id" });
      }
    };
    request.onerror = function onError() {
      fail(storageError(request.error));
    };
    request.onsuccess = function onSuccess() {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(request.result);
    };
  });
}

/** Read, compare and replace one structured-clone snapshot in a strictly durable transaction. */
function transactProfile(database, transform) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("profiles", "readwrite", {
      durability: "strict",
    });
    const store = transaction.objectStore("profiles");
    const request = store.get(PROFILE_ID);
    let result;
    let failure = null;
    const timer = setTimeout(onTimeout, TRANSACTION_TIMEOUT_MS);
    function onTimeout() {
      failure = profileError(
        "storage-timeout",
        "The offline save transaction timed out.",
      );
      try {
        transaction.abort();
      } catch (error) {
        reject(storageError(error));
      }
    }
    request.onsuccess = function onRead() {
      try {
        result = transform(request.result);
        if (result !== request.result) store.put(result);
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = function onComplete() {
      clearTimeout(timer);
      resolve(result);
    };
    transaction.onabort = function onAbort() {
      clearTimeout(timer);
      reject(
        storageError(
          failure ??
            transaction.error ??
            profileError(
              "storage-aborted",
              "Offline save transaction aborted.",
            ),
        ),
      );
    };
    transaction.onerror = function onError(event) {
      failure ??= event.target.error ?? transaction.error;
    };
  });
}

/** Invalid revisions can only be replaced by an explicit reset, never an ordinary save. */
function revisionOf(record) {
  if (record === undefined) return undefined;
  return Number.isSafeInteger(record?.revision) && record.revision >= 0
    ? record.revision
    : null;
}

function generationOf(record) {
  if (record === undefined) return undefined;
  return typeof record?.generation === "string" ? record.generation : null;
}

function compareRevision(record, expected) {
  if (
    revisionOf(record) !== expected.revision ||
    generationOf(record) !== expected.generation
  ) {
    throw profileError(
      "revision-conflict",
      "Offline progress changed in another tab. This tab cannot overwrite it; reload to use the saved profile.",
    );
  }
}

function nextRecord(profile, previous, reset = false) {
  const revision = revisionOf(previous);
  if (revision === Number.MAX_SAFE_INTEGER && !reset) {
    throw profileError(
      "revision-exhausted",
      "Offline save revision limit reached.",
    );
  }
  const now = Date.now();
  const createdAt =
    Number.isSafeInteger(previous?.createdAt) && previous.createdAt >= 0
      ? previous.createdAt
      : now;
  return {
    id: PROFILE_ID,
    generation:
      reset || previous === undefined
        ? crypto.randomUUID()
        : previous.generation,
    revision:
      revision === undefined || revision === Number.MAX_SAFE_INTEGER
        ? 0
        : (revision ?? 0) + 1,
    createdAt,
    updatedAt: Math.max(now, createdAt),
    profile,
  };
}

/**
 * Sole owner of one mutable profile root. Call markDirty after each synchronous mutation.
 * Checkpoints clone all domains together; callers must not retain nested refs across reset.
 * open always returns a store: inspect error/profile before starting gameplay.
 */
export class ProfileStore {
  constructor(options = {}) {
    this._profile = null;
    this.error = null;
    this.status = "opening";
    this.revision = undefined;
    this._generation = undefined;
    this.dirtyEpoch = 0;
    this.savedEpoch = 0;
    this._bootstrap = options.location
      ? structuredClone(options.location)
      : undefined;
    this._database = null;
    this._channel = null;
    this._timer = null;
    this._flushPromise = null;
    this._resetPromise = null;
    this._bindingPromise = null;
    this._closePromise = null;
    this._flushTarget = 0;
    this._listeners = new Set();
    this._destroyed = false;
    this._closing = false;
    this._onAutosave = this._autosave.bind(this);
    this._onBackgroundFailure = this._backgroundFailure.bind(this);
    this._onPageHide = this._pageHide.bind(this);
    this._onVisibility = this._visibility.bind(this);
    this._onBroadcast = this._broadcast.bind(this);
    this._onVersionChange = this._versionChange.bind(this);
    this._onDatabaseClose = this._databaseClose.bind(this);
  }

  static async open(options = {}) {
    const store = new ProfileStore(options);
    await store._open();
    return store;
  }

  get profile() {
    return this._profile;
  }

  async _open() {
    try {
      this._database = await openDatabase();
      this._database.onversionchange = this._onVersionChange;
      this._database.onclose = this._onDatabaseClose;
      const record = await transactProfile(this._database, (current) => {
        if (current !== undefined) {
          this.revision = revisionOf(current);
          this._generation = generationOf(current);
          const profile = migrateProfile(current.profile);
          validateProfileRecord({ ...current, profile });
          return profile === current.profile
            ? current
            : nextRecord(profile, current);
        }
        return nextRecord(createProfile(this._bootstrap), undefined);
      });
      this.revision = revisionOf(record);
      this._generation = generationOf(record);
      validateProfileRecord(record);
      this._profile = record.profile;
      this.status = "saved";
    } catch (error) {
      this._fail(error);
    }
    this._attach();
  }

  _attach() {
    globalThis.addEventListener?.("pagehide", this._onPageHide);
    globalThis.document?.addEventListener(
      "visibilitychange",
      this._onVisibility,
    );
    if (!globalThis.BroadcastChannel) return;
    try {
      this._channel = new BroadcastChannel(DATABASE);
      this._channel.onmessage = this._onBroadcast;
    } catch (error) {
      // IDB compare-and-swap remains authoritative without this optional notification channel.
      console.warn("Offline save cross-tab notifications unavailable", error);
    }
  }

  /** Observer callbacks receive the store, not a new profile copy on every gameplay tick. */
  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Save listener must be a function.");
    }
    if (this._destroyed || this._closing) {
      throw profileError("store-closed", "Offline save store is closed.");
    }
    if (this._listeners.size >= MAX_SUBSCRIBERS) {
      throw profileError("listener-limit", "Too many offline save observers.");
    }
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notify() {
    for (const listener of this._listeners) {
      try {
        listener(this);
      } catch (error) {
        console.error("Offline save observer failed", error);
      }
    }
  }

  _fail(error) {
    this.error = storageError(error);
    this.status =
      this.error.code === "revision-conflict" ? "conflict" : "error";
    this._notify();
    return this.error;
  }

  _requireDatabase() {
    if (this._destroyed) {
      throw profileError("store-closed", "Offline save store is closed.");
    }
    if (!this._database) {
      throw (
        this.error ??
        profileError(
          "storage-unavailable",
          "Offline save database is not open.",
        )
      );
    }
  }

  /** Commit only the binding domain; failed IDB writes never publish a draft to gameplay saves. */
  commitKeyBindings(value) {
    if (
      this._bindingPromise ||
      this._resetPromise ||
      this._closing ||
      this._destroyed
    ) {
      return Promise.reject(
        profileError("save-busy", "Offline save is busy or closed."),
      );
    }
    validateKeyBindings(value);
    const bindings = structuredClone(value);
    const priorFlush = this._flushPromise;
    this._clearTimer();
    this._bindingPromise = this._commitKeyBindings(bindings, priorFlush);
    return this._bindingPromise;
  }

  async _commitKeyBindings(bindings, priorFlush) {
    await Promise.resolve();
    try {
      if (priorFlush) await priorFlush;
      this._requireDatabase();
      const epoch = this.dirtyEpoch;
      const profile = structuredClone(this._profile);
      profile.keyBindings = bindings;
      validateProfile(profile);
      const expected = {
        revision: this.revision,
        generation: this._generation,
      };
      this.status = "saving";
      this._notify();
      const record = await transactProfile(this._database, (current) => {
        compareRevision(current, expected);
        validateProfileRecord(current);
        return nextRecord(profile, current);
      });
      this._profile.keyBindings = bindings;
      this.revision = record.revision;
      this.savedEpoch = epoch;
      this.error = null;
      this._publish();
      return this._saved();
    } catch (error) {
      throw this._fail(error);
    } finally {
      this._bindingPromise = null;
      this._schedule();
    }
  }

  /** Coalesced 250-ms browser checkpoint policy; no validation or cloning in the physics tick. */
  markDirty() {
    if (this._destroyed || this._closing) {
      throw profileError(
        "store-closed",
        "Offline save store is closing or closed.",
      );
    }
    if (!this._profile) {
      throw (
        this.error ??
        profileError("profile-unavailable", "No offline profile is loaded.")
      );
    }
    if (this.dirtyEpoch === Number.MAX_SAFE_INTEGER) {
      throw this._fail(
        profileError("epoch-exhausted", "Offline dirty epoch limit reached."),
      );
    }
    this.dirtyEpoch++;
    if (!this.error && !this._flushPromise && !this._resetPromise) {
      this.status = "dirty";
    }
    this._schedule();
    this._notify();
  }

  _schedule() {
    if (
      this._timer !== null ||
      this.error ||
      this._bindingPromise ||
      this._resetPromise ||
      this._closing ||
      this._destroyed
    ) {
      return;
    }
    if (this.dirtyEpoch > this.savedEpoch) {
      this._timer = setTimeout(this._onAutosave, AUTOSAVE_MS);
    }
  }

  _clearTimer() {
    clearTimeout(this._timer);
    this._timer = null;
  }

  _autosave() {
    this._timer = null;
    this.flush().catch(this._onBackgroundFailure);
  }

  _backgroundFailure(error) {
    if (this.error !== error) this._fail(error);
  }

  _pageHide() {
    if (!this._profile || this._destroyed || this._closing) return;
    this.flush().catch(this._onBackgroundFailure);
  }

  _visibility() {
    if (globalThis.document?.visibilityState === "hidden") this._pageHide();
  }

  /** Resolves only after every epoch requested by overlapping flush calls is durably committed. */
  flush() {
    this._clearTimer();
    if (this._resetPromise) return this._resetPromise;
    if (this._destroyed) {
      return Promise.reject(
        profileError("store-closed", "Offline save store is closed."),
      );
    }
    if (!this._profile) {
      return Promise.reject(
        this.error ??
          profileError("profile-unavailable", "No offline profile is loaded."),
      );
    }
    this._flushTarget = this.dirtyEpoch;
    if (this._flushPromise) return this._flushPromise;
    if (this.savedEpoch === this._flushTarget && !this._bindingPromise) {
      return this.error
        ? Promise.reject(this.error)
        : Promise.resolve(this.snapshot());
    }
    this._flushPromise = this._flushAll();
    return this._flushPromise;
  }

  async _flushAll() {
    const pendingBinding = this._bindingPromise;
    // Yield once so the shared promise exists before notifications or synchronous failures.
    await Promise.resolve();
    try {
      if (pendingBinding) await pendingBinding;
      for (let pass = 0; pass < MAX_FLUSH_PASSES; pass++) {
        this._requireDatabase();
        const epoch = this.dirtyEpoch;
        validateProfile(this._profile);
        const profile = structuredClone(this._profile);
        this.status = "saving";
        this._notify();
        const expected = {
          revision: this.revision,
          generation: this._generation,
        };
        const record = await transactProfile(this._database, (current) => {
          compareRevision(current, expected);
          validateProfileRecord(current);
          return nextRecord(profile, current);
        });
        this.revision = record.revision;
        this.savedEpoch = epoch;
        this.error = null;
        this._publish();
        if (this.savedEpoch >= this._flushTarget) return this._saved();
      }
      throw profileError(
        "save-overload",
        "Offline save could not catch up with repeated flush requests; pause gameplay and save again.",
      );
    } catch (error) {
      throw this._fail(error);
    } finally {
      this._flushPromise = null;
      this._schedule();
    }
  }

  _saved() {
    this.status = this.dirtyEpoch > this.savedEpoch ? "dirty" : "saved";
    this._notify();
    return this.snapshot();
  }

  _publish() {
    if (!this._channel) return;
    try {
      this._channel.postMessage({
        id: PROFILE_ID,
        revision: this.revision,
        generation: this._generation,
      });
    } catch (error) {
      console.warn("Offline save invalidation notification failed", error);
    }
  }

  _broadcast(event) {
    const message = event.data;
    if (message?.id !== PROFILE_ID || !Number.isSafeInteger(message.revision)) {
      return;
    }
    if (
      this._destroyed ||
      (message.generation === this._generation &&
        message.revision <= this.revision)
    ) {
      return;
    }
    // This is a hint, never trusted replacement state. The next transaction checks the real row.
    this._fail(
      profileError(
        "revision-conflict",
        "Offline progress changed in another tab. Reload before continuing to avoid losing local changes.",
      ),
    );
    this._clearTimer();
  }

  /** Explicit destructive action: serialized reset replaces the whole record, never delete/create. */
  reset() {
    if (this._closing || this._destroyed) {
      return Promise.reject(
        profileError("store-closed", "Offline save store is closed."),
      );
    }
    if (this._resetPromise) return this._resetPromise;
    this._clearTimer();
    this._resetPromise = this._reset();
    return this._resetPromise;
  }

  async _reset() {
    await Promise.resolve();
    try {
      if (this._bindingPromise) await this._bindingPromise;
      if (this._flushPromise) {
        try {
          await this._flushPromise;
        } catch (error) {
          this._backgroundFailure(error);
        }
      }
      this._requireDatabase();
      if (this.dirtyEpoch === Number.MAX_SAFE_INTEGER) {
        throw profileError(
          "epoch-exhausted",
          "Offline dirty epoch limit reached.",
        );
      }
      const profile = createProfile(this._bootstrap);
      const expected = {
        revision: this.revision,
        generation: this._generation,
      };
      this.status = "resetting";
      this._notify();
      const record = await transactProfile(this._database, (current) => {
        compareRevision(current, expected);
        return nextRecord(profile, current, true);
      });
      // Reset deliberately supersedes mutations made before its commit. The root stays stable.
      if (this._profile) Object.assign(this._profile, profile);
      else this._profile = profile;
      this.revision = record.revision;
      this._generation = record.generation;
      this.dirtyEpoch++;
      this.savedEpoch = this.dirtyEpoch;
      this.error = null;
      this._publish();
      return this._saved();
    } catch (error) {
      throw this._fail(error);
    } finally {
      this._resetPromise = null;
      this._schedule();
    }
  }

  _versionChange() {
    this._database.close();
    this._database = null;
    this._clearTimer();
    this._fail(
      profileError(
        "database-version-changed",
        "Offline save database changed in another tab. Reload this client.",
      ),
    );
  }

  _databaseClose() {
    this._database = null;
    this._clearTimer();
    this._fail(
      profileError(
        "storage-closed",
        "Offline save database closed unexpectedly. Reload this client.",
      ),
    );
  }

  /** Metadata only. Gameplay reads profile; snapshot never exposes IDB handles or mutable aliases. */
  snapshot() {
    return {
      status: this.status,
      revision: this.revision ?? null,
      generation: this._generation ?? null,
      dirty: this.dirtyEpoch > this.savedEpoch,
      dirtyEpoch: this.dirtyEpoch,
      savedEpoch: this.savedEpoch,
      error: this.error
        ? { code: this.error.code, message: this.error.message }
        : null,
    };
  }

  /** Await teardown: final flush failure rejects, but all owned listeners/handles still close. */
  destroy() {
    if (this._closePromise) return this._closePromise;
    this._closePromise = this._close();
    this._closing = true;
    return this._closePromise;
  }

  async _close() {
    try {
      if (this._profile || this._resetPromise) await this.flush();
    } finally {
      this._destroyed = true;
      this._clearTimer();
      globalThis.removeEventListener?.("pagehide", this._onPageHide);
      globalThis.document?.removeEventListener(
        "visibilitychange",
        this._onVisibility,
      );
      if (this._channel) {
        this._channel.onmessage = null;
        this._channel.close();
        this._channel = null;
      }
      if (this._database) {
        this._database.onversionchange = null;
        this._database.onclose = null;
        this._database.close();
        this._database = null;
      }
      this.status = "closed";
      this._notify();
      this._listeners.clear();
    }
  }
}
