import { EntityAnimation } from "../rendering/animation.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";
import { skillWorldEffectPath } from "../skills/skill-world-effects.js";
import { SkillResources } from "../skills/skill-resources.js";

const MAX_CASTS = 32;
const RETAIN_MS = 60000;
const DESTROY = Object.freeze({ children: true });

/** Presentation only: locally requested Use cues never award damage, buffs or resources. */
export class LocalSkillFeedback {
  constructor(presentation) {
    this.presentation = presentation;
    this.records = new Map();
    this.destroyed = false;
  }
  begin(skillId, operationId) {
    this.makeRoom();
    const owner = this.presentation.owner;
    const skill = owner.catalog.ui.skills[skillId];
    const profile = owner.store.profile;
    const rank = profile?.skills[skillId]?.level ?? 0;
    if (
      !operationId ||
      !skill?.levels[rank] ||
      profile.hp <= 0 ||
      this.records.size >= MAX_CASTS
    ) {
      return null;
    }
    const path = SkillResources.prototype.phasePath(skill, "effect", rank);
    const record = {
      operationId,
      skillId,
      age: 0,
      descriptor: path
        ? skill.visuals[path]
        : [4111006, 14101004, 11101005].includes(skillId)
          ? owner.catalog.ui.skillWorld?.effects[skillWorldEffectPath(skillId)]
          : null,
      follow: Boolean(path),
      origin: { ...owner.scene.presentation },
      confirmed: false,
      visual: null,
      lease: null,
      voice: null,
      visualPlayed: false,
      soundPlayed: false,
      serverVisual: false,
      serverSound: false,
      stopped: false,
    };
    this.records.set(operationId, record);
    Promise.all([this.visual(record), this.sound(record)]).catch((error) => {
      this.reject(record);
      if (!this.destroyed && error.name !== "AbortError") owner.report(error);
    });
    return record;
  }
  makeRoom() {
    if (this.records.size < MAX_CASTS) return;
    for (const [id, record] of this.records) {
      if (!record.confirmed || record.visual) continue;
      this.reject(record);
      this.records.delete(id);
      return;
    }
  }
  snapshot() {
    return [...this.records.values()].map((record) => ({
      operationId: record.operationId,
      skillId: record.skillId,
      visualPlayed: record.visualPlayed,
      soundPlayed: record.soundPlayed,
      visible: Boolean(record.visual?.container.visible),
      serverVisual: record.serverVisual,
      serverSound: record.serverSound,
      confirmed: record.confirmed,
      stopped: record.stopped,
    }));
  }
  async visual(record) {
    const descriptor = record.descriptor;
    if (!descriptor?.bundle || descriptor.available === false) return;
    const parent = this.presentation;
    const lease = await loadVisualBundle(
      descriptor.bundle,
      parent.owner.services,
      parent.controller.signal,
    );
    if (this.destroyed || record.stopped || record.serverVisual) {
      lease.destroy();
      return;
    }
    record.lease = lease;
    const entity = lease.manifest.entities[0];
    record.visual = new EntityAnimation(entity, lease.textures);
    record.visual.setAction("play", "once", true);
    parent.scene.addWorldContainer(record.visual.container, 398500);
    record.visualPlayed = true;
    record.visualAge = 0;
    this.position(record);
  }
  async sound(record) {
    const parent = this.presentation;
    const entry = await parent.prepareSound(record.skillId, "Use");
    if (!entry || this.destroyed || record.stopped || record.serverSound) {
      return;
    }
    entry.users++;
    try {
      record.voice = parent.owner.audio.audio.start(entry, "SE", false);
    } catch (error) {
      entry.users--;
      throw error;
    }
    record.soundPlayed = true;
  }
  /** Exact operation identity prevents two casts of the same skill from consuming each other. */
  visualEcho(event) {
    if (event.actorId !== this.presentation.owner.store.id) return false;
    const record = this.records.get(event.visual.feedbackId);
    if (
      !record ||
      record.descriptor?.bundle.sha256 !== event.visual.bundle.sha256
    ) {
      return false;
    }
    record.serverVisual = true;
    return record.visualPlayed;
  }
  soundEcho(event) {
    if (
      event.actorId !== this.presentation.owner.store.id ||
      event.leaf !== "Use" ||
      event.loop ||
      event.stopped
    ) {
      return false;
    }
    const record = this.records.get(event.feedbackId);
    if (!record) return false;
    record.serverSound = true;
    return record.soundPlayed;
  }
  position(record) {
    const target = record.follow
      ? this.presentation.owner.scene?.presentation
      : record.origin;
    if (!target || !record.visual) return;
    record.visual.setPosition(target.x, target.y);
    record.visual.container.scale.x = target.facing > 0 ? -1 : 1;
  }
  draw(ms) {
    for (const [id, record] of this.records) {
      record.age += ms;
      if (record.visual) {
        record.visualAge += ms;
        this.position(record);
        record.visual.advance(ms);
        if (record.visual.completed) this.releaseVisual(record);
      }
      if (record.age >= RETAIN_MS) {
        this.reject(record);
        this.records.delete(id);
      }
    }
  }
  releaseVisual(record) {
    if (record.visual) {
      this.presentation.scene?.removeWorldContainer(record.visual.container);
      record.visual.container.destroy(DESTROY);
      record.visual = null;
    }
    record.lease?.destroy();
    record.lease = null;
  }
  reject(record) {
    if (!record || record.stopped) return;
    record.stopped = true;
    record.confirmed = true;
    this.releaseVisual(record);
    if (record.voice) {
      this.presentation.owner.audio.audio.stopVoice(record.voice);
    }
  }
  destroy() {
    this.destroyed = true;
    for (const record of this.records.values()) this.reject(record);
    this.records.clear();
  }
}
