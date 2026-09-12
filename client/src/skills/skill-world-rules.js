// Identities: original Skill.wz; movement types: Cosmic StatEffect1766..1795.
export const TELEPORT_SKILLS = new Set([2101002, 2201002, 2301001, 12101003]);
export const FLASH_SKILLS = new Set([4111006, 14101004]);
export const RUSH_SKILLS = new Set([1121006, 1221007, 1321003, 21100002]);
export const DASH_SKILLS = new Set([5001005, 15001003]);
export const DROP_SKILLS = new Set([1006, 10001006, 20001006]);
export const AREA_SKILLS = new Set([2111003, 4221006, 12111005]);
export const MORPH_SKILLS = new Set([
  5101007, 5111005, 5121003, 13111005, 15111002,
]);
export const RIDING_SKILLS = new Set([1004, 10001004, 20001004, 5221006]);
export const PUPPET_SKILLS = new Set([3111002, 3211002, 13111004]);
export const STATIONARY_SUMMONS = new Set([...PUPPET_SKILLS, 5211001, 5220002]);
export const CIRCLE_SUMMONS = new Set([
  3111005, 3211005, 2311006, 3221005, 3121006, 5211002,
]);
export const FOLLOW_SUMMONS = new Set([
  1321007, 2121005, 2221005, 2321003, 11001004, 12001004, 12111004, 13001004,
  14001005, 15001004,
]);
export const HELPER_SUMMONS = new Set([10001013, 20001013]);

export function summonMovement(id) {
  if (STATIONARY_SUMMONS.has(id)) return "stationary";
  if (CIRCLE_SUMMONS.has(id)) return "circle";
  if (FOLLOW_SUMMONS.has(id)) return "follow";
  return null;
}

function motionFamily(id) {
  if (TELEPORT_SKILLS.has(id)) return "teleport";
  if (FLASH_SKILLS.has(id) || id === 11101005 || id === 21001001) {
    return "impulse";
  }
  if (RUSH_SKILLS.has(id)) return "rush";
  if (id === 4211002) return "assault";
  if (id === 5201006) return "recoil";
  if (DASH_SKILLS.has(id)) return "dash";
  if (DROP_SKILLS.has(id)) return "drop";
  if (id === 5201005) return "wings";
  return null;
}

export function worldFamily(id) {
  const motion = motionFamily(id);
  if (motion) return motion;
  if (AREA_SKILLS.has(id)) return "area";
  if (MORPH_SKILLS.has(id) || RIDING_SKILLS.has(id)) return "form";
  if (id === 2311002) return "door";
  if (summonMovement(id) || HELPER_SUMMONS.has(id)) return "summon";
  return null;
}

/** Hidden acquisition never changes runtime ownership of a legitimately learned skill. */
export function classifyWorldSkill(record) {
  const family = worldFamily(record.id);
  if (!family) return null;
  const reason = HELPER_SUMMONS.has(record.id)
    ? "Original hidden helper event input and movement/interaction semantics are absent from supplied WZ and authorized Cosmic references"
    : null;
  return {
    activation: family === "drop" ? "passive" : family,
    supported: reason === null,
    reason,
    hooks: [family],
    owner: "world",
  };
}
