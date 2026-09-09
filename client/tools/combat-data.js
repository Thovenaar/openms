import { at, resolveNode } from "../src/assets/image.js";
import { readRectangle } from "./hitbox-data.js";

const MAX_ACTIONS = 128;
const MAX_PROPERTIES = 32768;

/** Preserve original scalar inputs without assigning original damage semantics. */
function scalarFields(node) {
  const result = Object.create(null);
  const children = Object.entries(resolveNode(node).children);
  if (children.length > MAX_PROPERTIES) {
    throw new Error("Combat metadata limit");
  }
  for (const [key, child] of children) {
    const resolved = resolveNode(child);
    if (resolved.value !== undefined) result[key] = resolved.value;
  }
  return result;
}

/** Starter weapon selection is local; its afterimage and rectangles are original. */
export function extractCombat(context) {
  const weaponPath = "Weapon/01302000.img";
  const equipment = scalarFields(
    at(context.image("Character", weaponPath), "info"),
  );
  const afterimagePath = `Afterimage/${equipment.afterImage}.img`;
  const source = `Character.wz:${afterimagePath}`;
  const root = at(context.image("Character", afterimagePath), "0");
  const children = Object.entries(root.children);
  if (children.length > MAX_ACTIONS) throw new Error("Weapon action limit");
  const attacks = Object.create(null);
  for (const [name, child] of children) {
    const node = resolveNode(child);
    if (!node.children.lt || !node.children.rb) continue;
    attacks[name] = { rectangle: readRectangle(node, `${source}/0/${name}`) };
  }
  const octoSkill = at(context.image("Skill", "500.img"), "skill/5001003");
  return {
    schemaVersion: 1,
    weaponId: 1302000,
    source: `Character.wz:${weaponPath}/info`,
    equipment,
    attacks,
    defaultAction: "swingO1",
    proneAction: "proneStab",
    capabilities: {
      basicAttack: "local timing/damage; original equipped swordOL geometry",
      skills:
        "learned SkillSystem: catalog-classified sword attacks, self-stat buffs and passive consumers; unrecovered controllers remain unavailable",
      projectile:
        "unavailable: ranged weapon/ammunition not equipped; 009537d5/0095571f trajectory/hit phases unresolved",
      summon:
        "unavailable: no learned summon skill or authoritative summon controller; artwork alone never spawns actors",
      mobProjectile:
        "type 1/2 and type 3/4 geometry/controller dependencies unresolved at 0066d9c0",
      scripts:
        "server skill/event scripts not supplied; retained metadata is not executable code",
      drops:
        "unavailable: original server drop tables/ownership not supplied; no synthetic drops",
      restrictedSkill5001003: {
        source: "Skill.wz:500.img/skill/5001003/level/1",
        levelOne: scalarFields(at(octoSkill, "level/1")),
        status:
          "not learned/equipped; selected-skill-only mobs reject basic sword damage",
      },
      experienceTable:
        "not recovered from retained original consumers or Etc inventory; explicit local quadratic progression",
    },
  };
}
