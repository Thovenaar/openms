/** Native 004165ec uint32 output, modulo100 at009523b4/00958aec.
 * The supplied [0,1) stream is offline authority, not a recovered client seed. */
export function knockbackRoll(random) {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new Error("Combat random source outside [0,1)");
  }
  return Math.floor(sample * 0x100000000) % 100;
}

/** Native signed percent clamp at009523bf..d2 and00958ba1..bb1. */
export function knockbackChance(value) {
  if (!Number.isSafeInteger(value)) {
    throw new Error("Invalid knockback probability");
  }
  return Math.max(0, Math.min(100, value));
}
