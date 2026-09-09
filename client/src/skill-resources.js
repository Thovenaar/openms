import { EntityAnimation } from "./animation.js";
import { loadVisualBundle } from "./visual-resources.js";
import { check } from "./stream-network.js";

const MAX_PREPARED = 64;
const MAX_SEQUENCES = 128;
const MAX_HITS = 6;
const MAX_VOICES = 24;
const MAX_PREPARE_ROUNDS = 64;
const DESTROY_DISPLAY = Object.freeze({ children: true });

/** Prepared skill leases and reusable display slots; no fetch/decode starts in step(). */
export class SkillResources {
  constructor(scene, hooks) {
    this.scene = scene;
    this.hooks = hooks;
    this.controller = new AbortController();
    this.records = new Map();
    this.pending = null;
    this.requestedSkills = null;
    this.destroyed = false;
    this.voices = new Set();
  }

  /** Serialize a finite learned-skill batch; callers retry after the audio gesture if desired. */
  prepare(skills) {
    if (skills.length > MAX_PREPARED) {
      return Promise.reject(new Error("Prepared skill budget exceeded"));
    }
    this.requestedSkills = skills;
    if (this.pending) return this.pending;
    this.pending = this.drainPreparation().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async drainPreparation() {
    for (let round = 0; round < MAX_PREPARE_ROUNDS; round++) {
      check(this.controller.signal);
      const requested = this.requestedSkills;
      await this.loadBatch(requested);
      check(this.controller.signal);
      if (requested === this.requestedSkills) return;
    }
    throw new Error(
      "Skill preparation changes exceeded bounded admission rounds",
    );
  }

  async loadBatch(skills) {
    for (const skill of skills) {
      check(this.controller.signal);
      const existing = this.records.get(skill.id);
      if (existing) {
        await this.loadSounds(skill, existing);
        continue;
      }
      if (this.records.size >= MAX_PREPARED) {
        throw new Error("Prepared skill budget exceeded");
      }
      const record = { visuals: new Map(), sounds: new Map() };
      try {
        await this.loadVisuals(skill, record);
        await this.loadSounds(skill, record);
        check(this.controller.signal);
        this.records.set(skill.id, record);
      } catch (error) {
        this.release(record);
        throw error;
      }
    }
  }

  async loadVisuals(skill, record) {
    const entries = Object.entries(skill.visuals);
    if (entries.length > MAX_SEQUENCES) {
      throw new Error("Skill sequence budget exceeded");
    }
    for (const [path, descriptor] of entries) {
      if (!/^(effect|effect0|hit|hit\/0)$/.test(path)) continue;
      if (descriptor.available === false) {
        throw new Error(`${descriptor.source}: ${descriptor.reason}`);
      }
      const owner = await loadVisualBundle(
        descriptor.bundle,
        this.hooks.services,
        this.controller.signal,
      );
      const slots = [];
      const sequence = { owner, descriptor, slots };
      record.visuals.set(path, sequence);
      check(this.controller.signal);
      const count = path.includes("hit") ? MAX_HITS : 1;
      for (let i = 0; i < count; i++) {
        const animation = new EntityAnimation(
          owner.manifest.entities[0],
          owner.textures,
        );
        animation.container.visible = false;
        this.scene.overlays.addChild(animation.container);
        slots.push({ animation, remaining: 0, follow: false });
      }
    }
  }

  async loadSounds(skill, record) {
    const audio = this.hooks.audio;
    if (!audio?.context || audio.context.state !== "running") return;
    for (const leaf of ["Use", "Hit"]) {
      const sound = skill.sounds.leaves[leaf];
      if (!sound?.available || record.sounds.has(leaf)) continue;
      const entry = await audio.acquire(
        sound.descriptor,
        this.controller.signal,
      );
      if (this.controller.signal.aborted) {
        entry.users--;
        check(this.controller.signal);
      }
      record.sounds.set(leaf, entry);
      check(this.controller.signal);
    }
  }

  admissionError(skill, info) {
    const record = this.records.get(skill.id);
    if (!record) return "Learned skill resources are not prepared";
    const use = record.visuals.get("effect") ?? record.visuals.get("effect0");
    const hit = record.visuals.get("hit/0") ?? record.visuals.get("hit");
    if (use && !this.hasSlots(use, 1)) return "Skill Use visual slots are busy";
    if (hit && !this.hasSlots(hit, info.mobCount ?? 1)) {
      return "Skill Hit visual slots are busy";
    }
    return this.soundAdmissionError(skill, record);
  }

  soundAdmissionError(skill, record) {
    if (this.hooks.audio?.context?.state === "running") {
      for (const leaf of ["Use", "Hit"]) {
        if (skill.sounds.leaves[leaf]?.available && !record.sounds.has(leaf)) {
          return "Skill sound resources require preparation after audio enable";
        }
      }
    }
    return null;
  }

  hasSlots(sequence, needed) {
    let free = 0;
    for (const slot of sequence.slots) if (slot.remaining <= 0) free++;
    return free >= needed;
  }

  /** Pinned decoded entries and voices are released by this owner, not orphaned on map exit. */
  sound(skill, leaf) {
    const audio = this.hooks.audio;
    const entry = this.records.get(skill.id)?.sounds.get(leaf);
    if (!entry || this.destroyed || audio.context?.state !== "running") return;
    for (const voice of this.voices) if (voice.ended) this.voices.delete(voice);
    if (this.voices.size >= MAX_VOICES) {
      this.hooks.report(new Error("Skill voice budget exceeded"));
      return;
    }
    entry.users++;
    try {
      this.voices.add(audio.start(entry, "SE", false));
    } catch (error) {
      entry.users--;
      this.hooks.report(error);
    }
  }

  play(skill, phase, target) {
    const record = this.records.get(skill.id);
    if (!record) return;
    const path = phase === "Use" ? "effect" : "hit/0";
    const sequence =
      record.visuals.get(path) ??
      record.visuals.get(phase === "Use" ? "effect0" : "hit");
    if (!sequence) return;
    for (const slot of sequence.slots) {
      if (slot.remaining > 0) continue;
      slot.remaining = sequence.descriptor.durationMs;
      slot.follow = phase === "Use";
      slot.animation.setAction("play", "loop");
      slot.animation.setAction("play", "once");
      slot.animation.setPosition(target.x, target.y);
      slot.animation.container.scale.x =
        this.scene.simulation.facing > 0 ? -1 : 1;
      slot.animation.container.visible = true;
      return;
    }
  }

  step(ms) {
    for (const record of this.records.values()) {
      for (const sequence of record.visuals.values()) {
        for (const slot of sequence.slots) {
          if (slot.remaining <= 0) continue;
          slot.remaining = Math.max(0, slot.remaining - ms);
          if (!slot.remaining) {
            slot.animation.container.visible = false;
            continue;
          }
          if (slot.follow) {
            slot.animation.setPosition(
              this.scene.presentation.x,
              this.scene.presentation.y,
            );
          }
          slot.animation.advance(ms);
        }
      }
    }
  }

  release(record) {
    for (const entry of record.sounds.values()) entry.users--;
    for (const sequence of record.visuals.values()) {
      for (const slot of sequence.slots) {
        slot.animation.container.destroy(DESTROY_DISPLAY);
      }
      sequence.owner.destroy();
    }
  }

  destroy() {
    this.destroyed = true;
    this.controller.abort();
    for (const voice of this.voices) this.hooks.audio.stopVoice(voice);
    this.voices.clear();
    for (const record of this.records.values()) this.release(record);
    this.records.clear();
  }
}
