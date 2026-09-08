import { EntityAnimation } from "./animation.js";
import { VisualTextures } from "./visual-resources.js";
import { entities } from "./stream-validation.js";
import { check } from "./stream-network.js";

const MAX_PENDING_TEMPLATES = 2;
const PREFETCH_VIEWPORTS = 0.5;

/** Gameplay lives in mobs; this owner may discard/reacquire only presentation. */
export class OfflineMobRenderer {
  constructor(scene, mobs) {
    this.scene = scene;
    this.mobs = mobs;
    this.templates = new Map();
    this.destroyed = false;
    this.pending = 0;
    this.error = null;
    for (const mob of mobs) {
      if (this.templates.has(mob.record.template)) continue;
      const descriptor = scene.manifest.life.renderables?.[mob.record.template];
      if (!descriptor && !mob.defaultAction) continue;
      if (!descriptor) {
        throw new Error("Dynamic mob artwork missing from map package");
      }
      entities([descriptor.entity], scene.manifest);
      this.templates.set(mob.record.template, {
        descriptor,
        values: [descriptor.entity],
        wanted: 0,
        resources: null,
        controller: null,
        promise: null,
        ready: false,
        failed: false,
      });
    }
  }

  wanted(mob) {
    if (!mob.active || !mob.visible) return false;
    const scene = this.scene;
    const bounds = this.templates.get(mob.record.template).descriptor.bounds;
    const marginX = scene.viewport.width * PREFETCH_VIEWPORTS;
    const marginY = scene.viewport.height * PREFETCH_VIEWPORTS;
    const radius = Math.max(Math.abs(bounds.left), Math.abs(bounds.right));
    return (
      mob.x + radius >= scene.camera.x - marginX &&
      mob.x - radius <= scene.camera.x + scene.viewport.width + marginX &&
      mob.y + bounds.bottom >= scene.camera.y - marginY &&
      mob.y + bounds.top <= scene.camera.y + scene.viewport.height + marginY
    );
  }

  countDemand() {
    for (const slot of this.templates.values()) slot.wanted = 0;
    for (const mob of this.mobs) {
      if (this.wanted(mob)) this.templates.get(mob.record.template).wanted++;
      else this.remove(mob);
    }
    for (const slot of this.templates.values()) {
      if (!slot.wanted) this.release(slot);
    }
  }

  async prepare(signal) {
    check(signal);
    this.countDemand();
    const cancel = this.destroy.bind(this);
    signal.addEventListener("abort", cancel, { once: true });
    try {
      for (const slot of this.templates.values()) {
        if (slot.wanted) await this.load(slot);
        check(signal);
      }
      this.instantiateDemand();
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  /** Called by scene demand scheduling, never by fixed-step simulation. */
  updateDemand() {
    if (this.destroyed) return;
    this.countDemand();
    this.instantiateDemand();
    for (const slot of this.templates.values()) {
      if (this.pending >= MAX_PENDING_TEMPLATES) break;
      if (!slot.wanted || slot.resources || slot.promise || slot.failed) {
        continue;
      }
      this.load(slot)
        .then(this.loaded.bind(this))
        .catch(this.failed.bind(this, slot));
    }
  }

  loaded() {
    if (!this.destroyed) this.instantiateDemand();
  }

  failed(slot, error) {
    if (error.name === "AbortError" || this.destroyed) return;
    slot.failed = true;
    this.error = error.message;
    this.scene.lastError = error.message;
  }

  async load(slot) {
    if (this.destroyed) return;
    const controller = new AbortController();
    const resources = new VisualTextures(
      this.scene.manifest,
      this.scene.atlases,
    );
    slot.controller = controller;
    slot.resources = resources;
    slot.promise = resources.load(
      slot.values,
      controller.signal,
      slot.descriptor.atlases,
    );
    this.pending++;
    try {
      await slot.promise;
      check(controller.signal);
      if (!this.destroyed && slot.resources === resources) slot.ready = true;
    } catch (error) {
      resources.destroy();
      if (slot.resources === resources) {
        slot.resources = null;
        slot.ready = false;
      }
      throw error;
    } finally {
      if (slot.controller === controller) slot.promise = null;
      this.pending--;
    }
  }

  instantiateDemand() {
    for (const mob of this.mobs) {
      if (mob.presentation || !this.wanted(mob)) continue;
      const slot = this.templates.get(mob.record.template);
      if (!slot.ready) continue;
      const source = {
        ...slot.descriptor.entity,
        id: mob.id,
        order: 100000 + Number(mob.id.slice(5)),
        x: mob.x,
        y: mob.y,
      };
      const presentation = new EntityAnimation(source, slot.resources.textures);
      presentation.gameplayOwned = true;
      mob.presentation = presentation;
      this.synchronizeMob(mob);
      try {
        this.scene.addDynamicEntity(presentation);
      } catch (error) {
        mob.presentation = null;
        presentation.container.destroy({ children: true });
        throw error;
      }
    }
  }

  /** Original frame selection is projected from simulation, never RAF time. */
  synchronizeMob(mob) {
    const entity = mob.presentation;
    if (!entity) return;
    entity.setPosition(mob.x, mob.y);
    entity.container.scale.x = mob.facing > 0 ? -1 : 1;
    entity.container.visible = mob.visible;
    const once = !mob.alive || mob.state === "hit" || mob.state === "attack";
    entity.setAction(mob.action, once ? "once" : "loop");
    entity.seek(mob.actionMs);
  }

  synchronize() {
    for (const mob of this.mobs) this.synchronizeMob(mob);
  }

  remove(mob) {
    if (!mob.presentation) return;
    this.scene.removeDynamicEntity(mob.id);
    mob.presentation.container.destroy({ children: true });
    mob.presentation = null;
  }

  release(slot) {
    slot.controller?.abort();
    slot.resources?.destroy();
    slot.resources = null;
    slot.ready = false;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const mob of this.mobs) this.remove(mob);
    for (const slot of this.templates.values()) this.release(slot);
  }
}
