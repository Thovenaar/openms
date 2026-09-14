import { expect, test } from "bun:test";
import { SkillChain } from "../src/skills/skill-chain.js";
import { SkillAttack } from "../src/skills/skill-attack.js";
import {
  applySkillStatus,
  createMobSkillStatus,
  MOB_STATUS,
  stepMobSkillStatus,
} from "../src/combat/mob-skill-status.js";

function mob(x, y = 0) {
  const info = { elemAttr: "", boss: 0 };
  return {
    x,
    y,
    alive: true,
    active: true,
    deaths: 0,
    selectedSkills: [],
    hp: 40000,
    maxHP: 40000,
    template: { info },
    skillStatus: createMobSkillStatus(info),
    body: { left: x - 1, right: x + 1, top: y - 30, bottom: y, active: true },
  };
}

function chain(mobs) {
  const combat = {
    field: { mobs },
    targets: new Array(15),
    body: {},
    eligible: SkillAttack.prototype.eligible,
  };
  return new SkillChain(combat);
}

const SPARK = { skill: { id: 15111006 }, info: { range: 150, mobCount: 6 } };
const LIGHTNING = { skill: { id: 2221006 }, info: { mobCount: 6 } };
const ORIGIN = { x: 0, y: 0, facing: 1 };

test("Spark anchors the400px cap on the first secondary, not the excluded primary", () => {
  const primary = mob(0);
  const targets = [mob(149), mob(298), mob(447), mob(546), mob(600)];
  const controller = chain([primary, ...targets]);
  const count = controller.select(SPARK, ORIGIN, primary);
  expect(controller.combat.targets.slice(0, count)).toEqual(
    targets.slice(0, 4),
  );
});

test("Spark first target follows native enumeration, subsequent equal distances keep enumeration order", () => {
  const first = mob(100),
    near = mob(50),
    upper = mob(150, -20),
    lower = mob(150, 20);
  const controller = chain([first, near, upper, lower]);
  const count = controller.select(SPARK, ORIGIN);
  expect(controller.combat.targets.slice(0, count)).toEqual([
    first,
    upper,
    lower,
  ]);
});

test("Previous target is excluded before native ten-candidate counting, but other visited targets count", () => {
  const previous = mob(150);
  const visited = Array.from({ length: 9 }, () => mob(150));
  const last = mob(200),
    beyondCap = mob(151);
  const controller = chain([previous, ...visited, last, beyondCap]);
  for (let index = 0; index < visited.length; index++) {
    controller.combat.targets[index] = visited[index];
  }
  controller.combat.targets[9] = previous;
  expect(
    controller.next(SPARK, ORIGIN, previous, {
      excluded: null,
      count: 10,
      range: 150,
    }),
  ).toBe(last);
});

test("Chain Lightning acquires its first target with the widening native ray then traverses elevated hops", () => {
  const behind = mob(-100),
    close = mob(20),
    immune = mob(80),
    first = mob(120, -40);
  immune.template.info.invincible = 1;
  const next = mob(250, -150),
    final = mob(380, -260),
    out = mob(540, -260);
  const controller = chain([behind, close, immune, first, next, final, out]);
  const count = controller.select(LIGHTNING, ORIGIN);
  expect(controller.combat.targets.slice(0, count)).toEqual([
    first,
    next,
    final,
  ]);
  next.selectedSkills = [123];
  expect(controller.select(LIGHTNING, ORIGIN)).toBe(1);
});

test("Chain Lightning mirrors native first acquisition and hop direction", () => {
  const first = mob(-120, -40),
    next = mob(-250, -150),
    wrong = mob(120, -40);
  const controller = chain([wrong, first, next]);
  const count = controller.select(LIGHTNING, { x: 0, y: 0, facing: -1 });
  expect(controller.combat.targets.slice(0, count)).toEqual([first, next]);
});

test("Elemental Boost y extends freeze while x increases Flamethrower DOT, not duration", () => {
  const context = {
    rank: 30,
    dotDamage: 1000,
    elementalBoost: { x: 5, y: 2 },
    generator: { next: () => 0 },
  };
  const ice = mob(0),
    fire = mob(0);
  applySkillStatus(
    ice,
    { id: 5211005, properties: { elemAttr: "i" } },
    { time: 3 },
    context,
  );
  expect(ice.skillStatus.remaining[MOB_STATUS.freeze]).toBe(8000);
  applySkillStatus(
    fire,
    { id: 5211004, properties: { elemAttr: "f" } },
    { time: 3 },
    context,
  );
  stepMobSkillStatus(fire, 999);
  expect(fire.hp).toBe(40000);
  stepMobSkillStatus(fire, 1);
  expect(fire.hp).toBe(38950);
  stepMobSkillStatus(fire, 1000);
  stepMobSkillStatus(fire, 1000);
  expect(fire.hp).toBe(36850);
  stepMobSkillStatus(fire, 1000);
  expect(fire.hp).toBe(36850);
});

test("Flamethrower applies precomputed modern DOT to resistant targets and bosses", () => {
  const context = {
    rank: 30,
    dotDamage: 1000,
    generator: {
      next() {
        throw new Error("Flamethrower has no authored chance roll");
      },
    },
  };
  const skill = { id: 5211004, properties: { elemAttr: "f" } };
  const target = mob(0);
  target.template.info.elemAttr = "F2";
  expect(applySkillStatus(target, skill, { time: 3 }, context)).toBe(true);
  target.template.info.elemAttr = "";
  target.template.info.boss = 1;
  expect(applySkillStatus(target, skill, { time: 3 }, context)).toBe(true);
  target.template.info.boss = 0;
  target.hp = 2;
  applySkillStatus(target, skill, { time: 3 }, context);
  stepMobSkillStatus(target, 1000);
  expect(target.hp).toBe(1);
  stepMobSkillStatus(target, 1000);
  expect(target.hp).toBe(1);
});

test("Chain Lightning applies staged damage once and rejects a respawned target identity", () => {
  const first = mob(120),
    second = mob(250),
    third = mob(380);
  const field = {
    hooks: {},
    simulation: ORIGIN,
    combat: { weaponType: 37 },
    damageGenerator: { next: () => 0 },
    damageTarget(target, amount) {
      target.hp = Math.max(0, target.hp - amount);
    },
  };
  const combat = new SkillAttack(field);
  const record = {
    skill: { id: 2221006, properties: {} },
    rank: 1,
    info: { mad: 103 },
    spec: { kind: "magic" },
  };
  combat.targets[0] = first;
  combat.targets[1] = second;
  combat.targets[2] = third;
  for (let index = 0; index < 3; index++) {
    const shot = combat.reserveShot(record, combat.targets[index], ORIGIN);
    combat.chain.stage(shot, index, ORIGIN);
    shot.count = 1;
    shot.damage[0] = 100;
    if (!shot.delay) combat.launchShot(shot);
  }
  expect([first.hp, second.hp, third.hp]).toEqual([39900, 40000, 40000]);
  combat.step(99);
  expect(second.hp).toBe(40000);
  combat.step(1);
  expect(second.hp).toBe(39900);
  third.deaths++;
  combat.step(100);
  expect(third.hp).toBe(40000);
  combat.step(1000);
  expect([first.hp, second.hp, third.hp]).toEqual([39900, 39900, 40000]);
});

test("Spark applies damage at cumulative twice-distance travel deadlines", () => {
  const first = mob(100),
    second = mob(200);
  const field = {
    hooks: {},
    simulation: ORIGIN,
    combat: { weaponType: 48 },
    damageGenerator: { next: () => 0 },
    damageTarget(target, amount) {
      target.hp = Math.max(0, target.hp - amount);
    },
  };
  const combat = new SkillAttack(field);
  const record = {
    skill: { id: 15111006, properties: {} },
    rank: 1,
    info: {},
    spec: { kind: "proc" },
  };
  combat.targets[0] = first;
  combat.targets[1] = second;
  for (let index = 0; index < 2; index++) {
    const shot = combat.reserveShot(record, combat.targets[index], ORIGIN);
    combat.chain.stage(shot, index, ORIGIN);
    shot.count = 1;
    shot.damage[0] = 100;
    if (!shot.delay) combat.launchShot(shot);
  }
  combat.step(151);
  expect([first.hp, second.hp]).toEqual([40000, 40000]);
  combat.step(1);
  expect([first.hp, second.hp]).toEqual([39900, 40000]);
  combat.step(199);
  expect(second.hp).toBe(40000);
  combat.step(1);
  expect(second.hp).toBe(39900);
});

test("Reapplying Flamethrower replaces the periodic deadline rather than inheriting a nearly due tick", () => {
  const target = mob(0);
  const context = { rank: 30, dotDamage: 1000, generator: { next: () => 0 } };
  const skill = { id: 5211004, properties: { elemAttr: "f" } };
  applySkillStatus(target, skill, { time: 3 }, context);
  stepMobSkillStatus(target, 999);
  applySkillStatus(target, skill, { time: 3 }, context);
  stepMobSkillStatus(target, 1);
  expect(target.hp).toBe(40000);
  stepMobSkillStatus(target, 999);
  expect(target.hp).toBe(39000);
});

test("Chain Lightning honors an eligible Homing Beacon mark before the ordinary ray, without retaining respawn identity", () => {
  const near = mob(100),
    marked = mob(240);
  const controller = chain([near, marked]);
  controller.combat.homing = marked;
  controller.combat.homingGeneration = marked.deaths;
  expect(controller.select(LIGHTNING, ORIGIN)).toBe(1);
  expect(controller.combat.targets[0]).toBe(marked);
  marked.deaths++;
  expect(controller.select(LIGHTNING, ORIGIN)).toBe(2);
  expect(controller.combat.targets[0]).toBe(near);
});
