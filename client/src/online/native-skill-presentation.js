import { SkillResources } from "../skills/skill-resources.js";

const MAX_REMOTE_RESOURCES = 128;
const MAX_CASTS = 512;

/** Original skill visuals/audio borrow admitted ranks; this owner cannot cast or grant buffs. */
export class NativeSkillPresentation {
  constructor(owner) {
    this.owner = owner;
    this.resources = null;
    this.signature = null;
    this.generation = 0;
    this.effects = new Set();
    this.remote = new Map();
    this.projectiles = new Set();
  }
  createResources(scene) {
    return new SkillResources(scene, {
      services: this.owner.services,
      audio: this.owner.audio.audio,
      report: (error) => this.owner.report(error),
    });
  }
  setScene(scene) {
    if (this.resources?.scene === scene) return;
    this.destroy();
    this.resources = this.createResources(scene);
    this.signature = null;
  }
  async publish(previous) {
    const scene = this.owner.scene;
    if (!scene) return;
    this.setScene(scene);
    const generation = ++this.generation;
    await this.prepareLearned();
    if (generation !== this.generation || this.owner.destroyed) return;
    this.publishBuffs(previous);
  }
  async prepareLearned() {
    const skills = this.owner.store.profile.skills;
    const signature = JSON.stringify(skills);
    if (signature === this.signature) return;
    await this.resources.prepare(
      this.learnedRecords(skills),
      (id) => skills[id].level,
    );
    this.signature = signature;
  }
  learnedRecords(skills) {
    const records = Object.entries(skills)
      .filter(([, rank]) => rank.level > 0)
      .map(([id]) => this.owner.catalog.ui.skills[id]);
    if (records.some((record) => !record)) {
      throw new Error("Server learned skill artwork is unavailable.");
    }
    return records;
  }
  publishBuffs(previous) {
    const effects = new Set();
    for (const effect of this.owner.state.self.effects) {
      effects.add(effect.id);
      if (previous && effect.kind === "skill" && !this.effects.has(effect.id)) {
        this.use(effect.templateId, this.owner.scene.presentation);
      }
    }
    this.effects = effects;
  }
  async enableAudio() {
    if (!this.resources || !this.owner.store.profile) return;
    const skills = this.owner.store.profile.skills;
    await this.resources.prepare(
      this.learnedRecords(skills),
      (id) => skills[id].level,
    );
    for (const entry of this.remote.values()) await this.prepareRemote(entry);
  }
  use(id, position) {
    const skill = this.owner.catalog.ui.skills[id];
    const rank = this.owner.store.profile.skills[id]?.level;
    if (!skill || !rank || !this.resources) return;
    this.resources.sound(skill, "Use");
    this.resources.play(skill, "Use", position, rank);
  }
  prepareRemote(entry) {
    const skills = [...entry.skills.values()].map((known) => known.skill);
    return entry.resources.prepare(skills, (id) => entry.skills.get(id).rank);
  }
  async remoteResources(event, skill, rank) {
    if (!Number.isInteger(rank) || rank < 1 || !skill.levels[rank]) {
      throw new Error("The server cast rank has no original skill artwork.");
    }
    let entry = this.remote.get(event.actorId);
    if (!entry) {
      if (this.remote.size >= MAX_REMOTE_RESOURCES) {
        throw new Error("Remote skill artwork budget exceeded.");
      }
      entry = {
        resources: this.createResources(this.owner.scene),
        skills: new Map(),
        preparing: null,
      };
      this.remote.set(event.actorId, entry);
    }
    if (entry.skills.get(skill.id)?.rank !== rank) {
      entry.skills.set(skill.id, { skill, rank });
      entry.preparing = this.prepareRemote(entry);
    }
    await entry.preparing;
    return entry.resources;
  }
  async castResources(event) {
    const skill = this.owner.catalog.ui.skills[event.skillId];
    if (!skill) throw new Error("Server skill artwork is unavailable.");
    const self = event.actorId === this.owner.store.id;
    const rank = self
      ? this.owner.store.profile.skills[event.skillId]?.level
      : event.rank;
    if (!Number.isInteger(rank) || rank < 1) {
      throw new Error("Server skill rank is unavailable.");
    }
    const resources = self
      ? this.resources
      : await this.remoteResources(event, skill, rank);
    return { skill, rank, resources };
  }
  position(id) {
    if (id === this.owner.store.id) return this.owner.scene.presentation;
    const view = this.owner.hooks.scene().views.get(id);
    if (!view) return null;
    return {
      get x() {
        return view.drawX;
      },
      get y() {
        return view.drawY;
      },
      get facing() {
        return view.entity.facing;
      },
    };
  }
  playUse(cast, position) {
    if (!position) return;
    cast.resources.sound(cast.skill, "Use");
    cast.resources.play(cast.skill, "Use", position, cast.rank);
  }
  async projectile(event) {
    if (!event.skillId) return;
    const scene = this.owner.scene;
    const cast = await this.castResources(event);
    if (scene !== this.owner.scene || this.owner.destroyed) return;
    if (this.projectiles.size >= MAX_CASTS) {
      throw new Error("Skill cast presentation budget exceeded.");
    }
    this.projectiles.add(event.actionId);
    this.playUse(cast, this.position(event.actorId));
  }
  async combat(event) {
    if (!event.skillId) return;
    const scene = this.owner.scene;
    const cast = await this.castResources(event);
    if (scene !== this.owner.scene || this.owner.destroyed) return;
    if (!this.projectiles.delete(event.actionId)) {
      this.playUse(cast, this.position(event.actorId));
    }
    for (const hit of event.hits) {
      const target = this.owner.entities.find(
        (entry) => entry.id === hit.targetId,
      );
      if (!target || !hit.damage) continue;
      cast.resources.sound(cast.skill, "Hit");
      cast.resources.play(cast.skill, "Hit", target.position, cast.rank);
    }
  }
  update(ms) {
    if (this.resources && this.resources.scene !== this.owner.scene) {
      this.destroy();
      return;
    }
    this.resources?.step(ms);
    const views = this.owner.hooks.scene()?.views;
    for (const [id, entry] of this.remote) {
      if (!views?.has(id)) {
        entry.resources.destroy();
        this.remote.delete(id);
      } else entry.resources.step(ms);
    }
  }
  destroy() {
    this.generation++;
    this.resources?.destroy();
    this.resources = null;
    for (const entry of this.remote.values()) entry.resources.destroy();
    this.remote.clear();
    this.projectiles.clear();
  }
}
