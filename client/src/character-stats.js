const VITAL_CAP = 30000;
const EQUIPMENT_FIELDS = Object.freeze([
  ["str", "incSTR"],
  ["dex", "incDEX"],
  ["int", "incINT"],
  ["luk", "incLUK"],
  ["maxHP", "incMHP"],
  ["maxMP", "incMMP"],
  ["pad", "incPAD"],
  ["mad", "incMAD"],
  ["pdd", "incPDD"],
  ["mdd", "incMDD"],
  ["acc", "incACC"],
  ["eva", "incEVA"],
  ["speed", "incSpeed"],
  ["jump", "incJump"],
]);

/** Original base-template fields only; this save model never invents equipment upgrades. */
function equipmentInfo(items, id) {
  const template = items?.[id];
  if (!template?.info) {
    throw new Error(`Original equipped-item statistics unavailable: ${id}`);
  }
  return template.info;
}

function addStat(total, value) {
  const amount = value ?? 0;
  if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(total + amount)) {
    throw new Error("Equipped statistic exceeds safe integer bounds");
  }
  return total + amount;
}

/** Caller supplies a validated bounded profile and immutable original item metadata. */
export function equippedStat(profile, items, field) {
  let result = 0;
  for (const entry of profile.equipment) {
    result = addStat(result, equipmentInfo(items, entry.id)[field]);
  }
  return result;
}

/** Reuse caller-owned output; no object/array construction in gameplay projection. */
export function equipmentBonuses(profile, items, output) {
  for (const [key] of EQUIPMENT_FIELDS) output[key] = 0;
  for (const entry of profile.equipment) {
    const info = equipmentInfo(items, entry.id);
    for (const [key, source] of EQUIPMENT_FIELDS) {
      output[key] = addStat(output[key], info[source]);
    }
  }
  return output;
}

/** Cosmic Character.java7600..7669: base + equipped maxima, then30000 cap.
 * config.yaml USE_FIXED_RATIO_HPMP_UPDATE=false: raising a maximum never heals.
 * Base values remain durable even when equipment drives the displayed total to its cap.
 * Temporary Hyper Body is not an implemented controller and is not synthesized here. */
export function recalculateVitals(profile, items) {
  const hp = addStat(profile.baseMaxHP, equippedStat(profile, items, "incMHP"));
  const mp = addStat(profile.baseMaxMP, equippedStat(profile, items, "incMMP"));
  profile.maxHP = Math.max(1, Math.min(VITAL_CAP, hp));
  profile.maxMP = Math.max(0, Math.min(VITAL_CAP, mp));
  profile.hp = Math.min(profile.hp, profile.maxHP);
  profile.mp = Math.min(profile.mp, profile.maxMP);
}

const PRIMARY_STATS = ["str", "dex", "int", "luk"];
const SECONDARY_CAPS = [
  ["pad", 1999],
  ["pdd", 1999],
  ["mad", 1999],
  ["mdd", 1999],
  ["acc", 999],
  ["eva", 999],
];
const SWORD_MASTERY = [1100000, 1200000, 11100000];
const ACCURACY_PASSIVES = [3000000, 4000000, 14000000, 5000000, 15000000];

/** Allocate once per consumer, then reuse with projectCharacterStats. */
export function createCharacterStats() {
  const output = {
    level: 0,
    job: 0,
    weaponId: 0,
    weaponType: 0,
    mastery: null,
    hands: 0,
    damageSupported: false,
  };
  for (const [key] of EQUIPMENT_FIELDS) output[key] = 0;
  return output;
}

function learnedInfo(hooks, id) {
  const rank = hooks.skillLevel(id);
  if (!Number.isSafeInteger(rank) || rank < 0) {
    throw new Error("Invalid learned-stat rank");
  }
  if (!rank) return null;
  const info = hooks.skillInfo(id, rank);
  if (!info) throw new Error(`Original learned-stat data unavailable: ${id}`);
  return info;
}

/** 00764795/00764afe: first nonzero authored mastery, with x as ACC bonus. */
function projectSwordMastery(hooks, output) {
  output.mastery = output.weaponType === 0 ? 0 : null;
  output.damageSupported = output.weaponType === 30;
  if (!output.damageSupported) return;
  output.mastery = 0;
  for (const id of SWORD_MASTERY) {
    const info = learnedInfo(hooks, id);
    if (!info) continue;
    const mastery = addStat(0, info.mastery);
    if (!mastery) continue;
    output.mastery = mastery;
    output.acc = addStat(output.acc, info.x);
    return;
  }
}

/** 0077f6b5..7f6: integer EVA terms; x87 ACC truncates only after addition. */
function projectBaseAccuracy(output) {
  const family = Math.trunc((output.job % 1000) / 100);
  const branch = Math.trunc(output.job / 10);
  let evasion = Math.trunc(output.luk / 2) + Math.trunc(output.dex / 4);
  let dexFactor = family === 3 || family === 4 || family === 5 ? 0.6 : 0.8;
  const lukFactor = dexFactor === 0.6 ? 0.3 : 0.5;
  if (family === 5 && branch === 51) {
    evasion = Math.trunc(Math.trunc(output.luk / 2) + output.dex * 1.5);
    dexFactor = 0.9;
  } else if (family === 5 && branch === 52) {
    evasion = Math.trunc(output.luk / 2) + Math.trunc(output.dex / 8);
  }
  output.eva = addStat(output.eva, evasion);
  output.acc = addStat(
    output.acc,
    Math.trunc(output.dex * dexFactor + output.luk * lukFactor),
  );
}

/** 0077fc..8044f: learned passive fields, never job-based grants. */
function projectPassiveStats(profile, hooks, output) {
  for (const id of ACCURACY_PASSIVES) {
    const info = learnedInfo(hooks, id);
    if (!info) continue;
    output.acc = addStat(output.acc, info.x);
    if (id !== 3000000) output.eva = addStat(output.eva, info.y);
  }
  const root =
    Math.trunc(profile.job / 100) === 22 || profile.job === 2001
      ? 2001
      : Math.trunc(profile.job / 1000) * 1000;
  const blessing = learnedInfo(hooks, root * 10000 + 12);
  if (blessing) {
    output.pad = addStat(output.pad, blessing.x);
    output.mad = addStat(output.mad, blessing.y);
    output.acc = addStat(output.acc, blessing.z);
    output.eva = addStat(output.eva, blessing.z);
  }
  const magic = learnedInfo(hooks, 22000000);
  if (magic) output.mad = addStat(output.mad, magic.mad);
  const magicMastery = learnedInfo(hooks, 22170001);
  if (magicMastery?.mastery) output.mad = addStat(output.mad, magicMastery.x);
  projectSwordMastery(hooks, output);
}

/** 00765c5e: Thrust is learned, not inherent movement granted by a job. */
function projectPassiveSpeed(hooks, output) {
  let id = 0;
  if (output.job === 311 || output.job === 312) id = 3110000;
  else if (output.job === 321 || output.job === 322) id = 3210000;
  else if (output.job === 1310 || output.job === 1311 || output.job === 1312) {
    id = 13100004;
  }
  if (id) output.speed = addStat(output.speed, learnedInfo(hooks, id)?.speed);
}

/** 008c457c/45e8 normal, unmounted totals; speed debuffs may fall below100. */
function projectMovementStats(output, temporary) {
  const speed = Math.max(100, Math.min(140, 100 + output.speed));
  const jump = Math.max(100, Math.min(123, 100 + output.jump));
  output.speed = Math.min(140, addStat(speed, temporary?.speed));
  output.jump = Math.min(123, addStat(jump, Math.max(0, temporary?.jump ?? 0)));
}

/**
 * Native0077ec9f ->0077f4c9 ->0077df48 consumer projection. The profile contains
 * base stats and equipped instances; hooks.derivedStats returns temporary-only
 * additive fields. Equipment/PAD is summed exactly once. No durable mutation.
 * Unsupported weapon mastery leaves damageSupported=false, mastery/ACC=null.
 * Morph/stat overrides, Maple Warrior and advanced temporary controllers are not
 * synthesized: they must enter through a separately recovered stat authority.
 */
export function projectCharacterStats(
  profile,
  hooks,
  output,
  temporary = hooks.derivedStats?.(),
) {
  if (
    typeof hooks.skillLevel !== "function" ||
    typeof hooks.skillInfo !== "function"
  ) {
    throw new Error("Original learned-stat rank source unavailable");
  }
  equipmentBonuses(profile, hooks.items, output);
  for (const key of PRIMARY_STATS) {
    output[key] = addStat(profile[key], output[key]);
  }
  output.level = profile.level;
  output.job = profile.job;
  output.weaponId = 0;
  for (const entry of profile.equipment) {
    if (entry.slot === -11) output.weaponId = entry.id;
  }
  output.weaponType = Math.trunc(output.weaponId / 10000) % 100;
  output.hands = output.dex + output.int + output.luk;
  output.mad = addStat(output.mad, output.int);
  output.mdd = addStat(output.mdd, output.int);
  projectBaseAccuracy(output);
  projectPassiveStats(profile, hooks, output);
  projectPassiveSpeed(hooks, output);
  for (const [key, cap] of SECONDARY_CAPS) {
    const base = Math.max(0, Math.min(cap, output[key]));
    output[key] = Math.max(0, Math.min(cap, addStat(base, temporary?.[key])));
  }
  projectMovementStats(output, temporary);
  output.maxHP = profile.maxHP;
  output.maxMP = profile.maxMP;
  if (output.mastery === null) output.acc = null;
  return output;
}
