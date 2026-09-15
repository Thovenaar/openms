import { ResourceCache } from "./resource-cache.js";
import { LIMITS, resource } from "./stream-validation.js";
import { resourceByteLimit } from "../assets/resource-validation.js";
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
  async fetchBytes(url, signal, maximum) {
    const deadline = networkDeadline(signal, this.timeouts);
    const activity = this.activity?.begin("download", url);
    try {
      return await this.download(url, deadline, maximum);
    } finally {
      deadline.dispose();
      this.activity?.end(activity);
    }
  }
  /** Encoded progress is advisory; the frontier owns every declared total. */
  report(url, loaded) {
    this.activity?.stream?.(url, loaded);
  }
  async download(url, deadline, maximum) {
    const signal = deadline.signal;
    signal.throwIfAborted();
    const response = await withinDeadline(
      fetch(url, { signal, cache: "no-store" }),
      signal,
    );
    if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
    deadline.progress();
    this.report(url, 0);
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
        this.report(url, length);
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
  async load(info, signal) {
    resource(info);
    return this.gate.run(async () => {
      await this.ready;
      check(signal);
      const url = new URL(info.url, location.origin).href;
      const cacheable = info.url.startsWith("/generated/");
      // One token per admitted resource: cached and downloaded work both settle it.
      const activity = this.activity?.begin("resource", url, info.bytes);
      try {
        const cached =
          cacheable && !this.releaseControlled() && this.cache
            ? await this.cache.match(url)
            : null;
        let buffer;
        if (cached) {
          try {
            buffer = await cached.arrayBuffer();
            await this.verify(buffer, info);
          } catch (error) {
            this.writes = this.writes.then(() => this.invalidate(url));
            await this.writes;
            throw error;
          }
          this.hits++;
        } else {
          buffer = await this.fetchBytes(url, signal, info.bytes);
          await this.verify(buffer, info);
        }
        check(signal);
        if (cacheable) {
          this.writes = this.writes.then(() =>
            this.store(url, buffer, Boolean(cached)),
          );
          await this.writes;
        }
        check(signal);
        return buffer;
      } finally {
        this.activity?.end(activity);
      }
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
              resourceByteLimit("/generated/catalog.json"),
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
      ...this.cacheSnapshot(),
      cacheHits: this.hits,
      downloadBytes: this.downloadBytes,
      lastCancellationError: this.lastCancellationError ?? null,
    };
  }
}
