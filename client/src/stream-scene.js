import { Container } from "pixi.js";
import { EntityAnimation } from "./animation.js";
import { createSimulation } from "./physics/simulation.js";
import { check, aborted } from "./stream-network.js";
import { entities, LIMITS } from "./stream-validation.js";
import { VisualTextures } from "./visual-resources.js";

/** Viewport intersection and one-half viewport near-prefetch are browser policies. */
function intersects(bounds, camera, viewport, margin) {
  return (
    bounds.right >= camera.x - margin * viewport.width &&
    bounds.left <= camera.x + (1 + margin) * viewport.width &&
    bounds.bottom >= camera.y - margin * viewport.height &&
    bounds.top <= camera.y + (1 + margin) * viewport.height
  );
}

/** Region owns subtextures/display objects; atlas sources are shared/refcounted. */
class Region {
  constructor(scene, descriptor) {
    this.scene = scene;
    this.descriptor = descriptor;
    this.controller = new AbortController();
    this.resources = new VisualTextures(scene.manifest, scene.atlases);
    this.textures = this.resources.textures;
    this.entities = [];
    this.ready = false;
    this.destroyed = false;
    this.promise = null;
    this.spriteCount = 0;
  }
  async load(values) {
    const signal = this.controller.signal;
    try {
      if (!values) {
        const data = await this.scene.network.json(this.descriptor, signal);
        if (data.schemaVersion !== 2 || data.id !== this.descriptor.id) {
          throw new Error("Region version/identity mismatch");
        }
        values = entities(data.entities, this.scene.manifest);
      }
      await this.resources.load(values, signal, this.descriptor?.atlases);
      check(signal);
      this.instantiate(values);
      check(signal);
      this.ready = true;
      this.scene.refreshEntities();
      return this;
    } catch (error) {
      this.destroy();
      throw error;
    }
  }
  instantiate(values) {
    if (this.scene.entities.length + values.length > LIMITS.entities) {
      throw new Error("Resident entity backpressure");
    }
    for (let index = 0; index < values.length; index++) {
      if (this.scene.byId.has(values[index].id)) {
        throw new Error("Duplicate resident entity identity");
      }
      const entity = new EntityAnimation(values[index], this.textures);
      this.entities.push(entity);
      const available =
        LIMITS.sprites - this.scene.spriteCount - this.spriteCount;
      if (entity.background) {
        entity.prepareBackground({ width: 2560, height: 1440 }, available);
      }
      if (entity.sprites.length > available) {
        throw new Error("Resident sprite backpressure");
      }
      this.spriteCount += entity.sprites.length;
    }
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.controller.abort();
    this.ready = false;
    for (const entity of this.entities) {
      entity.container.destroy({ children: true });
    }
    this.resources.destroy();
    this.entities.length = 0;
  }
}

/** One live world plus an isolated transition candidate. No all-artwork preload path. */
export class StreamScene {
  constructor(manifest, services, viewport) {
    this.manifest = manifest;
    this.network = services.network;
    this.atlases = services.atlases;
    this.viewport = viewport;
    this.camera = { ...manifest.camera };
    this.container = new Container();
    // Pixi enables parent sorting when actor depth changes; previews stay above world art.
    this.overlays = new Container({ zIndex: Number.MAX_SAFE_INTEGER });
    this.regions = new Map();
    this.entities = [];
    this.backgrounds = [];
    this.byId = new Map();
    this.actorRegion = new Region(this, null);
    this.simulation = null;
    this.actor = null;
    this.destroyed = false;
    this.lastError = null;
    this.pendingLoads = 0;
    this.nearLimit = 2;
    this.failures = new Set();
    this.spriteCount = 0;
  }
  async prepare(signal, arrival = null) {
    const cancel = () => this.destroy();
    signal.addEventListener("abort", cancel, { once: true });
    try {
      await this.actorRegion.load(this.manifest.actors);
      check(signal);
      this.actor = this.actorRegion.entities.find(
        (entity) => entity.kind === "character",
      );
      if (!this.actor) throw new Error("Map has no original character actor");
      const spawn = arrival ?? { x: this.actor.baseX, y: this.actor.baseY };
      this.camera.x += spawn.x - this.actor.baseX;
      this.camera.y += spawn.y - this.actor.baseY;
      this.simulation = createSimulation(this.manifest.physics, spawn);
      this.updateActor(this.simulation);
      for (let index = 0; index < this.manifest.regions.length; index++) {
        const region = this.manifest.regions[index];
        if (
          region.always ||
          intersects(region.bounds, this.camera, this.viewport, 0)
        ) {
          await this.loadRegion(region);
        }
        check(signal);
      }
      return this;
    } catch (error) {
      this.destroy();
      throw error;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }
  async loadRegion(descriptor) {
    if (this.destroyed) throw aborted();
    const old = this.regions.get(descriptor.id);
    if (old) return old.promise;
    const region = new Region(this, descriptor);
    this.regions.set(descriptor.id, region);
    this.pendingLoads++;
    region.promise = region.load(null);
    try {
      return await region.promise;
    } catch (error) {
      if (this.regions.get(descriptor.id) === region) {
        this.regions.delete(descriptor.id);
      }
      throw error;
    } finally {
      this.pendingLoads--;
    }
  }
  refreshEntities() {
    if (this.destroyed) return;
    this.entities.length = 0;
    this.backgrounds.length = 0;
    this.byId.clear();
    this.spriteCount = 0;
    this.collect(this.actorRegion);
    for (const region of this.regions.values()) this.collect(region);
    this.entities.sort(
      (left, right) =>
        left.container.zIndex - right.container.zIndex ||
        left.order - right.order,
    );
    this.container.removeChildren();
    for (const entity of this.entities) {
      this.container.addChild(entity.container);
    }
    this.container.addChild(this.overlays);
    this.fieldSystems?.refresh();
  }
  /** Initialize and update the same pose contract, including paused map entry. */
  updateActor(pose) {
    const actor = this.actor;
    const action = this.simulation.action;
    actor.setPosition(pose.x, pose.y);
    // Original extracted artwork faces left; positive direction mirrors it.
    actor.container.scale.x = pose.facing > 0 ? -1 : 1;
    if (actor.action !== action && actor.actions.has(action)) {
      actor.setAction(action);
    }
    this.updateActorDepth();
  }
  /** 0092fd16 local-user depth; update sorted ownership only when its plane changes. */
  updateActorDepth() {
    const actor = this.actor;
    const sim = this.simulation;
    const z = 29997 + (sim.contactLayer * 3000 - sim.contactGroup) * 10;
    const previous = actor.container.zIndex;
    if (z === previous) return;
    actor.container.zIndex = z;
    const oldIndex = this.entities.indexOf(actor);
    if (oldIndex < 0) {
      throw new Error("Live actor missing from scene ownership");
    }
    let index = oldIndex;
    const direction = z > previous ? 1 : -1;
    for (let count = 0; count < this.entities.length; count++) {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= this.entities.length) break;
      const next = this.entities[nextIndex];
      const comparison = z - next.container.zIndex || actor.order - next.order;
      if (comparison * direction <= 0) break;
      this.entities[index] = next;
      index = nextIndex;
    }
    this.entities[index] = actor;
    if (index !== oldIndex) {
      this.container.setChildIndex(actor.container, index);
    }
  }

  collect(region) {
    if (!region.ready) return;
    this.spriteCount += region.spriteCount;
    for (const entity of region.entities) {
      if (this.byId.has(entity.id)) {
        throw new Error(`Duplicate resident entity: ${entity.id}`);
      }
      this.entities.push(entity);
      this.byId.set(entity.id, entity);
      if (entity.background) this.backgrounds.push(entity);
    }
  }
  /** Timer-driven demand, bounded by validated region count and two concurrent regions. */
  updateDemand() {
    if (this.destroyed) return;
    let changed = false;
    for (const [id, region] of this.regions) {
      if (
        region.descriptor.always ||
        intersects(region.descriptor.bounds, this.camera, this.viewport, 0.5)
      ) {
        continue;
      }
      region.destroy();
      this.regions.delete(id);
      changed = true;
    }
    if (changed) this.refreshEntities();
    this.scheduleRegions(0);
    this.scheduleRegions(0.5);
  }
  scheduleRegions(margin) {
    for (
      let index = 0;
      index < this.manifest.regions.length &&
      this.pendingLoads < this.nearLimit;
      index++
    ) {
      const descriptor = this.manifest.regions[index];
      if (this.regions.has(descriptor.id) || this.failures.has(descriptor.id)) {
        continue;
      }
      if (
        !descriptor.always &&
        !intersects(descriptor.bounds, this.camera, this.viewport, margin)
      ) {
        continue;
      }
      this.loadRegion(descriptor).catch((error) => {
        if (error.name !== "AbortError") {
          this.lastError = error.message;
          this.failures.add(descriptor.id);
        }
      });
    }
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fieldSystems?.destroy();
    this.actorRegion.destroy();
    for (const region of this.regions.values()) region.destroy();
    this.regions.clear();
    this.container.destroy({ children: true });
    this.entities.length = 0;
    this.backgrounds.length = 0;
    this.byId.clear();
  }
}
