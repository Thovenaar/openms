import {
  resource,
  manifest,
  visualBundle,
} from "../rendering/stream-validation.js";

const MAX_FILES = 16384;
const FOREGROUND_RESERVE = 256 * 1024 * 1024;

/** A bounded manifest frontier; complete map atlases include every resident mob template. */
export class RegionDownloadPlan {
  constructor(region, catalog, network) {
    this.region = region;
    this.catalog = catalog;
    this.network = network;
    this.jobs = [];
    this.seen = new Map();
    this.bytes = 0;
    this.doneBytes = 0;
    this.complete = 0;
    this.next = 0;
    this.current = new Set();
    this.status = "downloading";
    this.error = null;
    for (const id of region.maps) {
      const name = catalog.mapNames[Number(id)] ?? id;
      this.add(catalog.maps[id], "map", name);
      this.add(
        catalog.ui.minimaps[id]?.descriptor,
        "bundle",
        `${name} — minimap`,
      );
      this.add(catalog.audiovisual.maps[id]?.bgm, "bytes", `${name} — music`);
    }
  }
  add(info, kind, label) {
    if (!info) return;
    resource(info);
    if (!info.url.startsWith("/generated/")) return;
    const previous = this.seen.get(info.url);
    if (previous) {
      if (previous.sha256 !== info.sha256) {
        throw new Error("Conflicting regional asset");
      }
      return;
    }
    if (this.jobs.length >= MAX_FILES) {
      throw new Error("Region file limit exceeded");
    }
    this.seen.set(info.url, info);
    this.jobs.push({ info, kind, label });
    this.bytes += info.bytes;
  }
  async load(job, signal) {
    if (job.kind === "bytes") await this.network.load(job.info, signal, true);
    else {
      const json = await this.network.json(job.info, signal, true);
      const data = job.kind === "map" ? manifest(json) : visualBundle(json);
      for (const info of Object.values(data.atlases)) {
        this.add(info, "bytes", `${job.label} — artwork`);
      }
      if (job.kind === "map") {
        for (const info of data.regions) {
          this.add(info, "bytes", `${job.label} — scenery`);
        }
        this.mobSounds(data);
      }
    }
    this.complete++;
    this.doneBytes += job.info.bytes;
  }
  mobSounds(map) {
    for (const template of Object.values(map.life.templates)) {
      if (template.kind !== "mob") continue;
      const sounds =
        this.catalog.audiovisual.combat.sounds.Mob[Number(template.originalId)];
      for (const sound of Object.values(sounds ?? {})) {
        if (sound.available) {
          this.add(sound.descriptor, "bytes", `${template.name} — sound`);
        }
      }
    }
  }
  async batch(signal, publish) {
    await this.network.ready;
    if (!this.hasStorage()) return;
    const jobs = this.jobs.slice(this.next, this.next + 2);
    this.next += jobs.length;
    const results = await Promise.allSettled(
      jobs.map(async (job) => {
        this.current.add(job);
        publish();
        try {
          await this.load(job, signal);
        } finally {
          this.current.delete(job);
        }
      }),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure) {
      signal.throwIfAborted();
      this.status = "failed";
      this.error = failure.reason.message;
    } else if (this.hasStorage() && this.next === this.jobs.length) {
      this.status = "complete";
    }
  }
  hasStorage() {
    if (this.network.cacheStatus !== "persistent") {
      this.status = "cache-unavailable";
      return false;
    }
    if (this.bytes + FOREGROUND_RESERVE > this.network.cacheByteLimit) {
      this.status = "storage-full";
      return false;
    }
    return true;
  }
  snapshot() {
    return {
      name: this.region.name,
      maps: this.region.maps.length,
      status: this.status,
      files: this.jobs.length,
      complete: this.complete,
      bytes: this.bytes,
      doneBytes: this.doneBytes,
      current: [...this.current].map((job) => job.label),
      error: this.error,
      cacheBytes: this.network.cacheBytes,
      cacheLimit: this.network.cacheByteLimit,
    };
  }
}
