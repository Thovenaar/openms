import { expect, test } from "bun:test";
import original from "../../docs/ghidra-physics-motion/wz-globals.json";
import tower from "../../docs/ghidra-physics-refinements/200081100-collision.json";
import {
  advanceSimulation,
  applyExternalImpulse,
  createSimulation,
  relocateSimulation,
  snapshotSimulation,
} from "../src/physics/simulation.js";
import { attachGround } from "../src/physics/geometry.js";

function input(direction = 0) {
  return {
    left: direction < 0,
    right: direction > 0,
    up: false,
    down: false,
    jump: false,
    jumpPressed: false,
    attack: false,
  };
}

function world(footholds = tower.footholds, map = tower.map) {
  return {
    schemaVersion: 1,
    globals: original.globals,
    footholds,
    map,
    ladders: [],
  };
}

/** Isolating topology; these coordinates are not an original trajectory recording. */
function mixedGroups(wallGroup, baseGroup = 0) {
  return world(
    [
      {
        id: 1,
        layer: 1,
        group: 7,
        x1: -100,
        y1: 0,
        x2: 220,
        y2: 0,
        prev: 0,
        next: 2,
      },
      {
        id: 2,
        layer: 1,
        group: wallGroup,
        x1: 220,
        y1: 0,
        x2: 220,
        y2: -100,
        prev: 1,
        next: 0,
      },
      {
        id: 3,
        layer: 1,
        group: baseGroup,
        x1: -500,
        y1: 200,
        x2: 500,
        y2: 200,
        prev: 0,
        next: 0,
      },
    ],
    {},
  );
}

function hitFromPlatform(terrain) {
  const sim = createSimulation(terrain, { x: 219, y: 0 });
  attachGround(sim, sim.geometry.byId.get(1));
  applyExternalImpulse(sim, 200, -200);
  advanceSimulation(sim, input(), 30);
  return sim;
}

test("original tower right and left walls contain airborne hits from group-2 platform 153", () => {
  for (const side of [-1, 1]) {
    const edge = side < 0 ? -310 : 220;
    const sim = createSimulation(world(), { x: edge - side, y: -278 });
    attachGround(sim, sim.geometry.byId.get(153));
    applyExternalImpulse(sim, side * 200, -200);
    for (let tick = 0; tick < 14; tick++) {
      advanceSimulation(sim, input(side), 30);
      // 009b38xx sweeps integer coordinates; subpixel coasting is not a visible wall escape.
      expect((Math.trunc(sim.x) - edge) * side).toBeLessThanOrEqual(0);
    }
    expect(sim.x).toBe(edge);
    expect(sim.footholdId).toBe(153);
    expect(sim.bounds).toEqual({
      left: -380,
      right: 290,
      top: -2220,
      bottom: 130,
    });
  }
});

test("air walls accept the actor group but reject an unrelated third group", () => {
  const actorWall = hitFromPlatform(mixedGroups(7));
  expect(actorWall.x).toBe(220);
  expect(actorWall.vx).toBe(0);
  const unrelatedWall = hitFromPlatform(mixedGroups(9));
  expect(unrelatedWall.x).toBeGreaterThan(220);
  expect(unrelatedWall.vx).toBeGreaterThan(0);
});

test("space selection uses the lowest populated group, surviving same-field relocation", () => {
  const sim = hitFromPlatform(mixedGroups(4, 4));
  expect(sim.x).toBe(220);
  expect(sim.vx).toBe(0);
  relocateSimulation(sim, { x: 219, y: -30 });
  applyExternalImpulse(sim, 200, -200);
  advanceSimulation(sim, input(), 30);
  expect(sim.x).toBe(220);
  expect(sim.vx).toBe(0);
  expect(snapshotSimulation(sim).spaceGroup).toBe(4);
});

test("ground-to-air endpoint continuation retains eligibility for the field wall", () => {
  const terrain = mixedGroups(0);
  terrain.footholds[0].x2 = 200;
  terrain.footholds[0].next = 0;
  terrain.footholds[1].prev = 0;
  terrain.footholds[1].y1 = 100;
  const sim = createSimulation(terrain, { x: 199, y: 0 });
  attachGround(sim, sim.geometry.byId.get(1));
  sim.speed = sim.vx = 500;
  advanceSimulation(sim, input(1), 60);
  expect(sim.x).toBe(220);
  expect(Math.abs(sim.vx)).toBe(0);
  expect(sim.state).toBe("air");
});

test("landing on a new floor group updates actor contact without replacing the space group", () => {
  const terrain = mixedGroups(9);
  const sim = createSimulation(terrain, { x: 0, y: -1 });
  sim.vy = 100;
  advanceSimulation(sim, input(), 30);
  expect(sim.footholdId).toBe(1);
  expect(sim.contactGroup).toBe(7);
  expect(sim.spaceGroup).toBe(0);
});

test("tower extrema clamp initialization and relocation, not falling at the bottom", () => {
  const sim = createSimulation(world(), { x: 1000, y: 1000 });
  expect({ x: sim.x, y: sim.y }).toEqual({ x: 290, y: 130 });
  advanceSimulation(sim, input(1), 30);
  expect(sim.x).toBe(290);
  expect(sim.y).toBeGreaterThan(130);
  relocateSimulation(sim, { x: -1000, y: -10000 });
  expect({ x: sim.x, y: sim.y }).toEqual({ x: -380, y: -2220 });
  applyExternalImpulse(sim, -200, -200);
  advanceSimulation(sim, input(-1), 30);
  expect({ x: sim.x, y: sim.y, vx: sim.vx, vy: sim.vy }).toEqual({
    x: -380,
    y: -2220,
    vx: 0,
    vy: 0,
  });
  advanceSimulation(sim, input(1), 30);
  expect(sim.x).toBeGreaterThan(-380);
  expect(sim.y).toBeGreaterThan(-2220);
});

test("grounded left-domain clipping projects onto the slope and permits inward detachment", () => {
  const terrain = world(
    [
      {
        id: 1,
        layer: 1,
        group: 3,
        x1: -1000,
        y1: 0,
        x2: 1000,
        y2: 200,
        prev: 0,
        next: 0,
      },
    ],
    {},
  );
  const sim = createSimulation(terrain, { x: -969, y: 3.1 });
  attachGround(sim, sim.geometry.byId.get(1));
  sim.speed = -125;
  advanceSimulation(sim, input(-1), 30);
  expect(sim.x).toBe(-970);
  expect(sim.y).toBeCloseTo(3, 10);
  expect(sim.speed).toBe(0);
  applyExternalImpulse(sim, 200, -200);
  advanceSimulation(sim, input(1), 30);
  expect(sim.x).toBeGreaterThan(-970);
  expect(sim.y).toBeLessThan(3);
  expect(sim.state).toBe("air");
});
