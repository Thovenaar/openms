// Original 008c2870 x87 arithmetic, jump table008c452c; retained in
// docs/ghidra-client-features/windows/stat-damage-{instructions,constants}.txt.
// Weapon types are00460aa0's (itemId /10000)%100, not equipment categories.
const COEFFICIENTS = new Map([
  [30, [4, 4]],
  [31, [3.2, 4.4]],
  [32, [3.2, 4.4]],
  [33, [4, 4]],
  [37, [3.2, 4.4]],
  [38, [3.2, 4.4]],
  [40, [4.6, 4.6]],
  [41, [3.4, 4.8]],
  [42, [3.4, 4.8]],
  [43, [3, 5]],
  [44, [3, 5]],
  [45, [3.4, 3.4]],
  [46, [3.6, 3.6]],
  [47, [3.6, 3.6]],
  [48, [4.8, 4.8]],
  [49, [3.6, 3.6]],
]);

/** Writes original displayed damage bounds. mastery is raw00764795 output,
 * not a percentage: selected skill level-data field+0x124, zero if unlearned.
 * stats.pad must include the actual0077df48 weapon/projectile contribution.
 * Returns false for unavailable inputs; never substitutes a generic formula.
 */
export function nativeStatDamage(stats, mastery, output = stats) {
  const type = stats.weaponType;
  output.damageMin = null;
  output.damageMax = null;
  if (type === 0) {
    return true;
  }
  const coefficients = COEFFICIENTS.get(type);
  if (!damageInputsAvailable(stats, mastery, coefficients)) return false;
  let primary = stats.str;
  let secondary = stats.dex;
  let minimum = coefficients?.[0];
  let maximum = coefficients?.[1];
  if (usesDexterity(type)) {
    primary = stats.dex;
    secondary = stats.str;
  } else if (usesLuck(type, stats.job)) {
    primary = stats.luk;
    secondary = stats.str + stats.dex;
    minimum = 3.6;
    maximum = 3.6;
  } else if (type === 39) {
    minimum = stats.job === 500 ? 3 : 4.2;
    maximum = minimum;
  }
  if (!Number.isFinite(primary) || !Number.isFinite(secondary)) return false;
  const factor = (mastery * 5 + 10) * 0.009000000000000001;
  output.damageMin = Math.max(
    1,
    Math.min(
      199999,
      Math.trunc((primary * factor * minimum + secondary) * stats.pad * 0.01),
    ),
  );
  output.damageMax = Math.max(
    1,
    Math.min(
      199999,
      Math.trunc((primary * maximum + secondary) * stats.pad * 0.01),
    ),
  );
  return true;
}

function usesDexterity(type) {
  return type === 45 || type === 46 || type === 49;
}

function usesLuck(type, job) {
  return type === 47 || (type === 33 && Math.trunc((job % 1000) / 100) === 4);
}

function damageInputsAvailable(stats, mastery, coefficients) {
  return Boolean(
    (coefficients || stats.weaponType === 39) &&
    Number.isFinite(mastery) &&
    Number.isFinite(stats.pad),
  );
}
