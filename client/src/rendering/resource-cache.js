import { LIMITS } from "./stream-validation.js";
import { CacheIndex } from "./cache-index.js";
import {
  CACHE_POLICY,
  estimateCacheBudget,
  requestCachePersistence,
} from "./cache-policy.js";

/** One cache owner per game tab; all mutations and index updates share its writer. */
export class ResourceCache {
  constructor() {
    this.cache = null;
    this.cacheBytes = 0;
    this.cacheEntries = new Map();
    this.cacheStatus = "initializing";
    this.cacheIndex = null;
    this.cacheByteLimit = CACHE_POLICY.fallbackBytes;
    this.cacheEstimate = "pending";
    this.cachePersistence = "pending";
    this.cacheOpenMs = 0;
    this.cacheQuotaRecoveries = 0;
    this.cacheSkipped = 0;
    this.writes = Promise.resolve();
    this.ready = this.open();
  }

  releaseControlled() {
    const controlled = Boolean(globalThis.navigator?.serviceWorker?.controller);
    if (controlled) this.cacheStatus = "release-managed";
    return controlled;
  }

  async open() {
    const started = performance.now();
    if (this.releaseControlled()) return;
    try {
      const exists = await caches.has("maple-content-v2");
      this.cache = await caches.open("maple-content-v2");
      this.cacheIndex = await CacheIndex.open();
      const rows = await this.cacheIndex.restore(this.cache, !exists);
      for (const row of rows) {
        this.cacheEntries.set(row.url, row.bytes);
        this.cacheBytes += row.bytes;
      }
      const storage = globalThis.navigator?.storage;
      const estimate = await estimateCacheBudget(storage, this.cacheBytes);
      this.cacheByteLimit = estimate.bytes;
      this.cacheEstimate = estimate.status;
      await this.evict(0, 0);
      this.cacheStatus = "persistent";
      this.persistenceReady = requestCachePersistence(storage, (status) => {
        this.cachePersistence = status;
      });
      this.releaseControlled();
    } catch (error) {
      if (this.cache) this.readOnly(error);
      else this.disableCache(error);
    } finally {
      this.cacheOpenMs = performance.now() - started;
    }
  }

  disableCache(error) {
    this.cacheStatus = `unavailable: ${error.message}`;
    this.cacheIndex?.close();
    this.cache = null;
  }

  readOnly(error) {
    this.cacheStatus = `read-only: ${error.message}`;
    this.cacheIndex?.close();
  }

  async evict(incoming, slots = 1) {
    for (const [url] of this.cacheEntries) {
      if (
        this.cacheBytes + incoming <= this.cacheByteLimit &&
        this.cacheEntries.size + slots <= LIMITS.cacheEntries
      ) {
        break;
      }
      await this.remove(url);
    }
  }

  remember(url, bytes) {
    this.cacheBytes -= this.cacheEntries.get(url) ?? 0;
    this.cacheEntries.delete(url);
    if (bytes !== null) {
      this.cacheEntries.set(url, bytes);
      this.cacheBytes += bytes;
    }
  }

  async writeBuffer(url, buffer) {
    await this.cacheIndex?.begin(url);
    try {
      await this.cache.put(
        url,
        new Response(buffer, {
          headers: { "x-maple-bytes": String(buffer.byteLength) },
        }),
      );
    } catch (error) {
      await this.cacheIndex?.cancel(url);
      throw error;
    }
    await this.cacheIndex?.finish(url, buffer.byteLength);
    this.remember(url, buffer.byteLength);
  }

  async store(url, buffer, cached = false) {
    if (
      this.releaseControlled() ||
      !this.cache ||
      this.cacheStatus.startsWith("read-only:")
    ) {
      return;
    }
    try {
      if (cached && this.cacheEntries.has(url)) {
        await this.cacheIndex?.finish(url, buffer.byteLength);
        this.remember(url, buffer.byteLength);
        return;
      }
      if (buffer.byteLength > this.cacheByteLimit) {
        this.cacheSkipped++;
        return;
      }
      // Missing payloads may leave conservative stale metadata after external eviction.
      if (this.cacheEntries.has(url)) await this.remove(url);
      await this.evict(buffer.byteLength);
      await this.writeBuffer(url, buffer);
    } catch (error) {
      if (error.name === "QuotaExceededError") {
        await this.recoverQuota(url, buffer);
      } else this.disableCache(error);
    }
  }

  /** One retry with a smaller budget; denied writes must not destroy verified read access. */
  async recoverQuota(url, buffer) {
    this.cacheQuotaRecoveries++;
    this.cacheByteLimit = Math.floor(
      Math.min(this.cacheByteLimit, this.cacheBytes) * 0.75,
    );
    try {
      await this.evict(0, 0);
      if (buffer.byteLength > this.cacheByteLimit) {
        this.cacheSkipped++;
        return;
      }
      await this.evict(buffer.byteLength);
      await this.writeBuffer(url, buffer);
    } catch (error) {
      this.readOnly(error);
    }
  }

  /** Journal deletion so an interrupted eviction cannot leak uncounted payloads. */
  async invalidate(url) {
    try {
      await this.remove(url);
    } catch (error) {
      this.disableCache(error);
    }
  }

  async remove(url) {
    if (!this.cache) return;
    await this.cacheIndex?.begin(url);
    await this.cache.delete(url);
    await this.cacheIndex?.finish(url, null);
    this.remember(url, null);
  }

  cacheSnapshot() {
    return {
      cacheBytes: this.cacheBytes,
      cacheEntries: this.cacheEntries.size,
      cacheStatus: this.cacheStatus,
      cacheByteLimit: this.cacheByteLimit,
      cacheEntryLimit: LIMITS.cacheEntries,
      cacheEstimate: this.cacheEstimate,
      cachePersistence: this.cachePersistence,
      cacheOpenMs: this.cacheOpenMs,
      cacheIndexStatus: this.cacheIndex?.status ?? "unavailable",
      cacheHeaderReads: this.cacheIndex?.headerReads ?? 0,
      cacheQuotaRecoveries: this.cacheQuotaRecoveries,
      cacheSkipped: this.cacheSkipped,
    };
  }
}
