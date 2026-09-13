export const STARTING_STAT_KEYS = Object.freeze(["str", "dex", "int", "luk"]);
export const STARTING_STAT_MIN = 4;
export const STARTING_STAT_TOTAL = 25;
export const STARTING_STAT_MAX = 13;

/** Browser creation policy: four base4 stats sharing nine additional points.
 * The v83 executable retains dice artwork but does not submit rolled stats.
 * See docs/login-creation-recovery.md for that provenance boundary. */
export function validStartingStats(stats) {
  if (!stats || typeof stats !== "object") return false;
  let sum = 0;
  for (const key of STARTING_STAT_KEYS) {
    const value = stats[key];
    if (
      !Number.isInteger(value) ||
      value < STARTING_STAT_MIN ||
      value > STARTING_STAT_MAX
    ) {
      return false;
    }
    sum += value;
  }
  return sum === STARTING_STAT_TOTAL;
}
