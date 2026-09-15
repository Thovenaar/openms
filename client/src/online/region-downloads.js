import { assetRegions } from "./asset-regions.js";
import { RegionDownloadPlan } from "./region-download-plan.js";
import { visualBundle } from "../rendering/stream-validation.js";

/** Encoded cache warming only; foreground networking keeps two reserved slots. */
export class RegionDownloads {
  constructor(catalog, network, loading, signal) {
    this.catalog = catalog;
    this.network = network;
    this.loading = loading;
    this.signal = signal;
    this.regions = null;
    this.plans = new Map();
    this.queue = [];
    this.currentMap = null;
    this.running = null;
    this.paused = false;
    this.state = null;
  }
  async start() {
    try {
      const world = visualBundle(
        await this.network.json(
          this.catalog.ui.bundles.WorldMap,
          this.signal,
          true,
        ),
      );
      this.regions = assetRegions(this.catalog, world.metadata);
      this.enqueue(this.regions.defaultRegion);
      if (this.currentMap) this.select(this.currentMap);
      this.kick();
    } catch (error) {
      this.failed(error);
    }
  }
  select(mapId) {
    this.currentMap = String(mapId).padStart(9, "0");
    if (!this.regions) return;
    const region = this.regions.membership.get(this.currentMap);
    this.enqueue(region, true);
    this.kick();
  }
  enqueue(id, first = false) {
    const region = this.regions.groups.get(id);
    if (!region) return;
    let plan = this.plans.get(id);
    if (!plan) {
      plan = new RegionDownloadPlan(region, this.catalog, this.network);
      this.plans.set(id, plan);
    }
    if (plan.status !== "downloading") return;
    const index = this.queue.indexOf(plan);
    if (index >= 0) this.queue.splice(index, 1);
    if (first) this.queue.unshift(plan);
    else this.queue.push(plan);
  }
  toggle() {
    this.paused = !this.paused;
    this.publish(this.queue[0]);
    if (!this.paused) this.kick();
  }
  kick() {
    if (this.running || this.paused || this.signal.aborted) return;
    this.running = this.run()
      .catch((error) => this.failed(error))
      .finally(() => {
        this.running = null;
        if (this.queue.length && !this.paused) this.kick();
      });
  }
  async run() {
    while (this.queue.length && !this.paused) {
      this.signal.throwIfAborted();
      const plan = this.queue[0];
      await plan.batch(this.signal, () => this.publish(plan));
      this.publish(plan);
      if (plan.status !== "downloading") {
        this.queue.splice(this.queue.indexOf(plan), 1);
      }
      // Cached JSON/hash work yields between bounded batches as well as network reads.
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
    }
  }
  publish(plan) {
    if (!plan || this.signal.aborted) return;
    this.state = {
      ...plan.snapshot(),
      paused: this.paused,
      queuedRegions: this.queue
        .filter((item) => item !== plan)
        .map((item) => item.region.name),
    };
    this.loading.setBackground(this.state);
  }
  failed(error) {
    if (this.signal.aborted) return;
    this.queue.length = 0;
    this.state = {
      name: "Region downloads",
      status: "failed",
      error: error.message,
    };
    this.loading.setBackground(this.state);
  }
  snapshot() {
    return this.state;
  }
}
