import { coordinate } from "./geometry.js";

/** 00a44889..cb: validated foothold extrema, not camera bounds. */
export function prepareBounds(segments, map) {
  const bounds = {
    left: Infinity,
    top: Infinity,
    right: -Infinity,
    bottom: -Infinity,
  };
  for (const segment of segments) {
    bounds.left = Math.min(bounds.left, segment.x1 + 30, segment.x2 + 30);
    bounds.right = Math.max(bounds.right, segment.x1 - 30, segment.x2 - 30);
    bounds.top = Math.min(bounds.top, segment.y1 - 300, segment.y2 - 300);
    bounds.bottom = Math.max(bounds.bottom, segment.y1 + 10, segment.y2 + 10);
  }
  if (map.VRLimit) restrictViewport(bounds, map);
  if (bounds.left > bounds.right || bounds.top > bounds.bottom) {
    throw new Error("Reversed original physical world bounds");
  }
  return bounds;
}

/** 00a44c41..94: zero properties do not restrict the original rectangle. */
function restrictViewport(bounds, map) {
  const left = coordinate(map.VRLeft ?? 0);
  const right = coordinate(map.VRRight ?? 0);
  const top = coordinate(map.VRTop ?? 0);
  const bottom = coordinate(map.VRBottom ?? 0);
  if (left !== 0) bounds.left = Math.max(bounds.left, left + 20);
  if (right !== 0) bounds.right = Math.min(bounds.right, right - 20);
  if (top !== 0) bounds.top = Math.max(bounds.top, top + 65);
  if (bottom !== 0) bounds.bottom = Math.min(bounds.bottom, bottom);
}

/** Original toward-zero consumed-time conversion; no duration is fabricated. */
function clippedMilliseconds(before, after, clipped, milliseconds) {
  if (before === after) return milliseconds;
  return Math.max(
    0,
    Math.min(
      milliseconds,
      Math.trunc(((clipped - before) / (after - before)) * milliseconds),
    ),
  );
}

/** 009b47aa: clamp grounded X through scalar distance before endpoint arbitration. */
export function clipGround(sim, startPosition, milliseconds) {
  const segment = sim.foothold;
  const x = segment.x1 + segment.tx * sim.position;
  const clipped = Math.max(sim.bounds.left, Math.min(sim.bounds.right, x));
  if (clipped === x) return milliseconds;
  const previous = sim.position;
  sim.position = (clipped - segment.x1) / segment.tx;
  sim.speed = 0;
  return clippedMilliseconds(
    startPosition,
    previous,
    sim.position,
    milliseconds,
  );
}

/** 009b45c1: clamp X and the top only; falling below the bottom is not a floor. */
export function clipAir(sim, sweep, milliseconds) {
  const x = Math.max(sim.bounds.left, Math.min(sim.bounds.right, sim.x));
  let elapsed = milliseconds;
  if (x !== sim.x) {
    elapsed = clippedMilliseconds(sweep.previousX, sim.x, x, milliseconds);
    sim.x = x;
    sim.vx = 0;
  }
  if (sim.y < sim.bounds.top) {
    elapsed = Math.min(
      elapsed,
      clippedMilliseconds(sweep.previousY, sim.y, sim.bounds.top, milliseconds),
    );
    sim.y = sim.bounds.top;
    sim.vy = 0;
  }
  return elapsed;
}
