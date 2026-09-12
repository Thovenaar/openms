import { test, expect } from "bun:test";
import original from "../../docs/ghidra-physics-motion/wz-globals.json";
import { createSimulation } from "../src/physics/simulation.js";
import { OnlinePrediction } from "../src/online/prediction.js";
import { ServerClock } from "../src/online/transport-clock.js";
import { PROTOCOL } from "../../shared/protocol.js";
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

/** Drive the real predictor through one authenticated checkpoint and its bounded catch-up steps. */
function presentable() {
  const simulation = createSimulation(world(), { x: 0, y: -10 });
  const input = createHeldInput();
  run(simulation, input, 0, 5);
  const prediction = new OnlinePrediction({ onInput: () => 1 });
  prediction.install(simulation, 6);
  prediction.observe({
    connectionEpoch: "epoch",
    fieldEpoch: "field",
    serverTick: 6,
    ackInputSeq: 1,
    paused: false,
    motion: captureMotion(simulation),
  });
  const clock = performance.now();
  prediction.timing({
    ready: true,
    connectionEpoch: "epoch",
    fieldEpoch: "field",
    serverTick: 6,
    roundTripMs: 0,
    oneWayMs: 0,
    offsetMs: 0,
    tickOffsetMs: 0,
    receivedAt: clock,
    paused: false,
  });
  assignHeldInput(input, {
    horizontal: 1,
    vertical: 0,
    jump: false,
    attack: false,
  });
  prediction.advance(clock, input);
  return { prediction, simulation, clock };
}

test("presented pose stays inside the newest two kernel states", () => {
  const { prediction, simulation, clock } = presentable();
  const target = { x: 0, y: 0 };
  const { previousX, x } = simulation;
  expect(x).toBeGreaterThan(previousX);
  expect(prediction.interpolate(clock, target).x).toBe(previousX);
  const middle = prediction.interpolate(clock + 15, target).x;
  expect(middle).toBeGreaterThan(previousX);
  expect(middle).toBeLessThan(x);
  expect(prediction.interpolate(clock + 30, target).x).toBe(x);
  // Local clock reads outside the step's quantum neither extrapolate nor rewind.
  expect(prediction.interpolate(clock + 60, target).x).toBe(x);
  expect(prediction.interpolate(clock - 10, target).x).toBe(previousX);
});

test("presentation never writes the interpolated pose back into the kernel", () => {
  const { prediction, simulation, clock } = presentable();
  const before = captureMotion(simulation);
  const target = { x: 0, y: 0 };
  for (let step = 0; step <= 30; step += 5) {
    prediction.interpolate(clock + step, target);
    expect(target.x).toBeGreaterThanOrEqual(before.previousX);
    expect(target.x).toBeLessThanOrEqual(before.x);
  }
  expect(captureMotion(simulation)).toEqual(before);
});

test("prediction sends usable input within authenticated lead despite inflated arrival timing", () => {
  const sent = [];
  const simulation = createSimulation(world(), { x: 0, y: -10 });
  const prediction = new OnlinePrediction({
    onInput(sample) {
      sent.push({ ...sample });
      return sent.length;
    },
  });
  const observation = {
    connectionEpoch: "epoch",
    fieldEpoch: "destination",
    serverTick: 13,
    ackInputSeq: null,
    paused: false,
    motion: captureMotion(simulation),
  };
  prediction.install(simulation, observation.serverTick);
  prediction.observe(observation);
  const now = performance.now();
  const clock = new ServerClock();
  prediction.timing(
    clock.observe({ ...observation, receivedAt: now, roundTripMs: 300 }),
  );
  const held = createHeldInput();
  held.right = true;
  // Explicit scheduler times, independent of test-runner stalls and RAF cadence.
  for (let step = 0; step < 10; step++) {
    prediction.advance(now + step * PROTOCOL.TICK_MS, held);
  }
  expect(sent).toEqual([
    {
      targetTick: observation.serverTick + PROTOCOL.INPUT_LEAD_TICKS,
      horizontal: 1,
      vertical: 0,
      jump: false,
      attack: false,
    },
  ]);
  expect(simulation.x).toBeGreaterThan(observation.motion.x);
});

test("a freshly installed predictor waits for matching field timing", () => {
  const sent = [];
  const simulation = createSimulation(world(), { x: 0, y: -10 });
  const prediction = new OnlinePrediction({
    onInput(sample) {
      sent.push({ ...sample });
      return sent.length;
    },
  });
  const clock = new ServerClock();
  prediction.timing(
    clock.observe({
      connectionEpoch: "epoch",
      fieldEpoch: "source",
      serverTick: 100000,
      paused: false,
      receivedAt: performance.now(),
      roundTripMs: 30,
    }),
  );
  prediction.install(simulation, 13);
  const before = captureMotion(simulation);
  prediction.observe({
    connectionEpoch: "epoch",
    fieldEpoch: "destination",
    serverTick: 13,
    ackInputSeq: null,
    paused: false,
    motion: before,
  });
  const now = performance.now();
  const held = createHeldInput();
  held.right = true;
  for (let step = 0; step < PROTOCOL.INPUT_HISTORY; step++) {
    prediction.advance(now + step, held);
  }
  expect(sent).toEqual([]);
  expect(captureMotion(simulation)).toEqual(before);
});
