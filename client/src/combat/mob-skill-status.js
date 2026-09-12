import { skillNumber } from "../skills/skill-costs.js";

// Cosmic StatEffect751..839 and Monster1137..1296. One slot per native stat: recast replaces.
export const MOB_STATUS = Object.freeze({
  stun: 0,
  freeze: 1,
  seal: 2,
  speed: 3,
  watk: 4,
  wdef: 5,
  mdef: 6,
  accuracy: 7,
  poison: 8,
  web: 9,
  showdown: 10,
  doom: 11,
  inert: 12,
  imprint: 13,
  venom: 14,
  sealSkill: 15,
  ambush: 16,
  demon: 17,
});
const STATUS_COUNT = 18;
const STUN = new Set([
  1111005, 1111006, 1111008, 1211002, 1311006, 3101005, 4211002, 4221007,
  5101002, 5101003, 5121004, 5121005, 5121007, 5201004, 11111003, 15111004,
  21110006, 22140002, 22180001, 3111005, 3211005,
]);
const FREEZE = new Set([
  2201004, 2211002, 2221007, 2211006, 3211003, 5211005, 2121006, 21120006,
  22150002, 2121005, 3221005,
]);
const SEAL = new Set([2111004, 2211004, 12111002]);
const SLOW = new Set([2101003, 2201003, 12101001]);
const POISON = new Set([
  2101005, 2111006, 2121003, 2221003, 2111003, 12111005, 14111006, 5211004,
]);
const WEB = new Set([4111003, 14111001]);
const CRASH = new Set([1111007, 1211009, 1311007]);
const SINGLE_STATUS_FAMILIES = Object.freeze({
  4001002: "weaken",
  14001002: "weaken",
  1201006: "weaken",
  4121003: "showdown",
  4221003: "showdown",
  2311005: "doom",
  5221009: "inert",
  22160000: "imprint",
  4121004: "ambush",
  4221004: "ambush",
});
const BUFF_STATS = ["watk", "wdef", "mdef", "accuracy", "speed"];
const DOT_STATS = [MOB_STATUS.poison, MOB_STATUS.ambush];
const DOOM_FIELDS = [
  "level",
  "PADamage",
  "PDDamage",
  "MADamage",
  "MDDamage",
  "acc",
  "eva",
];
export const MOB_DOT_SKILLS = new Set([
  ...POISON,
  4120005,
  4220005,
  14110004,
  4121004,
  4221004,
]);

export function statusFamily(id) {
  if (STUN.has(id)) return "stun";
  if (FREEZE.has(id)) return "freeze";
  if (SEAL.has(id)) return "seal";
  if (SLOW.has(id)) return "speed";
  if (POISON.has(id)) return "poison";
  if (WEB.has(id)) return "web";
  if (CRASH.has(id)) return "sealSkill";
  return SINGLE_STATUS_FAMILIES[id] ?? null;
}

export function createMobSkillStatus(info) {
  return {
    remaining: new Float64Array(STATUS_COUNT),
    values: new Float64Array(STATUS_COUNT),
    sources: new Int32Array(STATUS_COUNT),
    poisonMs: 0,
    venomStacks: 0,
    dotMs: new Float64Array(STATUS_COUNT),
    application: { duration: 0, source: 0 },
    presentation: { line: 0, critical: false, skillId: 0 },
    projected: { ...info, demonWeakness: null },
    changed: false,
  };
}

export function clearMobSkillStatus(mob) {
  const state = mob.skillStatus;
  state.remaining.fill(0);
  state.values.fill(0);
  state.sources.fill(0);
  state.dotMs.fill(0);
  state.poisonMs = 0;
  state.venomStacks = 0;
  projectMobSkillStatus(mob);
}

export function hasMobStatus(mob, name) {
  return mob.skillStatus.remaining[MOB_STATUS[name]] > 0;
}

/** Admitted value; caller-owned effect contains duration in ms and source skill ID. */
export function setMobStatus(mob, name, value, effect) {
  const index = MOB_STATUS[name];
  const { duration, source } = effect;
  if (!Number.isInteger(index) || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("Invalid admitted monster status");
  }
  const state = mob.skillStatus;
  state.remaining[index] = duration;
  state.values[index] = value;
  state.sources[index] = source;
  if (name === "poison" || name === "ambush") state.dotMs[index] = 0;
  if (name === "stun" || name === "freeze") {
    mob.pendingAttack = null;
    if (mob.state === "attack") {
      mob.state = "idle";
      mob.stateMs = 0;
    }
  }
  projectMobSkillStatus(mob);
}

/** Original elemAttr encodes pairs like I2F3; 0 normal,1 immune,2 strong,3 weak. */
export function elementalEffectiveness(info, element) {
  if (info.demonWeakness === element) return 3;
  const text = info.elemAttr ?? "";
  if (typeof element !== "string" || !element.length) return 0;
  const code = element.charCodeAt(0) | 32;
  for (let index = 0; index + 1 < text.length; index += 2) {
    if ((text.charCodeAt(index) | 32) === code) {
      return text.charCodeAt(index + 1) - 48;
    }
  }
  return 0;
}

function statusEligible(mob, skill, family) {
  if (!family || !mob.alive || mob.template.info.boss) return false;
  const effectiveness = elementalEffectiveness(
    mob.template.info,
    skill.properties.elemAttr ?? "n",
  );
  if (effectiveness === 1 || effectiveness === 2) return false;
  return family !== "poison" || mob.hp > 1;
}

function statusDuration(skill, info, context, family) {
  let duration = context.summon
    ? 4000
    : skillNumber(info.time, skillNumber(info.y)) * 1000;
  if (family === "freeze" && !context.summon) {
    duration *= 2;
    // Original5220001 rank strings: x=DOT percent, y=additional freeze seconds.
    if (skill.id === 5211005) {
      duration += skillNumber(context.elementalBoost?.y) * 1000;
    }
  }
  return duration;
}

function applyStatusFamily(mob, family, info, context) {
  const effect = mob.skillStatus.application;
  if (family === "weaken") {
    setMobStatus(mob, "watk", skillNumber(info.x), effect);
    setMobStatus(mob, "wdef", skillNumber(info.y), effect);
  } else if (family === "showdown") {
    const value = skillNumber(info.x);
    setMobStatus(mob, "showdown", value, effect);
    setMobStatus(mob, "wdef", value, effect);
    setMobStatus(mob, "mdef", value, effect);
  } else {
    let value =
      family === "ambush"
        ? Math.trunc(
            ((context.str + context.luk) * 3.7 * skillNumber(info.damage)) /
              100,
          )
        : statusValue(family, mob, info, context.rank);
    if (effect.source === 5211004) {
      value = Math.min(
        32767,
        Math.ceil(
          (value * (100 + skillNumber(context.elementalBoost?.x))) / 100,
        ),
      );
    }
    setMobStatus(mob, family, value, effect);
  }
}

export function applySkillStatus(mob, skill, info, context) {
  const family = statusFamily(skill.id);
  if (!statusEligible(mob, skill, family)) return false;
  if (
    skill.id !== 5211004 &&
    context.generator.next() % 100 >= skillNumber(info.prop, 100)
  ) {
    return false;
  }
  const duration = statusDuration(skill, info, context, family);
  if (family === "sealSkill") return clearMobBuffs(mob, skill.id);
  if (!(duration > 0)) return false;
  const effect = mob.skillStatus.application;
  effect.duration = duration;
  effect.source = skill.id;
  applyStatusFamily(mob, family, info, context);
  if (skill.id === 2121003 || skill.id === 2221003) {
    setMobStatus(mob, "demon", 1, effect);
  }
  return true;
}

function statusValue(family, mob, info, rank) {
  if (family === "speed" || family === "imprint") return skillNumber(info.x);
  if (family === "poison") {
    return Math.min(32767, Math.ceil(mob.maxHP / (70 - rank)));
  }
  if (family === "web") return Math.ceil(mob.maxHP / 50);
  return 1;
}

export function hasMobBuffs(mob) {
  const state = mob.skillStatus;
  for (const name of BUFF_STATS) {
    const index = MOB_STATUS[name];
    if (state.remaining[index] > 0 && state.values[index] > 0) return true;
  }
  return false;
}

export function clearMobBuffs(mob, skillId = 0) {
  const state = mob.skillStatus;
  let cleared = false;
  for (const name of BUFF_STATS) {
    const index = MOB_STATUS[name];
    if (!state.remaining[index] || state.values[index] <= 0) continue;
    if (skillId === 1111007 && name !== "wdef") continue;
    if (skillId === 1211009 && name !== "mdef") continue;
    if (skillId === 1311007 && name !== "watk") continue;
    state.remaining[index] = 0;
    state.values[index] = 0;
    cleared = true;
  }
  if (cleared) projectMobSkillStatus(mob);
  return cleared;
}

function adjusted(mob, field, status) {
  const base = mob.template.info[field] ?? 0;
  const index = MOB_STATUS[status];
  const value =
    mob.skillStatus.remaining[index] > 0 ? mob.skillStatus.values[index] : 0;
  return Math.max(0, Math.trunc((base * (100 + value)) / 100));
}

export function projectMobSkillStatus(mob) {
  const info = mob.skillStatus.projected;
  info.PADamage = adjusted(mob, "PADamage", "watk");
  info.PDDamage = adjusted(mob, "PDDamage", "wdef");
  info.MDDamage = adjusted(mob, "MDDamage", "mdef");
  info.acc = adjusted(mob, "acc", "accuracy");
  info.demonWeakness = hasMobStatus(mob, "demon")
    ? mob.skillStatus.sources[MOB_STATUS.demon] === 2121003
      ? "i"
      : "f"
    : null;
  const doom = hasMobStatus(mob, "doom") ? mob.skillStatus.doomInfo : null;
  for (const key of DOOM_FIELDS) if (doom) info[key] = doom[key] ?? 0;
  if (!doom) {
    info.level = mob.template.info.level;
    info.MADamage = mob.template.info.MADamage;
    info.eva = mob.template.info.eva;
  }
}

/** Called once per fixed quantum; poison cannot kill, expire before the next interval.
 * Presentation consumers copy synchronously; each mob reuses its DOT payload. */
export function stepMobSkillStatus(mob, ms, onDamage = null) {
  const state = mob.skillStatus;
  let dirty = false;
  for (const index of DOT_STATS) {
    if (state.remaining[index] <= 0) {
      state.dotMs[index] = 0;
      continue;
    }
    state.dotMs[index] += Math.min(ms, state.remaining[index]);
    if (state.dotMs[index] >= 1000) {
      state.dotMs[index] -= 1000;
      const amount = Math.max(0, Math.min(mob.hp - 1, state.values[index]));
      mob.hp -= amount;
      if (amount > 0) {
        state.presentation.skillId = state.sources[index];
        onDamage?.(mob, amount, state.presentation);
      }
    }
  }
  for (let index = 0; index < STATUS_COUNT; index++) {
    if (state.remaining[index] <= 0) continue;
    state.remaining[index] = Math.max(0, state.remaining[index] - ms);
    if (state.remaining[index]) continue;
    state.values[index] = 0;
    dirty = true;
  }
  if (!hasMobStatus(mob, "poison")) {
    state.poisonMs = 0;
    state.venomStacks = 0;
  }
  if (dirty) projectMobSkillStatus(mob);
}

export function mobSkillMovementScale(mob) {
  if (
    hasMobStatus(mob, "stun") ||
    hasMobStatus(mob, "freeze") ||
    hasMobStatus(mob, "web")
  ) {
    return 0;
  }
  const state = mob.skillStatus;
  return (
    Math.max(
      0,
      100 + (hasMobStatus(mob, "speed") ? state.values[MOB_STATUS.speed] : 0),
    ) / 100
  );
}
