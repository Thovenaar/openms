import {
  createSkillAnimation,
  loadSkillVisual,
} from "./skill-runtime-ports.js";

import { MORPH_SKILLS } from "./skill-world-rules.js";

const DESTROY = Object.freeze({ children: true });
const MAX_FORMS = 8;

export function morphId(info, gender) {
  const id = info.morph;
  return gender === 1 && (id === 1000 || id === 1001 || id === 1003)
    ? id + 100
    : id;
}

/** One independently leased actor; ordinary avatar retains its equipment ownership. */
export class SkillForms {
  constructor(system) {
    this.system = system;
    this.records = new Map();
    this.current = null;
    this.controller = new AbortController();
  }

  async prepare(skills) {
    for (const skill of skills) {
      if (!MORPH_SKILLS.has(skill.id)) continue;
      const info = this.system.info(skill.id);
      const id = morphId(info, this.system.store.profile.gender);
      if (this.records.has(id)) continue;
      if (this.records.size >= MAX_FORMS) {
        throw new Error("Form residency bound exceeded");
      }
      const descriptor = this.system.fullCatalog.ui.skillWorld?.forms[id];
      if (!descriptor) continue;
      const owner = await loadSkillVisual(
        this.system,
        descriptor.bundle,
        this.controller.signal,
      );
      const animation = createSkillAnimation(
        this.system,
        owner.manifest.entities[0],
        owner.textures,
      );
      animation.container.visible = false;
      this.system.scene.addWorldContainer(
        animation.container,
        this.system.scene.actor.container.zIndex,
      );
      this.records.set(id, {
        descriptor,
        owner,
        animation,
        remainingMs: 0,
        skillId: 0,
        info: null,
      });
    }
  }

  admissionError(skill, info) {
    if (!MORPH_SKILLS.has(skill.id)) {
      return "Riding requires the original mount and saddle composition";
    }
    const id = morphId(info, this.system.store.profile.gender);
    if (!this.records.has(id)) {
      return "Original morph actor resources are not prepared";
    }
    if (this.system.scene.simulation.state === "ladder") {
      return "Cannot transform on a ladder";
    }
    return null;
  }

  cast(skill, info, rank, restoring = false) {
    this.cancel();
    const record = this.records.get(
      morphId(info, this.system.store.profile.gender),
    );
    record.remainingMs = info.time * 1000;
    record.skillId = skill.id;
    record.info = info;
    this.current = record;
    this.system.scene.actor.container.renderable = false;
    record.animation.container.visible = true;
    this.system.scene.simulation.worldMovement.form = record.descriptor;
    if (!restoring) this.system.startBuff(skill, rank, info);
    this.present(this.system.scene.simulation);
  }

  supportsAction(action) {
    return this.current?.animation.actions.has(formAction(action)) ?? false;
  }

  present(pose) {
    const record = this.current;
    if (!record) return;
    const animation = record.animation;
    const action = formAction(
      pose.action ?? this.system.scene.simulation.action,
    );
    if (animation.actions.has(action)) {
      animation.setAction(action, pose.playback ?? "loop");
    }
    animation.setPosition(pose.x, pose.y);
    animation.container.scale.x = pose.facing > 0 ? -1 : 1;
    animation.container.zIndex = this.system.scene.actor.container.zIndex;
  }

  step(ms) {
    const record = this.current;
    if (!record) return;
    record.remainingMs -= ms;
    if (record.remainingMs <= 0 || this.system.level(record.skillId) <= 0) {
      this.cancel();
      return;
    }
    this.present(this.system.scene.simulation);
    record.animation.advance(ms);
  }

  cancel(id = null) {
    const record = this.current;
    if (!record || (id !== null && record.skillId !== id)) return;
    record.animation.container.visible = false;
    this.system.scene.actor.container.renderable = true;
    this.system.scene.simulation.worldMovement.form = null;
    if (!this.system.transferredEffects) {
      this.system.effects.remove(record.skillId);
    }
    this.current = null;
    this.system.recompute();
  }

  destroy() {
    this.cancel();
    this.controller.abort();
    for (const record of this.records.values()) {
      this.system.scene.removeWorldContainer(record.animation.container);
      record.animation.container.destroy(DESTROY);
      record.owner.destroy();
    }
    this.records.clear();
  }
}

function formAction(action) {
  if (action === "stand1" || action === "stand2") return "stand";
  if (action === "walk1" || action === "walk2") return "walk";
  return action;
}
