import {
  resource,
  manifest,
  visualBundle,
} from "../rendering/stream-validation.js";
import { assetContainer, regionPackClosure } from "../assets/region-pack.js";
import { installAssetPack, installRegionPack } from "./region-pack.js";

const MAX_FILES = 16384;
const FOREGROUND_RESERVE = 256 * 1024 * 1024;

/** A bounded manifest frontier; complete map atlases include every resident mob template. */
export class RegionDownloadPlan {
  constructor(region, catalog, network, packs = null) {
    this.region = region;
    this.catalog = catalog;
    this.network = network;
    this.packs = packs?.packs ?? null;
    this.assets = packs?.assets ?? null;
    this.containers = packs?.containers ?? null;
    this.installed = new Map();
    this.assetContainers = 0;
    this.downloads = 0;
    this.jobs = [];
    this.seen = new Map();
    this.finished = new Set();
    this.discovered = 0;
    this.bytes = 0;
    this.doneBytes = 0;
    this.complete = 0;
    this.packed = 0;
    this.packFallbacks = 0;
    this.next = 0;
    this.current = new Set();
    this.status = "downloading";
    this.error = null;
    for (const id of region.maps) this.schedule(id, catalog);
  }
  /** One map contributes its manifest, its minimap and its music. */
  schedule(id, catalog) {
    const name = catalog.mapNames[Number(id)] ?? id;
    const minimap = catalog.ui.minimaps[id]?.descriptor;
    const pack = this.packs?.[id] ?? null;
    this.add(catalog.maps[id], "map", name, { pack, minimap });
    // A pack carries the minimap, so only an unpacked map queues it separately.
    if (!pack) this.add(minimap, "bundle", `${name} — minimap`);
    this.add(catalog.audiovisual.maps[id]?.bgm, "bytes", `${name} — music`);
  }
  /** One request may deliver a whole packed closure; the frontier still counts each member. */
  add(info, kind, label, extra = null) {
    if (this.admit(info) !== "new") return;
    this.jobs.push({
      info,
      kind,
      label,
      ...extra,
      container: this.containerFor(info),
    });
  }
  containerFor(info) {
    return this.assets ? assetContainer(this, info.url) : null;
  }
  deliver(info) {
    if (this.admit(info) === "rejected") return;
    this.finish(info.url, info.bytes);
  }
  admit(info) {
    if (!info) return "rejected";
    resource(info);
    if (!info.url.startsWith("/generated/")) return "rejected";
    const previous = this.seen.get(info.url);
    if (previous) {
      if (previous.sha256 !== info.sha256) {
        throw new Error("Conflicting regional asset");
      }
      return "known";
    }
    if (this.discovered >= MAX_FILES) {
      throw new Error("Region file limit exceeded");
    }
    this.seen.set(info.url, info);
    this.discovered++;
    this.bytes += info.bytes;
    return "new";
  }
  finish(url, bytes) {
    if (this.finished.has(url)) return;
    this.finished.add(url);
    this.complete++;
    this.doneBytes += bytes;
  }
  async load(job, signal) {
    if (job.container) {
      const installed = await this.installContainer(job.container, signal);
      if (installed) {
        this.finish(job.info.url, job.info.bytes);
        return;
      }
    }
    if (job.kind === "bytes") {
      this.downloads++;
      await this.network.load(job.info, signal, true);
    } else {
      const data = await this.describe(job, signal);
      for (const info of Object.values(data.atlases)) {
        this.add(info, "bytes", `${job.label} — artwork`);
      }
      if (job.kind === "map") this.mobSounds(data);
    }
    this.finish(job.info.url, job.info.bytes);
  }
  /** Packed maps deliver their JSON closure in one verified transfer. */
  async describe(job, signal) {
    if (job.kind === "map" && job.pack) {
      const packed = await this.loadPacked(job, signal);
      if (packed) return packed;
    }
    this.downloads++;
    const json = await this.network.json(job.info, signal, true);
    const data = job.kind === "map" ? manifest(json) : visualBundle(json);
    if (job.kind === "map") {
      this.add(job.minimap, "bundle", `${job.label} — minimap`);
      for (const info of data.regions) {
        this.add(info, "bytes", `${job.label} — scenery`);
      }
    }
    return data;
  }
  /** One shared container is fetched once per plan; its members then cost no request. */
  installContainer(descriptor, signal) {
    const known = this.installed.get(descriptor.url);
    if (known) return known;
    this.downloads++;
    const install = installAssetPack(this.network, descriptor, signal)
      .then(() => {
        this.assetContainers++;
        return true;
      })
      .catch(() => {
        signal.throwIfAborted();
        this.packFallbacks++;
        return false;
      });
    this.installed.set(descriptor.url, install);
    return install;
  }
  /** A pack delivery problem is not a gameplay problem: retry that map per file. */
  async loadPacked(job, signal) {
    this.downloads++;
    try {
      const { manifest: data, bundle } = await installRegionPack(
        this.network,
        job.pack,
        { manifest: job.info, minimap: job.minimap },
        signal,
      );
      const parsed = manifest(data);
      for (const info of regionPackClosure(job.info, parsed, job.minimap)) {
        this.deliver(info);
      }
      // A packed map no longer queues its minimap separately, so take its artwork here.
      if (bundle) {
        for (const info of Object.values(visualBundle(bundle).atlases)) {
          this.add(info, "bytes", `${job.label} — minimap artwork`);
        }
      }
      this.packed++;
      return parsed;
    } catch {
      signal.throwIfAborted();
      this.packFallbacks++;
      return null;
    }
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
    const jobs = [];
    while (jobs.length < 2 && this.next < this.jobs.length) {
      const job = this.jobs[this.next++];
      if (this.finished.has(job.info.url)) continue;
      jobs.push(job);
    }
    if (!jobs.length) {
      if (this.hasStorage() && this.next === this.jobs.length) {
        this.status = "complete";
      }
      return;
    }
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
      files: this.discovered,
      complete: this.complete,
      bytes: this.bytes,
      doneBytes: this.doneBytes,
      current: [...this.current].map((job) => job.label),
      error: this.error,
      cacheBytes: this.network.cacheBytes,
      cacheLimit: this.network.cacheByteLimit,
      packed: this.packed,
      assetContainers: this.assetContainers,
      downloads: this.downloads,
      packFallbacks: this.packFallbacks,
    };
  }
}
