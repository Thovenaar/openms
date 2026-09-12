// Requested offline gameplay policy, not a recovered native resistance chance.
export const OFFLINE_ORDINARY_RECOIL_PERCENT = 90;

/** Native 004165ec uint32 output, modulo100 at009523b4/00958aec.
 * Damage and resistance must consume the same injected gameplay word stream. */
export function knockbackRoll(word) {
  if (!Number.isSafeInteger(word) || word < 0 || word > 0xffffffff) {
    throw new Error("Combat random source outside uint32");
  }
  return word % 100;
}

/** Native signed percent clamp at009523bf..d2 and00958ba1..bb1. */
export function knockbackChance(value) {
  if (!Number.isSafeInteger(value)) {
    throw new Error("Invalid knockback probability");
  }
  return Math.max(0, Math.min(100, value));
}
