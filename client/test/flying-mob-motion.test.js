import { expect, test } from "bun:test";
import original from "../../docs/ghidra-physics-motion/wz-globals.json";
import { createSimulation } from "../src/physics/simulation.js";
import { createMobs, stepMob } from "../src/combat/offline-mobs.js";

// Synthetic single-floor geometry isolates the native009bd799 waypoint rules.
function flyingSimulation() {
  return createSimulation(
    {
      schemaVersion: 1,
      globals: original.globals,
      footholds: [
        {
          id: 1,
          layer: 1,
          group: 0,
          x1: -2000,
          y1: 0,
          x2: 2000,
          y2: 0,
          prev: 0,
          next: 0,
          properties: {},
        },
      ],
      ladders: [],
      map: {},
    },
    { x: 0, y: 0 },
  );
}

function flyingFixture() {
  return createMobs(
    {
      placements: [
        {
          id: "life:0",
          kind: "mob",
          template: "mob:2300100",
          authored: {
            id: "2300100",
            x: 0,
            y: -120,
            cy: 0,
            fh: 1,
            f: 0,
            rx0: -20,
            rx1: 20,
          },
        },
      ],
      templates: {
        "mob:2300100": {
          kind: "mob",
          info: { maxHP: 100, flySpeed: 5 },
          defaultAction: "fly",
          actions: {
            fly: {
              timingKnown: true,
              frames: [
                {
                  delayMs: 150,
                  body: { left: -8, top: -12, right: 8, bottom: 0 },
                },
              ],
            },
          },
        },
      },
    },
    flyingSimulation(),
  )[0];
}

test("unprovoked flight selects foothold-relative waypoints instead of field-edge corners", () => {
  const mob = flyingFixture();
  expect(mob.y).toBe(-120);
  stepMob(mob, 30);
  // Native distance is modulo truncated foothold length; height is random%60-50.
  expect(mob.flight.goalX).toBeGreaterThanOrEqual(-2000);
  expect(mob.flight.goalX).toBeLessThan(2000);
  expect(mob.flight.goalY).toBeGreaterThanOrEqual(-50);
  expect(mob.flight.goalY).toBeLessThan(10);
});

test("a flying chase retains its waypoint while its target remains inside the native leash", () => {
  const mob = flyingFixture();
  mob.aggro.damageInstances = 1;
  const target = { x: 400, y: -100 };
  stepMob(mob, 30, target);
  const waypoint = { x: mob.flight.goalX, y: mob.flight.goalY };
  target.x++;
  target.y++;
  stepMob(mob, 30, target);
  expect({ x: mob.flight.goalX, y: mob.flight.goalY }).toEqual(waypoint);
});
