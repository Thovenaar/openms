import { expect, test } from "bun:test";
import {
  hypnotizeDamage,
  mesoExplosionDamage,
  mesoTouches,
} from "../src/skills/skill-target-rules.js";

const LOW_ROLL = { next: () => 0 };

test("Meso Explosion uses the original two-branch curve across 1000 mesos", () => {
  expect(mesoExplosionDamage(1000, 1000, 0)).toBe(4000);
  expect(mesoExplosionDamage(1001, 1000, 0)).toBe(4003);
  expect(mesoExplosionDamage(50000, 1000, 9999999)).toBe(45248);
});

test("A meso pile merely touching the mob rectangle does not damage it", () => {
  const pile = { x: 0, y: 0 };
  const body = { active: true, left: 50, right: 60, top: -10, bottom: 10 };
  expect(mesoTouches(pile, body)).toBe(false);
  body.left = 49;
  expect(mesoTouches(pile, body)).toBe(true);
});

test("Native Hypnotize damage stays finite at equal attack and defense", () => {
  const stats = { PADamage: 100, PDDamage: 100, MADamage: 100, MDDamage: 100 };
  expect(hypnotizeDamage(stats, stats, false, LOW_ROLL)).toBe(130);
  expect(hypnotizeDamage(stats, stats, true, LOW_ROLL)).toBe(125);
});
