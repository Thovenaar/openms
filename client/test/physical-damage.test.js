import { expect, test } from "bun:test";
import { PhysicalDamage } from "../src/combat/physical-damage.js";
import {
  createCharacterStats,
  projectCharacterStats,
} from "../src/character/character-stats.js";

// Original starter PAD17 and Red Snail level4/PDD3; character inputs isolate arithmetic.
const SNAIL = Object.freeze({ level: 4, PDDamage: 3, eva: 0 });
const HECTOR = Object.freeze({ level: 55, PDDamage: 120, eva: 20 });
function swordStats(overrides = {}) {
  return {
    level: 1,
    str: 12,
    dex: 5,
    pad: 17,
    acc: 6,
    mastery: 0,
    weaponType: 30,
    damageSupported: true,
    ...overrides,
  };
}

function replay(values) {
  let index = 0;
  const source = new PhysicalDamage(Math.random, () => {
    if (index >= values.length) throw new Error("Replay exhausted");
    return values[index++];
  });
  return source;
}

function profileFixture() {
  const items = {
    1302000: { info: { incPAD: 17 } },
    1002000: {
      info: { incSTR: 3, incDEX: 2, incLUK: 1, incACC: 2, incPAD: 4 },
    },
  };
  const profile = {
    level: 1,
    job: 0,
    str: 12,
    dex: 5,
    int: 4,
    luk: 4,
    maxHP: 50,
    maxMP: 5,
    inventory: [],
    equipment: [
      { uid: "sword", id: 1302000, count: 1, slot: -11 },
      { uid: "hat", id: 1002000, count: 1, slot: -1 },
    ],
  };
  const learned = {};
  const temporary = { pad: 10, acc: 4 };
  const hooks = {
    items,
    derivedStats: () => temporary,
    skillLevel: (id) => (learned[id] ? 1 : 0),
    skillInfo: (id) => learned[id] ?? null,
  };
  return { profile, hooks, learned, temporary };
}

test("starter sword mastery range permits zero and never the old inflated one-hit kill", () => {
  const source = replay([0, 0, 0, 0, 0, 0, 0, 0, 0, 9999999, 0, 0, 0, 0]);
  const stats = swordStats();
  expect(source.generate(stats, SNAIL)).toBe(0);
  expect(source.generate(stats, SNAIL)).toBe(7);
});

test("accuracy uses its reserved slot and consumes the seven-word window even on MISS", () => {
  const source = replay([
    9999999, 0, 9999999, 0, 0, 0, 0, 0, 9999999, 9999999, 0, 0, 0, 0,
  ]);
  const stats = swordStats({ level: 4 });
  const evasive = { ...SNAIL, eva: 2 };
  expect(source.generate(stats, evasive)).toBe(0);
  expect(source.lastOutcome).toBe("accuracy-miss");
  expect(source.generate(stats, evasive)).toBe(7);
});

test("defense precedes skill percentage and learned raw mastery changes the lower bound", () => {
  const source = replay(new Array(14).fill(0));
  const stats = swordStats({ level: 55, str: 100, dex: 20, pad: 50, acc: 999 });
  expect(source.generate(stats, HECTOR, 165)).toBe(-52);
  stats.mastery = 9;
  expect(source.generate(stats, HECTOR, 165)).toBe(80);
});

test("independent defense rolls and native level penalty may produce nonpositive lines", () => {
  const source = replay([
    0, 0, 9999999, 0, 0, 0, 0, 0, 0, 9999999, 9999999, 0, 0, 0,
  ]);
  const stats = swordStats({ level: 55, str: 125, dex: 5, acc: 999 });
  expect(source.generate(stats, HECTOR)).toBe(25);
  expect(source.generate(stats, HECTOR)).toBe(13);
  const distant = new PhysicalDamage(() => 0);
  expect(
    distant.generate(swordStats({ str: 100, dex: 20, pad: 500 }), {
      level: 102,
      PDDamage: 0,
      eva: 0,
    }),
  ).toBe(-2);
});

test("equipment instances, temporary contributions and learned mastery are counted once per projection", () => {
  const { profile, hooks, learned, temporary } = profileFixture();
  const stats = createCharacterStats();
  projectCharacterStats(profile, hooks, stats);
  const source = new PhysicalDamage(Math.random, () => 9999999);
  expect(source.generate(stats, SNAIL)).toBe(18);
  expect(stats.acc).toBe(14);
  learned[1100000] = { mastery: 9, x: 3 };
  projectCharacterStats(profile, hooks, stats);
  expect(stats.acc).toBe(17);
  const lower = new PhysicalDamage(() => 0);
  expect(lower.generate(stats, SNAIL)).toBe(9);
  temporary.pad = 0;
  projectCharacterStats(profile, hooks, stats);
  expect(source.generate(stats, SNAIL)).toBe(11);
  expect(profile.str).toBe(12);
});

test("ranged mastery and projectile PAD do not leak into the close-range fallback", () => {
  const source = new PhysicalDamage(() => 0);
  const stats = swordStats({
    weaponType: 45,
    level: 4,
    str: 100,
    dex: 200,
    pad: 110,
    mastery: 9,
    projectilePAD: 10,
    padWithoutProjectile: 100,
  });
  const target = { level: 4, PDDamage: 0, eva: 0 };
  expect(
    source.generate(stats, target, 100, {
      action: "shoot1",
      ranged: true,
      projectilePAD: 10,
    }),
  ).toBe(480);
  expect(
    source.generate(stats, target, 100, {
      action: "swingT1",
      ranged: false,
      projectilePAD: 0,
    }),
  ).toBe(107);
});

test("dagger job primary and spear/polearm action coefficients remain distinct", () => {
  const source = new PhysicalDamage(() => 0);
  const stats = swordStats({
    level: 4,
    str: 100,
    dex: 200,
    luk: 300,
    pad: 100,
    projectilePAD: 0,
    padWithoutProjectile: 100,
  });
  const target = { level: 4, PDDamage: 0, eva: 0 };
  stats.weaponType = 33;
  stats.job = 400;
  expect(source.generate(stats, target)).toBe(397);
  stats.job = 100;
  expect(source.generate(stats, target)).toBe(236);
  const use = { action: "swingT2", ranged: false, projectilePAD: 0 };
  stats.weaponType = 43;
  expect(source.generate(stats, target, 100, use)).toBe(227);
  stats.weaponType = 44;
  expect(source.generate(stats, target, 100, use)).toBe(245);
  use.action = "stabT1";
  expect(source.generate(stats, target, 100, use)).toBe(227);
});

test("capped PAD does not debit projectile attack a second time from a melee fallback", () => {
  const { profile, hooks, temporary } = profileFixture();
  profile.level = 10;
  profile.job = 400;
  profile.luk = 300;
  profile.equipment[0].id = 1472000;
  hooks.items[1472000] = { info: { incPAD: 1999 } };
  hooks.items[2070000] = { info: { incPAD: 15, reqLevel: 10 } };
  temporary.pad = 0;
  const source = new PhysicalDamage(() => 0);
  const use = { action: "stabO1", ranged: false, projectilePAD: 0 };
  const stats = projectCharacterStats(profile, hooks, createCharacterStats());
  const withoutStars = source.generate(stats, SNAIL, 100, use);
  profile.inventory.push({ uid: "stars", id: 2070000, count: 1, slot: 1 });
  projectCharacterStats(profile, hooks, stats);
  expect(source.generate(stats, SNAIL, 100, use)).toBe(withoutStars);
});

test("incoming physical EVA uses four-word windows and integer half-level penalties", () => {
  const source = replay([4900000, 9999999, 9999999, 9999999, 4900000, 0, 0, 0]);
  const stats = { level: 9, job: 0, eva: 45 };
  const info = { level: 10, acc: 20 };
  expect(source.evades(stats, info)).toBe(true);
  stats.level = 8;
  expect(source.evades(stats, info)).toBe(false);
});

test("incoming physical EVA retains native lower bounds for zero-over-zero", () => {
  const source = replay([200000, 0, 0, 0, 400000, 0, 0, 0]);
  const stats = { level: 1, job: 0, eva: 0 };
  const info = { level: 1, acc: 0 };
  expect(source.evades(stats, info)).toBe(false);
  stats.job = 1400;
  expect(source.evades(stats, info)).toBe(true);
});

test("incoming physical EVA caps ordinary and thief branches independently", () => {
  const source = replay([8500000, 0, 0, 0, 8500000, 0, 0, 0]);
  const stats = { level: 1, job: 0, eva: 999 };
  const info = { level: 1, acc: 1 };
  expect(source.evades(stats, info)).toBe(false);
  stats.job = 400;
  expect(source.evades(stats, info)).toBe(true);
});

test("incoming magnitude uses squared attack and matching defense instead of PAD divided by20", () => {
  const stats = {
    level: 1,
    job: 0,
    str: 0,
    dex: 0,
    int: 0,
    luk: 0,
    eva: 0,
    pdd: 0,
    mdd: 0,
  };
  // Controlled defense baseline, not a substitute for packaged StandardPDD.
  const options = { magic: false, standardPDD: [new Array(201).fill(0)] };
  const info = { level: 1, acc: 100, PADamage: 100, MADamage: 100 };
  const source = new PhysicalDamage(Math.random, () => 9999999);
  expect(source.receive(stats, info, options)).toBe(84);
  stats.pdd = 100;
  expect(source.receive(stats, info, options)).toBe(37);
  stats.str = 250;
  expect(source.receive(stats, info, options)).toBe(17);
  options.magic = true;
  stats.str = 0;
  expect(source.receive(stats, info, options)).toBe(79);
  stats.mdd = 100;
  expect(source.receive(stats, info, options)).toBe(54);
});

test("below-standard physical defense penalizes higher-level targets without changing attack RNG", () => {
  const stats = {
    level: 10,
    job: 0,
    str: 12,
    dex: 5,
    int: 4,
    luk: 4,
    eva: 0,
    pdd: 10,
    mdd: 4,
  };
  const options = { magic: false, standardPDD: [new Array(201).fill(100)] };
  const info = { level: 10, acc: 100, PADamage: 100 };
  const source = new PhysicalDamage(Math.random, () => 9999999);
  const equal = source.receive(stats, info, options);
  info.level = 11;
  expect(source.receive(stats, info, options)).toBeGreaterThan(equal);
  info.level = 1;
  expect(source.receive(stats, info, options)).toBeLessThan(equal);
});

test("magical evasion uses the level-penalized EVA interval and equality boundary", () => {
  const source = replay([0, 0, 0, 0, 0, 0, 0, 0]);
  const stats = { level: 10, job: 0, eva: 100 };
  const info = { level: 10, acc: 10 };
  expect(source.evades(stats, info, true)).toBe(true);
  info.level = 12;
  expect(source.evades(stats, info, true)).toBe(false);
});

test("equipped and allocated stats enter physical receiving without double-counting temporary defense", () => {
  const { profile, hooks, temporary } = profileFixture();
  const stats = createCharacterStats();
  const options = { magic: false, standardPDD: [new Array(201).fill(7)] };
  const info = { level: 1, acc: 100, PADamage: 100 };
  const source = new PhysicalDamage(Math.random, () => 9999999);
  projectCharacterStats(profile, hooks, stats);
  const naked = source.receive(stats, info, options);
  hooks.items[1002000].info.incPDD = 50;
  projectCharacterStats(profile, hooks, stats);
  const equipped = source.receive(stats, info, options);
  expect(equipped).toBeLessThan(naked);
  temporary.pdd = 50;
  projectCharacterStats(profile, hooks, stats);
  const buffed = source.receive(stats, info, options);
  expect(buffed).toBeLessThan(equipped);
  profile.str += 100;
  projectCharacterStats(profile, hooks, stats);
  expect(source.receive(stats, info, options)).toBeLessThan(buffed);
});

test("Invincible reduces untruncated physical magnitude once and never reduces magic", () => {
  const stats = {
    level: 1,
    job: 0,
    str: 0,
    dex: 0,
    int: 0,
    luk: 0,
    eva: 0,
    pdd: 0,
    mdd: 0,
    invincible: 20,
  };
  const options = { magic: false, standardPDD: [new Array(201).fill(0)] };
  const info = { level: 1, acc: 100, PADamage: 100, MADamage: 100 };
  const source = new PhysicalDamage(Math.random, () => 9999999);
  //84.9999995 * .8 truncates to67, not84 - trunc(84 * .2) =68.
  expect(source.receive(stats, info, options)).toBe(67);
  options.magic = true;
  expect(source.receive(stats, info, options)).toBe(79);
});

test("level-appropriate defense chips while far-below mobs keep native nonpositive MISS", () => {
  const stats = {
    level: 1,
    job: 0,
    str: 0,
    dex: 0,
    int: 0,
    luk: 0,
    eva: 0,
    pdd: 1000,
    mdd: 1000,
  };
  const options = { magic: false, standardPDD: [new Array(201).fill(0)] };
  const info = { level: 1, acc: 100, PADamage: 100, MADamage: 100 };
  const source = new PhysicalDamage(Math.random, () => 9999999);
  // Local minimum-chip policy: a same-level mob cannot be fully blocked by defense.
  expect(source.receive(stats, info, options)).toBe(1);
  options.magic = true;
  expect(source.receive(stats, info, options)).toBe(1);
  info.MADamage = 0;
  stats.mdd = 0;
  expect(source.receive(stats, info, options)).toBe(0);
  // More than ten levels below the defender, the native nonpositive MISS survives.
  options.magic = false;
  stats.mdd = 1000;
  stats.level = 60;
  expect(source.receive(stats, info, options)).toBeLessThan(0);
});
