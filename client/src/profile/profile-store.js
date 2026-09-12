import {
  createAccountStorage,
  validateAccountStorage,
  compareAccountStorage,
} from "./account-storage.js";
import {
  createProfile,
  migrateProfile,
  profileError,
  validateProfile,
  validateKeyBindings,
  validateProfileRecord,
  PROFILE_LIMITS,
  validateCharacterId,
  validateCharacterUids,
} from "./profile-validation.js";
import { validateSocialOwner } from "./profile-social.js";
import {
  hasSocialLinks,
  validateSocialCommit,
} from "./profile-social-transaction.js";

const DATABASE = "maple-offline-save";
const DATABASE_VERSION = 2;
const PROFILE_ID = "local";
const AUTOSAVE_MS = 250;
const OPEN_TIMEOUT_MS = 10000;
const TRANSACTION_TIMEOUT_MS = 15000;
const MAX_FLUSH_PASSES = 64;
const MAX_SUBSCRIBERS = 64;
const MAX_PROFILE_NODES = 2000000;

/** Freeze plain validated data outside the tick; retained refs cannot bypass exclusion. */
function freezeProfile(profile) {
  const queue = [profile];
  const seen = new WeakSet(queue);
  for (let index = 0; index < queue.length; index++) {
    if (queue.length > MAX_PROFILE_NODES) {
      throw profileError(
        "profile-limit",
        "Profile graph exceeds bounded freeze.",
      );
    }
    for (const child of Object.values(queue[index])) {
      if (!child || typeof child !== "object" || seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  for (const value of queue) Object.freeze(value);
}

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
      upgradeDatabase(request.result, event.oldVersion);
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

function upgradeDatabase(database, oldVersion) {
  if (oldVersion === 0) {
    database.createObjectStore("profiles", { keyPath: "id" });
  }
  if (oldVersion < 2) {
    database.createObjectStore("accountStorage", { keyPath: "id" });
  }
}

function readProfileRecords(database, ids, account) {
  const transaction = database.transaction(
    account ? ["profiles", "accountStorage"] : ["profiles"],
    "readwrite",
    {
      durability: "strict",
    },
  );
  const store = transaction.objectStore("profiles");
  const countRequest = store.count();
  const requests = ids
    ? ids.map((id) => store.get(id))
    : [store.getAll(undefined, PROFILE_LIMITS.characters + 1)];
  const accountStore = account
    ? transaction.objectStore("accountStorage")
    : null;
  const accountRequest = accountStore?.get("local");
  return {
    transaction,
    store,
    countRequest,
    requests,
    accountStore,
    accountRequest,
  };
}

function transactionFailure(failure, transaction) {
  return storageError(
    failure ??
      transaction.error ??
      profileError("storage-aborted", "Offline save transaction aborted."),
  );
}

/** One transaction owner for single-row saves, bounded roster reads and multi-row CAS. */
function transactProfiles(database, ids, transform, account = false) {
  return new Promise((resolve, reject) => {
    const {
      transaction,
      store,
      countRequest,
      requests,
      accountStore,
      accountRequest,
    } = readProfileRecords(database, ids, account);
    let remaining = requests.length + 1 + Number(account),
      result,
      failure = null;
    const timer = setTimeout(onTimeout, TRANSACTION_TIMEOUT_MS);
    function onTimeout() {
      failure = profileError(
        "storage-timeout",
        "The offline save transaction timed out.",
      );
      try {
        transaction.abort();
      } catch (error) {
        // Terminal complete/abort alone settles a transaction, even when abort is too late.
        if (error.name !== "InvalidStateError") failure = storageError(error);
      }
    }
    function onRead() {
      if (--remaining) return;
      try {
        const current = ids
          ? requests.map((request) => request.result)
          : requests[0].result;
        result = transform(
          current,
          countRequest.result,
          accountRequest?.result,
        );
        writeChangedRecords(result, current, store, accountStore);
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    }
    countRequest.onsuccess = onRead;
    if (accountRequest) accountRequest.onsuccess = onRead;
    for (const request of requests) request.onsuccess = onRead;
    transaction.oncomplete = function onComplete() {
      clearTimeout(timer);
      resolve(result);
    };
    transaction.onabort = function onAbort() {
      clearTimeout(timer);
      reject(transactionFailure(failure, transaction));
    };
    transaction.onerror = function onError(event) {
      failure ??= event.target.error ?? transaction.error;
    };
  });
}

function writeChangedRecords(result, current, store, accountStore) {
  if (result.accountStorage) {
    accountStore.put(result.accountStorage);
  }
  for (let index = 0; index < result.length; index++) {
    if (result[index] !== current[index]) {
      store.put(result[index]);
    }
  }
}

async function transactProfile(database, id, transform) {
  const records = await transactProfiles(database, [id], (current, count) => [
    transform(current[0], count),
  ]);
  return records[0];
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

function nextRecord(profile, previous, id, reset = false) {
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
    id,
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

function characterSummary(record, items) {
  try {
    const profile = migrateProfile(record.profile, items);
    validateProfileRecord({ ...record, profile }, items);
    return {
      id: record.id,
      name: profile.name,
      level: profile.level,
      job: profile.job,
      location: { ...profile.location },
      revision: record.revision,
      generation: record.generation,
      error: null,
    };
  } catch (error) {
    const failure = storageError(error);
    return {
      id: record.id,
      error: { code: failure.code, message: failure.message },
    };
  }
}

function validateCharacterHandles(stores, transform) {
  if (
    !Array.isArray(stores) ||
    stores.length < 2 ||
    stores.length > PROFILE_LIMITS.characters ||
    typeof transform !== "function" ||
    !stores.every((store) => store instanceof ProfileStore)
  ) {
    throw profileError(
      "invalid-characters",
      "Between two and32 distinct compatible local character handles are required.",
    );
  }
  const ids = new Set();
  for (const store of stores) {
    if (ids.has(store.id) || store.temporary !== stores[0].temporary) {
      throw profileError(
        "invalid-characters",
        "Character handles must have distinct IDs and the same persistence mode.",
      );
    }
    ids.add(store.id);
    validateCharacterHandle(store);
  }
  validateCharacterUids(stores.map((store) => store.profile));
}

function validateCharacterHandle(store) {
  if (
    store._profilePromise ||
    store._resetPromise ||
    store._closing ||
    store._destroyed
  ) {
    throw profileError(
      "save-busy",
      "A participating local character is busy or closed.",
    );
  }
  if (!store.temporary) store._requireDatabase();
  validateCharacterId(store.id);
  validateProfile(store.profile, store._items);
  validateSocialOwner(store.profile.social, store.id);
}

async function persistCharacters(stores, profiles) {
  if (stores[0].temporary) {
    return stores.map((store) => {
      if (store.revision === Number.MAX_SAFE_INTEGER) {
        throw profileError(
          "revision-exhausted",
          "Temporary save revision limit reached.",
        );
      }
      return { revision: store.revision + 1 };
    });
  }
  const expected = stores.map((store) => ({
    revision: store.revision,
    generation: store._generation,
  }));
  return transactProfiles(
    stores[0]._database,
    stores.map((store) => store.id),
    (current) => {
      for (let index = 0; index < stores.length; index++) {
        compareRevision(current[index], expected[index]);
        validateProfileRecord(current[index], stores[index]._items);
      }
      validateCharacterUids(current.map((record) => record.profile));
      return current.map((record, index) =>
        nextRecord(profiles[index], record, stores[index].id),
      );
    },
  );
}

/** Accepted dirty epochs are included in the final snapshots; prior flushes drain first. */
async function commitCharacters(stores, transform, originals, priorFlushes) {
  await Promise.resolve();
  let failure = null;
  const preparations = [];
  try {
    const flushed = await Promise.allSettled(priorFlushes);
    const failed = flushed.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    const drafts = stores.map((store) => structuredClone(store.profile));
    if (transform(drafts) !== undefined) {
      throw profileError(
        "invalid-transform",
        "Character transform must be synchronous and return nothing.",
      );
    }
    for (let index = 0; index < stores.length; index++) {
      validateProfile(drafts[index], stores[index]._items);
      validateSocialOwner(drafts[index].social, stores[index].id);
    }
    validateSocialCommit(
      stores.map((store) => store.id),
      originals,
      drafts,
    );
    validateCharacterUids(drafts);
    const profiles = drafts.map((draft) => structuredClone(draft));
    for (let index = 0; index < stores.length; index++) {
      preparations.push(await stores[index]._prepareResources(profiles[index]));
    }
    const records = await persistCharacters(stores, profiles);
    publishCharacterCohort(stores, profiles, records);
  } catch (error) {
    failure = storageError(error);
    restoreCharacterCohort(stores, originals, failure);
  } finally {
    for (const preparation of preparations) {
      await finishProfileResources(preparation, failure === null);
    }
    for (const store of stores) store._profilePromise = null;
    for (const store of stores) store._schedule();
  }
  const snapshots = stores.map((store) => store.snapshot());
  for (const store of stores) store._notify();
  if (failure) throw failure;
  return snapshots;
}

/** Resource publication failure cannot undo a character transaction that already committed. */
async function finishProfileResources(preparation, committed) {
  if (!preparation) return;
  try {
    await preparation[committed ? "commit" : "discard"]();
  } catch (error) {
    try {
      preparation.report(error);
    } catch (reportError) {
      console.error(
        "Profile resource error reporting failed",
        error,
        reportError,
      );
    }
  }
}

/** Install every committed root before any observer can read the cohort. */
function publishCharacterCohort(stores, profiles, records) {
  for (let index = 0; index < stores.length; index++) {
    const store = stores[index];
    store._profile = profiles[index];
    store.revision = records[index].revision;
    store.savedEpoch = store.dirtyEpoch;
    store.error = null;
    store.status = "saved";
  }
  for (const store of stores) store._publish();
}

function restoreCharacterCohort(stores, originals, failure) {
  for (let index = 0; index < stores.length; index++) {
    stores[index]._profile = originals[index];
    stores[index].error = failure;
    stores[index].status =
      failure.code === "revision-conflict" ? "conflict" : "error";
  }
}

/**
 * Sole owner of one mutable profile root. Call markDirty after each synchronous mutation.
 * Reacquire root/nested refs after reset or any atomic transition, including failure.
 * open always returns a store: inspect error/profile before starting gameplay.
 */
export class ProfileStore {
  constructor(options = {}) {
    Object.defineProperty(this, "id", {
      value: options.id ?? PROFILE_ID,
      enumerable: true,
    });
    this._items = options.items;
    this.prepareResources = options.prepareResources ?? null;
    if (
      this.prepareResources !== null &&
      typeof this.prepareResources !== "function"
    ) {
      throw new TypeError("Profile resource preparation must be a function");
    }
    this._create = false;
    this._initialProfile = null;
    this._profile = null;
    this.error = null;
    this._accountStorage = null;
    this.status = "opening";
    this.revision = undefined;
    this._generation = undefined;
    this.dirtyEpoch = 0;
    this.savedEpoch = 0;
    this._bootstrap = options.location
      ? structuredClone(options.location)
      : undefined;
    this._bootstrapLocation = options.bootstrapLocation ?? null;
    this._database = null;
    this._channel = null;
    this._timer = null;
    this._flushPromise = null;
    this._resetPromise = null;
    this._profilePromise = null;
    this._closePromise = null;
    this._flushTarget = 0;
    this._listeners = new Set();
    this._destroyed = false;
    this.temporary = false;
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

  /** Isolated schema5 store; never opens IDB or attaches browser listeners. */
  static memory(profile, options = {}) {
    validateCharacterId(options.id ?? PROFILE_ID);
    validateProfile(profile, options.items);
    validateSocialOwner(profile.social, options.id ?? PROFILE_ID);
    if (options.accountStorage !== undefined) {
      validateAccountStorage(options.accountStorage, profile, options.items);
    }
    const store = new ProfileStore({ ...options, location: profile.location });
    store._profile = structuredClone(profile);
    if (options.accountStorage !== undefined) {
      store._accountStorage = structuredClone(options.accountStorage);
    }
    store.temporary = true;
    store.revision = 0;
    store._generation = "temporary";
    store.status = "saved";
    return store;
  }

  /** Bounded browser-local roster, including explicit errors for unreadable rows. */
  static async listCharacters(options = {}) {
    const database = await openDatabase();
    try {
      const records = await transactProfiles(
        database,
        null,
        (current, count) => {
          if (count > PROFILE_LIMITS.characters) {
            throw profileError(
              "character-limit",
              "Local character roster exceeds its bounded capacity.",
            );
          }
          return current;
        },
      );
      return records.map((record) => characterSummary(record, options.items));
    } finally {
      database.close();
    }
  }

  /** Creation is an insert in the existing profiles store, never an overwrite or reset. */
  static async createCharacter(options = {}) {
    if (options.profile !== undefined || options.temporary === true) {
      throw profileError(
        "invalid-character-creation",
        "Temporary profiles cannot be promoted into durable characters.",
      );
    }
    const profile = createProfile(options.location);
    if (options.name !== undefined) profile.name = options.name;
    validateProfile(profile, options.items);
    const store = new ProfileStore({
      ...options,
      id: options.id ?? crypto.randomUUID(),
    });
    store._create = true;
    store._initialProfile = profile;
    await store._open();
    return store;
  }

  /** Acquire every exclusion synchronously before draining any accepted work. */
  static commitCharacters(stores, transform) {
    validateCharacterHandles(stores, transform);
    stores = stores.slice();
    const originals = stores.map((store) => structuredClone(store.profile));
    const priorFlushes = stores.map((store) => store._flushPromise);
    for (const store of stores) {
      freezeProfile(store.profile);
      store._clearTimer();
    }
    const pending = commitCharacters(
      stores,
      transform,
      originals,
      priorFlushes,
    );
    for (const store of stores) store._profilePromise = pending;
    for (const store of stores) store._notify();
    return pending;
  }

  get profile() {
    return this._profile;
  }

  get profileTransactionPending() {
    return Boolean(this._profilePromise);
  }

  /** Read an existing save before loading the default map's new-character location. */
  async _resolveBootstrap() {
    if (!this._bootstrapLocation) return;
    const record = await transactProfile(
      this._database,
      this.id,
      (current) => current,
    );
    if (record === undefined) {
      this._bootstrap = structuredClone(await this._bootstrapLocation());
    }
    this._bootstrapLocation = null;
  }

  async _open() {
    try {
      validateCharacterId(this.id);
      this._database = await openDatabase();
      this._database.onversionchange = this._onVersionChange;
      this._database.onclose = this._onDatabaseClose;
      await this._resolveBootstrap();
      const record = await transactProfile(
        this._database,
        this.id,
        (current, count) => {
          if (current !== undefined) {
            if (this._create) {
              throw profileError(
                "character-exists",
                "A local character with this ID already exists.",
              );
            }
            this.revision = revisionOf(current);
            this._generation = generationOf(current);
            const profile = migrateProfile(current.profile, this._items);
            validateProfileRecord({ ...current, profile }, this._items);
            return profile === current.profile
              ? current
              : nextRecord(profile, current, this.id);
          }
          if (!this._create && this.id !== PROFILE_ID) {
            throw profileError(
              "character-missing",
              "The selected local character does not exist.",
            );
          }
          if (count >= PROFILE_LIMITS.characters) {
            throw profileError(
              "character-limit",
              "The local character roster is full.",
            );
          }
          const profile =
            this._initialProfile ?? createProfile(this._bootstrap);
          validateProfile(profile, this._items);
          return nextRecord(profile, undefined, this.id);
        },
      );
      this.revision = revisionOf(record);
      this._generation = generationOf(record);
      validateProfileRecord(record, this._items);
      this._profile = record.profile;
      this.status = "saved";
      this._initialProfile = null;
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

  /** Optional external resource authority; the character database never owns its caches. */
  async _prepareResources(profile) {
    const preparation = await this.prepareResources?.(profile, this);
    if (preparation === null || preparation === undefined) return null;
    if (
      typeof preparation.commit !== "function" ||
      typeof preparation.discard !== "function" ||
      typeof preparation.report !== "function"
    ) {
      throw new TypeError(
        "Profile resource preparation requires complete ownership",
      );
    }
    return preparation;
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

  /** Binding saves use the same whole-profile atomic transaction and exclusion. */
  commitKeyBindings(value) {
    validateKeyBindings(value);
    const bindings = structuredClone(value);
    return this.commitProfile((draft) => {
      draft.keyBindings = bindings;
    });
  }

  /** Published account root is installed before any character commit observer runs. */
  storageSnapshot() {
    return this._accountStorage ? structuredClone(this._accountStorage) : null;
  }

  async readStorage() {
    if (this.temporary) {
      this._accountStorage ??= createAccountStorage();
    } else {
      this._requireDatabase();
      let loaded;
      await transactProfiles(
        this._database,
        [this.id],
        (records, count, account) => {
          loaded = validateAccountStorage(
            account ?? createAccountStorage(),
            this._profile,
            this._items,
          );
          return records;
        },
        true,
      );
      this._accountStorage = loaded;
    }
    return structuredClone(this._accountStorage);
  }

  /** Account and character publish only from one strict IDB transaction completion. */
  async commitStorage(transform, expected) {
    const account = structuredClone(expected);
    validateAccountStorage(account, this._profile, this._items);
    await this.commitProfile((draft) => {
      const result = transform(draft, account);
      if (result !== undefined) {
        throw profileError(
          "invalid-transform",
          "Storage transform must be synchronous and return nothing.",
        );
      }
      validateAccountStorage(account, draft, this._items);
    }, account);
    return structuredClone(this._accountStorage);
  }

  /** Synchronous draft transform; queued flush/reset/close await its durable completion. */
  commitProfile(transform, account = null) {
    if (typeof transform !== "function") {
      throw new TypeError("Profile transform must be a function.");
    }
    if (
      this._profilePromise ||
      this._resetPromise ||
      this._closing ||
      this._destroyed
    ) {
      return Promise.reject(
        profileError("save-busy", "Offline save is busy or closed."),
      );
    }
    validateProfile(this._profile, this._items);
    validateSocialOwner(this._profile.social, this.id);
    const original = structuredClone(this._profile);
    freezeProfile(this._profile);
    const priorFlush = this._flushPromise;
    this._clearTimer();
    this._profilePromise = this._commitProfile(
      transform,
      priorFlush,
      original,
      account,
    );
    this._notify();
    return this._profilePromise;
  }
  async _commitProfile(transform, priorFlush, original, account) {
    await Promise.resolve();
    let failure = null;
    let preparation = null;
    try {
      if (priorFlush) await priorFlush;
      if (!this._profile) {
        throw profileError(
          "profile-unavailable",
          "No offline profile is loaded.",
        );
      }
      const draft = structuredClone(this._profile);
      const result = transform(draft);
      if (result !== undefined) {
        throw profileError(
          "invalid-transform",
          "Profile transform must be synchronous and return nothing.",
        );
      }
      validateProfile(draft, this._items);
      validateSocialOwner(draft.social, this.id);
      validateSocialCommit([this.id], [original], [draft]);
      // A transform may retain its draft: never publish or persist that mutable alias.
      const profile = structuredClone(draft);
      const savedAccount = account ? structuredClone(account) : null;
      const epoch = this.dirtyEpoch;
      preparation = await this._prepareResources(profile);
      const record = await this._persistProfile(
        profile,
        original,
        savedAccount,
      );
      if (savedAccount) {
        savedAccount.revision++;
        this._accountStorage = savedAccount;
      }
      this._profile = profile;
      this.revision = record.revision;
      this.savedEpoch = epoch;
      this.error = null;
      this._publish();
    } catch (error) {
      this._profile = original;
      failure = storageError(error);
    } finally {
      await finishProfileResources(preparation, failure === null);
      this._profilePromise = null;
      this._schedule();
    }
    if (failure) throw this._fail(failure);
    return this._saved();
  }

  async _persistProfile(profile, original, account) {
    if (this.temporary) {
      if (this.revision === Number.MAX_SAFE_INTEGER) {
        throw profileError(
          "revision-exhausted",
          "Temporary save revision limit reached.",
        );
      }
      if (account) compareAccountStorage(this._accountStorage, account);
      return { revision: this.revision + 1 };
    }
    this._requireDatabase();
    const expected = { revision: this.revision, generation: this._generation };
    const records = await transactProfiles(
      this._database,
      [this.id],
      (current, count, stored) => {
        compareRevision(current[0], expected);
        validateProfileRecord(current[0], this._items);
        const result = [nextRecord(profile, current[0], this.id)];
        if (account) {
          validateAccountStorage(
            stored ?? createAccountStorage(),
            original,
            this._items,
          );
          compareAccountStorage(stored, account);
          result.accountStorage = {
            ...account,
            revision: account.revision + 1,
          };
        }
        return result;
      },
      !!account,
    );
    return records[0];
  }

  /** Temporary Save validates a checkpoint but cannot publish it outside this store. */
  _saveMemory() {
    validateProfile(this._profile, this._items);
    validateSocialOwner(this._profile.social, this.id);
    if (this.revision === Number.MAX_SAFE_INTEGER) {
      throw profileError(
        "revision-exhausted",
        "Temporary save revision limit reached.",
      );
    }
    this.revision++;
    this.savedEpoch = this.dirtyEpoch;
    this.error = null;
    return this._saved();
  }

  /** Coalesce overlapping temporary flushes without IDB, timers, or synchronous observer recursion. */
  async _flushMemory() {
    const pendingProfile = this._profilePromise;
    await Promise.resolve();
    let preparation = null;
    try {
      if (pendingProfile) await pendingProfile;
      if (pendingProfile && this.savedEpoch >= this._flushTarget) {
        return this.snapshot();
      }
      for (let pass = 0; pass < MAX_FLUSH_PASSES; pass++) {
        preparation = await this._prepareResources(this._profile);
        const snapshot = this._saveMemory();
        const completed = preparation;
        preparation = null;
        await finishProfileResources(completed, true);
        if (this.savedEpoch >= this._flushTarget) return snapshot;
      }
      throw profileError(
        "save-overload",
        "Temporary save observers exceed the checkpoint bound.",
      );
    } catch (error) {
      await finishProfileResources(preparation, false);
      throw this._fail(error);
    } finally {
      this._flushPromise = null;
    }
  }

  /** Coalesced 250-ms browser checkpoint policy; no validation or cloning in the physics tick. */
  markDirty() {
    if (this._destroyed || this._closing) {
      // Close rejects new gameplay writes; accepted transactions still drain.
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
    if (this.profileTransactionPending) {
      throw profileError("save-busy", "Profile transaction is pending.");
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
      this.temporary ||
      this._timer !== null ||
      this.error ||
      this._profilePromise ||
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
    if (this.savedEpoch === this._flushTarget && !this._profilePromise) {
      return this.error
        ? Promise.reject(this.error)
        : Promise.resolve(this.snapshot());
    }
    this._flushPromise = this.temporary
      ? this._flushMemory()
      : this._flushAll();
    return this._flushPromise;
  }

  async _flushAll() {
    const pendingProfile = this._profilePromise;
    // Yield once so the shared promise exists before notifications or synchronous failures.
    await Promise.resolve();
    let preparation = null;
    try {
      if (pendingProfile) await pendingProfile;
      if (pendingProfile && this.savedEpoch >= this._flushTarget) {
        return this.snapshot();
      }
      for (let pass = 0; pass < MAX_FLUSH_PASSES; pass++) {
        this._requireDatabase();
        const epoch = this.dirtyEpoch;
        validateProfile(this._profile, this._items);
        const profile = structuredClone(this._profile);
        this.status = "saving";
        this._notify();
        const expected = {
          revision: this.revision,
          generation: this._generation,
        };
        preparation = await this._prepareResources(profile);
        const record = await transactProfile(
          this._database,
          this.id,
          (current) => {
            compareRevision(current, expected);
            validateProfileRecord(current, this._items);
            validateSocialOwner(profile.social, this.id);
            validateSocialCommit([this.id], [current.profile], [profile]);
            return nextRecord(profile, current, this.id);
          },
        );
        this.revision = record.revision;
        this.savedEpoch = epoch;
        this.error = null;
        this._publish();
        const completed = preparation;
        preparation = null;
        await finishProfileResources(completed, true);
        if (this.savedEpoch >= this._flushTarget) return this._saved();
      }
      throw profileError(
        "save-overload",
        "Offline save could not catch up with repeated flush requests; pause gameplay and save again.",
      );
    } catch (error) {
      await finishProfileResources(preparation, false);
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
        id: this.id,
        revision: this.revision,
        generation: this._generation,
      });
    } catch (error) {
      console.warn("Offline save invalidation notification failed", error);
    }
  }

  _broadcast(event) {
    const message = event.data;
    if (message?.id !== this.id || !Number.isSafeInteger(message.revision)) {
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

  /** A detached beginner draft using this store's original validated packaged bootstrap. */
  createResetProfile() {
    return validateProfile(createProfile(this._bootstrap), this._items);
  }

  _requireUnlinkedReset() {
    if (hasSocialLinks(this._profile?.social)) {
      throw profileError(
        "social-reset-required",
        "Reset this linked character through the loaded local social authority so every participant is detached atomically.",
      );
    }
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
    this._resetPromise = this.temporary ? this._resetMemory() : this._reset();
    return this._resetPromise;
  }

  async _reset() {
    await Promise.resolve();
    let preparation = null;
    try {
      if (this._profilePromise) await this._profilePromise;
      if (this._flushPromise) {
        try {
          await this._flushPromise;
        } catch (error) {
          this._backgroundFailure(error);
        }
      }
      this._requireUnlinkedReset();
      this._requireDatabase();
      if (this.dirtyEpoch === Number.MAX_SAFE_INTEGER) {
        throw profileError(
          "epoch-exhausted",
          "Offline dirty epoch limit reached.",
        );
      }
      const profile = this.createResetProfile();
      const expected = {
        revision: this.revision,
        generation: this._generation,
      };
      this.status = "resetting";
      this._notify();
      preparation = await this._prepareResources(profile);
      const record = await transactProfile(
        this._database,
        this.id,
        (current) => {
          compareRevision(current, expected);
          return nextRecord(profile, current, this.id, true);
        },
      );
      // Reset deliberately supersedes mutations made before its commit. The root stays stable.
      if (this._profile) Object.assign(this._profile, profile);
      else this._profile = profile;
      this.revision = record.revision;
      this._generation = record.generation;
      this.dirtyEpoch++;
      this.savedEpoch = this.dirtyEpoch;
      this.error = null;
      this._publish();
      const completed = preparation;
      preparation = null;
      await finishProfileResources(completed, true);
      return this._saved();
    } catch (error) {
      await finishProfileResources(preparation, false);
      throw this._fail(error);
    } finally {
      this._resetPromise = null;
      this._schedule();
    }
  }

  /** Reset creates a new beginner profile at the temporary bootstrap, never the durable row. */
  async _resetMemory() {
    await Promise.resolve();
    let preparation = null;
    try {
      if (this._profilePromise) await this._profilePromise;
      if (this._flushPromise) {
        try {
          await this._flushPromise;
        } catch (error) {
          this._backgroundFailure(error);
        }
      }
      this._requireUnlinkedReset();
      if (
        this.dirtyEpoch === Number.MAX_SAFE_INTEGER ||
        this.revision === Number.MAX_SAFE_INTEGER
      ) {
        throw profileError(
          "epoch-exhausted",
          "Temporary reset counter limit reached.",
        );
      }
      const profile = this.createResetProfile();
      preparation = await this._prepareResources(profile);
      Object.assign(this._profile, profile);
      this.dirtyEpoch++;
      const snapshot = this._saveMemory();
      const completed = preparation;
      preparation = null;
      await finishProfileResources(completed, true);
      return snapshot;
    } catch (error) {
      await finishProfileResources(preparation, false);
      throw this._fail(error);
    } finally {
      this._resetPromise = null;
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
      id: this.id,
      persistence: this.temporary ? "temporary" : "durable",
      status: this.status,
      revision: this.revision ?? null,
      generation: this._generation ?? null,
      dirty: this.dirtyEpoch > this.savedEpoch,
      dirtyEpoch: this.dirtyEpoch,
      savedEpoch: this.savedEpoch,
      profileTransactionPending: this.profileTransactionPending,
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
