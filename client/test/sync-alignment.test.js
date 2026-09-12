import { test, expect } from "bun:test";
import original from "../../docs/ghidra-physics-motion/wz-globals.json";
import {
  createSimulation,
  advanceSimulation,
} from "../src/physics/simulation.js";

// Synthetic isolating geometry for the shared movement kernel; not original-game recordings.
// This file asserts the authoritative-server sync contract: a client and a server that run the
// same kernel stay identical per *tick index*, and it pins the documented ways that breaks.
const QUANTUM_MS = 30;

function floor(id, y) {
  return {
    id,
    layer: 1,
    group: 0,
    x1: -4000,
    y1: y,
    x2: 4000,
    y2: y,
    prev: 0,
    next: 0,
    properties: {},
  };
}

function world() {
  return {
    schemaVersion: 1,
    globals: original.globals,
    footholds: [floor(1, 0)],
    ladders: [],
    map: {},
  };
}

function heldInput(direction) {
  return {
    left: direction < 0,
    right: direction > 0,
    up: false,
    down: false,
    jump: false,
    attack: false,
    jumpPressed: false,
  };
}

/** Coasting script: accelerate right, coast, then reverse. */
function coasting(tick) {
  if (tick < 20) return 1;
  if (tick < 30) return 0;
  return -1;
}

/** Direction changes almost every tick, so a held (starved) tick is visibly the wrong input. */
function changing(tick) {
  if (tick % 7 === 3) return 0;
  if (tick % 11 === 5) return -1;
  return 1;
}

function run(directions, quantaPerTick = 1) {
  const sim = createSimulation(world(), { x: 0, y: 0 });
  for (const direction of directions) {
    advanceSimulation(sim, heldInput(direction), QUANTUM_MS * quantaPerTick);
  }
  return sim.x;
}

/**
 * Server-applied input per tick for a stamped client stream. A sample stamped for tick `t` is
 * applied there only if it arrives by `t + oneWayTicks + bufferTicks`; a starved tick holds the
 * last continuous input.
 */
function serverApplied(stamped, { oneWayTicks, bufferTicks, arrivalOffset }) {
  const applied = [];
  let held = 0;
  for (let tick = 0; tick < stamped.length; tick += 1) {
    const arrival = tick + oneWayTicks + arrivalOffset(tick);
    const deadline = tick + oneWayTicks + bufferTicks;
    applied.push(arrival <= deadline ? stamped[tick] : held);
    held = applied[tick];
  }
  return applied;
}

test("inputs stamped for their own tick keep client and server identical per tick index", () => {
  const stamped = Array.from({ length: 60 }, (_, tick) => coasting(tick));
  const applied = serverApplied(stamped, {
    oneWayTicks: 2,
    bufferTicks: 0,
    arrivalOffset: () => 0,
  });
  expect(applied).toEqual(stamped);
  expect(run(applied)).toBe(run(stamped));
  // The script reverses, so net displacement is small; assert it moved at all.
  expect(Math.abs(run(applied))).toBeGreaterThan(10);
});

test("rewinding to the authoritative tick and replaying the suffix restores the server timeline", () => {
  const stamped = Array.from({ length: 60 }, (_, tick) => coasting(tick));
  const mispredicted = [...stamped];
  mispredicted[5] = 0; // client moved when the server had no input for that tick
  expect(run(mispredicted)).not.toBe(run(stamped));

  // The client adopts the authoritative state for the divergence tick and replays only its
  // unacknowledged suffix. Replaying the acknowledged prefix reconstructs that state exactly
  // because the kernel is deterministic, which is what makes reconciliation sound.
  const authoritative = run(stamped.slice(0, 6));
  const reconciled = [...stamped.slice(0, 6), ...stamped.slice(6)];
  expect(run(reconciled)).toBe(run(stamped));
  expect(run(stamped.slice(0, 6))).toBe(authoritative);
});

test("jitter without a server input buffer starves ticks and leaves a standing gap", () => {
  const stamped = Array.from({ length: 60 }, (_, tick) => changing(tick));
  const applied = serverApplied(stamped, {
    oneWayTicks: 2,
    bufferTicks: 0,
    arrivalOffset: (tick) => (tick % 2 ? 1 : -1),
  });
  const mismatched = applied.filter(
    (value, tick) => value !== stamped[tick],
  ).length;
  expect(mismatched).toBeGreaterThan(0);
  expect(run(applied)).not.toBe(run(stamped));
});

test("a one-tick input buffer accepts the same late arrival and removes the gap", () => {
  const stamped = Array.from({ length: 60 }, (_, tick) => changing(tick));
  const arrivalOffset = (tick) => (tick % 2 ? 1 : -1);
  const refused = serverApplied(stamped, {
    oneWayTicks: 2,
    bufferTicks: 0,
    arrivalOffset,
  });
  const accepted = serverApplied(stamped, {
    oneWayTicks: 2,
    bufferTicks: 1,
    arrivalOffset,
  });
  expect(accepted).not.toEqual(refused);
  expect(accepted).toEqual(stamped);
  expect(run(accepted)).toBe(run(stamped));
});

test("client stepping twice per server tick diverges, and its gap grows with duration", () => {
  const stamped = Array.from({ length: 60 }, (_, tick) => coasting(tick));
  const longer = Array.from({ length: 120 }, (_, tick) => coasting(tick));
  const gapAt60 = Math.abs(run(stamped, 2) - run(stamped, 1));
  const gapAt120 = Math.abs(run(longer, 2) - run(longer, 1));
  expect(gapAt60).toBeGreaterThan(0);
  expect(gapAt120).toBeGreaterThan(gapAt60); // divergence accumulates, it does not settle
  expect(run(stamped, 1)).toBe(run(stamped)); // coalescing to one quantum per tick is exact
});
