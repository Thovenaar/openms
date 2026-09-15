import { ResourceCache } from "./resource-cache.js";
import { LIMITS, resource } from "./stream-validation.js";
import { loadCatalog } from "./stream-catalog.js";
import {
  gzipCeiling,
  gzipVariantURL,
  inflateGzip,
  inflatedDescriptor,
  storedDescriptor,
  storedEncoding,
} from "./gzip-asset.js";
import {
  networkDeadline,
  withinDeadline,
  NETWORK_TIMEOUTS,
} from "./stream-deadline.js";

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
    this.backgroundActive = 0;
    this.queue = [];
    this.pumpBound = this.pump.bind(this);
  }
  run(work, signal, background = false) {
    check(signal);
    if (this.queue.length >= LIMITS.queue) {
      return Promise.reject(new Error("Streaming queue backpressure"));
    }
    return new Promise((resolve, reject) => {
      const job = { work, signal, background, resolve, reject, cancel: null };
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
      let index = this.queue.findIndex((job) => !job.background);
      if (index < 0) {
        if (this.backgroundActive >= Math.max(1, this.limit - 2)) break;
        index = 0;
      }
      const [job] = this.queue.splice(index, 1);
      job.signal.removeEventListener("abort", job.cancel);
      if (job.signal.aborted) {
        job.reject(aborted());
        continue;
      }
      this.active++;
      if (job.background) this.backgroundActive++;
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
      if (job.background) this.backgroundActive--;
      queueMicrotask(this.pumpBound);
    }
  }
}

/** Persistent cache has serialized eviction by recent use and a hard byte/entry ceiling. */
export class Network extends ResourceCache {
  constructor(timeouts = NETWORK_TIMEOUTS, activity = null) {
    super();
    this.activity = activity;
    this.timeouts = timeouts;
    this.gate = new Gate(LIMITS.fetches);
    this.hits = 0;
    this.downloadBytes = 0;
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
  async fetchBytes(url, signal, maximum, background = false) {
    const deadline = networkDeadline(signal, this.timeouts);
    const activity = background ? null : this.activity?.begin("download", url);
    try {
      return await this.download(url, deadline, maximum, background);
    } finally {
      deadline.dispose();
      if (activity) this.activity.end(activity);
    }
  }
  /** Encoded progress is advisory; the frontier owns every declared total. */
  report(url, loaded, background = false) {
    if (background) return;
    this.activity?.stream?.(url, loaded);
  }
  async download(url, deadline, maximum, background = false) {
    const signal = deadline.signal;
    signal.throwIfAborted();
    const response = await withinDeadline(
      fetch(url, {
        signal,
        cache: "no-store",
        priority: background ? "low" : "high",
      }),
      signal,
    );
    if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
    deadline.progress();
    this.report(url, 0, background);
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      for (let index = 0; index <= maximum; index++) {
        const part = await withinDeadline(reader.read(), signal);
        if (part.done) break;
        if (part.value.byteLength) deadline.progress();
        length += part.value.byteLength;
        if (length > maximum || index === maximum) {
          throw new Error("Network resource limit exceeded");
        }
        chunks.push(part.value);
        this.report(url, length, background);
      }
    } catch (error) {
      // Do not let a broken stream's cancellation hold a fetch gate forever.
      reader.cancel(error).catch((failure) => {
        this.lastCancellationError = failure?.name ?? "CancellationError";
      });
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
  /** A compressed sibling holds far fewer disk bytes; raw stays the correctness reference. */
  async cachedBytes(url, cached, signal) {
    const stored = await cached.arrayBuffer();
    return storedEncoding(cached) === "gzip"
      ? await inflateGzip(stored, signal)
      : stored;
  }

  /** Recency refresh keeps payload bytes and their recorded disk cost untouched. */
  storedDisk(response) {
    const declared = Number(response.headers.get("content-length"));
    return Number.isSafeInteger(declared) && declared > 0 ? declared : null;
  }

  /** Prefer the compressed variant, but never let its absence break an available resource. */
  async fetchIncoming(request) {
    const { url, compressed, signal, background, maximum } = request;
    if (!compressed) {
      const buffer = await this.fetchBytes(url, signal, maximum, background);
      return storedDescriptor(buffer, buffer.byteLength);
    }
    // Incompressible input can expand; bound the transfer by the declared raw size either way.
    const compressedMaximum = Math.max(maximum, gzipCeiling(maximum));
    try {
      const buffer = await this.fetchBytes(
        compressed,
        signal,
        compressedMaximum,
        background,
      );
      return storedDescriptor(buffer, maximum);
    } catch (error) {
      if (signal.aborted) throw error;
      const buffer = await this.fetchBytes(url, signal, maximum, background);
      return storedDescriptor(buffer, buffer.byteLength);
    }
  }

  /** One cache lookup; release-managed and private resources never consult persistent storage. */
  async lookup(url, cacheable) {
    if (!cacheable || this.releaseControlled() || !this.cache) return null;
    return this.cache.match(url);
  }

  /** A stale or damaged entry is evicted before its failure reaches the caller. */
  async readCached(url, cached, info, signal) {
    try {
      const buffer = await this.cachedBytes(url, cached, signal);
      await this.verify(buffer, info);
      return buffer;
    } catch (error) {
      this.writes = this.writes.then(() => this.invalidate(url));
      await this.writes;
      throw error;
    }
  }

  /** Serialized behind one writer; only a verified hit reorders eviction. */
  queueStore(url, descriptor, disk = null) {
    this.writes = this.writes.then(() =>
      disk === null
        ? this.store(url, descriptor)
        : this.touch(url, descriptor.raw, disk),
    );
  }

  /** Verified hit: refresh recency without rewriting the stored payload. */
  async consume(url, info, cached, signal) {
    const buffer = await this.readCached(url, cached, info, signal);
    this.hits++;
    // Without a declared length, keep the recorded cost instead of rewriting the compact body.
    const measured = this.storedDisk(cached);
    const disk =
      measured ??
      (this.cacheEntries.has(url) ? this.cacheEntries.get(url) : null);
    if (disk !== null) {
      this.queueStore(url, storedDescriptor(buffer, buffer.byteLength), disk);
    }
    return buffer;
  }

  /** Cache miss: prefer the compressed variant and store exactly what was fetched. */
  async discover(request) {
    const { url, info, signal, background, cacheable } = request;
    const variant = cacheable ? gzipVariantURL(info.url) : null;
    const descriptor = await this.fetchIncoming({
      url,
      // The derived sibling is site-relative; fetchBytes requires an absolute URL.
      compressed: variant ? new URL(variant, location.origin).href : null,
      signal,
      background,
      maximum: info.bytes,
    });
    const inflated = await inflatedDescriptor(descriptor, signal);
    await this.verify(inflated.buffer, info);
    if (cacheable) this.queueStore(url, descriptor);
    return inflated.buffer;
  }

  async load(info, signal, background = false) {
    resource(info);
    return this.gate.run(
      async () => {
        await this.ready;
        check(signal);
        const url = new URL(info.url, location.origin).href;
        const cacheable = info.url.startsWith("/generated/");
        // One token per admitted resource: cached and downloaded work both settle it.
        const activity = background
          ? null
          : this.activity?.begin("resource", url, info.bytes);
        try {
          const cached = await this.lookup(url, cacheable);
          const buffer = cached
            ? await this.consume(url, info, cached, signal)
            : await this.discover({
                url,
                info,
                signal,
                background,
                cacheable,
              });
          await this.writes;
          check(signal);
          return buffer;
        } finally {
          if (activity) this.activity.end(activity);
        }
      },
      signal,
      background,
    );
  }
  async json(info, signal, background = false) {
    return JSON.parse(
      new TextDecoder().decode(await this.load(info, signal, background)),
    );
  }
  async catalog(signal, expectedHash) {
    return loadCatalog(this, expectedHash, signal);
  }
  snapshot() {
    return {
      fetchActive: this.gate.active,
      fetchQueued: this.gate.queue.length,
      ...this.cacheSnapshot(),
      cacheHits: this.hits,
      downloadBytes: this.downloadBytes,
      startupPack: this.startupPack ?? null,
      lastCancellationError: this.lastCancellationError ?? null,
    };
  }
}
