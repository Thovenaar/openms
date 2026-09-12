// Original Skill.wz IDs; Cosmic StatEffect.loadFromData status switch495..835.
// Values name actual consumer units, not the old catalog's artwork-based buckets.
export const STATE_SKILLS = new Map();
function family(ids, name, fields, weapons = null) {
  const spec = Object.freeze({ family: name, fields, weapons });
  for (const id of ids) STATE_SKILLS.set(id, spec);
}
family([1001, 10001001, 20001001], "periodic-recovery", { recovery: "x" });
family([1010, 10001010, 20001010], "event-invincibility", { divineBody: "x" });
family([1011, 10001011, 20001011], "event-power-explosion", {
  berserkFury: "x",
});
family(
  [
    1002, 10001002, 20001002, 1001003, 11001001, 2001003, 12001002, 1101006,
    11101003, 1301006, 2101001, 2201001, 12101000, 3001003, 13001002, 2301004,
    4101004, 4201003, 14101003,
  ],
  "derived-stats",
  {},
);
family([2001002, 12001001], "magic-guard", { magicGuard: "x" });
family([1121002, 1221002, 1321002, 21121003], "stance", { stance: "prop" });
family([4001003, 14001003], "dark-sight", {
  darkSight: "x",
  darkSightSpeed: "speed",
});
family([13101006], "dark-sight", {
  darkSight: "x",
  darkSightSpeed: "speed",
  windWalk: "damage",
});
family([1101004, 1201004, 11101001], "booster", { booster: "x" }, [30, 40]);
family([1101005], "booster", { booster: "x" }, [31, 41]);
family([1201005], "booster", { booster: "x" }, [32, 42]);
family([1301004], "booster", { booster: "x" }, [43]);
family([1301005, 21001003], "booster", { booster: "x" }, [44]);
family([2111005, 2211005, 12101004], "booster", { booster: "x" }, [37, 38]);
family([3101002, 13101001], "booster", { booster: "x" }, [45]);
family([3201002], "booster", { booster: "x" }, [46]);
family([4101003, 14101002], "booster", { booster: "x" }, [47]);
family([4201002], "booster", { booster: "x" }, [33]);
family([5101006, 15101002], "booster", { booster: "x" }, [48]);
family([5201003], "booster", { booster: "x" }, [49]);
family([5121009, 15111005], "speed-infusion", { speedInfusion: "x" });
family([1101007, 1201007], "power-guard", { powerGuard: "x" });
family([1301007], "hyper-body", { hyperBodyHP: "x", hyperBodyMP: "y" });
family([1311008], "dragon-blood", { dragonBlood: "x" });
family([1111002, 11111001], "combo", { combo: 1 });
family([1121010], "enrage", { enrage: 1 });
family(
  [1211003, 1211005, 1211007, 1221003, 11111007],
  "charge",
  { charge: "id" },
  [30, 40],
);
family(
  [1211004, 1211006, 1211008, 1221004],
  "charge",
  { charge: "id" },
  [32, 42],
);
family([15101006], "charge", { charge: "id" }, [48]);
family([21111005], "charge", { charge: "id" }, [44]);
family([11101002, 13101002], "final-attack", { finalAttack: "id" });
family([2121002, 2221002, 2321002], "mana-reflection", {
  manaReflection: "id",
});
family([2121004, 2221004, 2321004], "infinity", { infinity: "x" });
family([2301003], "invincible", { invincible: "x" });
family([2311003], "holy-symbol", { holySymbol: "x" });
family([2321005], "holy-shield", { holyShield: "x" });
family([12101005], "elemental-reset", { elementalReset: "x" });
family([3101004, 13101003], "soul-arrow", { soulArrow: "x" }, [45]);
family([3201004], "soul-arrow", { soulArrow: "x" }, [46]);
family([3121002, 3221002], "sharp-eyes", { sharpEyes: "packed" });
family([3121007], "hamstring", { hamstring: "id" });
family([3221006], "blind", { blind: "id" });
family([3121008], "concentrate", { concentrate: "x" });
family([4111001], "meso-up", { mesoUp: "x" });
family([4111002, 14111000], "shadow-partner", {
  shadowPartner: "x",
  shadowPartnerSkill: "y",
});
family([4121006], "shadow-stars", { shadowStars: 1 }, [47]);
family([4211003], "pickpocket", { pickpocket: "id" });
family([4211005], "meso-guard", { mesoGuard: "x" });
family([15111006], "spark", { spark: "id" });
family([21100005], "combo-drain", { comboDrain: "x" }, [44]);
family([21120007], "combo-barrier", { comboBarrier: "x" }, [44]);
family([21111001], "smart-knockback", { smartKnockback: "x" });
family([21101003], "body-pressure", { bodyPressure: "id" });
family([1005, 10001005, 20001005], "echo", { echo: "x" });
family(
  [
    1121000, 1221000, 1321000, 2121000, 2221000, 2321000, 3121000, 3221000,
    4121000, 4221000, 5121000, 5221000, 21121000,
  ],
  "maple-warrior",
  { mapleWarrior: "x" },
);

export const STATE_PASSIVES = new Map();
function passive(ids, name) {
  for (const id of ids) STATE_PASSIVES.set(id, name);
}
passive(
  [1000000, 1000002, 2000000, 1110000, 1210000, 11110000, 4100002, 4200001],
  "natural-recovery",
);
passive(
  [1000001, 11000000, 2000001, 12000000, 5100000, 15100000],
  "vital-growth",
);
passive(
  [
    1100000, 1100001, 1200000, 1200001, 1300000, 1300001, 11100000, 21100000,
    21120001, 3100000, 3200000, 4100000, 4200000, 5100001, 5200000, 13100000,
    14100000, 15100001, 3120005, 3220004, 13110003,
  ],
  "weapon-mastery",
);
passive([1110001, 1210001, 4210000], "shield-mastery");
passive([3000000, 4000000, 14000000, 5000000, 15000000], "accuracy-evasion");
passive([3000001, 13000000, 4100001, 14100001, 15110000], "critical");
passive([3000002, 13000001, 4000001, 14000001], "projectile-range");
passive([3110000, 3210000, 13100004], "passive-speed");
passive([1320008, 1320009], "beholder-schedule");
passive([4110000, 14110003], "item-alchemy");

/** Complete record in; original permission gates are checked by the catalog owner first. */
export function classifyStateSkill(skill) {
  const spec = STATE_SKILLS.get(skill.id);
  const name = spec?.family ?? STATE_PASSIVES.get(skill.id);
  if (!name) return null;
  return {
    activation: spec ? "self-buff" : "passive",
    supported: true,
    reason: null,
    hooks: [name],
    owner: "state",
  };
}
