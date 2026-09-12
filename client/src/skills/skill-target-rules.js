import { hasMobStatus } from "../combat/mob-skill-status.js";

export const TARGET_SKILLS = new Map([
  [4211006, Object.freeze({ kind: "meso" })],
  [2311005, Object.freeze({ kind: "status", magic: true })],
  [5221009, Object.freeze({ kind: "status", projectile: true })],
]);
export const MAX_MESO_PILES = 20;
export const MAX_MESO_LINES = 15;
export const HYPNOTIZE_HIT_MS = 2000;

/** Original00791fbc; random is the native unsigned PRNG output, not Math.random. */
export function mesoExplosionDamage(amount, power, random) {
  const curve =
    amount <= 1000 ? (amount * 0.82 + 28) / 5300 : amount / (amount + 5250);
  return Math.trunc(
    power * 50 * curve * (0.5 + (random % 10000000) * 0.00000005),
  );
}

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

/** Original00792ae1/00792c01, not Cosmic's unrelated anti-cheat upper bound. */
export function hypnotizeDamage(attacker, target, magic, generator) {
  const first = (generator.next() % 10000000) * 0.0000001;
  const second = (generator.next() % 10000000) * 0.0000001;
  const attack = magic ? attacker.MADamage : attacker.PADamage;
  const defense = magic ? target.MDDamage : target.PDDamage;
  const factor = magic ? 0.75 + first * 0.05 : 0.8 + first * 0.05;
  return Math.max(
    0,
    Math.trunc(
      (attack * factor + 100) * attack * 0.01 -
        Math.max(0, defense) * (0.5 + second * 0.1),
    ),
  );
}
