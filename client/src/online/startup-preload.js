import {
  LIMITS,
  resource,
  visualBundle,
  manifest,
} from "../rendering/stream-validation.js";
import { planStartupAssets } from "./startup-assets.js";

/** Encoded bytes only; decoded images and GPU textures remain demand-owned. */
export const STARTUP_PRELOAD_LIMITS = Object.freeze({
  files: 768,
  bytes: 64 * 1024 * 1024,
  concurrency: LIMITS.fetches,
});

/** A deduplicated, finite frontier. Each manifest is followed only to its declared assets. */
export class StartupPreload {
  constructor(network) {
    this.network = network;
    this.jobs = [];
    this.seen = new Map();
    this.bytes = 0;
    this.complete = 0;
  }

  add(info, kind = "bytes") {
    if (!info) return;
    resource(info);
    // Authenticated/community resources never enter the shared persistent cache.
    if (!info.url.startsWith("/generated/")) return;
    const previous = this.seen.get(info.url);
    if (previous) {
      if (previous.sha256 !== info.sha256 || previous.bytes !== info.bytes) {
        throw new Error("Conflicting startup resource identity");
      }
      return;
    }
    if (
      this.jobs.length >= STARTUP_PRELOAD_LIMITS.files ||
      this.bytes + info.bytes > STARTUP_PRELOAD_LIMITS.bytes
    ) {
      throw new Error("Common startup assets exceed the preload budget");
    }
    if (!["bytes", "bundle", "map"].includes(kind)) {
      throw new Error("Invalid preload kind");
    }
    this.seen.set(info.url, info);
    this.jobs.push({ info, kind });
    this.bytes += info.bytes;
    this.network.activity?.plan([info]);
  }

  async load(job, signal) {
    if (job.kind === "bytes") await this.network.load(job.info, signal);
    else {
      const value = await this.network.json(job.info, signal);
      signal.throwIfAborted();
      const data = job.kind === "map" ? manifest(value) : visualBundle(value);
      for (const info of Object.values(data.atlases)) this.add(info);
      if (job.kind === "map") {
        for (const info of data.regions) this.add(info);
      }
    }
    this.complete++;
  }

  /** Small settled batches avoid filling the network queue and retire together on failure. */
  async run(signal) {
    signal.throwIfAborted();
    await this.network.ready;
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    try {
      for (let start = 0; start < this.jobs.length; ) {
        signal.throwIfAborted();
        if (this.network.cacheStatus !== "persistent") {
          return this.result("cache-unavailable");
        }
        const batch = this.jobs.slice(
          start,
          start + STARTUP_PRELOAD_LIMITS.concurrency,
        );
        const results = await Promise.allSettled(
          batch.map(async (job) => {
            try {
              await this.load(job, controller.signal);
            } catch (error) {
              controller.abort(error);
              throw error;
            }
          }),
        );
        const failed = results.find((result) => result.status === "rejected");
        if (failed) throw controller.signal.reason;
        start += batch.length;
      }
      signal.throwIfAborted();
      return this.result(
        this.network.cacheStatus === "persistent"
          ? "complete"
          : "cache-unavailable",
      );
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  result(status) {
    return {
      status,
      files: this.jobs.length,
      bytes: this.bytes,
      complete: this.complete,
    };
  }
}

/** Complete this before exposing login: no game socket or character lease exists yet. */
export async function preloadStartupAssets(catalog, network, signal) {
  const plan = new StartupPreload(network);
  planStartupAssets(plan, catalog);
  return plan.run(signal);
}
