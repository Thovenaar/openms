import { recalculateVitals } from "./character-stats.js";

/** Explicit offline policy, NOT an original MapleStory EXP/stat table. */
export const PROGRESSION_POLICY = Object.freeze({
  authority: "offline-local-policy",
  maxLevel: 200,
  threshold: "15 * level * level",
  hpPerLevel: 5,
  mpPerLevel: 3,
  primaryStatPerLevel: 1,
});

/** Remaining-level EXP threshold; units are WZ EXP points, formula is local. */
export function experienceRequired(level) {
  if (
    !Number.isSafeInteger(level) ||
    level < 1 ||
    level > PROGRESSION_POLICY.maxLevel
  ) {
    throw new Error("Unsupported local character level");
  }
  return level === PROGRESSION_POLICY.maxLevel ? 0 : 15 * level * level;
}

/** Mutate an owned profile or transaction draft; caller persists and emits effects. */
export function awardExperience(profile, amount, hpGrowth = 0, items) {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !Number.isSafeInteger(profile.exp + amount)
  ) {
    throw new Error("Invalid local EXP award");
  }
  if (!Number.isSafeInteger(hpGrowth) || hpGrowth < 0) {
    throw new Error("Invalid learned max-HP growth bonus");
  }
  experienceRequired(profile.level);
  if (profile.level === PROGRESSION_POLICY.maxLevel) return 0;
  profile.exp += amount;
  let gained = 0;
  for (
    let count = profile.level;
    count < PROGRESSION_POLICY.maxLevel;
    count++
  ) {
    const required = experienceRequired(profile.level);
    if (profile.exp < required) break;
    profile.exp -= required;
    profile.level++;
    profile.baseMaxHP = Math.min(
      30000,
      profile.baseMaxHP + PROGRESSION_POLICY.hpPerLevel + hpGrowth,
    );
    profile.baseMaxMP = Math.min(
      30000,
      profile.baseMaxMP + PROGRESSION_POLICY.mpPerLevel,
    );
    profile.str++;
    profile.dex++;
    profile.int++;
    profile.luk++;
    gained++;
  }
  if (gained) {
    recalculateVitals(profile, items);
    profile.hp = profile.maxHP;
    profile.mp = profile.maxMP;
  }
  if (profile.level === PROGRESSION_POLICY.maxLevel) profile.exp = 0;
  return gained;
}
