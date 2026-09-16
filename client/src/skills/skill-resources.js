import {
  createSkillAnimation,
  loadSkillVisual,
} from "./skill-runtime-ports.js";

import { check } from "../rendering/stream-network.js";

const MAX_PREPARED = 534;
const MAX_SEQUENCES = 512;
const MAX_HITS = 32;
const MAX_SEQUENCE_SLOTS = 4096;
const MAX_VOICES = 24;
const MAX_PREPARE_ROUNDS = 64;
const DESTROY_DISPLAY = Object.freeze({ children: true });
const ONCE = Object.freeze({ loop: false, follow: false });
const FOLLOW = Object.freeze({ loop: false, follow: true });

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
  prepare(skills, rankForSkill = null, dependencies = []) {
    if (skills.length > MAX_PREPARED || dependencies.length > MAX_PREPARED) {
      return Promise.reject(new Error("Prepared skill budget exceeded"));
    }
    const requested = skills.map((skill) => ({
      skill,
      rank: rankForSkill ? rankForSkill(skill.id) : 1,
    }));
    const retained = new Set(skills.map((skill) => skill.id));
    for (const skill of dependencies) {
      if (retained.has(skill.id)) continue;
      retained.add(skill.id);
      requested.push({ skill, rank: 0 });
    }
    if (requested.length > MAX_PREPARED) {
      return Promise.reject(
        new Error("Prepared skill dependency budget exceeded"),
      );
    }
    this.requestedSkills = requested;
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
    // Profile/job changes release no-longer-owned leases before admitting the replacement batch.
    const retained = new Map(skills.map(({ skill, rank }) => [skill.id, rank]));
    for (const [id, record] of this.records) {
      if (retained.get(id) !== record.rank) {
        this.release(record);
        this.records.delete(id);
      }
    }
    for (const { skill, rank } of skills) {
      check(this.controller.signal);
      const existing = this.records.get(skill.id);
      if (existing) {
        await this.loadSounds(skill, existing);
        continue;
      }
      if (this.records.size >= MAX_PREPARED) {
        throw new Error("Prepared skill budget exceeded");
      }
      const record = {
        visuals: new Map(),
        sounds: new Map(),
        phases: new Map(),
        ranks: new Map(),
        soundLeaves: rank > 0 ? ["Use", "Hit"] : [],
        rank,
        loading: new Map(),
        disposed: false,
      };
      try {
        if (rank > 0) {
          await this.loadVisuals(skill, record);
          this.indexPhases(skill, record);
        }
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
    const info = skill.levels[record.rank];
    if (!info) throw new Error("Missing prepared skill rank");
    for (const phase of ["effect", "hit"]) {
      const path = this.phasePath(skill, phase, record.rank);
      if (path) {
        await this.loadSequence(
          skill,
          record,
          path,
          phase === "hit" ? Math.min(MAX_HITS, info.mobCount ?? 1) : 1,
        );
      }
    }
  }

  phasePath(skill, branch, rank) {
    for (const path of [
      `level/${rank}/${branch}/0`,
      `level/${rank}/${branch}`,
      `${branch}/0`,
      branch,
    ]) {
      if (skill.visuals[path]) return path;
    }
    return branch === "effect" && skill.visuals.effect0 ? "effect0" : null;
  }

  async loadSequence(skill, record, path, slots) {
    const descriptor = skill.visuals[path];
    if (!descriptor || descriptor.available === false) {
      throw new Error(
        descriptor?.reason ?? `Missing original skill sequence ${path}`,
      );
    }
    if (record.visuals.size >= MAX_SEQUENCES) {
      throw new Error("Skill sequence budget exceeded");
    }
    const owner = await loadSkillVisual(
      this,
      descriptor.bundle,
      this.controller.signal,
    );
    if (record.disposed || this.controller.signal.aborted) {
      owner.destroy();
      throw new Error("Skill sequence preparation canceled");
    }
    const sequence = {
      owner,
      descriptor,
      slots: [],
      active: [],
      free: [],
      activeCount: 0,
      freeCount: 0,
    };
    record.visuals.set(path, sequence);
    this.growSlots(sequence, slots);
    return sequence;
  }

  async loadSounds(skill, record) {
    const audio = this.hooks.audio;
    if (!audio?.context || audio.context.state !== "running") return;
    for (const leaf of record.soundLeaves) {
      const sound = skill.sounds.leaves[leaf];
      if (!sound?.available || record.sounds.has(leaf)) continue;
      const entry = await audio.acquire(
        sound.descriptor,
        this.controller.signal,
      );
      if (record.disposed || this.controller.signal.aborted) {
        entry.users--;
        throw new Error("Skill sound preparation canceled");
      }
      record.sounds.set(leaf, entry);
      check(this.controller.signal);
    }
  }

  admissionError(skill, info) {
    const record = this.records.get(skill.id);
    if (!record || !record.ranks.has(info)) {
      return "Learned skill rank resources are not prepared";
    }
    const rank = record.ranks.get(info);
    const use = this.selectSequence(skill, "Use", rank);
    const hit = this.selectSequence(skill, "Hit", rank);
    if (use && !this.hasSlots(use, 1)) return "Skill Use visual slots are busy";
    if (hit && !this.hasSlots(hit, info.mobCount ?? 1)) {
      return "Skill Hit visual slots are busy";
    }
    return this.soundAdmissionError(skill, record);
  }

  /** Authored unavailable sounds refuse admission even before the audio gesture. */
  soundAdmissionError(skill, record) {
    for (const leaf of record.soundLeaves) {
      const sound = skill.sounds.leaves[leaf];
      if (sound && !sound.available) {
        return `Original ${leaf} sound unavailable: ${sound.reason}`;
      }
    }
    if (this.hooks.audio?.context?.state !== "running") return null;
    return this.preparedSoundError(skill, record);
  }

  /** Enabled audio requires both a free Use voice and every available decoded leaf. */
  preparedSoundError(skill, record) {
    for (const voice of this.voices) if (voice.ended) this.voices.delete(voice);
    if (record.sounds.has("Use") && this.voices.size >= MAX_VOICES) {
      return "Skill voice budget exceeded";
    }
    for (const leaf of record.soundLeaves) {
      if (skill.sounds.leaves[leaf]?.available && !record.sounds.has(leaf)) {
        return "Skill sound resources require preparation after audio enable";
      }
    }
    return null;
  }

  hasSlots(sequence, needed) {
    return sequence.freeCount >= needed;
  }

  /** Pinned decoded entries and voices are released by this owner, not orphaned on map exit. */
  sound(skill, leaf, loop = false) {
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
      const voice = audio.start(entry, "SE", loop);
      this.voices.add(voice);
      return voice;
    } catch (error) {
      entry.users--;
      this.hooks.report(error);
    }
  }

  stopSound(voice) {
    if (!voice || !this.voices.has(voice)) return;
    this.hooks.audio.stopVoice(voice);
    this.voices.delete(voice);
  }

  play(skill, phase, target, rank = 1) {
    const sequence = this.selectSequence(skill, phase, rank);
    if (!sequence) return null;
    return this.playSequence(sequence, target, phase === "Use" ? FOLLOW : ONCE);
  }

  sequence(skill, path) {
    return this.records.get(skill.id)?.visuals.get(path) ?? null;
  }

  selectSequence(skill, phase, rank = 1) {
    return this.records.get(skill.id)?.phases.get(rank)?.[phase] ?? null;
  }

  indexPhases(skill, record) {
    const rank = record.rank;
    const phases = Object.create(null);
    record.ranks.set(skill.levels[rank], rank);
    for (const branch of [
      "effect",
      "hit",
      "ball",
      "keydown",
      "keydownend",
      "prepare",
      "release",
      "summon",
      "special",
      "affected",
    ]) {
      phases[branch] =
        record.visuals.get(`level/${rank}/${branch}/0`) ??
        record.visuals.get(`level/${rank}/${branch}`) ??
        record.visuals.get(`${branch}/0`) ??
        record.visuals.get(branch) ??
        null;
    }
    phases.Use = phases.effect ?? record.visuals.get("effect0") ?? null;
    phases.Hit = phases.hit;
    record.phases.set(rank, phases);
  }

  /** Explicit controller dependency acquisition; never called from a simulation tick. */
  async acquireSequence(skill, path, slots = 1) {
    if (!Number.isInteger(slots) || slots < 0 || slots > MAX_SEQUENCE_SLOTS) {
      throw new Error("Skill sequence slot budget exceeded");
    }
    if (this.pending) await this.pending;
    const record = this.sourceRecord(skill);
    let sequence = record.visuals.get(path);
    if (!sequence) {
      let pending = record.loading.get(path);
      if (!pending) {
        pending = this.loadSequence(skill, record, path, slots);
        record.loading.set(path, pending);
      }
      try {
        sequence = await pending;
      } finally {
        record.loading.delete(path);
      }
      if (record.rank > 0) this.indexPhases(skill, record);
    }
    this.growSlots(sequence, slots);
    return sequence;
  }

  sourceRecord(skill) {
    let record = this.records.get(skill.id);
    if (record) return record;
    if (this.records.size >= MAX_PREPARED) {
      throw new Error("Prepared skill budget exceeded");
    }
    record = {
      visuals: new Map(),
      sounds: new Map(),
      phases: new Map(),
      ranks: new Map(),
      soundLeaves: [],
      rank: 0,
      loading: new Map(),
      disposed: false,
    };
    this.records.set(skill.id, record);
    return record;
  }

  async acquireSound(skill, leaf) {
    if (this.pending) await this.pending;
    const record = this.records.get(skill.id);
    if (!record || !skill.sounds.leaves[leaf]) {
      throw new Error("Missing original skill sound dependency");
    }
    if (!record.soundLeaves.includes(leaf)) record.soundLeaves.push(leaf);
    await this.loadSounds(skill, record);
  }

  growSlots(sequence, count) {
    for (let i = sequence.slots.length; i < count; i++) {
      const animation = createSkillAnimation(
        this,
        sequence.owner.manifest.entities[0],
        sequence.owner.textures,
      );
      animation.container.visible = false;
      this.scene.overlays.addChild(animation.container);
      const slot = {
        animation,
        sequence,
        activeIndex: -1,
        remaining: 0,
        follow: false,
        target: null,
        facing: null,
        flight: false,
        flightAge: 0,
        flightDuration: 0,
        flightX: 0,
        flightY: 0,
        flightDX: 0,
        flightDY: 0,
      };
      sequence.slots.push(slot);
      sequence.active.push(null);
      sequence.free.push(null);
      sequence.free[sequence.freeCount++] = slot;
    }
  }

  playSequence(sequence, target, options = ONCE) {
    if (!sequence.freeCount) return null;
    const slot = sequence.free[--sequence.freeCount];
    sequence.free[sequence.freeCount] = null;
    slot.activeIndex = sequence.activeCount;
    sequence.active[sequence.activeCount++] = slot;
    slot.remaining =
      options.durationMs ??
      (options.loop ? Infinity : sequence.descriptor.durationMs);
    slot.follow = options.follow ?? false;
    slot.target = target;
    slot.facing = options.facing ?? null;
    slot.flight = options.flight ?? false;
    if (slot.flight) this.startFlight(slot, target, options);
    this.startSequenceAnimation(slot, options);
    return slot;
  }

  /** Publish a newly acquired slot with reset pose, facing and flight visibility. */
  startSequenceAnimation(slot, options) {
    const target = slot.target;
    slot.animation.setAction("play", options.loop ? "loop" : "once", true);
    slot.animation.setPosition(target.x, target.y);
    slot.animation.container.rotation = 0;
    slot.animation.container.scale.y = 1;
    slot.animation.container.scale.x =
      (slot.facing ?? target.facing ?? this.scene.simulation.facing) > 0
        ? -1
        : 1;
    slot.animation.container.visible = !slot.flight || slot.flightAge >= 0;
  }

  startFlight(slot, target, options) {
    slot.flightAge = -(options.delayMs ?? 0);
    slot.flightDuration = target.duration;
    slot.flightX = target.x;
    slot.flightY = target.y;
    slot.flightDX = target.endX - target.x;
    slot.flightDY = target.endY - target.y + (options.spreadY ?? 0);
    // The observer integrates this plan instead of sampling acknowledged positions, so a
    // peer ball follows the same straight line, duration and per-ball offset as the thrower.
    if (slot.animation) {
      slot.animation.flight = {
        startX: slot.flightX,
        startY: slot.flightY,
        endX: slot.flightX + slot.flightDX,
        endY: slot.flightY + slot.flightDY,
        durationMs: Math.max(1, slot.flightDuration),
        delayMs: Math.max(0, options.delayMs ?? 0),
      };
    }
  }

  stepFlight(slot, ms) {
    slot.flightAge += ms;
    slot.animation.container.visible = slot.flightAge >= 0;
    if (slot.flightAge < 0) return;
    const progress = Math.min(1, slot.flightAge / slot.flightDuration);
    slot.animation.setPosition(
      slot.flightX + slot.flightDX * progress,
      slot.flightY + slot.flightDY * progress,
    );
  }

  stop(slot) {
    if (!slot || slot.activeIndex < 0) return;
    const sequence = slot.sequence;
    const index = slot.activeIndex;
    const last = sequence.active[--sequence.activeCount];
    if (index !== sequence.activeCount) {
      sequence.active[index] = last;
      last.activeIndex = index;
    }
    sequence.active[sequence.activeCount] = null;
    sequence.free[sequence.freeCount++] = slot;
    slot.activeIndex = -1;
    slot.remaining = 0;
    slot.target = null;
    if (slot.animation) {
      slot.animation.flight = null;
      slot.animation.container.visible = false;
    }
  }

  step(ms) {
    for (const record of this.records.values()) {
      for (const sequence of record.visuals.values()) {
        for (let index = sequence.activeCount - 1; index >= 0; index--) {
          const slot = sequence.active[index];
          slot.remaining = Math.max(0, slot.remaining - ms);
          if (!slot.remaining) {
            this.stop(slot);
            continue;
          }
          if (slot.flight) this.stepFlight(slot, ms);
          if (slot.follow) {
            slot.animation.setPosition(slot.target.x, slot.target.y);
            slot.animation.container.scale.x =
              (slot.facing ??
                slot.target.facing ??
                this.scene.simulation.facing) > 0
                ? -1
                : 1;
          }
          slot.animation.advance(ms);
        }
      }
    }
  }

  release(record) {
    record.disposed = true;
    for (const entry of record.sounds.values()) entry.users--;
    for (const sequence of record.visuals.values()) {
      for (const slot of sequence.slots) {
        this.stop(slot);
        slot.animation.container.destroy(DESTROY_DISPLAY);
      }
      sequence.freeCount = 0;
      sequence.free.length = 0;
      sequence.active.length = 0;
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
