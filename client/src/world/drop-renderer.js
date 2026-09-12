import { EntityAnimation } from "../rendering/animation.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";
import { DROP_POLICY } from "./drop-system.js";
import { dropDrawY } from "./drop-motion.js";

const MAX_PENDING = 2;
const PREFETCH_MARGIN = 128;

/** Original 00506bfe: <50, <100, <1000, then meso bag. */
export function currencyVariant(quantity) {
  if (quantity < 50) return 0;
  if (quantity < 100) return 1;
  return quantity < 1000 ? 2 : 3;
}

function currencyEntity(resource, artwork, quantity) {
  const variant = currencyVariant(quantity);
  const frames = [];
  for (const record of artwork.variants[variant]) {
    const entity = resource.manifest.entities.find(
      (entry) => entry.id === record.path,
    );
    if (!entity) throw new Error("Missing immutable currency frame");
    frames.push({
      delay: record.delay,
      parts: entity.actions.default[0].parts,
    });
  }
  return { ...resource.manifest.entities[0], actions: { default: frames } };
}

function itemEntity(resource, template) {
  const path = template.iconRawPath ?? template.iconPath;
  const entity = resource.manifest.entities.find((entry) => entry.id === path);
  if (!entity) throw new Error("Missing immutable dropped-item icon");
  return entity;
}

/** Bounded demand owner. All decoding/instantiation runs outside fixed-step and draw. */
export class DropRenderer {
  constructor(scene, system, services, artwork) {
    if (
      !artwork?.descriptor ||
      !Array.isArray(artwork.variants) ||
      artwork.variants.length !== 4
    ) {
      throw new Error(
        "Currency artwork was not included in the offline closure",
      );
    }
    for (const variant of artwork.variants) {
      if (
        !Array.isArray(variant) ||
        variant.length !== 4 ||
        variant.some(
          (frame) => !Number.isFinite(frame.delay) || frame.delay <= 0,
        )
      ) {
        throw new Error("Invalid currency animation");
      }
    }
    this.scene = scene;
    this.system = system;
    this.services = services;
    this.artwork = artwork;
    this.resources = new Map();
    this.presentations = Array.from(
      { length: DROP_POLICY.capacity },
      (_, index) => ({
        id: `drop:${index}`,
        entity: null,
        generation: -1,
        resource: null,
      }),
    );
    this.pending = 0;
    this.destroyed = false;
    this.error = null;
    this.loadedBound = this.updateDemand.bind(this);
  }

  wanted(slot) {
    return (
      slot.active &&
      slot.x >= this.scene.camera.x - PREFETCH_MARGIN &&
      slot.x <=
        this.scene.camera.x + this.scene.viewport.width + PREFETCH_MARGIN &&
      slot.y >= this.scene.camera.y - PREFETCH_MARGIN &&
      slot.y <=
        this.scene.camera.y + this.scene.viewport.height + PREFETCH_MARGIN
    );
  }

  /** Initial currency load is small and gives transition failure ordinary rollback semantics. */
  async prepare(signal) {
    signal.throwIfAborted();
    const resource = await loadVisualBundle(
      this.artwork.descriptor,
      this.services,
      signal,
    );
    if (this.destroyed || signal.aborted) {
      resource.destroy();
      signal.throwIfAborted();
      return;
    }
    this.resources.set(0, {
      resource,
      wanted: 0,
      pending: false,
      failed: false,
      controller: null,
    });
  }

  updateDemand() {
    if (this.destroyed) return;
    this.retainDemand();
    for (let index = 0; index < this.system.slots.length; index++) {
      this.preparePresentation(
        this.system.slots[index],
        this.presentations[index],
      );
    }
  }

  retainDemand() {
    for (const resource of this.resources.values()) resource.wanted = 0;
    for (let index = 0; index < this.system.slots.length; index++) {
      const slot = this.system.slots[index],
        view = this.presentations[index];
      if (slot.reserved) {
        const resource = this.resources.get(slot.itemId);
        if (resource) resource.wanted++;
        continue;
      }
      const wanted = this.wanted(slot);
      if (view.generation !== slot.generation || !wanted) this.remove(view);
      if (!wanted) continue;
      const resource = this.resources.get(slot.itemId);
      if (resource) resource.wanted++;
    }
    this.releaseUnwantedResources();
  }

  releaseUnwantedResources() {
    for (const [id, resource] of this.resources) {
      if (!resource.wanted && id !== 0) {
        resource.controller?.abort();
        resource.resource?.destroy();
        this.resources.delete(id);
      }
    }
  }

  preparePresentation(slot, view) {
    if (!this.wanted(slot)) return;
    const resource = this.demand(slot.itemId);
    if (resource.resource && !view.entity) {
      this.instantiate(view, slot, resource.resource);
    }
    if (
      !resource.resource &&
      !resource.pending &&
      !resource.failed &&
      this.pending < MAX_PENDING
    ) {
      this.load(slot.itemId, resource)
        .then(this.loadedBound)
        .catch((error) => this.failed(resource, error));
    }
  }

  demand(id) {
    let resource = this.resources.get(id);
    if (resource) return resource;
    if (this.resources.size > DROP_POLICY.capacity) {
      throw new Error("Drop artwork owner limit");
    }
    resource = {
      resource: null,
      wanted: 0,
      pending: false,
      failed: false,
      controller: null,
      promise: null,
    };
    this.resources.set(id, resource);
    return resource;
  }

  load(id, slot) {
    if (!slot.promise) slot.promise = this.loadResource(id, slot);
    return slot.promise;
  }

  async loadResource(id, slot) {
    const descriptor = id
      ? this.system.items[id].descriptor
      : this.artwork.descriptor;
    slot.controller = new AbortController();
    slot.pending = true;
    this.pending++;
    try {
      const resource = await loadVisualBundle(
        descriptor,
        this.services,
        slot.controller.signal,
      );
      if (this.destroyed || slot.controller.signal.aborted) resource.destroy();
      else slot.resource = resource;
    } finally {
      slot.pending = false;
      this.pending--;
    }
  }

  failed(resource, error) {
    if (this.destroyed || error.name === "AbortError") return;
    resource.failed = true;
    this.error = error.message;
    this.scene.lastError = error.message;
  }

  instantiate(view, slot, resource) {
    const original = slot.itemId
      ? itemEntity(resource, this.system.items[slot.itemId])
      : currencyEntity(resource, this.artwork, slot.quantity);
    const source = {
      ...original,
      id: view.id,
      kind: "drop",
      x: slot.x,
      y: slot.y,
      z: 29999 + (slot.foothold.layer * 3000 - slot.foothold.group) * 10,
      order: 0,
      visible: true,
    };
    const entity = new EntityAnimation(source, resource.textures);
    entity.gameplayOwned = true;
    try {
      this.scene.addDynamicEntity(entity);
    } catch (error) {
      entity.container.destroy({ children: true });
      throw error;
    }
    view.entity = entity;
    view.generation = slot.generation;
    view.resource = resource;
  }

  /** The exact reserved world slot acquires its invisible display membership before item debit. */
  async prepareDrop(instance, slot) {
    const index = this.system.slots.indexOf(slot);
    if (
      this.destroyed ||
      index < 0 ||
      !slot.reserved ||
      slot.itemId !== instance.id
    ) {
      throw new Error(
        "The original item drop reservation is no longer current",
      );
    }
    const view = this.presentations[index];
    const cache = this.demand(instance.id);
    const prepared = { view, slot, published: false };
    try {
      if (!cache.resource) await this.load(instance.id, cache);
      if (this.destroyed || !slot.reserved || !cache.resource) {
        throw new Error("Original item drop preparation was cancelled");
      }
      this.remove(view);
      this.instantiate(view, slot, cache.resource);
      view.entity.container.visible = false;
      return prepared;
    } catch (error) {
      this.releaseDrop(prepared);
      throw error;
    }
  }

  publishDrop(prepared, slot) {
    prepared.view.generation = slot.generation;
    prepared.view.entity.container.visible = true;
    prepared.published = true;
  }

  releaseDrop(prepared) {
    if (!prepared.published) this.remove(prepared.view);
  }

  /** Scene camera transforms the shared world root. No allocation or resource work here. */
  draw() {
    for (let index = 0; index < this.system.slots.length; index++) {
      const slot = this.system.slots[index],
        entity = this.presentations[index].entity;
      if (!entity) continue;
      entity.container.visible = slot.active && slot.state !== "waiting";
      if (!entity.container.visible) continue;
      entity.seek(slot.age);
      const geometry = entity.current.geometry[entity.frame];
      const halfHeight = Math.trunc(geometry.height / 2);
      entity.container.pivot.set(
        geometry.x + Math.trunc(geometry.width / 2),
        geometry.y + halfHeight,
      );
      entity.setPosition(slot.x, dropDrawY(slot, halfHeight));
      entity.container.rotation = slot.rotation;
      entity.container.alpha = slot.alpha;
    }
  }

  remove(view) {
    if (!view.entity) return;
    this.scene.removeDynamicEntity(view.id);
    view.entity.container.destroy({ children: true });
    view.entity = null;
    view.resource = null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const view of this.presentations) this.remove(view);
    for (const resource of this.resources.values()) {
      resource.controller?.abort();
      resource.resource?.destroy();
    }
    this.resources.clear();
  }
}
