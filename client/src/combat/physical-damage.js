import { isRangedWeapon } from "./weapon-usage.js";

// Original0078df87 and00950921; retained in trading/damage-generator.txt.
const SAMPLE_COUNT = 7;
const UINT32_SCALE = 0x100000000;
const INCOMING_SAMPLE_COUNT = 4;
const UINT32_MAX = UINT32_SCALE - 1;
//0078ea..fe: [swing, stab] coefficients; class/posture overrides follow below.
const WEAPON_COEFFICIENTS = Object.freeze({
  30: [4, 4],
  31: [4.4, 3.2],
  32: [4.4, 3.2],
  33: [4, 4],
  37: [4.4, 3.2],
  38: [4.4, 3.2],
  39: [4.2, 4.2],
  40: [4.6, 4.6],
  41: [4.8, 3.4],
  42: [4.8, 3.4],
  43: [3, 5],
  44: [5, 3],
  45: [3.4, 3.4],
  46: [3.6, 3.6],
  47: [3.6, 3.6],
  48: [4.8, 4.8],
  49: [3.6, 3.6],
});
const DEX_WEAPONS = new Set([45, 46, 49]);

function usesLuck(stats) {
  return (
    stats.weaponType === 47 ||
    (stats.weaponType === 33 && Math.trunc((stats.job % 1000) / 100) === 4)
  );
}

function weaponCoefficient(stats, action, weak) {
  const type = stats.weaponType;
  if (weak) return type === 45 || type === 46 ? 3.4 : 1;
  if (action === "proneStab") return 1;
  if (
    type === 44 &&
    (stats.job === 2000 || Math.trunc(stats.job / 100) === 21)
  ) {
    return 5;
  }
  if (type === 39) return stats.job === 500 ? 3 : 4.2;
  if (usesLuck(stats)) return 3.6;
  return WEAPON_COEFFICIENTS[type][action.startsWith("swing") ? 0 : 1];
}

function weaponFactor(type, action, weak) {
  if (weak) return type === 49 ? 0.005 : 0.006666666666666667;
  return action === "proneStab" ? 0.005 : 0.01;
}

/** 0079460a orders bounds; native modulo grid includes0, excludes1. */
function sample(low, high, value) {
  const minimum = Math.min(low, high);
  return (
    minimum + (value % 10000000) * 0.0000001 * (Math.max(low, high) - minimum)
  );
}

/** Validated original target stats; absent WZ PDDamage/eva use loader zero. */
export function physicalTargetError(info) {
  if (!Number.isSafeInteger(info.level) || info.level < 0) {
    return "Original target level is unavailable";
  }
  return null;
}

function admitPhysicalDamage(stats, info, skillPercent) {
  if (!stats.damageSupported) {
    throw new Error("Original equipped weapon damage metadata unavailable");
  }
  if (!Number.isSafeInteger(skillPercent) || skillPercent <= 0) {
    throw new Error("Original physical skill percentage is unavailable");
  }
  const targetError = physicalTargetError(info);
  if (targetError) throw new Error(targetError);
}

/** 00793201..288: native primary-stat weights, truncating after their sum. */
function physicalDefenseWeight(stats) {
  const warrior = Math.trunc((stats.job % 1000) / 100) === 1;
  return Math.trunc(
    warrior
      ? (stats.dex + stats.luk) * 0.25 + stats.int / 9 + stats.str / 3.5
      : stats.luk * 0.25 + stats.int / 9 + stats.dex / 3.5 + stats.str * 0.4,
  );
}

/** 0079309f: equipment/temporary PDD relative to original StandardPDD.img. */
function physicalReduction(stats, info, standardPDD) {
  const family = Math.trunc((stats.job % 1000) / 100);
  const standard = standardPDD?.[family]?.[stats.level];
  if (!Number.isSafeInteger(standard) || standard < 0) {
    throw new Error("Original StandardPDD job/level value unavailable");
  }
  const weight = physicalDefenseWeight(stats);
  const defense = Math.max(0, Math.min(1999, stats.pdd));
  const delta = defense - standard;
  const base = (weight * 0.00125 + 0.28) * defense;
  if (delta >= 0) {
    return base + delta * (weight / 900 + stats.level / 1300 + 0.28) * 0.7;
  }
  const scale =
    stats.level < info.level ? 1.3 : 13 / (stats.level - info.level + 13);
  return base + delta * (stats.level / 550 + weight * 0.00125 + 0.28) * scale;
}

/** 0079355f..603: MDD already includes equipped INT; primary terms are separate. */
function magicalReduction(stats) {
  const magician = Math.trunc((stats.job % 1000) / 100) === 2;
  return (
    (stats.luk * 0.2 + stats.str / 7 + stats.dex / 6 + stats.mdd) *
    (magician ? 0.3 : 0.25)
  );
}

/** Reusable native outgoing/incoming windows; injectable stream, not native seed parity. */
export class PhysicalDamage {
  constructor(random = Math.random, nextUint32 = null) {
    if (
      typeof random !== "function" ||
      (nextUint32 !== null && typeof nextUint32 !== "function")
    ) {
      throw new Error("Invalid physical damage random source");
    }
    this.random = random;
    this.nextUint32 = nextUint32;
    this.samples = new Uint32Array(SAMPLE_COUNT);
    this.incomingSamples = new Uint32Array(INCOMING_SAMPLE_COUNT);
    this.lastEvasionChance = 0;
    this.lastEvaded = false;
    this.cursor = 0;
    this.lastGenerated = 0;
    this.lastOutcome = "none";
  }

  /** Used separately for post-generation recoil; never a hit-admission probability. */
  next() {
    let value;
    if (this.nextUint32) value = this.nextUint32();
    else {
      const uniform = this.random();
      if (!Number.isFinite(uniform) || uniform < 0 || uniform >= 1) {
        throw new Error("Physical damage RNG must return a value in [0,1)");
      }
      value = Math.floor(uniform * UINT32_SCALE);
    }
    if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
      throw new Error("Physical damage RNG must return uint32");
    }
    return value;
  }

  roll(low, high) {
    const value = this.samples[this.cursor % SAMPLE_COUNT];
    this.cursor++;
    return sample(low, high, value);
  }

  /** Seven-word native window is shared by all damage lines of one target. */
  beginTarget() {
    for (let index = 0; index < SAMPLE_COUNT; index++) {
      this.samples[index] = this.next();
    }
    this.cursor = 0;
  }

  /** 009581a9 reserves four words;0079286e uses slot0 before physical magnitude.
   * Base acc is template+e8 -> mob-stat+64 (00789dc7); packet+68 is zero here.
   * Only normal mob stats are modeled, not unimplemented mob stat debuffs. */
  evades(stats, info, magic = false) {
    const targetError = physicalTargetError(info);
    if (targetError) throw new Error(targetError);
    for (let index = 0; index < INCOMING_SAMPLE_COUNT; index++) {
      this.incomingSamples[index] = this.next();
    }
    const gap = Math.max(0, info.level - stats.level);
    const evasion = Math.max(0, Math.min(999, stats.eva) - Math.trunc(gap / 2));
    const accuracy = Math.max(0, Math.min(999, info.acc ?? 0));
    if (magic) {
      this.lastEvasionChance = null;
      this.lastEvaded =
        accuracy <= sample(evasion * 0.1, evasion, this.incomingSamples[0]);
      return this.lastEvaded;
    }
    const ratio = (evasion / (accuracy * 4.5)) * 100;
    const thief = Math.trunc((stats.job % 1000) / 100) === 4;
    let chance = thief ? 5 : 2;
    // The native comparisons retain the lower bound for0/0, not NaN propagation.
    if (chance < ratio) chance = ratio;
    this.lastEvasionChance = Math.min(thief ? 95 : 80, chance);
    this.lastEvaded =
      (this.incomingSamples[0] % 10000000) * 0.00001 < this.lastEvasionChance;
    return this.lastEvaded;
  }

  /** 0079309f/0079345e reserve four words, then draw a separate magnitude word.
   * Original ordinary mob stats only; special mob debuffs/reflect are not invented.
   * options is caller-owned, reused across impacts. */
  receive(stats, info, options) {
    if (this.evades(stats, info, options.magic)) return 0;
    const original = options.magic
      ? info.MADamage
      : (options.attackPADamage ?? info.PADamage);
    if (!Number.isSafeInteger(original) || original < 0) {
      throw new Error("Original incoming attack statistic unavailable");
    }
    const attack = Math.max(0, Math.min(1999, original));
    const rolled = sample(
      attack * (options.magic ? 0.75 : 0.8),
      attack * (options.magic ? 0.8 : 0.85),
      this.next(),
    );
    const reduction = options.magic
      ? magicalReduction(stats)
      : physicalReduction(stats, info, options.standardPDD);
    return finishIncomingDamage(
      rolled * attack * 0.01 - reduction,
      stats,
      options.magic,
    );
  }

  /**
   * One line per original target, normal weapon use/Power Strike/Slash Blast.
   * Stats are a once-per-impact projectCharacterStats output. Returns signed native
   * truncation; HP authority, not this generator, maps nonpositive results to MISS.
   */
  generate(stats, info, skillPercent = 100, use = null) {
    admitPhysicalDamage(stats, info, skillPercent);
    for (let index = 0; index < SAMPLE_COUNT; index++) {
      this.samples[index] = this.next();
    }
    // Slot0 is consumed by the ordinary mob-state guard, even with no active state.
    this.cursor = 1;
    this.lastGenerated = 0;
    this.lastOutcome = "accuracy-miss";
    const gap = Math.max(0, info.level - stats.level);
    const accuracy =
      (Math.max(0, Math.min(999, stats.acc)) * 100) / (gap * 10 + 255);
    if (
      this.roll(accuracy * 0.7, accuracy * 1.3) <
      Math.max(0, Math.min(999, info.eva ?? 0))
    ) {
      return 0;
    }
    let damage = this.weaponDamage(stats, use);
    if (gap > 0) damage = (100 - gap) * damage * 0.01;
    const defense = Math.max(0, Math.min(1999, info.PDDamage ?? 0));
    damage -= this.roll(defense * 0.5, defense * 0.6);
    // Non-elemental supported actions:00790660/007907ec are identity here.
    damage = skillPercent * 0.01 * damage;
    const generated = Math.trunc(damage);
    if (!Number.isSafeInteger(generated)) {
      throw new Error("Physical damage exceeds safe integer bounds");
    }
    this.lastGenerated = generated === 0 ? 0 : generated;
    this.lastOutcome = this.lastGenerated > 0 ? "hit" : "nonpositive";
    return this.lastGenerated;
  }

  /**0078ea..fe: action-sensitive coefficients, including ranged melee penalties. */
  weaponDamage(stats, use) {
    const type = stats.weaponType;
    const ranged = use ? use.ranged : isRangedWeapon(type);
    const action = use?.action ?? "swingO1";
    const weak = isRangedWeapon(type) && !ranged;
    const mastery =
      ((weak ? 0 : stats.mastery) * 5 + 10) * 0.009000000000000001;
    const coefficient = weaponCoefficient(stats, action, weak);
    const factor = weaponFactor(type, action, weak);
    const rolled =
      action === "proneStab" && !weak
        ? coefficient * this.roll(stats.str * mastery, stats.str) + stats.dex
        : this.weaponBase(stats, mastery, coefficient);
    const pad = use
      ? Math.max(
          0,
          Math.min(1999, stats.padWithoutProjectile + use.projectilePAD),
        )
      : stats.pad;
    return rolled * pad * factor;
  }

  /** Native primary/secondary stats differ by weapon and thief dagger job. */
  weaponBase(stats, mastery, coefficient) {
    let primary = stats.str,
      secondary = stats.dex;
    if (DEX_WEAPONS.has(stats.weaponType)) {
      primary = stats.dex;
      secondary = stats.str;
    } else if (usesLuck(stats)) {
      primary = stats.luk;
      secondary = stats.str + stats.dex;
    }
    return coefficient * this.roll(primary * mastery, primary) + secondary;
  }
}

function finishIncomingDamage(damage, stats, magic) {
  //007933b2..3df applies physical Invincible before the single __ftol.
  const guarded = magic
    ? damage
    : damage - damage * (stats.invincible ?? 0) * 0.01;
  const generated = Math.trunc(guarded);
  //0095848f records physical nonpositive outcomes as MISS. The magic branch
  //00958422..34 alone preserves a nonzero hit with a minimum of1.
  if (generated === 0) return 0;
  return magic ? Math.max(1, generated) : generated;
}
