import { skillNumber } from "./skill-costs.js";
import {
  elementalEffectiveness,
  hasMobStatus,
  MOB_STATUS,
} from "../combat/mob-skill-status.js";

const AMPLIFICATION = [2110001, 2210001, 12110001, 22150000];
const LUCKY = new Set([4001344, 14001004, 4121007, 14111005]);
const FINISHER = new Set([
  1111003, 1111004, 1111005, 1111006, 11111002, 11111003,
]);
const COMBO_DAMAGE = [1, 1, 1.2, 1.54, 2, 2.5];
const BARRAGE = new Set([5121007, 15111004]);
const CHARGE_ELEMENTS = new Map([
  [1211003, "f"],
  [1211004, "f"],
  [1211005, "i"],
  [1211006, "i"],
  [1211007, "l"],
  [1211008, "l"],
  [1221003, "h"],
  [1221004, "h"],
  [11111007, "h"],
  [15101006, "l"],
  [21111005, "i"],
]);

export function learnedCombatInfo(hooks, id) {
  const rank = hooks.skillLevel?.(id);
  return rank > 0 ? hooks.skillInfo(id, rank) : null;
}

export function skillLineCount(info) {
  return Math.max(
    skillNumber(info.attackCount, 1),
    skillNumber(info.bulletCount, 1),
  );
}

/**00790782: immunity/strong/weak interpolation also handles Elemental Reset. */
export function elementalDamage(damage, target, element, reset = 0) {
  if (!element) return damage;
  const strength = Math.max(0, 1 - reset / 100);
  const effect = elementalEffectiveness(target, element);
  if (effect === 1) return damage * (1 - strength);
  if (effect === 2) return damage * (1 - strength * 0.5);
  if (effect === 3) return Math.min(199999, damage * (1 + strength * 0.5));
  return damage;
}

/** Native00791617/0079216d/00792595; target-specific RNG window owned by PhysicalDamage. */
export class SkillDamage {
  constructor(generator, hooks) {
    this.generator = generator;
    this.hooks = hooks;
    this.critical = false;
    this.base = 0;
  }

  /** context owns reusable stats, weapon use, and per-cast/per-line modifiers. */
  generate(skill, info, mob, context) {
    const target = mob.skillStatus.projected;
    this.critical = false;
    const fixed = this.fixedDamage(skill, info, mob, context);
    if (fixed !== null) return fixed;
    if (context.kind === "summon") {
      return this.summon(skill, info, context.stats, target);
    }
    if (skillNumber(info.mad) > 0 || skill.id === 2301002) {
      return this.magic(skill, info, target, context);
    }
    return this.physical(skill, info, mob, context);
  }

  fixedDamage(skill, info, mob, context) {
    if (skillNumber(info.fixdamage) > 0) return skillNumber(info.fixdamage);
    if (skillNumber(info.damagepc) > 0) {
      return Math.trunc((mob.maxHP * skillNumber(info.damagepc)) / 100);
    }
    if (context.kind === "area") return 0;
    if (skill.id === 3221007) return 195000 + (this.generator.next() % 5000);
    if (
      (skill.id === 1221011 || skill.id === 21120006) &&
      !mob.skillStatus.projected.boss
    ) {
      return Math.max(0, mob.hp - 1);
    }
    return null;
  }

  hits(stats, target, magic) {
    const gap = Math.max(0, target.level - stats.level);
    const accuracy = magic
      ? (Math.trunc(stats.int / 10) + Math.trunc(stats.luk / 10)) * 5
      : stats.acc;
    const chance =
      (Math.max(0, Math.min(999, accuracy)) * 100) / (gap * 10 + 255);
    this.generator.roll(0, 100); // native target immunity slot, even when no immunity active
    return (
      this.generator.roll(
        chance * (magic ? 0.5 : 0.7),
        chance * (magic ? 1.2 : 1.3),
      ) >= Math.max(0, Math.min(999, target.eva ?? 0))
    );
  }

  physicalBase(skill, info, target, context) {
    const stats = context.stats;
    let base = LUCKY.has(skill.id)
      ? (this.generator.roll(stats.luk * 0.5, stats.luk) * 5 * stats.pad) / 100
      : this.generator.weaponDamage(stats, context.use);
    if (skill.id === 4111004) {
      base =
        Math.trunc(
          this.generator.roll(
            skillNumber(info.moneyCon) * 0.5,
            skillNumber(info.moneyCon) * 1.5,
          ),
        ) * 10;
    }
    base *= (100 - Math.max(0, target.level - stats.level)) / 100;
    base = this.element(skill, base, target, context.temporary);
    if (skill.id !== 1311005 && skill.id !== 4111004) {
      const defense = Math.min(1999, target.PDDamage ?? 0);
      base -= this.generator.roll(defense * 0.5, defense * 0.6);
    }
    this.base = Math.trunc(base);
    if (skill.id === 5211004 || skill.id === 5211005) {
      const capsule = Math.trunc(context.use.projectileId / 1000);
      if (capsule !== (skill.id === 5211004 ? 2331 : 2332)) base *= 0.5;
    }
    return base;
  }

  physical(skill, info, mob, context) {
    if (!this.hits(context.stats, mob.skillStatus.projected, false)) return 0;
    const base = this.physicalBase(
      skill,
      info,
      mob.skillStatus.projected,
      context,
    );
    let damage = base * (skillNumber(info.damage, 100) * 0.01);
    if (skill.id === 5211004 || skill.id === 5211005) {
      damage += (base * skillNumber(context.elementalBoost?.damage)) / 100;
    }
    if (skill.id === 3101005) damage = (base * skillNumber(info.x)) / 100;
    damage = this.physicalModifiers(damage, skill, mob, context);
    if (BARRAGE.has(skill.id) && context.line > 3) {
      damage *= 2 ** (context.line - 3);
    }
    if (context.chargeMs >= 0) {
      damage *=
        (10 + Math.trunc((context.chargeMs * 90) / context.chargeMax)) / 100;
    }
    if (context.temporary.berserkFury) {
      damage *= context.temporary.berserkFury / 100;
    }
    return Math.trunc(damage);
  }

  physicalModifiers(damage, skill, mob, context) {
    damage = this.stateModifiers(damage, skill, context);
    damage = this.criticalDamage(damage, mob, context.stats);
    if (hasMobStatus(mob, "imprint")) {
      damage *= 1 + mob.skillStatus.values[MOB_STATUS.imprint] / 100;
    }
    return damage;
  }

  stateModifiers(damage, skill, context) {
    const temporary = context.temporary;
    const berserk = learnedCombatInfo(this.hooks, 1320006);
    if (berserk && context.hp * 100 <= context.maxHP * skillNumber(berserk.x)) {
      damage *= 1 + skillNumber(berserk.damage) / 100;
    }
    if (FINISHER.has(skill.id)) {
      damage *= COMBO_DAMAGE[Math.min(5, Math.max(0, context.combo - 1))];
    }
    if (temporary.windWalk) damage *= temporary.windWalk / 100;
    const vanish = learnedCombatInfo(this.hooks, 14100005);
    if (temporary.darkSight && vanish) {
      damage *= skillNumber(vanish.damage) / 100;
    }
    return damage;
  }

  criticalDamage(damage, mob, stats) {
    let chance = stats.criticalChance ?? 0;
    let bonus = (stats.criticalDamage ?? 100) - 100;
    const stun = learnedCombatInfo(this.hooks, 5110000);
    if (stun && hasMobStatus(mob, "stun")) {
      chance += skillNumber(stun.prop);
      bonus += skillNumber(stun.damage) - 100;
    }
    if (chance > 0 && this.generator.roll(0, 100) < chance) {
      this.critical = true;
      damage += (this.base * bonus) / 100;
    }
    return damage;
  }

  element(skill, damage, target, temporary) {
    const reset = temporary.elementalReset ?? 0;
    if (skill.id === 2111006) {
      return (
        elementalDamage(damage / 2, target, "f", reset) +
        elementalDamage(damage / 2, target, "s", reset)
      );
    }
    if (skill.id === 2211006) {
      return (
        elementalDamage(damage / 2, target, "i", reset) +
        elementalDamage(damage / 2, target, "l", reset)
      );
    }
    damage = elementalDamage(damage, target, skill.properties.elemAttr, reset);
    const charge = temporary.charge;
    if (!charge) return damage;
    const info = learnedCombatInfo(this.hooks, charge);
    if (!info) return damage;
    return elementalDamage(
      (damage * skillNumber(info.damage, 100)) / 100,
      target,
      CHARGE_ELEMENTS.get(charge),
    );
  }

  magic(skill, info, target, context) {
    const stats = context.stats;
    if (!this.hits(stats, target, true)) return 0;
    const mastery = (skillNumber(info.mastery) * 5 + 10) * 0.009000000000000001;
    const magic = Math.min(1999, stats.mad);
    let damage =
      ((this.generator.roll(magic * mastery, magic) * 3.3 +
        (magic * 0.058) ** 2 +
        stats.int * 0.5) *
        skillNumber(info.mad)) /
      100;
    if (skill.id === 2301002) {
      damage = this.healDamage(info, stats, context.targetCount);
    }
    for (const id of AMPLIFICATION) {
      const amp = learnedCombatInfo(this.hooks, id);
      if (amp) {
        damage *= skillNumber(amp.y, 100) / 100;
        break;
      }
    }
    damage = this.element(skill, damage, target, context.temporary);
    const defense = Math.min(1999, target.MDDamage ?? 0);
    damage -= this.generator.roll(defense * 0.5, defense * 0.6);
    if (context.chargeMs >= 0) {
      damage *=
        (10 + Math.trunc((context.chargeMs * 90) / context.chargeMax)) / 100;
    }
    if (context.temporary.berserkFury) damage *= 2;
    return Math.trunc(damage);
  }

  healDamage(info, stats, recipients) {
    const count = Math.max(1, recipients);
    const intelligence = this.generator.roll(stats.int * 0.2, stats.int * 0.8);
    return (
      ((count * 0.3 + 1) *
        skillNumber(info.hp) *
        0.01 *
        (intelligence * 1.5 + stats.luk) *
        stats.mad *
        0.005) /
      count
    );
  }

  summon(skill, info, stats, target) {
    const magic = skillNumber(info.pad) === 0;
    if (!this.hits(stats, target, magic)) return 0;
    let damage;
    if (magic) {
      const mastery =
        (skillNumber(info.mastery) * 5 + 10) * 0.009000000000000001;
      damage =
        ((this.generator.roll(stats.mad * mastery, stats.mad) * 3.3 +
          stats.int * 0.5 +
          (stats.mad * 0.058) ** 2) *
          skillNumber(info.mad)) /
        100;
    } else {
      const family = Math.trunc((stats.job % 1000) / 100);
      const primary =
        family === 3 ? stats.dex : family === 4 ? stats.luk : stats.str;
      const secondary = family === 3 ? stats.str : stats.dex;
      damage =
        ((primary * this.generator.roll(0.7, 1) * 2.5 + secondary) *
          skillNumber(info.pad)) /
        100;
    }
    return Math.trunc(
      elementalDamage(damage, target, skill.properties.elemAttr),
    );
  }
}
