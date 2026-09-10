// Original0078df87 and00950921; retained in trading/damage-generator.txt.
const SAMPLE_COUNT = 7;
const UINT32_SCALE = 0x100000000;
const INCOMING_SAMPLE_COUNT = 4;
const UINT32_MAX = UINT32_SCALE - 1;

/** 0079460a orders bounds; native modulo grid includes0, excludes1. */
function sample(low, high, value) {
  const minimum = Math.min(low, high);
  return (
    minimum + (value % 10000000) * 0.0000001 * (Math.max(low, high) - minimum)
  );
}

/** Validated original target stats; absent WZ PDDamage/eva use loader zero. */
export function swordTargetError(info) {
  if (!Number.isSafeInteger(info.level) || info.level < 0) {
    return "Original target level is unavailable";
  }
  return null;
}

function admitSwordDamage(stats, info, skillPercent) {
  if (!stats.damageSupported || stats.weaponType !== 30) {
    throw new Error("Original damage controller requires a one-handed sword");
  }
  if (!Number.isSafeInteger(skillPercent) || skillPercent <= 0) {
    throw new Error("Original physical skill percentage is unavailable");
  }
  const targetError = swordTargetError(info);
  if (targetError) throw new Error(targetError);
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

  /** 009581a9 reserves four words;0079286e uses slot0 before physical magnitude.
   * Base acc is template+e8 -> mob-stat+64 (00789dc7); packet+68 is zero here.
   * Only normal mob stats are modeled, not unimplemented mob stat debuffs. */
  evades(stats, info) {
    const targetError = swordTargetError(info);
    if (targetError) throw new Error(targetError);
    for (let index = 0; index < INCOMING_SAMPLE_COUNT; index++) {
      this.incomingSamples[index] = this.next();
    }
    const gap = Math.max(0, info.level - stats.level);
    const evasion = Math.max(0, Math.min(999, stats.eva) - Math.trunc(gap / 2));
    const accuracy = Math.max(0, Math.min(999, info.acc ?? 0));
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

  /**
   * One line per original target, ordinary one-handed sword/Power Strike/Slash Blast.
   * Stats are a once-per-impact projectCharacterStats output. Returns signed native
   * truncation; HP authority, not this generator, maps nonpositive results to MISS.
   */
  generate(stats, info, skillPercent = 100) {
    admitSwordDamage(stats, info, skillPercent);
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
    const mastery = (stats.mastery * 5 + 10) * 0.009000000000000001;
    let damage =
      (4 * this.roll(stats.str * mastery, stats.str) + stats.dex) *
      stats.pad *
      0.01;
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
}
