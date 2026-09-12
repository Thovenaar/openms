import { EntityAnimation } from "../rendering/animation.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";
import { TELEPORT_SKILLS } from "./skill-world-rules.js";

const DESTROY = Object.freeze({ children: true });

function effectPath(id) {
  if (TELEPORT_SKILLS.has(id)) return "Teleport";
  if (id === 4111006) return "Flying";
  if (id === 14101004) return "Flying1";
  if (id === 11101005) return "SoulRush";
  return null;
}

export class SkillWorldEffects {
  constructor(system) {
    this.system = system;
    this.records = new Map();
    this.controller = new AbortController();
  }

  async prepare(skills) {
    for (const skill of skills) {
      const path = effectPath(skill.id);
      if (!path || this.records.has(path)) continue;
      const descriptor = this.system.fullCatalog.ui.skillWorld?.effects[path];
      if (!descriptor?.available) continue;
      const owner = await loadVisualBundle(
        descriptor.bundle,
        this.system.hooks.services,
        this.controller.signal,
      );
      const slots = [];
      for (let index = 0; index < 2; index++) {
        const animation = new EntityAnimation(
          owner.manifest.entities[0],
          owner.textures,
        );
        animation.container.visible = false;
        this.system.scene.addWorldContainer(
          animation.container,
          this.system.scene.actor.container.zIndex + 1,
        );
        slots.push({ animation, remainingMs: 0 });
      }
      this.records.set(path, {
        owner,
        slots,
        durationMs: descriptor.durationMs,
      });
    }
  }

  admissionError(id) {
    const path = effectPath(id);
    if (!path) return null;
    const record = this.records.get(path);
    if (!record) return "Original movement effect is not prepared";
    return null;
  }

  play(id, origin, index = 0) {
    const record = this.records.get(effectPath(id));
    if (!record) return;
    const slot = record.slots[index];
    slot.remainingMs = record.durationMs;
    slot.animation.setPosition(origin.x, origin.y);
    slot.animation.container.scale.x = origin.facing > 0 ? -1 : 1;
    slot.animation.container.visible = true;
    slot.animation.setAction("play", "once", true);
  }

  step(ms) {
    for (const record of this.records.values()) {
      for (const slot of record.slots) {
        if (slot.remainingMs <= 0) continue;
        slot.remainingMs = Math.max(0, slot.remainingMs - ms);
        slot.animation.advance(ms);
        slot.animation.container.visible = slot.remainingMs > 0;
      }
    }
  }

  destroy() {
    this.controller.abort();
    for (const record of this.records.values()) {
      for (const slot of record.slots) {
        this.system.scene.removeWorldContainer(slot.animation.container);
        slot.animation.container.destroy(DESTROY);
      }
      record.owner.destroy();
    }
    this.records.clear();
  }
}
