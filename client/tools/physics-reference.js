import {
  createSimulation,
  advanceSimulation,
  snapshotSimulation,
} from "../src/physics/simulation.js";

const INPUT_KEYS = ["left", "right", "up", "down", "jump", "attack"];
const MAX_TRACE_EVENTS = 10000;
const MAX_TRACE_MS = 600000;

/** Trace timings are milliseconds; keys are booleans, not synthetic key codes. */
function validateTrace(trace) {
  if (!Array.isArray(trace.events) || trace.events.length > MAX_TRACE_EVENTS) {
    throw new Error("Invalid input trace events");
  }
  if (
    !Number.isFinite(trace.durationMs) ||
    trace.durationMs <= 0 ||
    trace.durationMs > MAX_TRACE_MS
  ) {
    throw new Error("Invalid trace duration");
  }
  let previous = 0;
  for (const event of trace.events) {
    if (
      !Number.isFinite(event.atMs) ||
      event.atMs < previous ||
      event.atMs > trace.durationMs
    ) {
      throw new Error("Input trace timestamps must be ordered and bounded");
    }
    if (!INPUT_KEYS.includes(event.key) || typeof event.down !== "boolean") {
      throw new Error("Invalid input trace key transition");
    }
    previous = event.atMs;
  }
}

/** Apply an exact-time input boundary; snapshots are outside the simulation tick. */
function applyEvent(input, event) {
  if (event.key === "jump" && event.down && !input.jump) {
    input.jumpPressed = true;
  }
  input[event.key] = event.down;
}

/** @param {object} world @param {object} trace @param {number} refreshHz */
export function replayTrace(world, trace, refreshHz) {
  validateTrace(trace);
  if (!Number.isFinite(refreshHz) || refreshHz < 1 || refreshHz > 1000) {
    throw new Error("Invalid replay refresh rate");
  }
  const sim = createSimulation(world, trace.spawn);
  const input = {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    attack: false,
    jumpPressed: false,
  };
  const frameMs = 1000 / refreshHz;
  const frameLimit =
    Math.ceil(trace.durationMs / frameMs) + trace.events.length + 1;
  let elapsed = 0;
  let eventIndex = 0;
  let minimumY = sim.y;
  function observeStep() {
    minimumY = Math.min(minimumY, sim.y);
  }
  for (
    let iteration = 0;
    iteration < frameLimit && elapsed < trace.durationMs;
    iteration++
  ) {
    for (
      ;
      eventIndex < trace.events.length &&
      trace.events[eventIndex].atMs === elapsed;
      eventIndex++
    ) {
      applyEvent(input, trace.events[eventIndex]);
    }
    const nextEvent = trace.events[eventIndex]?.atMs ?? trace.durationMs;
    const end = Math.min(trace.durationMs, elapsed + frameMs, nextEvent);
    if (end <= elapsed) throw new Error("Input trace made no progress");
    advanceSimulation(sim, input, end - elapsed, observeStep);
    elapsed = end;
  }
  if (elapsed !== trace.durationMs) {
    throw new Error("Replay iteration bound exceeded");
  }
  return { refreshHz, minimumY, snapshot: snapshotSimulation(sim) };
}

/** Exact timestamp partitioning proves simulation consistency, not display hardware fidelity. */
export function compareRefreshRates(world, trace) {
  const runs = [60, 120, 144, 240].map((rate) =>
    replayTrace(world, trace, rate),
  );
  const reference = runs[0].snapshot;
  const fields = ["x", "y", "vx", "vy", "state", "footholdId", "ladderId"];
  const differences = [];
  for (const run of runs) {
    if (run.minimumY !== runs[0].minimumY) {
      differences.push({
        refreshHz: run.refreshHz,
        field: "minimumY",
        actual: run.minimumY,
        expected: runs[0].minimumY,
      });
    }
    for (const field of fields) {
      if (run.snapshot[field] !== reference[field]) {
        differences.push({
          refreshHz: run.refreshHz,
          field,
          actual: run.snapshot[field],
          expected: reference[field],
        });
      }
    }
  }
  return {
    method:
      "Deterministic exact-time input trace: final state and per-step minimumY; not full trajectory, physical refresh or original Windows parity",
    pass: differences.length === 0,
    trace,
    runs,
    differences,
  };
}
