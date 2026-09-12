import { at, resolveNode } from "../src/assets/image.js";
import { fields } from "./life-data.js";

/** Incoming diseases use the same original Skill.wz MobSkill ranks as authorized Cosmic. */
export function extractSkillCombat(context) {
  const root = context.image("Skill", "MobSkill.img");
  const mobSkills = Object.create(null);
  const entries = Object.entries(resolveNode(root).children);
  if (entries.length > 256) {
    throw new Error("Original monster skill bound exceeded");
  }
  for (const [id, node] of entries) {
    if (!/^\d+$/.test(id)) continue;
    const levels = at(node, "level");
    const rows = Object.entries(resolveNode(levels).children);
    if (rows.length > 256) {
      throw new Error("Original monster skill rank bound exceeded");
    }
    const ranks = Object.create(null);
    for (const [rank, level] of rows) {
      if (!/^\d+$/.test(rank)) continue;
      ranks[rank] = fields(level);
    }
    mobSkills[id] = ranks;
  }
  return { mobSkills, source: "Skill.wz:MobSkill.img/{skill}/level/{rank}" };
}
