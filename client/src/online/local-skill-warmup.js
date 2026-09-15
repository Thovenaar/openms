import { SkillResources } from "../skills/skill-resources.js";
import { skillWorldEffectPath } from "../skills/skill-world-effects.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";

const MAX_SKILLS = 8;
const MAX_WARMED = 16;

/** Same recovered Use branch for readiness and key-press feedback. */
export function localSkillDescriptor(id, skill, rank, catalog) {
  const path = SkillResources.prototype.phasePath(skill, "effect", rank);
  return {
    descriptor: path
      ? skill.visuals[path]
      : [4111006, 14101004, 11101005].includes(id)
        ? catalog.ui.skillWorld?.effects[skillWorldEffectPath(id)]
        : null,
    follow: Boolean(path),
  };
}

/** A field keeps a bounded working set of bound Use artwork; failures leave cold loading available. */
export class LocalSkillWarmup {
  constructor(presentation) {
    this.presentation = presentation;
    this.leases = new Map();
    this.pending = null;
    this.destroyed = false;
    this.lastError = null;
  }
  prepare() {
    if (this.pending) return this.pending;
    this.pending = this.load()
      .catch((error) => {
        if (!this.destroyed) this.lastError = error.message;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
  async load() {
    const parent = this.presentation,
      owner = parent.owner;
    const profile = owner.store.profile;
    if (!profile) return;
    const skills = new Set();
    for (const binding of Object.values(profile.keyBindings.keys)) {
      if (binding.type === 1 && skills.size < MAX_SKILLS) {
        skills.add(binding.id);
      }
    }
    for (const id of skills) {
      await this.skill(id, profile);
    }
  }
  async skill(id, profile) {
    const parent = this.presentation,
      owner = parent.owner;
    const rank = profile.skills[id]?.level ?? 0;
    const skill = owner.catalog.ui.skills[id];
    if (!skill?.levels[rank]) return;
    const { descriptor } = localSkillDescriptor(id, skill, rank, owner.catalog);
    if (descriptor?.bundle && descriptor.available !== false) {
      await this.visual(descriptor.bundle);
    }
    const path = SkillResources.prototype.phasePath(skill, "ball", rank);
    const ball = path && skill.visuals[path];
    if (ball?.bundle && ball.available !== false) {
      await this.visual(ball.bundle);
    }
    await parent.prepareSound(id, "Use");
  }
  async visual(bundle) {
    if (this.leases.has(bundle.sha256) || this.leases.size >= MAX_WARMED) {
      return;
    }
    const parent = this.presentation;
    const lease = await loadVisualBundle(
      bundle,
      parent.owner.services,
      parent.controller.signal,
    );
    if (this.destroyed) lease.destroy();
    else this.leases.set(bundle.sha256, lease);
  }
  get(bundle) {
    return this.leases.get(bundle.sha256);
  }
  destroy() {
    this.destroyed = true;
    for (const lease of this.leases.values()) lease.destroy();
    this.leases.clear();
  }
}
