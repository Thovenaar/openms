import { test, expect } from "bun:test";
import original from "../../docs/ghidra-physics-motion/wz-globals.json";
import { createSimulation } from "../src/physics/simulation.js";
import {
  createHeldInput,
  assignHeldInput,
  stepMotion,
  captureMotion,
  restoreMotion,
} from "../../shared/motion.js";

// Synthetic isolating geometry, not an original-game recording. Exercise the real
// online continuation boundary rather than reconstructing state by replaying spawn.
function world() {
  return {
    schemaVersion: 1,
    globals: original.globals,
    map: {},
    ladders: [],
    footholds: [
      {
        id: 1,
        layer: 1,
        group: 0,
        x1: -1000,
        y1: 0,
        x2: 1000,
        y2: 0,
        prev: 0,
        next: 0,
        properties: {},
      },
      {
        id: 2,
        layer: 1,
        group: 0,
        x1: -1000,
        y1: 300,
        x2: 1000,
        y2: 300,
        prev: 0,
        next: 0,
        properties: {},
      },
    ],
  };
}
function sample(tick) {
  return {
    horizontal: tick < 25 ? 1 : tick < 50 ? -1 : 0,
    vertical: tick >= 55 && tick < 60 ? 1 : 0,
    jump: tick === 12 || (tick >= 55 && tick < 59),
    attack: false,
  };
}
function run(simulation, input, first, last) {
  for (let tick = first; tick <= last; tick++) {
    assignHeldInput(input, sample(tick));
    stepMotion(simulation, input);
  }
}

test("mid-flight authoritative checkpoint restores future movement and held edges exactly", () => {
  const source = createSimulation(world(), { x: 0, y: -10 });
  const input = createHeldInput();
  run(source, input, 0, 17);
  const checkpoint = captureMotion(source);
  expect(checkpoint.y).toBeLessThan(0);
  const restored = createSimulation(world(), { x: -900, y: 290 });
  restoreMotion(restored, structuredClone(checkpoint));
  const replay = createHeldInput();
  assignHeldInput(replay, checkpoint.held);
  run(source, input, 18, 110);
  run(restored, replay, 18, 110);
  expect(captureMotion(restored)).toEqual(captureMotion(source));
});

test("down-jump ignored foothold survives a received checkpoint", () => {
  const source = createSimulation(world(), { x: 0, y: -10 });
  const input = createHeldInput();
  assignHeldInput(input, {
    horizontal: 0,
    vertical: 0,
    jump: false,
    attack: false,
  });
  for (let tick = 0; tick < 20; tick++) stepMotion(source, input);
  assignHeldInput(input, {
    horizontal: 0,
    vertical: 1,
    jump: true,
    attack: false,
  });
  stepMotion(source, input);
  const checkpoint = captureMotion(source);
  expect(checkpoint.ignoredFootholdId).toBe(1);
  const restored = createSimulation(world(), { x: 0, y: -10 });
  restoreMotion(restored, checkpoint);
  const replay = createHeldInput();
  assignHeldInput(replay, checkpoint.held);
  for (let tick = 0; tick < 30; tick++) {
    assignHeldInput(input, {
      horizontal: 0,
      vertical: 0,
      jump: false,
      attack: false,
    });
    assignHeldInput(replay, {
      horizontal: 0,
      vertical: 0,
      jump: false,
      attack: false,
    });
    stepMotion(source, input);
    stepMotion(restored, replay);
  }
  expect(restored.footholdId).toBe(2);
  expect(captureMotion(restored)).toEqual(captureMotion(source));
});

test("unknown checkpoint geometry fails before replacing the last complete state", () => {
  const simulation = createSimulation(world(), { x: 0, y: -10 });
  const before = captureMotion(simulation);
  const malformed = structuredClone(before);
  malformed.ignoredFootholdId = 99;
  expect(() => restoreMotion(simulation, malformed)).toThrow(
    "CONTENT_MISMATCH",
  );
  expect(captureMotion(simulation)).toEqual(before);
});
