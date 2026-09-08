import { LIMITS, resource } from "./stream-validation.js";

export function aborted() {
  return new DOMException("Demand cancelled", "AbortError");
}
export function check(signal) {
  if (signal.aborted) throw aborted();
}

/** FIFO work admission; queued cancellation releases the queue slot immediately. */
export class Gate {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
    this.pumpBound = this.pump.bind(this);
  }
  run(work, signal) {
    check(signal);
    if (this.queue.length >= LIMITS.queue) {
      return Promise.reject(new Error("Streaming queue backpressure"));
    }
    return new Promise((resolve, reject) => {
      const job = { work, signal, resolve, reject, cancel: null };
      job.cancel = () => {
        const index = this.queue.indexOf(job);
        if (index >= 0) this.queue.splice(index, 1);
        reject(aborted());
      };
      signal.addEventListener("abort", job.cancel, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }
  pump() {
    while (this.active < this.limit && this.queue.length) {
      const job = this.queue.shift();
      job.signal.removeEventListener("abort", job.cancel);
      if (job.signal.aborted) {
        job.reject(aborted());
        continue;
      }
      this.active++;
      this.execute(job);
    }
  }
  async execute(job) {
    try {
      job.resolve(await job.work());
    } catch (error) {
      job.reject(error);
    } finally {
      this.active--;
      queueMicrotask(this.pumpBound);
    }
  }
}

/** Persistent FIFO cache has one serialized writer and a hard byte/entry ceiling. */
export class Network {
  constructor() {
    this.gate = new Gate(LIMITS.fetches);
    this.cache = null;
    this.cacheBytes = 0;
    this.cacheEntries = new Map();
    this.cacheStatus = "initializing";
    this.hits = 0;
    this.downloadBytes = 0;
    this.writes = Promise.resolve();
    this.ready = this.open();
  }
  /** A controlled page reads the pinned release through fetch, never stale runtime entries. */
  releaseControlled() {
    const controlled = Boolean(globalThis.navigator?.serviceWorker?.controller);
    if (controlled) this.cacheStatus = "release-managed";
    return controlled;
  }
  async open() {
    if (this.releaseControlled()) return;
    try {
      this.cache = await caches.open("maple-content-v2");
      const keys = await this.cache.keys();
      for (const request of keys) {
        const response = await this.cache.match(request);
        const bytes = Number(response.headers.get("x-maple-bytes"));
        if (
          !Number.isSafeInteger(bytes) ||
          bytes <= 0 ||
          bytes > LIMITS.resourceBytes
        ) {
          await this.cache.delete(request);
          continue;
        }
        this.cacheEntries.set(request.url, bytes);
        this.cacheBytes += bytes;
      }
      await this.evict(0);
      this.cacheStatus = "persistent";
      this.releaseControlled();
    } catch (error) {
      this.disableCache(error);
    }
  }
  disableCache(error) {
    this.cacheStatus = `unavailable: ${error.message}`;
    this.cache = null;
  }
  async evict(incoming) {
    for (const [url, bytes] of this.cacheEntries) {
      if (
        this.cacheBytes + incoming <= LIMITS.cacheBytes &&
        this.cacheEntries.size < LIMITS.cacheEntries
      ) {
        break;
      }
      await this.cache.delete(url);
      this.cacheEntries.delete(url);
      this.cacheBytes -= bytes;
    }
  }
  async store(url, buffer) {
    if (this.releaseControlled() || !this.cache || this.cacheEntries.has(url)) {
      return;
    }
    try {
      await this.evict(buffer.byteLength);
      if (this.releaseControlled()) return;
      await this.cache.put(
        url,
        new Response(buffer, {
          headers: { "x-maple-bytes": String(buffer.byteLength) },
        }),
      );
      this.cacheEntries.set(url, buffer.byteLength);
      this.cacheBytes += buffer.byteLength;
    } catch (error) {
      this.disableCache(error);
    }
  }
  async verify(buffer, info) {
    if (buffer.byteLength !== info.bytes) {
      throw new Error(`Asset byte mismatch: ${info.url}`);
    }
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", buffer),
    );
    let hash = "";
    for (const byte of digest) hash += byte.toString(16).padStart(2, "0");
    if (hash !== info.sha256) {
      throw new Error(`Asset hash mismatch: ${info.url}`);
    }
  }
  async fetchBytes(url, signal, maximum) {
    const response = await fetch(url, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      for (let index = 0; index <= maximum; index++) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > maximum || index === maximum) {
          throw new Error("Network resource limit exceeded");
        }
        chunks.push(part.value);
      }
    } catch (error) {
      await reader.cancel(error);
      throw error;
    }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    this.downloadBytes += length;
    return result.buffer;
  }
  async load(info, signal) {
    resource(info);
    return this.gate.run(async () => {
      await this.ready;
      check(signal);
      const url = new URL(info.url, location.origin).href;
      const cached =
        !this.releaseControlled() && this.cache
          ? await this.cache.match(url)
          : null;
      let buffer;
      if (cached) {
        buffer = await cached.arrayBuffer();
        this.hits++;
      } else buffer = await this.fetchBytes(url, signal, info.bytes);
      await this.verify(buffer, info);
      check(signal);
      if (!cached) {
        this.writes = this.writes.then(() => this.store(url, buffer));
        await this.writes;
      }
      check(signal);
      return buffer;
    }, signal);
  }
  async json(info, signal) {
    return JSON.parse(new TextDecoder().decode(await this.load(info, signal)));
  }
  async catalog(signal) {
    return this.gate.run(
      async () =>
        JSON.parse(
          new TextDecoder().decode(
            await this.fetchBytes(
              "/generated/catalog.json",
              signal,
              LIMITS.resourceBytes,
            ),
          ),
        ),
      signal,
    );
  }
  snapshot() {
    return {
      fetchActive: this.gate.active,
      fetchQueued: this.gate.queue.length,
      cacheBytes: this.cacheBytes,
      cacheEntries: this.cacheEntries.size,
      cacheStatus: this.cacheStatus,
      cacheHits: this.hits,
      downloadBytes: this.downloadBytes,
    };
  }
}
