import { expect, test } from "bun:test";
import original from "../../docs/ghidra-physics-motion/wz-globals.json";
import { createSimulation } from "../src/physics/simulation.js";
import { createMobs, stepMob } from "../src/offline-mobs.js";

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

function groundedMob(info = {}) {
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
