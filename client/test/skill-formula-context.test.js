import { expect, test } from "bun:test";
import { SkillAttack } from "../src/skills/skill-attack.js";
import { SkillTargetController } from "../src/skills/skill-target-controller.js";
import { PhysicalDamage } from "../src/combat/physical-damage.js";
import {
  createMobSkillStatus,
  MOB_STATUS,
} from "../src/combat/mob-skill-status.js";

function fixture(magic) {
  const weaponId = magic ? 1372000 : 1332000;
  const info = { level: 50, acc: 0, elemAttr: "" };
  const mob = {
    id: "target",
    x: 0,
    y: 0,
    hp: 10000,
    maxHP: 10000,
    alive: true,
    active: true,
    deaths: 0,
    selectedSkills: [],
    template: { info },
    skillStatus: createMobSkillStatus(info),
    body: { active: true, left: -10, right: 10, top: -20, bottom: 0 },
  };
  const profile = {
    job: magic ? 200 : 420,
    level: 50,
    str: 10,
    dex: 20,
    int: 100,
    luk: 100,
    hp: 50,
    maxHP: 50,
    maxMP: 50,
    skills: {},
    inventory: [],
    equipment: [{ id: weaponId, slot: -11 }],
  };
  const field = {
    mobs: [mob],
    byId: new Map([[mob.id, mob]]),
    simulation: { x: 0, y: 0, facing: 1 },
    combat: { weaponType: magic ? 37 : 33 },
    store: { profile },
    damageGenerator: new PhysicalDamage(Math.random, () => 9999999),
    hooks: {
      items: { [weaponId]: { info: { incPAD: 100, incMAD: 100 } } },
      skillLevel: () => 0,
      skillInfo: () => null,
    },
  };
  return { field, mob, combat: new SkillAttack(field) };
}

test("Poison Mist prepares modern stats on its first area tick", () => {
  const { combat, mob } = fixture(true);
  const skill = { id: 2111003, properties: { elemAttr: "s" } };
  const info = {
    dot: 200,
    time: 3,
    lt: { x: -30, y: -30 },
    rb: { x: 30, y: 30 },
  };
  combat.prepareExternal(skill, info, 1);
  expect(
    combat.external(skill, info, { kind: "area", x: 0, y: 0, facing: 1 }),
  ).toBe(1);
  // Wand 1.2 * (INT100*4+LUK100) * MAD100/100 * DOT200%.
  expect(mob.skillStatus.values[MOB_STATUS.poison]).toBe(1200);
});

test("Meso Explosion prepares modern stats before its first pile hit", () => {
  const { field, mob, combat } = fixture(false);
  const hits = [];
  combat.resolve = (shot) => hits.push(shot.damage[0]);
  const controller = {
    field,
    mobs: [mob],
    pending: true,
    count: 1,
    piles: [{ x: 0, y: 0, quantity: 1000 }],
  };
  const skill = { id: 4211006, properties: {} };
  expect(
    SkillTargetController.prototype.handleImpact.call(
      controller,
      { skill, info: { x: 200, mobCount: 1 }, rank: 1, spec: { kind: "meso" } },
      combat,
    ),
  ).toBe(true);
  expect(hits).toEqual([1229]);
  expect(controller.pending).toBe(false);
});
