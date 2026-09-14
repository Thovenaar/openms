import { FLASH_SKILLS } from "../skills/skill-world-rules.js";

/** Client mirror of the recovered movement-skill impulse
 *  (`SkillWorldController.impulse`, client/src/skills/skill-world-controller.js).
 *  The online predictor replays it locally; the next authoritative checkpoint
 *  overrides it, so a refused cast rolls back without a server round trip in the way. */
export function optimisticSkillImpulse(skillId, info, rank, facing) {
  if (!Number.isSafeInteger(facing) || facing === 0) return null;
  if (skillId === 21001001) {
    return { kind: "impulse", vx: facing * Number(info?.x ?? 0), vy: 0 };
  }
  if (skillId !== 11101005 && !FLASH_SKILLS.has(skillId)) return null;
  const level = skillId === 11101005 ? rank * 2 : rank;
  const step = Math.trunc(level / 4);
  return {
    kind: "impulse",
    vx: facing * (350 + step * 40),
    vy: -(250 + step * 20),
  };
}

function learnedRank(profile, skillId) {
  return profile?.skills?.[skillId]?.level ?? 0;
}

/** Resolve the learned rank, its authored info and facing for an observed cast. */
export function skillImpulseFor(profile, catalog, scene, skillId) {
  const rank = learnedRank(profile, skillId);
  const levels = catalog?.ui?.skills?.[skillId]?.levels;
  if (rank <= 0 || !levels) return null;
  return optimisticSkillImpulse(
    skillId,
    levels[rank] ?? null,
    rank,
    facing(scene),
  );
}

function facing(scene) {
  return scene?.simulation?.facing ?? 0;
}
