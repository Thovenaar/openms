import { attachGround } from "./geometry.js";

const QUANTUM_MS = 30;
const MAX_STEPS = 8;

/**00952e28..00952eff:90ms fixed delta then180ms integer decay;0094e6d3 consumes30ms. */
export function createRushMotion() {
  return {
    remainingMs: 0,
    phaseMs: 0,
    phase: 0,
    delta: 0,
    initialDelta: 0,
    accumulatorMs: 0,
    waitMs: 0,
  };
}

export function beginRushMotion(motion, distance, facing) {
  motion.remainingMs = 270;
  motion.phaseMs = 90;
  motion.phase = 0;
  motion.delta = facing * Math.abs(Math.trunc(distance / 8));
  motion.initialDelta = motion.delta;
  motion.accumulatorMs = 0;
  motion.waitMs = 0;
}

export function advanceRushMotion(sim, motion, ms) {
  if (motion.remainingMs <= 0) return;
  motion.accumulatorMs += ms;
  for (
    let count = 0;
    count < MAX_STEPS && motion.accumulatorMs >= QUANTUM_MS;
    count++
  ) {
    motion.accumulatorMs -= QUANTUM_MS;
    if (motion.remainingMs <= 0) break;
    if (motion.waitMs > 0) {
      motion.waitMs -= QUANTUM_MS;
      continue;
    }
    if (motion.phaseMs === 0) {
      motion.phase = 2;
      motion.phaseMs = 180;
      motion.delta = motion.initialDelta;
    }
    //0094e754 multiplies by double00af0d40=0.8, then truncates to an integer.
    if (motion.phase === 2) motion.delta = Math.trunc(motion.delta * 0.8);
    const tolerance =
      motion.phase === 2
        ? Math.abs(motion.delta)
        : Math.abs(Math.max(30, motion.delta));
    if (!moveSkillGround(sim, motion.delta, tolerance)) {
      motion.remainingMs = 0;
      break;
    }
    motion.phaseMs -= QUANTUM_MS;
    motion.remainingMs -= QUANTUM_MS;
  }
}

/**0094e78d/0094e7b0 choose the nearest floor above/below, never move into an unsupported gap. */
export function moveSkillGround(sim, delta, tolerance) {
  const x = sim.x + delta;
  if (x < sim.bounds.left || x > sim.bounds.right) return false;
  let selected = null;
  let distance = Infinity;
  let selectedY = sim.y;
  for (const segment of sim.geometry.segments) {
    if (segment.dx <= 0 || x < segment.x1 || x > segment.x2) continue;
    const y = segment.y1 + ((x - segment.x1) * segment.dy) / segment.dx;
    const dy = Math.abs(y - sim.y);
    if (dy > tolerance || dy >= distance) continue;
    selected = segment;
    selectedY = y;
    distance = dy;
  }
  if (!selected) return false;
  sim.previousX = sim.x;
  sim.previousY = sim.y;
  sim.x = x;
  sim.y = selectedY;
  sim.vx = 0;
  sim.vy = 0;
  attachGround(sim, selected);
  return true;
}
