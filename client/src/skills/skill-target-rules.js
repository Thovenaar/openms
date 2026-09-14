import {
  cappedDamage,
  levelAdjustedDamage,
  monsterDefenseMultiplier,
} from "../../../shared/combat-formulas.js";
import { hasMobStatus } from "../combat/mob-skill-status.js";

export const TARGET_SKILLS = new Map([
  [4211006, Object.freeze({ kind: "meso" })],
  [2311005, Object.freeze({ kind: "status", magic: true })],
  [5221009, Object.freeze({ kind: "status", projectile: true })],
]);
export const MAX_MESO_PILES = 20;
export const MAX_MESO_LINES = 15;
export const HYPNOTIZE_HIT_MS = 2000;

/** Original0096b7d3 gives each consumed pile a 100x100 damage rectangle. */
export function mesoTouches(pile, body) {
  return (
    body.active &&
    pile.x - 50 < body.right &&
    pile.x + 50 > body.left &&
    pile.y - 50 < body.bottom &&
    pile.y + 50 > body.top
  );
}

/** Native00670c63 rejects equal controller allegiance and dead/out-of-field actors. */
export function hypnotizeTarget(attacker, target) {
  return (
    attacker !== target &&
    attacker.alive &&
    target.alive &&
    target.active &&
    !target.fault &&
    !target.template.info.invincible &&
    !hasMobStatus(target, "inert") &&
    target.body.active
  );
}

/** Controlled v83 monsters use linear ATT with modern recipient DEF and level scaling. */
export function hypnotizeDamage(attacker, target, magic, generator) {
  const roll = (generator.next() % 10000000) * 0.0000001;
  const attack = magic ? attacker.MADamage : attacker.PADamage;
  const damage =
    attack * (0.85 + roll * 0.15) * monsterDefenseMultiplier(target, 0, magic);
  return cappedDamage(
    levelAdjustedDamage(damage, attacker.level, target.level),
  );
}
