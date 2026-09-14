import { test, expect } from "bun:test";
import original from "../../docs/ghidra-physics-motion/wz-globals.json";
import {
  createSimulation,
  applyExternalImpulse,
} from "../src/physics/simulation.js";
import { OnlinePrediction } from "../src/online/prediction.js";
import {
  createHeldInput,
  assignHeldInput,
  stepMotion,
  captureMotion,
  restoreMotion,
} from "../../shared/motion.js";

/** Synthetic isolating geometry, not an original-game recording. Mirrors the
 *  sync-alignment suite so both exercise the same online continuation boundary. */
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
    vertical: 0,
    jump: tick === 12,
    attack: false,
  };
}

/** One authoritative segment: the same kernel the client runs, with an impulse merged
 *  at the start of each listed tick exactly as a field tick would merge it. */
function authority(lastTick, impulses = []) {
  const sim = createSimulation(world(), { x: 0, y: -10 });
  const input = createHeldInput();
  const motion = [captureMotion(sim)];
  const diverts = [];
  for (let tick = 1; tick <= lastTick; tick++) {
    for (const impulse of impulses) {
      if (impulse.tick !== tick) continue;
      const before = captureMotion(sim);
      applyExternalImpulse(sim, impulse.vx, impulse.vy);
      diverts.push({ ...impulse, before });
    }
    assignHeldInput(input, sample(tick));
    stepMotion(sim, input);
    motion.push(captureMotion(sim));
  }
  return { motion, diverts };
}

/** Client prediction advanced `lastTick` ticks through the real predictor boundary. */
function predicting(lastTick) {
  const simulation = createSimulation(world(), { x: 0, y: -10 });
  let seq = 0;
  const sent = [];
  const prediction = new OnlinePrediction({
    onInput(value) {
      sent.push({ ...value, motion: { ...value.motion } });
      seq++;
      return seq;
    },
  });
  prediction.install(simulation, 0);
  // One authenticated checkpoint first: only an already-presented pose is glided.
  prediction.observe({
    connectionEpoch: "epoch",
    fieldEpoch: "field",
    serverTick: 0,
    ackInputSeq: null,
    paused: false,
    motion: captureMotion(simulation),
    diverts: [],
  });
  const held = createHeldInput();
  for (let tick = 1; tick <= lastTick; tick++) {
    assignHeldInput(held, sample(tick));
    expect(prediction.predict(held, true)).toBe(true);
  }
  return { prediction, simulation, sent };
}

function checkpoint(generated, tick, diverts = []) {
  return {
    connectionEpoch: "epoch",
    fieldEpoch: "field",
    serverTick: tick,
    ackInputSeq: tick,
    paused: false,
    motion: generated.motion[tick],
    diverts,
  };
}

test("a reported sample carries the state it extends, bounded and normalized", () => {
  const { prediction, sent } = predicting(3);
  expect(sent).toHaveLength(3);
  for (let tick = 1; tick <= 3; tick++) {
    expect(Object.keys(sent[tick - 1]).sort()).toEqual([
      "attack",
      "horizontal",
      "jump",
      "motion",
      "targetTick",
      "vertical",
    ]);
    expect(sent[tick - 1].targetTick).toBe(tick);
    for (const value of Object.values(sent[tick - 1].motion)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(Object.is(value, -0)).toBe(false);
    }
  }
  const current = captureMotion(prediction.simulation);
  expect(prediction.resumeMotion()).toEqual({
    x: current.x,
    y: current.y,
    vx: current.vx,
    vy: current.vy,
  });
});

test("an authoritative midair divert is replayed at its tick, not adopted", () => {
  const generated = authority(8, [
    { tick: 4, vx: 300, vy: -250, source: "hit" },
  ]);
  const { prediction, simulation } = predicting(8);
  const predicted = captureMotion(simulation);
  prediction.observe(checkpoint(generated, 4, [generated.diverts[0]]));
  expect(prediction.snapshot().diverts).toBe(1);
  expect(prediction.snapshot().corrections).toBe(0);
  // Replaying the published pre-impulse base with the same kernel entry point
  // reproduces the authority's own tick and suffix exactly.
  expect(captureMotion(simulation)).toEqual(generated.motion[8]);
  expect(predicted).not.toEqual(captureMotion(simulation));
});

test("a placed divert presents a continuous trajectory instead of one large jump", () => {
  const generated = authority(8, [
    { tick: 4, vx: 350, vy: -250, source: "hit" },
  ]);
  const { prediction } = predicting(8);
  const target = { x: 0, y: 0 };
  const shown = { x: 0, y: 0 };
  const now = performance.now();
  prediction.interpolate(now, shown);
  const beforeX = prediction.simulation.x;
  prediction.observe(checkpoint(generated, 4, [generated.diverts[0]]));
  expect(prediction.snapshot().diverts).toBe(1);
  prediction.interpolate(now, target);
  // The drawn pose still starts where the player actually saw it.
  expect(target.x).toBeCloseTo(shown.x, 6);
  // Every 30 ms of removal adds no more than one walking quantum (walkSpeed 125 px/s).
  const quantum = 0.125 * 30;
  let previous = { x: target.x, y: target.y };
  let frames = 0;
  for (let step = 30; step <= 1200; step += 30) {
    prediction.interpolate(now + step, target);
    const moved = Math.hypot(target.x - previous.x, target.y - previous.y);
    expect(moved).toBeLessThanOrEqual(quantum + 0.001);
    previous = { x: target.x, y: target.y };
    frames++;
    if (
      Math.hypot(
        target.x - prediction.simulation.x,
        target.y - prediction.simulation.y,
      ) < 0.001
    ) {
      break;
    }
  }
  expect(frames).toBeGreaterThan(1);
  expect(prediction.simulation.x).not.toBeCloseTo(beforeX, 6);
  prediction.interpolate(now + 5000, target);
  expect(target.x).toBeCloseTo(prediction.simulation.x, 6);
  expect(target.y).toBeCloseTo(prediction.simulation.y, 6);
});

test("an unexplained divergence beyond the snap bound is not glided", () => {
  const { prediction } = predicting(8);
  const target = { x: 0, y: 0 };
  prediction.seedCorrection(
    prediction.simulation.x + 60,
    prediction.simulation.y,
  );
  prediction.interpolate(performance.now(), target);
  expect(target.x).toBeCloseTo(prediction.simulation.x, 6);
});

test("a divert whose tick label is stale falls back to authoritative adoption", () => {
  const generated = authority(8, [
    { tick: 4, vx: 300, vy: -250, source: "hit" },
  ]);
  const { prediction, simulation } = predicting(8);
  const stale = checkpoint(generated, 4, [
    { ...generated.diverts[0], tick: 2 },
  ]);
  prediction.observe(stale);
  expect(prediction.snapshot().diverts).toBe(0);
  expect(captureMotion(simulation)).toEqual(generated.motion[8]);
});

test("a divert with no retained history entry falls back without diverging", () => {
  const generated = authority(8, [
    { tick: 4, vx: 300, vy: -250, source: "hit" },
  ]);
  const simulation = createSimulation(world(), { x: 0, y: -10 });
  const prediction = new OnlinePrediction({});
  prediction.install(simulation, 4);
  prediction.observe(checkpoint(generated, 4, [generated.diverts[0]]));
  expect(prediction.snapshot().diverts).toBe(0);
  expect(captureMotion(simulation)).toEqual(generated.motion[4]);
});

test("a divert whose replay disagrees with the checkpoint is rejected", () => {
  const generated = authority(8, [
    { tick: 4, vx: 300, vy: -250, source: "hit" },
  ]);
  const { prediction, simulation } = predicting(8);
  const tampered = checkpoint(generated, 4, [generated.diverts[0]]);
  tampered.motion = { ...generated.motion[4], vx: 0, vy: 0 };
  prediction.observe(tampered);
  expect(prediction.snapshot().diverts).toBe(0);
  // The rejected divert still ends authoritative and bounded: the tampered tick is
  // adopted and the retained suffix is re-stepped from it.
  const expected = createSimulation(world(), { x: 0, y: -10 });
  restoreMotion(expected, tampered.motion);
  const held = createHeldInput();
  for (let tick = 5; tick <= 8; tick++) {
    assignHeldInput(held, sample(tick));
    stepMotion(expected, held);
  }
  expect(captureMotion(simulation)).toEqual(captureMotion(expected));
});

test("an unplaceable divert inside a changed field epoch resyncs instead", () => {
  const generated = authority(8, [
    { tick: 4, vx: 300, vy: -250, source: "hit" },
  ]);
  const { prediction } = predicting(8);
  let resyncs = 0;
  prediction.onResync = () => resyncs++;
  prediction.observe(checkpoint(generated, 4, [generated.diverts[0]]));
  expect(resyncs).toBe(0);
  prediction.observe({
    ...checkpoint(generated, 4, [generated.diverts[0]]),
    fieldEpoch: "other",
  });
  expect(resyncs).toBe(1);
  expect(prediction.snapshot().ready).toBe(false);
});

test("two diverts on successive ticks merge in order through the shared kernel", () => {
  const generated = authority(6, [
    { tick: 3, vx: -200, vy: -180, source: "hit" },
    { tick: 4, vx: 350, vy: -250, source: "skill" },
  ]);
  const { prediction } = predicting(6);
  prediction.observe({
    connectionEpoch: "epoch",
    fieldEpoch: "field",
    serverTick: 3,
    ackInputSeq: 3,
    paused: false,
    motion: generated.motion[3],
    diverts: [generated.diverts[0]],
  });
  expect(prediction.snapshot().diverts).toBe(1);
  prediction.observe({
    connectionEpoch: "epoch",
    fieldEpoch: "field",
    serverTick: 4,
    ackInputSeq: 4,
    paused: false,
    motion: generated.motion[4],
    diverts: [generated.diverts[1]],
  });
  expect(prediction.snapshot().diverts).toBe(2);
  expect(captureMotion(prediction.simulation)).toEqual(generated.motion[6]);
});

test("a checkpoint without diverts keeps the plain authoritative path", () => {
  const generated = authority(8, []);
  const { prediction, simulation } = predicting(8);
  prediction.observe(checkpoint(generated, 4));
  expect(prediction.snapshot().diverts).toBe(0);
  expect(captureMotion(simulation)).toEqual(generated.motion[8]);
});

test("the same history and impulses reproduce captureMotion exactly, once", () => {
  function run() {
    const simulation = createSimulation(world(), { x: 0, y: -10 });
    const prediction = new OnlinePrediction({ onInput: () => 1 });
    prediction.install(simulation, 0);
    const held = createHeldInput();
    prediction.queueAction({ kind: "impulse", vx: 400, vy: -250 });
    expect(prediction.predict(held, true)).toBe(true);
    assignHeldInput(held, {
      horizontal: 1,
      vertical: 0,
      jump: false,
      attack: false,
    });
    expect(prediction.predict(held, true)).toBe(true);
    return captureMotion(simulation);
  }
  const first = run();
  expect(run()).toEqual(first);
  // One merge, not two: the queued impulse applies on its own entry only.
  const reference = createSimulation(world(), { x: 0, y: -10 });
  applyExternalImpulse(reference, 400, -250);
  const input = createHeldInput();
  stepMotion(reference, input);
  assignHeldInput(input, {
    horizontal: 1,
    vertical: 0,
    jump: false,
    attack: false,
  });
  stepMotion(reference, input);
  expect(first).toEqual(captureMotion(reference));
});
