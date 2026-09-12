import { skillNumber } from "./skill-costs.js";
import { BALLISTIC_SKILLS } from "./skill-ballistic-rules.js";
import { TARGET_SKILLS } from "./skill-target-rules.js";

// Original Skill.wz + native00950921/009537d5/0095571f dispatch, not historical art buckets.
export const COMBAT_SKILLS = new Map();
function family(ids, kind, options = {}) {
  const spec = Object.freeze({ kind, ...options });
  for (const id of ids) COMBAT_SKILLS.set(id, spec);
}
family([1001004, 1001005, 11001002, 11001003], "melee");
family([1111003, 1111005], "finisher", { weapons: [30, 40] });
family([1111004, 1111006], "finisher", { weapons: [31, 41] });
family([11111002, 11111003], "finisher", { weapons: [30, 40] });
family(
  [
    1111008, 1121008, 1211002, 1221009, 1221011, 1311001, 1311002, 1311003,
    1311004, 1311005, 1311006, 11111004, 11111006, 4001334, 4201004, 4201005,
    4211004, 4221001, 4221007, 5001001, 5001002, 5101002, 5101003, 5111002,
    5111004, 5111006, 5121001, 5121004, 5121005, 5121007, 15001001, 15001002,
    15101005, 15111001, 15111003, 15111004, 21000002, 21100001, 21110003,
    21110006, 21110007, 21110008, 21120005, 21120006, 21120009, 21120010,
  ],
  "melee",
);
family([20000014, 20000015, 20000016, 13101005], "melee");
family(
  [
    2001004, 2001005, 2101004, 2101005, 2111002, 2111006, 2121003, 2121006,
    2121007, 2201004, 2201005, 2211002, 2211003, 2211006, 2221003, 2221006,
    2221007, 2301005, 2311004, 2321007, 2321008, 12001003, 12101002, 12101006,
    12111003, 12111006,
  ],
  "magic",
);
family([2301002], "heal");
family([1000, 10001000, 20001000], "fixed", { projectile: true });
family([1009, 10001009, 20001009, 1020, 10001020, 20001020], "event-percent");
family(
  [
    3001004, 3001005, 3101005, 3111003, 3111006, 3121003, 3201005, 3211003,
    3211006, 3221003, 3221007, 4001344, 4101005, 4111005, 4121007, 4121008,
    5001003, 5201004, 5210000, 5211006, 5220011, 5221003, 5221007, 5221008,
    13001003, 13111001, 13111006, 13111007, 14001004, 14111002, 14111005,
  ],
  "ranged",
  { ammunition: true, projectile: true },
);
family([11101004, 15111007, 21100004, 21110004, 5121002, 4111004], "ranged", {
  projectile: true,
});
family([3101003, 3201003], "knockback");
family(
  [
    4001002, 14001002, 1201006, 2101003, 2201003, 2111004, 2211004, 12101001,
    12111002, 4111003, 14111001, 4121003, 4221003, 1111007, 1211009, 1311007,
  ],
  "status",
);
family([4121004, 4221004], "status");
family([2121001, 2221001, 2321001], "charge", { chargeMs: 1000, magic: true });
family([3221001], "charge", {
  chargeMs: 1000,
  projectile: true,
  ammunition: true,
});
family([3121004, 13111002, 5221004], "continuous", {
  projectile: true,
  ammunition: true,
});
family([1121001, 1221001, 1321001], "magnet", { chargeMs: 1000 });

//00766867, consumed009545: these area/effect attacks do not launch weapon bullets.
family([3111004, 3211004, 5201001, 5211004, 5211005, 13111000], "ranged", {
  ammunition: true,
});
family([14101006], "ranged");

for (const registry of [BALLISTIC_SKILLS, TARGET_SKILLS]) {
  for (const [id, spec] of registry) {
    if (COMBAT_SKILLS.has(id)) {
      throw new Error(`Duplicate native combat skill ${id}`);
    }
    COMBAT_SKILLS.set(id, spec);
  }
}

export const COMBAT_PASSIVES = new Map();
function passive(ids, kind) {
  for (const id of ids) COMBAT_PASSIVES.set(id, kind);
}
passive(
  [1100002, 1100003, 1200002, 1200003, 1300002, 1300003, 3100001, 3200001],
  "final-attack",
);
passive([2100000, 2200000, 2300000], "mp-eater");
passive([4120005, 4220005, 14110004], "venom");
passive([1120004, 1220005, 1320005, 21120004], "achilles");
passive([1120005, 1220006], "guardian");
passive([4120002, 4220002], "shadow-shifter");
passive([2110001, 2210001, 12110001, 22150000], "element-amplification");
passive([1320006], "berserk");
passive([5110000], "stun-mastery");
passive([5110001, 15100004], "energy-charge");
passive(
  [21000000, 21110000, 20000017, 20000018, 21110002, 21120002],
  "aran-combo",
);
passive([1120003, 11110005], "advanced-combo");
passive([1220010], "advanced-charge");
passive([3110001, 3210001], "mortal-blow");
passive([14100005], "vanish");
passive([5220001], "elemental-boost");
passive([1310000, 2110000, 2210000, 2310000, 12110000], "element-resistance");

export function classifyCombatSkill(skill) {
  const passive = COMBAT_PASSIVES.get(skill.id);
  if (passive) {
    return {
      activation: "passive",
      supported: true,
      reason: null,
      hooks: [passive],
      owner: "combat",
    };
  }
  const spec = COMBAT_SKILLS.get(skill.id);
  if (!spec) return null;
  const hooks = [spec.kind];
  if (spec.ammunition) hooks.push("ammunition");
  return {
    activation:
      spec.kind === "continuous" ||
      spec.kind === "charge" ||
      spec.kind === "magnet"
        ? "channel"
        : "combat",
    supported: true,
    reason: null,
    hooks,
    owner: "combat",
  };
}

export function combatRankError(info, skill) {
  for (const key of [
    "damage",
    "damagepc",
    "mad",
    "fixdamage",
    "mobCount",
    "attackCount",
    "bulletCount",
    "prop",
    "time",
    "range",
  ]) {
    const value = skillNumber(info[key]);
    if (!Number.isFinite(value) || value < 0) return `Invalid original ${key}`;
  }
  return combatPacketError(info, skill);
}

function combatPacketError(info, skill) {
  const targets = skillNumber(info.mobCount, 1);
  const lines = Math.max(
    skillNumber(info.attackCount, 1),
    skillNumber(info.bulletCount, 1),
  );
  const targetLimit =
    skill && [1009, 10001009, 20001009].includes(skill.id) ? 30 : 15;
  if (!Number.isInteger(targets) || targets < 1 || targets > targetLimit) {
    return "Original target count exceeds packet bound";
  }
  const lineLimit = skill?.id === 4211006 ? 20 : 15;
  if (!Number.isInteger(lines) || lines < 1 || lines > lineLimit) {
    return "Original line count exceeds packet bound";
  }
  return null;
}
