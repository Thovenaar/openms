import { test, expect } from "bun:test";
import { loadContent } from "../../server/src/content.js";
import { createSimulation } from "../src/physics/simulation.js";
import { OnlinePrediction } from "../src/online/prediction.js";
import { holdObservedClimb, OnlineScene } from "../src/online/scene.js";
import { ServerClock } from "../src/online/transport-clock.js";
import { inputHorizonTicks } from "../src/online/input-timing.js";
import { PROTOCOL } from "../../shared/protocol.js";
import {
  createHeldInput,
  assignHeldInput,
  stepMotion,
  captureMotion,
  restoreMotion,
} from "../../shared/motion.js";

// Reuse the verified extracted physics; this checkout need not retain archived Ghidra JSON.
const content = await loadContent();
const original = {
  globals: (await content.map(content.catalog.defaultMap)).physics.globals,
};

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

test("observed ladder and rope frames advance only while vertical position changes", () => {
  for (const action of ["ladder", "rope", "ladder2", "rope2"]) {
    expect(holdObservedClimb(action, 120, 120)).toBe(true);
    expect(holdObservedClimb(action, 120, 117)).toBe(false);
    expect(holdObservedClimb(action, 120, 123)).toBe(false);
  }
  expect(holdObservedClimb("walk1", 120, 120)).toBe(false);
});

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
function presentable(onGroundJump) {
  const simulation = createSimulation(world(), { x: 0, y: -10 });
  const input = createHeldInput();
  run(simulation, input, 0, 5);
  const prediction = new OnlinePrediction({ onInput: () => 1, onGroundJump });
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

test("an optimistic movement skill is predicted immediately and rolled back when refused", () => {
  const simulation = createSimulation(world(), { x: 0, y: -10 });
  const prediction = new OnlinePrediction({});
  prediction.install(simulation, 0);
  const before = captureMotion(simulation);
  const token = prediction.beginOptimistic(
    { kind: "impulse", vx: 400, vy: -250 },
    4111006,
  );
  expect(token).not.toBeNull();
  // The impulse is merged at the key press, not one predicted tick later.
  expect(simulation.vx).toBeGreaterThan(390);
  expect(simulation.vy).toBeLessThan(-150);
  // A rejected cast restores the exact pre-cast checkpoint.
  prediction.rejectOptimistic(token);
  expect(captureMotion(simulation)).toEqual(before);
  expect(prediction.snapshot().pendingImpulses).toBe(0);
});

test("a bounded server correction glides instead of snapping the presented pose", () => {
  const { prediction, simulation } = presentable();
  const target = { x: 0, y: 0 };
  const now = performance.now();
  simulation.x = 100;
  simulation.previousX = 100;
  // The player was shown x=94; the server says 100.
  prediction.seedCorrection(94, 0);
  prediction.interpolate(now, target);
  expect(target.x).toBeCloseTo(94, 0);
  // The correction window ends with the presentation on the authoritative state.
  prediction.interpolate(now + 200, target);
  expect(target.x).toBeCloseTo(100, 6);
  // A disagreement beyond the tolerance is a real desync and snaps.
  prediction.seedCorrection(50, 0);
  prediction.interpolate(now + 201, target);
  expect(target.x).toBeCloseTo(100, 6);
});

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

test("midair attack locks retain the local interpolation clock instead of chasing old entity poses", () => {
  const { prediction, simulation, clock } = presentable();
  const input = createHeldInput();
  assignHeldInput(input, {
    horizontal: 1,
    vertical: 0,
    jump: true,
    attack: false,
  });
  stepMotion(simulation, input);
  simulation.movementLocked = true;
  stepMotion(simulation, input);
  expect(simulation.y).toBeLessThan(simulation.previousY);
  const owner = { selfId: "self", drawPrediction: prediction, selfPose: {} };
  const view = {
    entity: {
      id: "self",
      position: { x: -100, y: 0 },
      combatState: { movementLocked: true },
    },
    fromX: -100,
    fromY: 0,
    received: clock,
  };
  const before = captureMotion(simulation);
  const result = OnlineScene.prototype.interpolateView.call(
    owner,
    view,
    clock + 15,
  );
  expect(result).toBe(simulation);
  expect(view.drawY).toBe((simulation.previousY + simulation.y) / 2);
  expect(view.drawX).toBe((simulation.previousX + simulation.x) / 2);
  view.entity.combatState.movementLocked = false;
  OnlineScene.prototype.interpolateView.call(owner, view, clock + 15);
  expect(view.drawY).toBe((simulation.previousY + simulation.y) / 2);
  expect(captureMotion(simulation)).toEqual(before);
});

test("ground jump audio follows accepted checkpoints once; air presses and rejoin are silent", () => {
  let sounds = 0;
  const { prediction, simulation } = presentable(() => sounds++);
  const source = createSimulation(world(), { x: 0, y: 0 });
  restoreMotion(source, captureMotion(simulation));
  const input = createHeldInput();
  let tick = prediction.predictedTick;
  function observe() {
    prediction.observe({
      connectionEpoch: "epoch",
      fieldEpoch: "field",
      serverTick: ++tick,
      ackInputSeq: 1,
      paused: false,
      motion: captureMotion(source),
    });
  }
  assignHeldInput(input, {
    horizontal: 1,
    vertical: 0,
    jump: true,
    attack: false,
  });
  stepMotion(source, input);
  expect(source.groundJumpSequence).toBe(1);
  observe();
  observe();
  expect(sounds).toBe(1);
  assignHeldInput(input, {
    horizontal: 1,
    vertical: 0,
    jump: false,
    attack: false,
  });
  stepMotion(source, input);
  assignHeldInput(input, {
    horizontal: 1,
    vertical: 0,
    jump: true,
    attack: false,
  });
  stepMotion(source, input);
  observe();
  expect(sounds).toBe(1);
  prediction.install(simulation, tick);
  observe();
  expect(sounds).toBe(1);
  source.groundJumpSequence = 0xffffffff;
  prediction.install(simulation, tick);
  observe();
  source.groundJumpSequence = 0;
  observe();
  expect(sounds).toBe(2);
});

test("prediction covers network delay within a bounded history horizon", () => {
  const sent = [];
  const simulation = createSimulation(world(), { x: 0, y: -10 });
  const prediction = new OnlinePrediction({
    onInput(sample) {
      sent.push({ ...sample, motion: { ...sample.motion } });
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
  expect(sent.length).toBeGreaterThan(1);
  expect(sent[0]).toMatchObject({
    horizontal: 1,
    vertical: 0,
    jump: false,
    attack: false,
  });
  expect(sent[0].targetTick).toBeGreaterThan(
    observation.serverTick + PROTOCOL.INPUT_LEAD_TICKS,
  );
  expect(sent.at(-1).targetTick).toBeLessThanOrEqual(
    observation.serverTick + inputHorizonTicks(clock),
  );
  // The same sample reports the bounded motion state it extends, for the server's
  // adoption check; the values are asserted by the divert-alignment suite.
  expect(Object.keys(sent[0].motion).sort()).toEqual(["vx", "vy", "x", "y"]);
  for (const value of Object.values(sent[0].motion)) {
    expect(Number.isFinite(value)).toBe(true);
  }
  expect(simulation.x).toBeGreaterThan(observation.motion.x);
});

test("a freshly installed predictor waits for matching field timing", () => {
  const sent = [];
  const simulation = createSimulation(world(), { x: 0, y: -10 });
  const prediction = new OnlinePrediction({
    onInput(sample) {
      sent.push({ ...sample, motion: { ...sample.motion } });
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
