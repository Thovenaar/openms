import { EntityAnimation } from "../rendering/animation.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";
import { check } from "../rendering/stream-network.js";

const NAMES = Object.freeze(["LevelUp", "QuestClear"]);
const MAX_ACTIVE_EFFECTS = 32; // Browser residency bound, not an original event limit.
const DESTROY = Object.freeze({ children: true });

function preparedEffectRecord(index, name, resources) {
  const record = index.effects[name];
  if (!record || resources.has(name)) {
    throw new Error(`Original effect is missing or duplicated: ${name}`);
  }
  if (NAMES.includes(name) && !index.sounds.Game[name]) {
    throw new Error(`Original ${name} sound must be packaged`);
  }
  return record;
}

/** Prepared original resources; admitted events never cancel another visible sequence. */
export class GameplayEffects {
  constructor(services) {
    this.services = services;
    this.resources = new Map();
    this.slots = [];
    this.controller = new AbortController();
  }
  async prepare(index, signal, names = NAMES) {
    if (!Array.isArray(names) || names.length > MAX_ACTIVE_EFFECTS) {
      throw new Error("Original effect preparation exceeds its resource bound");
    }
    this.controller.abort();
    this.controller = new AbortController();
    signal = AbortSignal.any([signal, this.controller.signal]);
    const resources = new Map();
    const slots = [];
    try {
      for (const name of names) {
        const record = preparedEffectRecord(index, name, resources);
        const owner = await loadVisualBundle(
          record.bundle,
          this.services,
          signal,
        );
        resources.set(name, { owner, record });
        check(signal);
        if (owner.manifest.entities.length !== 1) {
          throw new Error(`${name} bundle must contain one original effect`);
        }
        slots.push(createSlot(name, resources.get(name)));
      }
      this.releaseResources();
      this.resources = resources;
      this.slots = slots;
    } catch (error) {
      for (const slot of slots) slot.animation.container.destroy(DESTROY);
      for (const resource of resources.values()) resource.owner.destroy();
      throw error;
    }
  }
  /** Each call represents one committed notification, never a proposed reward or dialog. */
  play(name, scene, target = null) {
    const resource = this.resources.get(name);
    if (!resource || !scene) {
      throw new Error(`Gameplay ${name} is not prepared`);
    }
    let active = 0;
    for (const slot of this.slots) if (slot.scene) active++;
    if (active >= MAX_ACTIVE_EFFECTS) {
      throw new Error("Gameplay effect residency bound exceeded");
    }
    const slot = this.acquire(name, resource);
    const pose = target ?? scene.presentation ?? scene.simulation;
    slot.animation.setAction(
      resource.owner.manifest.entities[0].action,
      "once",
      true,
    );
    slot.animation.setPosition(pose.x, pose.y);
    slot.remaining = resource.record.durationMs;
    slot.scene = scene;
    slot.target = target;
    // 009377d9 cases0/9: native effect layer;004ad42b follows unflipped actor position.
    scene.addWorldContainer(slot.animation.container, 398500);
  }
  /** Cold demand growth only; frame advancement and expiry allocate nothing. */
  acquire(name, resource) {
    let idle = null;
    for (const slot of this.slots) {
      if (slot.scene) continue;
      if (slot.name === name) return slot;
      idle = slot;
    }
    if (this.slots.length < MAX_ACTIVE_EFFECTS) {
      const slot = createSlot(name, resource);
      this.slots.push(slot);
      return slot;
    }
    if (!idle) throw new Error("Gameplay effect residency bound exceeded");
    const replacement = createSlot(name, resource);
    idle.animation.container.destroy(DESTROY);
    idle.name = replacement.name;
    idle.animation = replacement.animation;
    return idle;
  }
  update(ms) {
    for (const slot of this.slots) {
      if (!slot.scene) continue;
      slot.remaining -= ms;
      if (slot.remaining <= 0) {
        this.release(slot);
        continue;
      }
      const pose =
        slot.target ?? slot.scene.presentation ?? slot.scene.simulation;
      slot.animation.setPosition(pose.x, pose.y);
      slot.animation.advance(ms);
    }
  }
  release(slot) {
    if (slot.scene) slot.scene.removeWorldContainer(slot.animation.container);
    slot.scene = null;
    slot.target = null;
    slot.remaining = 0;
  }
  clear() {
    for (const slot of this.slots) this.release(slot);
  }
  snapshot() {
    return this.slots
      .filter((slot) => slot.scene)
      .map((slot) => ({
        name: slot.name,
        remainingMs: slot.remaining,
        frame: slot.animation.frame,
      }));
  }
  releaseResources() {
    this.clear();
    for (const slot of this.slots) slot.animation.container.destroy(DESTROY);
    this.slots.length = 0;
    for (const resource of this.resources.values()) resource.owner.destroy();
    this.resources.clear();
  }
  destroy() {
    this.controller.abort();
    this.releaseResources();
  }
}

function createSlot(name, resource) {
  return {
    name,
    animation: new EntityAnimation(
      resource.owner.manifest.entities[0],
      resource.owner.textures,
    ),
    remaining: 0,
    scene: null,
  };
}
