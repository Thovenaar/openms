import { expect, test } from "bun:test";
import {
  hypnotizeDamage,
  mesoTouches,
} from "../src/skills/skill-target-rules.js";

const LOW_ROLL = { next: () => 0 };

test("A meso pile merely touching the mob rectangle does not damage it", () => {
  const pile = { x: 0, y: 0 };
  const body = { active: true, left: 50, right: 60, top: -10, bottom: 10 };
  expect(mesoTouches(pile, body)).toBe(false);
  body.left = 49;
  expect(mesoTouches(pile, body)).toBe(true);
});

test("Hypnotize uses linear attack and modern target defense", () => {
  const stats = {
    level: 50,
    PDRate: 50,
    MDRate: 50,
    PADamage: 100,
    PDDamage: 100,
    MADamage: 100,
    MDDamage: 100,
  };
  expect(hypnotizeDamage(stats, stats, false, LOW_ROLL)).toBe(46);
  expect(hypnotizeDamage(stats, stats, true, LOW_ROLL)).toBe(46);
});
