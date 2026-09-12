import {
  DELIVERY_LIMITS,
  HASH,
  SHELL_URLS,
  boundedResponse,
  collectDescriptors,
  collectMapResources,
  resourceByteLimit,
  validateRelease,
  verifyBytes,
} from "./offline-manifest.js";

const META_CACHE = "maple-offline-meta-v1";
const RELEASE_PREFIX = "maple-offline-release-v1-";
const META_PATH = "/__maple-offline/";
const RESPONSE_WAIT_MS = 120000;
const RESERVE = 1024 * 1024;

/** FIFO within oldest-created releases; reads never refresh insertion order. */
export class OfflineCache {
  constructor() {
    this.tail = Promise.resolve();
    this.working = new Map();
  }
  serialize(operation) {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }
  protect(name, urls) {
    this.working.set(name, new Set(urls));
  }
  release(name) {
    this.working.delete(name);
  }
  async put(name, url, response) {
    return this.serialize(async () => {
      const cache = await caches.open(name);
      for (
        let attempt = 0;
        attempt <= DELIVERY_LIMITS.resources * DELIVERY_LIMITS.releases;
        attempt++
      ) {
        try {
          await cache.put(url, response.clone());
          return;
        } catch (error) {
          if (error.name !== "QuotaExceededError") throw error;
          const removed = await this.reclaim(
            Number(response.headers.get("Content-Length")) || RESERVE,
            name,
          );
          if (!removed) break;
        }
      }
      throw new Error(
        "Offline working set does not fit browser storage. Current fields, game source, and complete installations were retained; the requested content is not offline-ready. Increase available browser storage or close unused game tabs before retrying.",
      );
    });
  }
  async protectedPaths(cache, name, live) {
    if (await cache.match(META_PATH + "complete")) return null;
    const paths = new Set([...SHELL_URLS, "/generated/catalog.json"]);
    const keys = await cache.keys();
    if (
      keys.length >
      DELIVERY_LIMITS.resources +
        DELIVERY_LIMITS.clients +
        DELIVERY_LIMITS.maps +
        16
    ) {
      throw new Error("Offline cache entry bound exceeded");
    }
    let migrated = false;
    let legacyMap = false;
    let removed = 0;
    for (const key of keys) {
      const path = new URL(key.url).pathname;
      if (path.startsWith(META_PATH + "map-")) legacyMap = true;
      if (!path.startsWith(META_PATH + "working-")) continue;
      if (path === META_PATH + "working-current") migrated = true;
      removed += await this.addWorkingPaths(cache, path, live, paths);
    }
    // Old workers did not record a map's closure. Preserve it until re-admitted.
    if (legacyMap && !migrated) return { keys: [], paths, removed };
    for (const url of this.working.get(name) ?? []) paths.add(url);
    return { keys, paths, removed };
  }
  async addWorkingPaths(cache, path, live, paths) {
    const owner = path.slice((META_PATH + "working-").length);
    if (
      owner !== "current" &&
      !live.has(owner) &&
      !(await self.clients.get(owner))
    ) {
      return (await cache.delete(path)) ? 1 : 0;
    }
    const state = await (await cache.match(path)).json();
    if (
      !Array.isArray(state.urls) ||
      state.urls.length > DELIVERY_LIMITS.resources
    ) {
      throw new Error("Invalid offline working set");
    }
    for (const url of state.urls) paths.add(url);
    return 0;
  }
  async retainedReleases(clients, targetName) {
    const retained = new Set([...this.working.keys(), targetName]);
    for (const pointer of ["active", "partial", "staged"]) {
      const record = await readRecord(pointer);
      if (record) retained.add(record.cacheName);
    }
    for (const client of clients) {
      const record = await readRecord(`client-${client.id}`);
      if (record) retained.add(record.cacheName);
    }
    await collectClientBindings(clients, retained);
    return retained;
  }
  async reclaim(bytes, targetName) {
    const names = (await caches.keys()).filter((name) =>
      name.startsWith(RELEASE_PREFIX),
    );
    if (names.length > DELIVERY_LIMITS.releases) {
      throw new Error("Offline release count exceeds bound");
    }
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    if (clients.length > DELIVERY_LIMITS.clients) {
      throw new Error("Offline client limit exceeded");
    }
    const retained = await this.retainedReleases(clients, targetName);
    const live = new Set(clients.map((client) => client.id));
    const progress = {
      freed: 0,
      removed: 0,
      required: Math.ceil(bytes * 1.1) + RESERVE,
    };
    for (const name of names) {
      if (!retained.has(name)) {
        if (await caches.delete(name)) return 1;
        continue;
      }
      const cache = await caches.open(name);
      const protectedSet = await this.protectedPaths(cache, name, live);
      if (!protectedSet) continue;
      progress.removed += protectedSet.removed;
      await this.reclaimEntries(cache, protectedSet, progress);
      if (progress.freed >= progress.required) return progress.removed;
    }
    return progress.removed;
  }

  async reclaimEntries(cache, protectedSet, progress) {
    for (const key of protectedSet.keys) {
      const path = new URL(key.url).pathname;
      if (path.startsWith(META_PATH) || protectedSet.paths.has(path)) continue;
      const response = await cache.match(key);
      const size = Number(response?.headers.get("x-maple-bytes")) || 0;
      if (await cache.delete(key)) {
        progress.freed += size;
        progress.removed++;
      }
      if (progress.freed >= progress.required) return;
    }
  }
}
const cacheStorage = new OfflineCache();
const NAVIGATION_CHECK_MS = 30000;
const MIME = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json",
  webmanifest: "application/manifest+json",
  png: "image/png",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

function cancellation(signal) {
  if (signal.aborted) {
    throw new DOMException("Offline download cancelled", "AbortError");
  }
}

async function fetchBytes(url, maximum, signal) {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal,
  });
  return boundedResponse(response, maximum, signal);
}

function resourceResponse(bytes, info) {
  const extension = info.url.slice(info.url.lastIndexOf(".") + 1);
  return new Response(bytes, {
    headers: {
      "Content-Type": MIME[extension] ?? "application/octet-stream",
      "Content-Length": String(info.bytes),
      "x-maple-bytes": String(info.bytes),
      "x-maple-sha256": info.sha256,
      "Cache-Control": "no-store",
    },
  });
}

/** Small atomic pointers reference immutable manifests; never duplicate a manifest per client. */
async function readRecord(name, memo = null) {
  const meta = await caches.open(META_CACHE);
  const response = await meta.match(META_PATH + name);
  if (!response) return null;
  const pointer = await response.json();
  if (
    typeof pointer.cacheName !== "string" ||
    !pointer.cacheName.startsWith(RELEASE_PREFIX) ||
    !HASH.test(pointer.releaseId)
  ) {
    throw new Error(`Invalid offline ${name} pointer`);
  }
  const remembered = memo?.get(pointer.cacheName);
  if (remembered?.manifest.releaseId === pointer.releaseId) return remembered;
  const record = await readReleaseRecord(pointer);
  if (memo) {
    if (memo.size >= DELIVERY_LIMITS.releases) memo.clear();
    memo.set(pointer.cacheName, record);
  }
  return record;
}

/** Load and validate the immutable manifest referenced by an already-checked pointer. */
async function readReleaseRecord(pointer) {
  const cache = await caches.open(pointer.cacheName);
  const stored = await cache.match(META_PATH + "manifest");
  if (!stored) {
    throw new Error(
      `Installed manifest missing for ${pointer.releaseId}; re-download online`,
    );
  }
  const bytes = await boundedResponse(stored, DELIVERY_LIMITS.manifestBytes);
  const manifest = await validateRelease(
    JSON.parse(new TextDecoder().decode(bytes)),
  );
  if (manifest.releaseId !== pointer.releaseId) {
    throw new Error("Offline pointer/manifest mismatch");
  }
  return { cacheName: pointer.cacheName, manifest };
}

async function writeRecord(name, record) {
  await cacheStorage.put(
    META_CACHE,
    META_PATH + name,
    Response.json({
      cacheName: record.cacheName,
      releaseId: record.manifest.releaseId,
    }),
  );
}

async function removeRecord(name) {
  await cacheStorage.serialize(async () => {
    const meta = await caches.open(META_CACHE);
    await meta.delete(META_PATH + name);
  });
}

async function verifiedResources(record, resources, options) {
  if (!record) return null;
  const cache = await caches.open(record.cacheName);
  const { port, signal, scope = "shell" } = options;
  const missing = [];
  const pending = [];
  const marker = await cache.match(META_PATH + "complete");
  const complete =
    !!marker && (await marker.json()).releaseId === record.manifest.releaseId;
  if (scope === "release" && !complete) {
    missing.push("Release completion marker");
  }
  const totalBytes = resources.reduce((bytes, info) => bytes + info.bytes, 0);
  let completedBytes = 0;
  let completedEntries = 0;
  let nextNotice = 0;
  for (const info of resources) {
    if (signal) cancellation(signal);
    if (port && performance.now() >= nextNotice) {
      nextNotice = performance.now() + 100;
      port.postMessage({
        type: "VERIFY_PROGRESS",
        progress: {
          completedBytes,
          totalBytes,
          completedEntries,
          totalEntries: resources.length,
          scope,
          current: info.url,
        },
      });
    }
    try {
      const response = await cache.match(info.url);
      if (!response) throw new Error("Not cached");
      await verifyBytes(
        await boundedResponse(response, info.bytes, signal),
        info,
      );
      completedBytes += info.bytes;
      completedEntries++;
    } catch (error) {
      missing.push(`${info.url}: ${error.message}`);
      pending.push(info);
    }
  }
  return {
    record,
    scope,
    complete,
    ready: missing.length === 0,
    completedBytes,
    totalBytes,
    resources: resources.length,
    missing,
    pending,
  };
}

/** Never collect an active, resumable, staged, or live-client-pinned release. */
async function collectCaches(jobName = null) {
  const protectedNames = new Set(jobName ? [jobName] : []);
  for (const name of cacheStorage.working.keys()) {
    protectedNames.add(name);
  }
  for (const name of ["active", "staged", "partial"]) {
    const record = await readRecord(name);
    if (record) protectedNames.add(record.cacheName);
  }
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  if (clients.length > DELIVERY_LIMITS.clients) {
    throw new Error("Offline client limit exceeded");
  }
  for (const client of clients) {
    const record = await readRecord(`client-${client.id}`);
    if (record) protectedNames.add(record.cacheName);
  }
  await collectClientBindings(clients, protectedNames);
  const keys = await caches.keys();
  const releases = keys.filter((name) => name.startsWith(RELEASE_PREFIX));
  if (releases.length > DELIVERY_LIMITS.releases) {
    throw new Error("Offline release count exceeds bound");
  }
  for (const name of releases) {
    if (!protectedNames.has(name)) await caches.delete(name);
  }
}

/** matchAll omits reserved navigation clients; get waits until ready or discarded. */
async function collectClientBindings(clients, protectedNames) {
  const meta = await caches.open(META_CACHE);
  const bindings = await meta.keys();
  if (bindings.length > DELIVERY_LIMITS.clients * DELIVERY_LIMITS.releases) {
    throw new Error("Offline binding count exceeds bound");
  }
  const live = new Set(
    clients.map((client) => `${META_PATH}client-${client.id}`),
  );
  for (const key of bindings) {
    const path = new URL(key.url).pathname;
    if (!path.startsWith(`${META_PATH}client-`) || live.has(path)) continue;
    const id = path.slice(`${META_PATH}client-`.length);
    const client = await self.clients.get(id);
    if (client) {
      const record = await readRecord(`client-${id}`);
      if (record) protectedNames.add(record.cacheName);
    } else await meta.delete(key);
  }
}

function projection(result) {
  if (!result) return null;
  return {
    releaseId: result.record.manifest.releaseId,
    buildId: result.record.manifest.buildId,
    scope: result.scope,
    complete: result.complete,
    totalBytes: result.totalBytes,
    resources: result.resources,
    maps: result.record.manifest.maps,
    unavailableMaps: result.record.manifest.unavailableMaps,
    ready: result.ready,
    completedBytes: result.completedBytes,
    missing: result.missing,
  };
}

/** Owns one cancellable staging job and immutable per-release descriptor indexes. */
export class OfflineService {
  constructor() {
    this.job = null;
    this.activating = false;
    this.responding = 0;
    this.responseQueue = [];
    this.checking = false;
    this.collecting = false;
    this.error = null;
    this.missing = new Set();
    this.records = new Map();
    this.indexes = new Map();
    this.navigation = null;
    this.operationTail = Promise.resolve();
    this.unpublished = new Map();
    this.storage = cacheStorage;
    this.message = this.message.bind(this);
    this.fetch = this.fetch.bind(this);
    this.activateWorker = this.activateWorker.bind(this);
  }
  /** Serialize lifecycle read/modify/write transitions; CacheStorage writes have their own FIFO. */
  serialize(operation) {
    const result = this.operationTail.then(operation);
    this.operationTail = result.catch(() => {});
    return result;
  }
  activateWorker(event) {
    event.waitUntil(self.clients.claim());
  }
  async status(port, clientId) {
    if (this.checking || this.collecting) {
      throw new Error("Offline status backpressure; wait for current work");
    }
    this.checking = true;
    try {
      const activeRecord = await readRecord("active", this.records);
      const active = projection(await this.verifyRecord(activeRecord, port));
      const staged = projection(
        await this.verifyRecord(await readRecord("staged", this.records), port),
      );
      const partialRecord = await readRecord("partial", this.records);
      const partial = projection(await this.verifyRecord(partialRecord, port));
      const pinned = await this.pinStatus(
        clientId,
        {
          activeRecord,
          active,
          partialRecord,
          partial,
        },
        port,
      );
      return {
        active,
        staged,
        partial,
        ...pinned,
        job: this.job?.progress ?? null,
        error: this.error,
        uncached: [...this.missing],
      };
    } finally {
      this.checking = false;
    }
  }
  async pinStatus(clientId, status, port) {
    const pinned = await readRecord(`client-${clientId}`, this.records);
    let result = status.active;
    if (pinned?.cacheName !== status.activeRecord?.cacheName) {
      result =
        pinned?.cacheName === status.partialRecord?.cacheName
          ? status.partial
          : projection(await this.verifyRecord(pinned, port));
    }
    return {
      pinnedReleaseId: pinned?.manifest.releaseId ?? null,
      pinned: result,
    };
  }
  /** Default status hashes only the shell/catalog, never optional map contents. */
  async verifyRecord(record, port = null, scope = "shell") {
    if (!record) return null;
    const resources =
      scope === "release"
        ? record.manifest.resources
        : this.shellResources(record);
    return verifiedResources(record, resources, { port, scope });
  }
  shellResources(record) {
    const inventory = this.resourceIndex(record);
    return [...SHELL_URLS, "/generated/catalog.json"].map((url) =>
      inventory.get(url),
    );
  }
  message(event) {
    if (
      !event.source ||
      new URL(event.source.url).origin !== self.location.origin
    ) {
      return;
    }
    if (event.data?.type === "USE_DELIVERY_WORKER") {
      event.waitUntil(self.skipWaiting());
      return;
    }
    if (!event.ports[0]) return;
    event.waitUntil(this.dispatch(event));
  }
  async dispatch(event) {
    const port = event.ports[0];
    try {
      const result = await this.command(event.data, port, event.source.id);
      port.postMessage({ type: "RESULT", result });
    } catch (error) {
      this.error = `${error.name}: ${error.message}`;
      port.postMessage({ type: "ERROR", error: this.error });
    } finally {
      port.close();
    }
  }

  command(data, port, clientId) {
    switch (data?.type) {
      case "OFFLINE_STATUS":
        return this.status(port, clientId);
      case "DOWNLOAD_RELEASE":
        return this.download(data.releaseId, port);
      case "PREPARE_RELEASE":
        return this.download(data.releaseId, port, true, clientId);
      case "CANCEL_DOWNLOAD":
        return this.cancel();
      case "ACTIVATE_RELEASE":
        return this.activate(data.releaseId, port);
      default:
        return this.workingCommand(data, port, clientId);
    }
  }

  workingCommand(data, port, clientId) {
    switch (data?.type) {
      case "PREPARE_MAP":
        return this.prepareMap(data, port, clientId);
      case "COMMIT_MAP":
        return this.commitMap(data, clientId);
      case "DISCARD_MAP":
        return this.discardPreparation(data, clientId, "map");
      case "PREPARE_PROFILE":
        return this.prepareProfile(data, port, clientId);
      case "COMMIT_PROFILE":
        return this.commitProfile(data, clientId);
      case "DISCARD_PROFILE":
        return this.discardPreparation(data, clientId, "profile");
      case "RETAIN_MAP":
        return this.retainMap(data, clientId);
      case "RELEASE_RETAINED_MAP":
        return this.releaseRetainedMap(data, clientId);
      default:
        throw new Error("Unknown offline command");
    }
  }
  async cancel() {
    if (this.job) {
      if (this.job.committing || this.job.clientId) return { cancelled: false };
      this.error = null;
      this.job.controller.abort();
      return { cancelled: true };
    }
    return this.serialize(async () => {
      const partial = await readRecord("partial");
      if (!partial) return { cancelled: false };
      await removeRecord("partial");
      await this.collect();
      this.error = null;
      return { cancelled: true };
    });
  }
  async findTarget(id, clientId = null) {
    for (const name of [`client-${clientId}`, "partial", "active", "staged"]) {
      const record = await readRecord(name, this.records);
      if (record?.manifest.releaseId === id) return record;
    }
    return null;
  }
  async target(id, clientId) {
    const existing = await this.findTarget(id, clientId);
    if (existing) return existing;
    const bytes = await fetchBytes(
      `/generated/releases/${id}.json`,
      DELIVERY_LIMITS.manifestBytes,
      this.job.controller.signal,
    );
    const manifest = await validateRelease(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    if (manifest.releaseId !== id) {
      throw new Error("Release changed during download");
    }
    const record = {
      cacheName: `${RELEASE_PREFIX}${id}-${crypto.randomUUID()}`,
      manifest,
    };
    this.storage.protect(record.cacheName, []);
    try {
      await this.storage.put(
        record.cacheName,
        META_PATH + "manifest",
        Response.json(manifest),
      );
      const active = await readRecord("active", this.records);
      await this.storage.put(
        record.cacheName,
        META_PATH + "predecessor",
        Response.json({ releaseId: active?.manifest.releaseId ?? null }),
      );
      cancellation(this.job.controller.signal);
      await writeRecord("partial", record);
      return record;
    } catch (error) {
      // No pointer was published: remove only this new, uniquely named cache.
      await this.storage.serialize(() => caches.delete(record.cacheName));
      this.storage.release(record.cacheName);
      throw error;
    }
  }
  /** Exclude pointer readers/publishers throughout the collection snapshot and deletes. */
  async collect(jobName) {
    if (this.responding || this.checking) return;
    if (this.collecting) {
      throw new Error("Offline collection already running");
    }
    this.collecting = true;
    try {
      await this.storage.serialize(() => collectCaches(jobName));
    } finally {
      this.collecting = false;
      this.pumpResponses();
    }
  }
  download(id, port, shellOnly = false, clientId) {
    return this.serialize(() =>
      this.downloadOperation(id, port, shellOnly, clientId),
    );
  }
  async downloadOperation(id, port, shellOnly, clientId) {
    if (this.job || this.activating) {
      throw new Error("An offline installation operation is already running");
    }
    if (!HASH.test(id)) throw new Error("Invalid requested offline release");
    const controller = new AbortController();
    const progress = {
      releaseId: id,
      scope: shellOnly ? "shell" : "release",
      completedEntries: 0,
      completedBytes: 0,
      totalEntries: 0,
      totalBytes: 0,
      current: "release manifest",
    };
    this.job = { controller, progress, committing: false, nextNotice: 0 };
    this.error = null;
    port?.postMessage({ type: "PROGRESS", progress });
    let record = null;
    try {
      record = await this.target(id, clientId);
      await this.collect(record.cacheName);
      await this.stage(record, port, shellOnly);
      cancellation(controller.signal);
      if (shellOnly) {
        await this.adoptLegacyPartial(record);
        return { releaseId: id, ready: true, scope: "shell" };
      }
      this.job.committing = true;
      await writeRecord("staged", record);
      await this.removePartial(record);
      return {
        releaseId: id,
        ready: true,
        scope: "release",
        activationRequired: true,
      };
    } catch (error) {
      if (controller.signal.aborted && !this.job.committing) {
        return this.discardDownload(id, record);
      }
      throw error;
    } finally {
      this.job = null;
      if (record) this.storage.release(record.cacheName);
    }
  }
  /** An older worker may have staged the latest shell without successor metadata. */
  async adoptLegacyPartial(record) {
    const partial = await readRecord("partial", this.records);
    if (partial?.cacheName !== record.cacheName) return;
    const cache = await caches.open(record.cacheName);
    if (await cache.match(META_PATH + "predecessor")) return;
    const bytes = await fetchBytes(
      "/generated/release.json",
      DELIVERY_LIMITS.manifestBytes,
      this.job.controller.signal,
    );
    const latest = await validateRelease(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    if (latest.releaseId !== record.manifest.releaseId) {
      throw new Error(
        "Release changed during shell preparation. Reload to select the latest source.",
      );
    }
    const active = await readRecord("active", this.records);
    await this.storage.put(
      record.cacheName,
      META_PATH + "predecessor",
      Response.json({
        releaseId: active?.manifest.releaseId ?? null,
      }),
    );
  }

  async discardDownload(id, record) {
    const target = record ?? (await readRecord("partial"));
    if (target?.manifest.releaseId === id) await this.removePartial(target);
    await this.collect();
    return { releaseId: id, cancelled: true, ready: false };
  }
  async removePartial(record) {
    const partial = await readRecord("partial", this.records);
    if (partial?.cacheName === record.cacheName) await removeRecord("partial");
  }
  notifyProgress(port) {
    const now = performance.now();
    if (now < this.job.nextNotice) return;
    this.job.nextNotice = now + 100;
    port?.postMessage({ type: "PROGRESS", progress: this.job.progress });
  }
  async stage(record, port, shellOnly = false) {
    const cache = await caches.open(record.cacheName);
    const sources = await this.stagingSources(record, cache);
    const resources = shellOnly
      ? this.shellResources(record)
      : record.manifest.resources;
    this.storage.protect(
      record.cacheName,
      resources.map((info) => info.url),
    );
    await this.stageResources(record, resources, sources, port);
    if (shellOnly) return;
    await this.checkClosure(record.manifest, cache, port);
    cancellation(this.job.controller.signal);
    await this.storage.put(
      record.cacheName,
      META_PATH + "complete",
      Response.json({ releaseId: record.manifest.releaseId }),
    );
    port?.postMessage({ type: "PROGRESS", progress: this.job.progress });
  }
  async stagingSources(record, cache, offline = false) {
    const prior = offline ? null : await readRecord("active", this.records);
    const distinct = prior && prior.cacheName !== record.cacheName;
    return {
      cache,
      cacheName: record.cacheName,
      offline,
      reuse: distinct ? await caches.open(prior.cacheName) : null,
      priorIndex: distinct ? this.resourceIndex(prior) : null,
    };
  }
  async stageResources(record, resources, sources, port) {
    const job = this.job;
    const verified = await verifiedResources(record, resources, {
      port,
      signal: job.controller.signal,
      scope: job.progress.scope,
    });
    if (sources.offline && verified.pending.length) {
      throw new Error(
        `Map resource missing or corrupt offline: ${verified.pending[0].url}`,
      );
    }
    job.progress.totalEntries = resources.length;
    job.progress.totalBytes = verified.totalBytes;
    job.progress.completedEntries = resources.length - verified.pending.length;
    job.progress.completedBytes = verified.completedBytes;
    for (const info of verified.pending) {
      cancellation(job.controller.signal);
      job.progress.current = info.url;
      this.notifyProgress(port);
      await this.stageResource(info, sources, job.controller.signal);
      job.progress.completedEntries++;
      job.progress.completedBytes += info.bytes;
    }
    port?.postMessage({ type: "PROGRESS", progress: job.progress });
  }
  async stageResource(info, sources, signal) {
    const cached = await this.cachedBytes(info, sources.cache);
    if (cached) return cached;
    if (sources.offline) {
      throw new Error(`Map resource missing or corrupt offline: ${info.url}`);
    }
    const previous = sources.priorIndex?.get(info.url);
    let bytes = null;
    if (previous?.sha256 === info.sha256 && previous.bytes === info.bytes) {
      bytes = await this.cachedBytes(info, sources.reuse);
    }
    if (!bytes) bytes = await fetchBytes(info.source, info.bytes, signal);
    await verifyBytes(bytes, info);
    cancellation(signal);
    await this.storage.put(
      sources.cacheName,
      info.url,
      resourceResponse(bytes, info),
    );
    return bytes;
  }
  /** Every lifecycle message belongs to this document's immutable navigation binding. */
  async ownerTarget(data, clientId) {
    if (!HASH.test(data.releaseId)) throw new Error("Invalid offline release");
    const record = await readRecord(`client-${clientId}`, this.records);
    if (!record || record.manifest.releaseId !== data.releaseId) {
      throw new Error("Preparation requires this tab's pinned release");
    }
    return record;
  }
  async mapTarget(data, clientId) {
    const record = await this.ownerTarget(data, clientId);
    if (
      !/^\d{9}$/.test(data.mapId) ||
      !record.manifest.maps.some((map) => map.id === data.mapId)
    ) {
      throw new Error(`Map is not in this release: ${data.mapId}`);
    }
    return record;
  }
  async workingState(record, clientId) {
    const cache = await caches.open(record.cacheName);
    const response = await cache.match(META_PATH + `working-${clientId}`);
    const fallback =
      response ?? (await cache.match(META_PATH + "working-current"));
    const saved = fallback ? await fallback.json() : null;
    if (saved?.schema === 2) {
      if (response) return saved;
      return {
        ...saved,
        pendingMap: null,
        pendingProfile: null,
        retained: null,
        recoveryUrls: [],
      };
    }
    // Old workers stored a single unsplit closure. Keep its current field until adoption.
    return {
      schema: 2,
      releaseId: record.manifest.releaseId,
      map: {
        mapId: saved?.mapId ?? null,
        preparationId: null,
        urls: saved?.currentUrls ?? saved?.urls ?? [],
      },
      profile: { preparationId: null, urls: [] },
      pendingMap: null,
      pendingProfile: null,
      retained: null,
    };
  }
  workingUrls(state, currentOnly = false) {
    const urls = new Set([...state.map.urls, ...state.profile.urls]);
    if (!currentOnly) {
      for (const url of state.recoveryUrls ?? []) urls.add(url);
      for (const entry of [
        state.pendingMap,
        state.pendingProfile,
        state.retained,
      ]) {
        for (const url of entry?.urls ?? []) urls.add(url);
      }
    }
    if (urls.size > DELIVERY_LIMITS.resources) {
      throw new Error("Offline working set exceeds bound");
    }
    return [...urls];
  }
  async saveWorking(record, clientId, state) {
    const urls = this.workingUrls(state);
    await this.storage.put(
      record.cacheName,
      META_PATH + `working-${clientId}`,
      Response.json({ ...state, urls }),
    );
  }
  async publishWorking(record, clientId, state, promote = false) {
    // One bounded recovery closure preserves old+new through every publication write,
    // including temporary worlds whose reload fallback deliberately remains the baseline.
    const previous = await this.workingState(record, clientId);
    state.recoveryUrls = this.workingUrls(previous);
    await this.saveWorking(record, clientId, state);
    await this.publishCurrent(record, state);
    if (promote) {
      await this.promoteMap(record, await caches.open(record.cacheName));
    }
    state.recoveryUrls = [];
    await this.saveWorking(record, clientId, state);
  }
  async publishCurrent(record, state) {
    // Temporary worlds are live-client state; reload must return to the durable baseline.
    const current = {
      ...state,
      map: state.retained?.map ?? state.map,
      profile: state.retained?.profile ?? state.profile,
      pendingMap: null,
      pendingProfile: null,
      retained: null,
      recoveryUrls: [],
    };
    await this.storage.put(
      record.cacheName,
      META_PATH + "working-current",
      Response.json({ ...current, urls: this.workingUrls(current, true) }),
    );
  }
  validatePreparation(data) {
    if (
      typeof data.offline !== "boolean" ||
      !Array.isArray(data.resources) ||
      data.resources.length === 0 ||
      data.resources.length > DELIVERY_LIMITS.resources ||
      typeof data.preparationId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(data.preparationId)
    ) {
      throw new Error(
        "Preparation requires selected profile descriptors and an owner token",
      );
    }
  }
  prepareMap(data, port, clientId) {
    return this.serialize(() =>
      this.prepareWorking(data, port, clientId, "map"),
    );
  }
  prepareProfile(data, port, clientId) {
    return this.serialize(() =>
      this.prepareWorking(data, port, clientId, "profile"),
    );
  }
  async prepareWorking(data, port, clientId, kind) {
    this.validatePreparation(data);
    if (this.unpublished.has(clientId)) {
      throw new Error(
        "Retry the committed world's cache publication before preparing a replacement",
      );
    }
    const record =
      kind === "map"
        ? await this.mapTarget(data, clientId)
        : await this.ownerTarget(data, clientId);
    const state = await this.workingState(record, clientId);
    const key = kind === "map" ? "pendingMap" : "pendingProfile";
    state[key] = null;
    // Persist abandonment before downloading C: A+C must not require space for B.
    await this.saveWorking(record, clientId, state);
    const { controller, progress } = this.startWorkingJob(data, clientId, kind);
    this.storage.protect(record.cacheName, []);
    this.error = null;
    try {
      const cache = await caches.open(record.cacheName);
      const sources = await this.stagingSources(record, cache, data.offline);
      const prepared = await this.workingResources(record, data, sources, port);
      const urls = prepared.resources.map((info) => info.url);
      this.storage.protect(record.cacheName, urls);
      await this.stageResources(record, prepared.resources, sources, port);
      cancellation(controller.signal);
      state[key] = {
        preparationId: data.preparationId,
        mapId: data.mapId,
        urls,
        mapUrls: prepared.mapUrls,
        profileUrls: prepared.profileUrls,
        previousProfileId: state.profile.preparationId,
      };
      await this.saveWorking(record, clientId, state);
      cancellation(controller.signal);
      return {
        releaseId: data.releaseId,
        mapId: data.mapId,
        preparationId: data.preparationId,
        ready: true,
        scope: kind,
        resources: urls.length,
        totalBytes: progress.totalBytes,
        completedBytes: progress.completedBytes,
      };
    } catch (error) {
      state[key] = null;
      await this.saveWorking(record, clientId, state);
      throw error;
    } finally {
      this.job = null;
      this.storage.release(record.cacheName);
    }
  }

  startWorkingJob(data, clientId, kind) {
    const controller = new AbortController();
    const progress = {
      releaseId: data.releaseId,
      mapId: data.mapId,
      scope: kind,
      completedEntries: 0,
      completedBytes: 0,
      totalEntries: 0,
      totalBytes: 0,
      current: "catalog",
    };
    this.job = {
      controller,
      progress,
      committing: false,
      nextNotice: 0,
      clientId,
      preparationId: data.preparationId,
    };
    return this.job;
  }
  discardPreparation(data, clientId, kind) {
    if (
      this.job?.clientId === clientId &&
      this.job.preparationId === data.preparationId
    ) {
      this.job.controller.abort();
    }
    return this.serialize(async () => {
      if (this.unpublished.get(clientId) === data.preparationId) {
        return { discarded: false };
      }
      const record = await this.ownerTarget(data, clientId);
      const state = await this.workingState(record, clientId);
      const key = kind === "map" ? "pendingMap" : "pendingProfile";
      if (
        !data.preparationId ||
        state[key]?.preparationId !== data.preparationId
      ) {
        return { discarded: false };
      }
      state[key] = null;
      await this.saveWorking(record, clientId, state);
      return { discarded: true };
    });
  }
  commitMap(data, clientId) {
    return this.serialize(() => this.commitWorking(data, clientId, "map"));
  }
  commitProfile(data, clientId) {
    return this.serialize(() => this.commitWorking(data, clientId, "profile"));
  }
  async commitWorking(data, clientId, kind) {
    const record =
      kind === "map"
        ? await this.mapTarget(data, clientId)
        : await this.ownerTarget(data, clientId);
    const state = await this.workingState(record, clientId);
    this.adoptPreparedScope(state, data, kind);
    const outstanding = this.unpublished.get(clientId);
    if (outstanding && outstanding !== data.preparationId) {
      throw new Error(
        "Retry the prior committed world's cache publication first",
      );
    }
    if (!outstanding && this.unpublished.size >= DELIVERY_LIMITS.clients) {
      throw new Error("Unpublished offline owner bound exceeded");
    }
    this.unpublished.set(clientId, data.preparationId);
    await this.publishWorking(record, clientId, state, kind === "map");
    this.unpublished.delete(clientId);
    return {
      releaseId: data.releaseId,
      mapId: data.mapId,
      preparationId: data.preparationId,
      committed: true,
    };
  }

  adoptPreparedScope(state, data, kind) {
    const key = kind === "map" ? "pendingMap" : "pendingProfile";
    const pending = state[key];
    if (!data.preparationId) {
      throw new Error("Commit requires its preparation token");
    }
    if (state[kind].preparationId === data.preparationId) return;
    if (
      pending?.preparationId !== data.preparationId ||
      (kind === "map" && pending.mapId !== data.mapId)
    ) {
      throw new Error("Commit requires this owner's current preparation token");
    }
    if (kind === "map") {
      state.map = {
        mapId: data.mapId,
        preparationId: data.preparationId,
        urls: pending.mapUrls,
      };
      // A profile committed while this destination was prepared takes precedence.
      if (state.profile.preparationId === pending.previousProfileId) {
        state.profile = {
          preparationId: data.preparationId,
          urls: pending.profileUrls,
        };
      }
    } else {
      state.profile = {
        preparationId: data.preparationId,
        urls: pending.profileUrls,
      };
    }
    state[key] = null;
  }
  retainMap(data, clientId) {
    return this.serialize(async () => {
      if (
        typeof data.token !== "string" ||
        !/^[a-f0-9-]{36}$/.test(data.token)
      ) {
        throw new Error("A retained-baseline owner token is required");
      }
      const record = await this.ownerTarget(data, clientId);
      const state = await this.workingState(record, clientId);
      if (state.retained?.preparationId === data.token) {
        return { token: data.token };
      }
      if (state.retained) {
        throw new Error("A frozen baseline is already retained");
      }
      if (!state.map.mapId) throw new Error("No committed map to retain");
      const token = data.token;
      state.retained = {
        preparationId: token,
        urls: this.workingUrls(state, true),
        map: state.map,
        profile: state.profile,
      };
      try {
        await this.publishWorking(record, clientId, state);
      } catch (error) {
        state.retained = null;
        await this.saveWorking(record, clientId, state);
        throw error;
      }
      return { token };
    });
  }
  releaseRetainedMap(data, clientId) {
    return this.serialize(async () => {
      const record = await this.ownerTarget(data, clientId);
      const state = await this.workingState(record, clientId);
      if (!data.token || state.retained?.preparationId !== data.token) {
        return { released: false };
      }
      state.retained = null;
      // Publish the replacement fallback first: failure keeps the retained token retryable.
      await this.publishCurrent(record, state);
      await this.saveWorking(record, clientId, state);
      return { released: true };
    });
  }
  /** The immutable release inventory authorizes every proposed descriptor before fetching. */
  resourceLoader(record, sources, port) {
    const inventory = this.resourceIndex(record);
    const signal = this.job.controller.signal;
    return async (descriptor) => {
      const info = this.mapDescriptor(inventory, descriptor);
      cancellation(signal);
      this.storage.working.get(record.cacheName).add(info.url);
      this.job.progress.current = info.url;
      this.notifyProgress(port);
      const bytes = await this.stageResource(info, sources, signal);
      return JSON.parse(new TextDecoder().decode(bytes));
    };
  }
  async profileResources(record, descriptors, loadJSON) {
    const inventory = this.resourceIndex(record);
    const found = new Map();
    const budget = { nodes: 0 };
    for (const descriptor of descriptors) {
      collectDescriptors(
        this.mapDescriptor(inventory, descriptor),
        found,
        budget,
      );
    }
    let bytes = 0;
    for (const descriptor of found.values()) {
      const info = this.mapDescriptor(inventory, descriptor);
      this.storage.working.get(record.cacheName).add(info.url);
      bytes += info.bytes;
      if (bytes > DELIVERY_LIMITS.totalBytes) {
        throw new Error("Profile resource byte limit exceeded");
      }
      if (info.url.endsWith(".json")) {
        collectDescriptors(await loadJSON(info), found, budget);
      }
    }
    return found;
  }
  async workingResources(record, data, sources, port) {
    const inventory = this.resourceIndex(record);
    const loadJSON = this.resourceLoader(record, sources, port);
    const catalog = await loadJSON(inventory.get("/generated/catalog.json"));
    if (catalog.buildId !== record.manifest.buildId) {
      throw new Error("Catalog/release build mismatch");
    }
    const profile = await this.profileResources(
      record,
      data.resources,
      loadJSON,
    );
    const map = data.mapId
      ? await collectMapResources(catalog, data.mapId, loadJSON)
      : new Map();
    const resources = new Map(
      this.shellResources(record).map((info) => [info.url, info]),
    );
    for (const root of [map, profile]) {
      for (const descriptor of root.values()) {
        const info = this.mapDescriptor(inventory, descriptor);
        resources.set(info.url, info);
      }
    }
    return {
      resources: [...resources.values()],
      mapUrls: [...map.keys()],
      profileUrls: [...profile.keys()],
    };
  }
  mapDescriptor(inventory, descriptor) {
    const expected = inventory.get(descriptor?.url);
    if (
      !expected ||
      expected.sha256 !== descriptor.sha256 ||
      expected.bytes !== descriptor.bytes
    ) {
      throw new Error(
        `Incomplete offline resource closure: ${descriptor?.url ?? "missing"}`,
      );
    }
    return expected;
  }
  /** Only the currently staged successor may advance the active navigation pointer. */
  async promoteMap(record, cache) {
    const partial = await readRecord("partial", this.records);
    if (partial?.cacheName !== record.cacheName) return;
    const predecessor = await cache.match(META_PATH + "predecessor");
    if (!predecessor) return;
    const active = await readRecord("active", this.records);
    if (
      (active?.manifest.releaseId ?? null) !==
      (await predecessor.json()).releaseId
    ) {
      return;
    }
    await writeRecord("active", record);
    await this.removePartial(record);
  }
  async checkClosure(manifest, cache, port) {
    const catalog = await cache.match("/generated/catalog.json");
    const root = JSON.parse(
      new TextDecoder().decode(
        await boundedResponse(
          catalog,
          resourceByteLimit("/generated/catalog.json"),
        ),
      ),
    );
    if (root.buildId !== manifest.buildId) {
      throw new Error("Catalog/release build mismatch");
    }
    const found = new Map();
    const budget = { nodes: 0 };
    const inventory = new Map(
      manifest.resources.map((info) => [info.url, info]),
    );
    collectDescriptors(root, found, budget);
    for (const info of found.values()) {
      cancellation(this.job.controller.signal);
      const expected = inventory.get(info.url);
      if (
        !expected ||
        expected.sha256 !== info.sha256 ||
        expected.bytes !== info.bytes
      ) {
        throw new Error(`Incomplete offline closure: ${info.url}`);
      }
      inventory.delete(info.url);
      if (!info.url.endsWith(".json")) continue;
      this.job.progress.current = `Verifying closure: ${info.url}`;
      this.notifyProgress(port);
      const response = await cache.match(info.url);
      const bytes = await boundedResponse(
        response,
        info.bytes,
        this.job.controller.signal,
      );
      collectDescriptors(
        JSON.parse(new TextDecoder().decode(bytes)),
        found,
        budget,
      );
    }
    for (const info of inventory.values()) {
      if (
        info.url.startsWith("/generated/") &&
        info.url !== "/generated/catalog.json"
      ) {
        throw new Error(`Unreachable release resource: ${info.url}`);
      }
    }
  }
  async cachedBytes(info, cache) {
    if (!cache) return null;
    const response = await cache.match(info.url);
    if (!response) return null;
    try {
      const bytes = await boundedResponse(response, info.bytes);
      await verifyBytes(bytes, info);
      return bytes;
    } catch (error) {
      this.error = `Replacing damaged cached resource: ${info.url}: ${error.message}`;
      return null;
    }
  }
  activate(id, port) {
    return this.serialize(() => this.activateOperation(id, port));
  }
  async activateOperation(id, port) {
    if (this.job || this.activating) {
      throw new Error(
        "Wait for the current installation operation before activation",
      );
    }
    this.activating = true;
    try {
      const result = await this.verifyRecord(
        await readRecord("staged"),
        port,
        "release",
      );
      if (!result?.ready || result.record.manifest.releaseId !== id) {
        throw new Error(
          "Cannot activate a missing, partial, or corrupt release",
        );
      }
      await writeRecord("active", result.record);
      await removeRecord("staged");
      this.error = null;
      return { releaseId: id, scope: "release", reloadRequired: true };
    } finally {
      this.activating = false;
    }
  }
  fetch(event) {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin || event.request.method !== "GET") {
      return;
    }
    if (
      url.pathname.startsWith("/generated/releases/") ||
      url.pathname === "/generated/release.json"
    ) {
      return;
    }
    event.respondWith(this.respond(event, url.pathname));
  }
  resourceIndex(record) {
    let index = this.indexes.get(record.cacheName);
    if (!index) {
      if (this.indexes.size >= DELIVERY_LIMITS.releases) this.indexes.clear();
      index = new Map(
        record.manifest.resources.map((info) => [info.url, info]),
      );
      this.indexes.set(record.cacheName, index);
    }
    return index;
  }
  /** Bound verification buffers, not legitimate bursts from independent asset owners. */
  admitResponse(signal) {
    if (signal.aborted) return Promise.reject(signal.reason);
    if (!this.collecting && this.responding < DELIVERY_LIMITS.responses) {
      this.responding++;
      return Promise.resolve();
    }
    if (this.responseQueue.length >= DELIVERY_LIMITS.queuedResponses) {
      return Promise.reject(
        new Error(
          "Offline response queue is full; retry after current downloads",
        ),
      );
    }
    return new Promise((resolve, reject) => {
      const pending = { resolve, reject, signal, abort: null, timer: null };
      pending.abort = () => {
        const index = this.responseQueue.indexOf(pending);
        if (index < 0) return;
        this.responseQueue.splice(index, 1);
        clearTimeout(pending.timer);
        signal.removeEventListener("abort", pending.abort);
        reject(
          signal.reason ?? new Error("Offline request admission timed out"),
        );
      };
      pending.timer = setTimeout(pending.abort, RESPONSE_WAIT_MS);
      signal.addEventListener("abort", pending.abort, { once: true });
      this.responseQueue.push(pending);
    });
  }
  pumpResponses() {
    while (
      !this.collecting &&
      this.responding < DELIVERY_LIMITS.responses &&
      this.responseQueue.length
    ) {
      const pending = this.responseQueue.shift();
      clearTimeout(pending.timer);
      pending.signal.removeEventListener("abort", pending.abort);
      this.responding++;
      pending.resolve();
    }
  }
  /** Migrate old installed shells into the current readiness gate without serving mixed bytes. */
  async navigationRecord() {
    if (!this.navigation) {
      this.navigation = this.selectNavigation().finally(() => {
        this.navigation = null;
      });
    }
    return this.navigation;
  }
  async selectNavigation() {
    const active = await readRecord("active", this.records);
    let response;
    try {
      response = await fetch("/generated/release.json", {
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(NAVIGATION_CHECK_MS),
      });
    } catch (error) {
      if (error instanceof TypeError || error.name === "TimeoutError") {
        if (active) return active;
        throw new Error(
          "Server unavailable and no verified release is installed. Reconnect and reload.",
        );
      }
      throw error;
    }
    const bytes = await boundedResponse(
      response,
      DELIVERY_LIMITS.manifestBytes,
    );
    const latest = await validateRelease(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    if (active?.manifest.releaseId === latest.releaseId) return active;
    // Shell/catalog staging stays partial until this release admits its first map.
    await this.download(latest.releaseId, null, true);
    const prepared = await this.findTarget(latest.releaseId);
    if (!prepared) {
      throw new Error("Shell preparation cancelled; reload to retry");
    }
    return prepared;
  }
  async respond(event, path) {
    let admitted = false;
    try {
      await this.admitResponse(event.request.signal);
      admitted = true;
      const navigation = event.request.mode === "navigate";
      const record = navigation
        ? await this.navigationRecord()
        : await readRecord(`client-${event.clientId}`, this.records);
      if (!record) return await this.online(event.request, path);
      const canonical = path === "/" ? "/index.html" : path;
      const info = this.resourceIndex(record).get(canonical);
      if (!info) {
        if (canonical.startsWith("/generated/")) {
          throw new Error(
            "Resource is not in this tab's verified release. Reload to select the latest release.",
          );
        }
        return await this.online(event.request, path);
      }
      const response = await this.pinnedResponse(
        record,
        info,
        event.request.signal,
      );
      if (navigation && event.resultingClientId) {
        await writeRecord(`client-${event.resultingClientId}`, record);
      }
      return response;
    } catch (error) {
      return await this.unavailable(path, error.message);
    } finally {
      if (admitted) this.responding--;
      this.pumpResponses();
    }
  }
  async pinnedResponse(record, info, signal) {
    const cache = await caches.open(record.cacheName);
    const response = await cache.match(info.url);
    if (!response) {
      const bytes = await fetchBytes(info.source, info.bytes, signal);
      await verifyBytes(bytes, info);
      cancellation(signal);
      await this.storage.put(
        record.cacheName,
        info.url,
        resourceResponse(bytes, info),
      );
      return resourceResponse(bytes, info);
    }
    const bytes = await boundedResponse(response, info.bytes, signal);
    await verifyBytes(bytes, info);
    return resourceResponse(bytes, info);
  }
  async online(request, path) {
    try {
      const response = await fetch(request);
      if (!response.ok) {
        return this.unavailable(path, `HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      return this.unavailable(path, error.message);
    }
  }
  async unavailable(path, reason) {
    if (this.missing.size >= DELIVERY_LIMITS.resources) {
      this.error = "Uncached request inventory limit exceeded";
    } else this.missing.add(`${path}: ${reason}`);
    const clients = await self.clients.matchAll();
    if (clients.length > DELIVERY_LIMITS.clients) {
      this.error = "Offline notification client limit exceeded";
    } else {
      for (const client of clients) {
        client.postMessage({
          type: "OFFLINE_UNCACHED",
          url: path,
          error: reason,
        });
      }
    }
    return new Response(
      `Offline content unavailable: ${path}\n${reason}\nReconnect to prepare this map or retry its verified resources.`,
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
}

const service = new OfflineService();
function installWorker(event) {
  event.waitUntil(self.skipWaiting());
}
self.addEventListener("install", installWorker);
self.addEventListener("activate", service.activateWorker);
self.addEventListener("message", service.message);
self.addEventListener("fetch", service.fetch);
