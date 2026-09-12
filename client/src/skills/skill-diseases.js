import { skillNumber } from "./skill-costs.js";
import { HERO_WILL_SKILLS } from "./skill-utility-rules.js";

const CURABLE = [120, 121, 122, 124, 125, 126];
const PURGE = [120, 121, 122, 124, 125, 126, 128, 132, 133];
const DISEASES = new Set([...PURGE, 123]);
const WILL = new Set(HERO_WILL_SKILLS);

/** Local caster only. Original MobSkill rank duration/value, never roster metadata. */
export class SkillDiseases {
  constructor(field) {
    this.field = field;
    this.remaining = new Float64Array(256);
    this.values = new Float64Array(256);
    this.poisonMs = 0;
  }

  has(id) {
    return this.remaining[id] > 0;
  }

  apply(id, rank) {
    const field = this.field;
    const info = field.hooks.mobSkills?.[id]?.[rank];
    if (!DISEASES.has(id) || !info || field.dead || this.has(id)) return false;
    if (this.blocksDisease(id)) return false;
    if (
      field.damageGenerator.next() / 0x100000000 >=
      skillNumber(info.prop, 1)
    ) {
      return false;
    }
    const duration = skillNumber(info.time) * 1000;
    if (duration <= 0) return false;
    this.remaining[id] = duration;
    this.values[id] = skillNumber(info.x);
    field.hooks.onDisease?.(id, duration);
    return true;
  }

  blocksDisease(id) {
    let active = 0;
    for (const disease of DISEASES) if (this.has(disease)) active++;
    if (active >= 2) return true;
    return (
      !!this.field.hooks.derivedStats?.().holyShield && id !== 128 && id !== 123
    );
  }

  admissionError(skill) {
    if (WILL.has(skill.id) || skill.id === 2311001) return null;
    if (this.has(123) || this.has(128)) {
      return "The original disease prevents this action";
    }
    return this.has(120) ? "Skills are sealed" : null;
  }

  hasCurable(purge = false) {
    for (const id of purge ? PURGE : CURABLE) if (this.has(id)) return true;
    return false;
  }

  cure(purge = false) {
    let changed = false;
    for (const id of purge ? PURGE : CURABLE) {
      if (!this.has(id)) continue;
      this.remaining[id] = 0;
      this.values[id] = 0;
      changed = true;
    }
    if (!this.has(125)) this.poisonMs = 0;
    return changed;
  }

  step(ms) {
    if (this.field.dead) {
      this.clear();
      return;
    }
    if (this.has(125)) {
      this.poisonMs += Math.min(ms, this.remaining[125]);
      if (this.poisonMs >= 1000) {
        this.poisonMs -= 1000;
        const profile = this.field.store.profile;
        profile.hp = Math.max(1, profile.hp - this.values[125]);
        this.field.changed();
      }
    }
    for (const id of DISEASES) {
      this.remaining[id] = Math.max(0, this.remaining[id] - ms);
      if (!this.remaining[id]) this.values[id] = 0;
    }
    if (!this.has(125)) this.poisonMs = 0;
  }

  clear() {
    this.remaining.fill(0);
    this.values.fill(0);
    this.poisonMs = 0;
  }
}
