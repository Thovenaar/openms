export const PET_LEAD_SKILLS = Object.freeze([8, 10000018, 20000024]);
export const LEGENDARY_SPIRIT_SKILLS = Object.freeze([
  1003, 10001003, 20001003,
]);
export const HERO_WILL_SKILLS = Object.freeze([
  1121011, 1221012, 1321010, 2121008, 2221008, 2321009, 3121009, 3221008,
  4121009, 4221008, 5121008, 5221010, 21121008,
]);

export function utilityFamily(id) {
  if (PET_LEAD_SKILLS.includes(id)) return "pet-lead";
  if (LEGENDARY_SPIRIT_SKILLS.includes(id)) return "enhancement";
  if (HERO_WILL_SKILLS.includes(id)) return "will";
  if (id === 2311001) return "dispel";
  if (id === 2321006) return "resurrection";
  if (id === 5121010) return "time-leap";
  if (id === 5101005) return "mp-recovery";
  if (id === 4211001) return "chakra";
  return null;
}

/** Hidden acquisition is not an activation gate; original disabled/GM gates precede this owner. */
export function classifyUtilitySkill(skill) {
  const family = utilityFamily(skill.id);
  if (!family) return null;
  return {
    activation: family === "pet-lead" ? "passive" : "utility",
    supported: true,
    reason: null,
    hooks: [family],
    owner: "utility",
  };
}
