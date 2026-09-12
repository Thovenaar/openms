import {
  eventMapFamily,
  eventSkillFamily,
  eventSkillRank,
  eventFieldAllows,
} from "./skill-event-rules.js";

const DOJO_MAX = 10000;
const DOJO_ATTACK = 100; // Authorized Cosmic config.yaml429.
const DOJO_RECEIVED = 20; // Authorized Cosmic config.yaml430.
export const PYRAMID_AUTHORITY_ERROR =
  "Nett's Pyramid massacre_skill quota producer is unavailable: authorized Cosmic disables entry and its monster scoring transaction";

/** Transient character event state, never an inventory/profile or fake remote party authority. */
export class SkillEvents {
  constructor(system) {
    this.system = system;
    this.mapId = Number(system.scene.manifest.id);
    this.family = eventMapFamily(this.mapId);
    this.energy = 0;
    this.fieldType = system.scene.manifest.physics.map.fieldType ?? 0;
    this.attackSequence = -1;
  }

  rank(id) {
    return eventSkillRank(
      id,
      this.system.store.profile.job,
      this.mapId,
      this.fieldType,
    );
  }

  error(skill) {
    const family = eventSkillFamily(skill.id);
    if (!family) return null;
    if (family !== this.family || !eventFieldAllows(family, this.fieldType)) {
      return "This secret skill requires its original event field";
    }
    if (!this.rank(skill.id)) {
      return "This event skill belongs to another original job family";
    }
    if (family === "pyramid") return PYRAMID_AUTHORITY_ERROR;
    return this.energy === DOJO_MAX
      ? null
      : "Mu Lung Dojo energy must be fully charged";
  }

  consume(skill) {
    const denied = this.error(skill);
    if (denied) throw new Error(denied);
    if (eventSkillFamily(skill.id) === "dojo") this.energy = 0;
  }

  onAttack(skill, _target, sequence) {
    if (this.family !== "dojo" || sequence === this.attackSequence) return;
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new Error("Missing original attack sequence identity");
    }
    this.attackSequence = sequence;
    if (skill && eventSkillFamily(skill.id) === "dojo") return;
    this.energy = Math.min(DOJO_MAX, this.energy + DOJO_ATTACK);
  }

  onDamage() {
    if (this.family === "dojo") {
      this.energy = Math.min(DOJO_MAX, this.energy + DOJO_RECEIVED);
    }
  }

  inherit(previous) {
    if (this.family !== "dojo" || previous.family !== "dojo") return;
    // dojang_Msg.js resets the entrance; stage transitions preserve character energy.
    if (this.mapId !== 925020000) this.energy = previous.energy;
  }
}
