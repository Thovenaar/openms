import { expect, test } from "bun:test";
import { PhysicalDamage } from "../src/physical-damage.js";
import {
  createCharacterStats,
  projectCharacterStats,
} from "../src/character-stats.js";

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

test("unsupported weapon mastery does not reuse the sword damage projection", () => {
  const { profile, hooks } = profileFixture();
  hooks.items[1452000] = { info: { incPAD: 17 } };
  profile.equipment[0].id = 1452000;
  const stats = projectCharacterStats(profile, hooks, createCharacterStats());
  expect(stats.acc).toBeNull();
  expect(() => new PhysicalDamage(() => 0).generate(stats, SNAIL)).toThrow(
    "one-handed sword",
  );
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
