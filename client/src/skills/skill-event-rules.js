export const DOJO_SKILLS = Object.freeze([
  1009, 1010, 1011, 10001009, 10001010, 10001011, 20001009, 20001010, 20001011,
]);
export const PYRAMID_SKILLS = Object.freeze([1020, 10001020, 20001020]);

export function eventSkillFamily(id) {
  if (DOJO_SKILLS.includes(id)) return "dojo";
  if (PYRAMID_SKILLS.includes(id)) return "pyramid";
  return null;
}

/** Authorized Cosmic MapId179..180,234..235; original field-type whitelist00587f5f agrees. */
export function eventMapFamily(mapId) {
  if (mapId >= 925020000 && mapId <= 925033804) return "dojo";
  if (mapId >= 926010100 && mapId <= 926023500) return "pyramid";
  return null;
}

export function eventFieldAllows(family, fieldType) {
  return family === "dojo"
    ? fieldType === 14 || fieldType === 18
    : fieldType === 23;
}

/** Original007616f6 gives event skills rank1; map and job authorization remain separate gates. */
export function eventSkillRank(id, job, mapId, fieldType) {
  const family = eventSkillFamily(id);
  if (!family || family !== eventMapFamily(mapId)) return 0;
  if (!eventFieldAllows(family, fieldType)) return 0;
  return Math.trunc(id / 10000000) === Math.trunc(job / 1000) ? 1 : 0;
}
