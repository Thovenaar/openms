import {
  DELIVERY_LIMITS,
  HASH,
  boundedResponse,
  collectDescriptors,
  validateRelease,
  verifyBytes,
} from "./offline-manifest.js";

const META_CACHE = "maple-offline-meta-v1";
const RELEASE_PREFIX = "maple-offline-release-v1-";
const META_PATH = "/__maple-offline/";
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
  const meta = await caches.open(META_CACHE);
  await meta.put(
    META_PATH + name,
    Response.json({
      cacheName: record.cacheName,
      releaseId: record.manifest.releaseId,
    }),
  );
}

async function removeRecord(name) {
  const meta = await caches.open(META_CACHE);
  await meta.delete(META_PATH + name);
}

async function verifiedRecord(record, port = null, signal = null) {
  if (!record) return null;
  const cache = await caches.open(record.cacheName);
  const marker = await cache.match(META_PATH + "complete");
  const missing = [];
  if (
    !marker ||
    (await marker.json()).releaseId !== record.manifest.releaseId
  ) {
    missing.push("Release completion marker");
  }
  let completedBytes = 0;
  let nextNotice = 0;
  for (const info of record.manifest.resources) {
    if (signal) cancellation(signal);
    if (port && performance.now() >= nextNotice) {
      nextNotice = performance.now() + 100;
      port.postMessage({
        type: "VERIFY_PROGRESS",
        progress: {
          completedBytes,
          totalBytes: record.manifest.totalBytes,
          current: info.url,
        },
      });
    }
    try {
      const response = await cache.match(info.url);
      if (!response) throw new Error("Not cached");
      await verifyBytes(await boundedResponse(response, info.bytes), info);
      completedBytes += info.bytes;
    } catch (error) {
      missing.push(`${info.url}: ${error.message}`);
    }
  }
  return { record, ready: missing.length === 0, completedBytes, missing };
}

/** Never collect an active, resumable, staged, or live-client-pinned release. */
async function collectCaches(jobName = null) {
  const protectedNames = new Set(jobName ? [jobName] : []);
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
    totalBytes: result.record.manifest.totalBytes,
    resources: result.record.manifest.resources.length,
    maps: result.record.manifest.maps,
    unavailableMaps: result.record.manifest.unavailableMaps,
    ready: result.ready,
    completedBytes: result.completedBytes,
    missing: result.missing,
  };
}

async function quotaPreflight(bytes) {
  if (!navigator.storage?.estimate) return;
  const estimate = await navigator.storage.estimate();
  const available = estimate.quota - estimate.usage;
  // CacheStorage metadata is browser-dependent: reserve an explicit 10% plus 1 MiB.
  const required = Math.ceil(bytes * 1.1) + 1024 * 1024;
  if (Number.isFinite(available) && available < required) {
    throw new Error(
      `Insufficient storage: need approximately ${required} bytes free; ${available} available. Installed release retained.`,
    );
  }
}

/** Owns one cancellable staging job and immutable per-release descriptor indexes. */
class OfflineService {
  constructor() {
    this.job = null;
    this.activating = false;
    this.cancelling = false;
    this.responding = 0;
    this.checking = false;
    this.collecting = false;
    this.error = null;
    this.missing = new Set();
    this.records = new Map();
    this.indexes = new Map();
    this.message = this.message.bind(this);
    this.fetch = this.fetch.bind(this);
    this.activateWorker = this.activateWorker.bind(this);
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
      const active = projection(
        await verifiedRecord(await readRecord("active"), port),
      );
      const staged = projection(
        await verifiedRecord(await readRecord("staged"), port),
      );
      const partial = this.job
        ? null
        : projection(await verifiedRecord(await readRecord("partial"), port));
      const pinned = await readRecord(`client-${clientId}`, this.records);
      return {
        active,
        staged,
        partial,
        pinnedReleaseId: pinned?.manifest.releaseId ?? null,
        job: this.job?.progress ?? null,
        error: this.error,
        uncached: [...this.missing],
      };
    } finally {
      this.checking = false;
    }
  }
  message(event) {
    if (
      !event.source ||
      new URL(event.source.url).origin !== self.location.origin ||
      !event.ports[0]
    ) {
      return;
    }
    event.waitUntil(this.dispatch(event));
  }
  async dispatch(event) {
    const port = event.ports[0];
    try {
      const type = event.data?.type;
      let result;
      if (type === "OFFLINE_STATUS") {
        result = await this.status(port, event.source.id);
      } else if (type === "DOWNLOAD_RELEASE") {
        result = await this.download(event.data.releaseId, port);
      } else if (type === "CANCEL_DOWNLOAD") result = await this.cancel();
      else if (type === "ACTIVATE_RELEASE") {
        result = await this.activate(event.data.releaseId, port);
      } else throw new Error("Unknown offline command");
      port.postMessage({ type: "RESULT", result });
    } catch (error) {
      this.error = `${error.name}: ${error.message}`;
      port.postMessage({ type: "ERROR", error: this.error });
    } finally {
      port.close();
    }
  }
  async cancel() {
    if (this.job) {
      if (this.job.committing) return { cancelled: false };
      this.error = null;
      this.job.controller.abort();
      return { cancelled: true };
    }
    if (this.cancelling || this.activating) {
      throw new Error("An offline installation operation is already running");
    }
    this.cancelling = true;
    try {
      const partial = await readRecord("partial");
      if (!partial) return { cancelled: false };
      await removeRecord("partial");
      await caches.delete(partial.cacheName);
      this.error = null;
      return { cancelled: true };
    } finally {
      this.cancelling = false;
    }
  }
  async target(id, port) {
    const partial = await readRecord("partial");
    if (partial?.manifest.releaseId === id) {
      const verified = await verifiedRecord(
        partial,
        port,
        this.job.controller.signal,
      );
      await quotaPreflight(
        partial.manifest.totalBytes - verified.completedBytes,
      );
      return partial;
    }
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
    await quotaPreflight(manifest.totalBytes);
    const record = {
      cacheName: `${RELEASE_PREFIX}${id}-${crypto.randomUUID()}`,
      manifest,
    };
    const cache = await caches.open(record.cacheName);
    await cache.put(META_PATH + "manifest", Response.json(manifest));
    await writeRecord("partial", record);
    return record;
  }
  /** Exclude pointer readers/publishers throughout the collection snapshot and deletes. */
  async collect(jobName) {
    if (this.collecting || this.responding || this.checking) {
      throw new Error("Offline collection backpressure; wait for current work");
    }
    this.collecting = true;
    try {
      await collectCaches(jobName);
    } finally {
      this.collecting = false;
    }
  }
  async download(id, port) {
    if (this.job || this.activating || this.cancelling) {
      throw new Error("An offline installation operation is already running");
    }
    if (!HASH.test(id)) throw new Error("Invalid requested offline release");
    const controller = new AbortController();
    const progress = {
      releaseId: id,
      completedEntries: 0,
      completedBytes: 0,
      totalEntries: 0,
      totalBytes: 0,
      current: "release manifest",
    };
    this.job = { controller, progress, committing: false, nextNotice: 0 };
    this.error = null;
    port.postMessage({ type: "PROGRESS", progress });
    let record = null;
    try {
      record = await this.target(id, port);
      await this.collect(record.cacheName);
      await this.stage(record, port);
      cancellation(controller.signal);
      this.job.committing = true;
      await writeRecord("staged", record);
      await removeRecord("partial");
      return { releaseId: id, ready: true, activationRequired: true };
    } catch (error) {
      if (controller.signal.aborted && !this.job.committing) {
        const target = record ?? (await readRecord("partial"));
        if (target?.manifest.releaseId === id) {
          await removeRecord("partial");
          await caches.delete(target.cacheName);
        }
        return { releaseId: id, cancelled: true, ready: false };
      }
      throw error;
    } finally {
      this.job = null;
    }
  }
  notifyProgress(port) {
    const now = performance.now();
    if (now < this.job.nextNotice) return;
    this.job.nextNotice = now + 100;
    port.postMessage({ type: "PROGRESS", progress: this.job.progress });
  }
  async stage(record, port) {
    const job = this.job;
    const cache = await caches.open(record.cacheName);
    const prior = await readRecord("active", this.records);
    const reuse = prior ? await caches.open(prior.cacheName) : null;
    // A stable URL may change between releases; old valid bytes are not corruption.
    const priorIndex = prior ? this.resourceIndex(prior) : null;
    job.progress.totalEntries = record.manifest.resources.length;
    job.progress.totalBytes = record.manifest.totalBytes;
    for (const info of record.manifest.resources) {
      cancellation(job.controller.signal);
      job.progress.current = info.url;
      this.notifyProgress(port);
      let bytes = await this.cachedBytes(info, cache);
      if (!bytes) {
        const priorInfo = priorIndex?.get(info.url);
        if (
          priorInfo?.sha256 === info.sha256 &&
          priorInfo.bytes === info.bytes
        ) {
          bytes = await this.cachedBytes(info, reuse);
        }
        if (!bytes) {
          bytes = await fetchBytes(
            info.source,
            info.bytes,
            job.controller.signal,
          );
        }
        await verifyBytes(bytes, info);
        cancellation(job.controller.signal);
        await cache.put(info.url, resourceResponse(bytes, info));
      }
      job.progress.completedEntries++;
      job.progress.completedBytes += info.bytes;
    }
    await this.checkClosure(record.manifest, cache, port);
    cancellation(job.controller.signal);
    await cache.put(
      META_PATH + "complete",
      Response.json({ releaseId: record.manifest.releaseId }),
    );
    port.postMessage({ type: "PROGRESS", progress: job.progress });
  }
  async checkClosure(manifest, cache, port) {
    const catalog = await cache.match("/generated/catalog.json");
    const root = JSON.parse(
      new TextDecoder().decode(
        await boundedResponse(catalog, DELIVERY_LIMITS.resourceBytes),
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
  async activate(id, port) {
    if (this.job || this.activating || this.cancelling) {
      throw new Error(
        "Wait for the current installation operation before activation",
      );
    }
    this.activating = true;
    try {
      const result = await verifiedRecord(await readRecord("staged"), port);
      if (!result?.ready || result.record.manifest.releaseId !== id) {
        throw new Error(
          "Cannot activate a missing, partial, or corrupt release",
        );
      }
      await writeRecord("active", result.record);
      await removeRecord("staged");
      this.error = null;
      return { releaseId: id, reloadRequired: true };
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
  async respond(event, path) {
    if (this.collecting || this.responding >= DELIVERY_LIMITS.responses) {
      this.error = "Offline request backpressure; wait for current work";
      return new Response(this.error, {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    this.responding++;
    try {
      const navigation = event.request.mode === "navigate";
      const name = navigation ? "active" : `client-${event.clientId}`;
      const record = await readRecord(name, this.records);
      if (!record) return await this.online(event.request, path);
      const canonical = path === "/" ? "/index.html" : path;
      const info = this.resourceIndex(record).get(canonical);
      if (!info) return await this.online(event.request, path);
      const response = await this.pinnedResponse(record, info);
      if (navigation && event.resultingClientId) {
        await writeRecord(`client-${event.resultingClientId}`, record);
      }
      return response;
    } catch (error) {
      return await this.unavailable(path, error.message);
    } finally {
      this.responding--;
    }
  }
  async pinnedResponse(record, info) {
    const cache = await caches.open(record.cacheName);
    const response = await cache.match(info.url);
    if (!response) {
      throw new Error(
        `Installed resource missing: ${info.url}. Re-download this release online.`,
      );
    }
    const bytes = await boundedResponse(response, info.bytes);
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
      `Offline content unavailable: ${path}\n${reason}\nOpen the download panel while online to install a complete release.`,
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
}

const service = new OfflineService();
self.addEventListener("activate", service.activateWorker);
self.addEventListener("message", service.message);
self.addEventListener("fetch", service.fetch);
