import { learnedCombatInfo } from "./skill-damage.js";
import { skillNumber } from "./skill-costs.js";
import { hasMobStatus, setMobStatus } from "../combat/mob-skill-status.js";

const ACHILLES = [1120004, 1220005, 1320005, 21120004];
const GUARDIAN = [1120005, 1220006];
const SHIFTER = [4120002, 4220002];
const RESISTANCE = [1310000, 2310000, 12110000, 2110000, 2210000];
const NATIVE_ELEMENT = {
  I: 1,
  i: 1,
  F: 2,
  f: 2,
  L: 3,
  l: 3,
  S: 4,
  s: 4,
  H: 5,
  h: 5,
  D: 6,
  d: 6,
  P: 7,
  p: 7,
};

export function incomingElementCode(element) {
  const code = typeof element === "string" ? NATIVE_ELEMENT[element] : element;
  return Number.isInteger(code) && code >= 1 && code <= 7 ? code : 0;
}

/** Native receive branch + Cosmic TakeDamageHandler207..278. No vital/inventory owner here. */
export class SkillDefenses {
  constructor(field) {
    this.field = field;
    this.hit = { skillId: 0, knockbackChance: 0, roll: 0 };
    this.statusEffect = { duration: 0, source: 0 };
    this.pendingTarget = null;
    this.pendingAmount = 0;
  }

  reduce(amount, mob, { magic, contact, outcome = null }) {
    if (amount <= 0) return amount;
    const field = this.field;
    const temporary = field.hooks.derivedStats?.() ?? null;
    if (temporary?.divineBody) return 0;
    if (this.evade(mob, magic, contact, outcome)) return 0;
    amount = this.mitigate(amount, mob, magic, temporary);
    if (contact)
      {amount = this.powerGuard(amount, mob, temporary?.powerGuard, outcome);}
    if (magic)
      {this.manaReflection(amount, mob, temporary?.manaReflection, outcome);}
    return amount;
  }

  mitigate(amount, mob, magic, temporary) {
    const field = this.field;
    amount = Math.max(
      1,
      Math.trunc((amount * (field.hooks.chakraDamagePercent?.() ?? 100)) / 100),
    );
    if (magic) {
      amount = this.elementResistance(
        amount,
        mob.pendingAttack?.properties.elemAttr,
      );
    }
    for (const id of ACHILLES) {
      const info = learnedCombatInfo(field.hooks, id);
      if (info) {
        amount = Math.trunc((amount * skillNumber(info.x)) / 1000);
        break;
      }
    }
    if (temporary?.comboBarrier) {
      amount = Math.trunc((amount * temporary.comboBarrier) / 1000);
    }
    return amount;
  }

  powerGuard(amount, mob, percent, outcome = null) {
    if (!percent) return amount;
    const reflected = Math.min(
      Math.trunc(mob.maxHP / 10),
      Math.trunc((amount * percent) / (mob.template.info.boss ? 200 : 100)),
    );
    this.reflect(
      mob,
      reflected,
      this.field.hooks.skillLevel?.(1101007) ? 1101007 : 1201007,
      outcome,
    );
    return amount - reflected;
  }

  manaReflection(amount, mob, id, outcome = null) {
    if (!id || mob.template.info.boss) return;
    const field = this.field;
    const info = learnedCombatInfo(field.hooks, id);
    if (info && field.damageGenerator.next() % 100 < skillNumber(info.prop)) {
      this.reflect(
        mob,
        Math.min(
          Math.trunc(mob.maxHP / 5),
          Math.trunc((amount * skillNumber(info.x)) / 100),
        ),
        id,
        outcome,
      );
    }
  }

  evade(mob, magic, contact, outcome = null) {
    const field = this.field;
    for (const id of SHIFTER) {
      const info = learnedCombatInfo(field.hooks, id);
      //00958592..59e consumes reserved incoming word1, not another RNG draw.
      if (
        info &&
        field.damageGenerator.incomingSamples[1] % 100 < skillNumber(info.prop)
      ) {
        return true;
      }
    }
    if (magic || !contact || !field.hooks.items) return false;
    if (!this.hasShield(outcome?.profile)) return false;
    return this.guardianEvade(mob, outcome);
  }

  hasShield(profile = this.field.store.profile) {
    for (const item of profile.equipment) {
      if (item.slot === -10 && Math.trunc(item.id / 10000) === 109) return true;
    }
    return false;
  }

  guardianEvade(mob, outcome = null) {
    const field = this.field;
    for (const id of GUARDIAN) {
      const info = learnedCombatInfo(field.hooks, id);
      if (
        !info ||
        //00958763..771: Guardian's authored prop is per thousand, using word3.
        field.damageGenerator.incomingSamples[3] % 1000 >=
          skillNumber(info.prop)
      ) {
        continue;
      }
      if (!mob.template.info.boss) {
        const effect = { duration: skillNumber(info.time) * 1000, source: id };
        if (outcome) {
          outcome.rejectContact = true;
          outcome.effects.push(() => {
            const target = field.hooks.resolveIncomingSource
              ? field.hooks.resolveIncomingSource(mob)
              : mob;
            if (target) setMobStatus(target, "stun", 1, effect);
          });
        } else setMobStatus(mob, "stun", 1, effect);
      }
      return true;
    }
    return false;
  }

  reflect(mob, amount, id, outcome = null) {
    if (outcome) {
      outcome.reflection = { mob, amount, hit: { ...this.hit, skillId: id } };
      return;
    }
    this.pendingTarget = mob;
    this.pendingAmount = amount;
    this.hit.skillId = id;
  }

  flushReflection(outcome = null) {
    if (outcome) {
      const reflection = outcome.reflection;
      outcome.reflection = null;
      if (!reflection || reflection.amount <= 0) return;
      const target = this.field.hooks.resolveIncomingSource
        ? this.field.hooks.resolveIncomingSource(reflection.mob)
        : reflection.mob;
      if (!target) return;
      this.field.damageTarget(target, reflection.amount, reflection.hit);
      this.field.hooks.onSkillProc?.(reflection.hit.skillId, target);
      return;
    }
    if (!this.pendingTarget || this.pendingAmount <= 0) return;
    this.field.damageTarget(this.pendingTarget, this.pendingAmount, this.hit);
    this.field.hooks.onSkillProc?.(this.hit.skillId, this.pendingTarget);
    this.pendingTarget = null;
    this.pendingAmount = 0;
  }

  elementResistance(amount, element) {
    //00765a34 accepts only explicit element1..7. Untyped magic gets no resistance.
    const code = incomingElementCode(element);
    if (!Number.isInteger(code) || code < 1 || code > 7) return amount;
    for (const id of RESISTANCE) {
      if (!resistsElement(id, code)) continue;
      const info = learnedCombatInfo(this.field.hooks, id);
      if (info) {
        return Math.max(
          1,
          Math.trunc((amount * (100 - skillNumber(info.x))) / 100),
        );
      }
    }
    return amount;
  }

  /** 0095fa8b: element-qualified percentage, signed division before subtraction. */
  itemDefense(amount, element) {
    const code = incomingElementCode(element);
    const temporary = this.field.hooks.derivedStats?.();
    if (
      amount <= 0 ||
      !Number.isInteger(code) ||
      code < 1 ||
      code > 4 ||
      code !== temporary?.defenseAttElement
    ) {
      return amount;
    }
    return amount - Math.trunc((amount * temporary.defenseAttPercent) / 100);
  }

  absorbMeso(amount, profile = this.field.store.profile, outcome = null) {
    if (this.field.hooks.derivedStats?.().magicGuard) return amount;
    const value = this.field.hooks.derivedStats?.().mesoGuard;
    if (!value || amount <= 0) return amount;
    const remaining = Math.round(amount / 2);
    const meso = Math.trunc((remaining * value) / 100);
    if (profile.meso < meso) {
      const cancel = () => this.field.hooks.cancelSkillFamily?.("meso-guard");
      if (outcome) outcome.effects.push(cancel);
      else cancel();
    }
    profile.meso = Math.max(0, profile.meso - meso);
    return remaining;
  }
  contactAllowed(mob) {
    if (
      hasMobStatus(mob, "inert") ||
      hasMobStatus(mob, "stun") ||
      hasMobStatus(mob, "freeze")
    ) {
      return false;
    }
    if (this.field.hooks.derivedStats?.().darkSight) return false;
    return true;
  }
}

function resistsElement(id, code) {
  if (id === 2110000) return code === 2 || code === 4;
  if (id === 2210000) return code === 1 || code === 3;
  return true;
}
