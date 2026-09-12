import { utilityFamily } from "./skill-utility-rules.js";
import { EquipmentEnhancement } from "../items/equipment-enhancement.js";
import { PetSkills } from "../character/pet-skills.js";
import { CHAKRA_SKILL, SkillChakra } from "./skill-chakra.js";
import { SkillEvents } from "./skill-events.js";

/** Uses the sole local live caster; saved party roster entries are never actor targets. */
export class SkillUtilityController {
  constructor(system) {
    this.system = system;
    this.enhancement = new EquipmentEnhancement(system);
    this.pets = new PetSkills(system);
    this.chakra = new SkillChakra(system);
    this.events = new SkillEvents(system);
  }

  async prepare(learnedSkills) {
    await this.pets.presentation.prepareSummoned();
    await this.chakra.prepare(learnedSkills);
    if (
      learnedSkills.some((skill) => utilityFamily(skill.id) === "enhancement")
    ) {
      await this.system.hooks.prepareEnhancement();
    }
  }

  step(ms) {
    this.pets.step(ms);
    this.chakra.step(ms);
  }

  inherit(previous) {
    this.events.inherit(previous.events);
    this.pets.hunger.set(previous.pets.hunger);
    for (let slot = 0; slot < this.pets.slotUids.length; slot++) {
      this.pets.slotUids[slot] = previous.pets.slotUids[slot];
    }
  }

  deferredCost(skill) {
    return skill.id === CHAKRA_SKILL;
  }
  input(input) {
    this.chakra.input(input);
  }
  chakraDamagePercent() {
    return this.chakra.damagePercent();
  }
  interruptChakra() {
    this.chakra.cancel();
  }
  cancel(id) {
    if (id === CHAKRA_SKILL) this.chakra.cancel();
  }
  onDeath() {
    this.chakra.cancel();
  }

  admissionError(skill, info) {
    const family = utilityFamily(skill.id);
    const field = this.system.hooks.gameplay();
    if (family === "chakra") return this.chakra.admissionError();
    if (family === "resurrection") {
      return "There is no dead same-party character in this field";
    }
    if (family === "will") {
      return field?.hasCurableDebuff(true)
        ? null
        : "There is no removable abnormal status";
    }
    if (family === "dispel") {
      return field
        ? field.skillDispelError(info)
        : "Dispel target authority is unavailable";
    }
    if (family === "time-leap") return this.cooldownError();
    if (family === "mp-recovery") return this.system.costs.error(skill, info);
    if (family === "enhancement") return this.enhancementError();
    return "This utility is an entitlement, not a cast";
  }

  enhancementError() {
    const denied = this.enhancement.admissionError();
    if (denied) return denied;
    return this.system.hooks.enhancementError
      ? this.system.hooks.enhancementError()
      : "Original enhancement window is unavailable";
  }

  cooldownError() {
    for (const [id, state] of this.system.states) {
      if (id !== 5121010 && state.cooldown > 0) return null;
    }
    return "There is no eligible cooldown to reset";
  }

  cast(skill, info, rank) {
    const family = utilityFamily(skill.id);
    const field = this.system.hooks.gameplay();
    if (family === "chakra") {
      this.chakra.cast(skill, info, rank);
      return;
    }
    if (family === "will") field.cureDebuffs(true);
    else if (family === "dispel") field.dispelSkill(info);
    else if (family === "time-leap") this.resetCooldowns();
    else if (family === "enhancement") this.system.hooks.openEnhancement();
    else if (family === "mp-recovery") {
      // SkillCosts already committed the HP-to-MP pair atomically before this presentation boundary.
      if (!(this.system.costs.mpRestore > 0)) {
        throw new Error("MP Recovery credit was not committed");
      }
    } else throw new Error("Utility cast was not admitted");
  }

  resetCooldowns() {
    // Cosmic StatEffect1090 and Character.removeAllCooldownsExcept: never reset Time Leap itself.
    for (const [id, state] of this.system.states) {
      if (id !== 5121010) state.cooldown = 0;
    }
  }

  destroy() {
    this.chakra.cancel();
    this.enhancement.destroy();
    this.pets.destroy();
  }
}
