import { recalculateVitals } from "./character-stats.js";
import { skillPointPool } from "../skills/skill-allocation-rules.js";

/** Explicit offline policy, NOT an original MapleStory EXP/stat table. */
export const PROGRESSION_POLICY = Object.freeze({
  authority: "offline-local-policy",
  maxLevel: 200,
  threshold: "15 * level * level",
  hpPerLevel: 5,
  mpPerLevel: 3,
  apPerLevel: 5,
  spPerLevel: 3,
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

const NO_GROWTH = Object.freeze({ hp: 0, mp: 0 });
const HP_GROWTH = new Map([
  [1, 1000001],
  [11, 11000000],
  [51, 5100000],
  [151, 15100000],
]);
const MP_GROWTH = new Map([
  [2, 2000001],
  [12, 12000000],
]);

/** Cosmic Character level-up consumes x; AssignAPProcessor separately consumes y. */
export function learnedGrowth(profile, catalog, now, output) {
  const family = Math.trunc(profile.job / 100);
  const hpSkill =
    HP_GROWTH.get(family) ?? HP_GROWTH.get(Math.trunc(profile.job / 10));
  output.hp = growthValue(profile, catalog, hpSkill, now);
  output.mp = growthValue(profile, catalog, MP_GROWTH.get(family), now);
  return output;
}

function growthValue(profile, catalog, id, now) {
  if (id === undefined) return 0;
  const record = profile.skills[id];
  if (
    !record?.level ||
    (record.expiresAt !== null && record.expiresAt <= now)
  ) {
    return 0;
  }
  const info = catalog[id]?.levels[record.level];
  if (!Number.isSafeInteger(info?.x) || info.x < 0) {
    throw new Error("Original learned vital growth unavailable");
  }
  return info.x;
}

function validateGrowth(growth) {
  if (
    !Number.isSafeInteger(growth.hp) ||
    growth.hp < 0 ||
    !Number.isSafeInteger(growth.mp) ||
    growth.mp < 0
  ) {
    throw new Error("Invalid learned vital growth bonus");
  }
}

/** Cosmic Character.levelUp/levelUpGainSp; job-separated SP is the requested game policy. */
function awardLevelPoints(profile) {
  const previousLevel = profile.level - 1;
  const cygnus = Math.trunc(profile.job / 1000) === 1;
  const bonus =
    cygnus && previousLevel > 10 && previousLevel < 77
      ? previousLevel <= 17
        ? 2
        : 1
      : 0;
  const ap = profile.remainingAp + PROGRESSION_POLICY.apPerLevel + bonus;
  const pool = skillPointPool(profile.job);
  const sp =
    profile.remainingSp[pool] +
    (profile.job % 1000 >= 100 ? PROGRESSION_POLICY.spPerLevel : 0);
  if (!Number.isSafeInteger(ap) || !Number.isSafeInteger(sp)) {
    throw new Error("Level-up point balance exceeds the profile limit");
  }
  profile.remainingAp = ap;
  profile.remainingSp[pool] = sp;
}

/** Mutate an owned profile or transaction draft; caller persists and emits effects. */
export function awardExperience(profile, amount, growth = NO_GROWTH, items) {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !Number.isSafeInteger(profile.exp + amount)
  ) {
    throw new Error("Invalid local EXP award");
  }
  validateGrowth(growth);
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
      profile.baseMaxHP + PROGRESSION_POLICY.hpPerLevel + growth.hp,
    );
    profile.baseMaxMP = Math.min(
      30000,
      profile.baseMaxMP + PROGRESSION_POLICY.mpPerLevel + growth.mp,
    );
    awardLevelPoints(profile);
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
