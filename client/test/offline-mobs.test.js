import { expect, test } from "bun:test";
import original from "../../docs/ghidra-physics-motion/wz-globals.json";
import { createSimulation } from "../src/physics/simulation.js";
import { createMobs, damageMob, stepMob } from "../src/offline-mobs.js";

// Isolating floor geometry; Shroom's mobType=4, speed=-30 and maxHP=20
// are original 0120100.img scalars, not an invented movement classification.
function mobWorld() {
  const footholds = [
    {
      id: 1,
      layer: 1,
      group: 0,
      x1: 0,
      y1: 0,
      x2: 32,
      y2: 0,
      prev: 0,
      next: 2,
      properties: {},
    },
    {
      id: 2,
      layer: 1,
      group: 0,
      x1: 32,
      y1: 0,
      x2: 64,
      y2: 0,
      prev: 1,
      next: 0,
      properties: {},
    },
  ];
  return {
    schemaVersion: 1,
    globals: original.globals,
    map: {},
    footholds,
    ladders: [],
  };
}

function groundedMob(info = {}, hitDuration = 0) {
  const simulation = createSimulation(mobWorld(), { x: 10, y: 0 });
  const action = {
    timingKnown: true,
    frames: [
      { delayMs: 180, body: { left: -4, top: -8, right: 6, bottom: 0 } },
    ],
  };
  const template = {
    kind: "mob",
    originalId: "0120100",
    defaultAction: "stand",
    info: { maxHP: 20, speed: -30, mobType: 4, ...info },
    actions: { stand: action, move: action },
  };
  if (hitDuration > 0) {
    template.actions.hit1 = {
      timingKnown: true,
      frames: [{ delayMs: hitDuration, body: action.frames[0].body }],
    };
  }
  const life = {
    templates: { "mob:0120100": template },
    placements: [
      {
        id: "life:0",
        kind: "mob",
        template: "mob:0120100",
        authored: { x: 10, y: -30, cy: 0, fh: 1, rx0: 0, rx1: 64, f: 0 },
      },
    ],
  };
  return createMobs(life, simulation)[0];
}

function advance(mob, ticks) {
  for (let tick = 0; tick < ticks; tick++) stepMob(mob, 30);
}

test("nonzero mobType does not strand a grounded Shroom before the next foothold", () => {
  const mob = groundedMob();
  advance(mob, 33);
  expect(mob.x).toBeCloseTo(51.58, 8);
  expect(mob.y).toBe(0);
  expect(mob.foothold.id).toBe(2);
  expect(mob.body.bottom).toBe(0);
  expect(mob.fault).toBeNull();
  advance(mob, 20);
  expect(mob.x).toBeCloseTo(51.4, 8);
  expect(mob.y).toBe(0);
});

test("noFlip fixes body mirroring without fixing the movement direction", () => {
  const mob = groundedMob({ noFlip: 1 });
  advance(mob, 33);
  expect(mob.x).toBeCloseTo(51.58, 8);
  expect(mob.body.left).toBeCloseTo(mob.x - 4, 8);
  expect(mob.body.right).toBeCloseTo(mob.x + 6, 8);
  advance(mob, 20);
  expect(mob.x).toBeCloseTo(51.4, 8);
  expect(mob.body.left).toBeCloseTo(mob.x - 4, 8);
  expect(mob.body.right).toBeCloseTo(mob.x + 6, 8);
});

test("pushed separates HP loss from recoil, while an active attack keeps its pose and impact", () => {
  const mob = groundedMob({ pushed: 10 }, 180);
  mob.state = "attack";
  const attack = { properties: { attackAfter: 90 } };
  mob.pendingAttack = attack;
  damageMob(mob, 9, 1);
  expect(mob.hp).toBe(11);
  expect(mob.state).toBe("attack");
  expect(mob.pendingAttack).toBe(attack);
  damageMob(mob, 10, 1);
  expect(mob.hp).toBe(1);
  expect(mob.state).toBe("attack");
  expect(mob.pendingAttack).toBe(attack);
  stepMob(mob, 30);
  // Native midpoint integration: (130 + 118)/2 * .03, not constant-speed 120.
  expect(mob.x).toBeCloseTo(13.72, 8);
  expect(mob.body.bottom).toBe(0);
  advance(mob, 5);
  expect(mob.x).toBeCloseTo(26.92, 8);
  expect(mob.knockbackMs).toBe(0);
});

test("a hit deadline prevents repeated recoil without preventing damage, and weapon chance selects stronger motion", () => {
  const mob = groundedMob({ maxHP: 100, pushed: 10 }, 180);
  const attack = { skillId: 0, knockbackChance: 30, roll: 30 };
  damageMob(mob, 10, 1, attack);
  stepMob(mob, 30);
  expect(mob.x).toBeCloseTo(13.72, 8);
  damageMob(mob, 10, -1, attack);
  expect(mob.hp).toBe(80);
  stepMob(mob, 30);
  expect(mob.x).toBeGreaterThan(13.72);
  advance(mob, 4);
  attack.roll = 29;
  damageMob(mob, 10, -1, attack);
  const before = mob.x;
  stepMob(mob, 30);
  expect(before - mob.x).toBeCloseTo(((300 + 294) / 2) * 0.03, 8);
});

test("knockback crosses patrol limits but respects connected floor ends without teleporting back", () => {
  const mob = groundedMob({}, 360);
  mob.record.authored.rx1 = 12;
  damageMob(mob, 1, 1);
  advance(mob, 12);
  expect(mob.x).toBeGreaterThan(12);
  const before = mob.x;
  stepMob(mob, 30);
  expect(mob.x).toBeCloseTo(before - 1.26, 8);
  expect(mob.x).toBeGreaterThan(12);
  damageMob(mob, 1, -1);
  advance(mob, 12);
  damageMob(mob, 1, -1);
  advance(mob, 12);
  expect(mob.x).toBe(0);
  expect(mob.foothold.id).toBe(1);
  expect(mob.body.bottom).toBe(0);
  expect(mob.fault).toBeNull();
});

test("selected-skill admission and a missing hit pose do not fabricate immunity or reaction", () => {
  const mob = groundedMob();
  mob.selectedSkills = [1001004];
  const attack = { skillId: 1001004, knockbackChance: 0, roll: 0 };
  damageMob(mob, 5, 1);
  expect(mob.hp).toBe(20);
  damageMob(mob, 5, 1, attack);
  expect(mob.hp).toBe(15);
  expect(mob.state).toBe("idle");
  expect(mob.knockbackMs).toBe(0);
  expect(damageMob(mob, 15, 1, attack)).toBe(true);
  expect(damageMob(mob, 15, 1, attack)).toBe(false);
  expect(mob.deaths).toBe(1);
  expect(mob.body.active).toBe(false);
});
