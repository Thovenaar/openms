import { coordinate, MAX_SEGMENTS } from "../physics/geometry.js";
import { prepareBounds } from "../physics/bounds.js";

// Physics manifests are immutable. Cache geometry once, never scan footholds per frame.
const cameraRects = new WeakMap();
// 00437b32: the camera target vector is attached fifty pixels above local-user feet.
const CAMERA_TARGET_Y = -50;
// Shape2D.dll 51408e33: FCOM qword [5140d978], bytes 0000000000003c40.
const CAMERA_FILTER_DEADBAND = 28;

/** Shape2D filter 0x1e0000. Coefficient 100 is distance/time damping, not milliseconds. */
export function createCameraFilter() {
  return {
    coefficient: 100,
    initialized: false,
    committedX: 0,
    committedY: 0,
    committedTime: 0,
    x: 0,
    y: 0,
  };
}

/** 51408e33 returns D unchanged inside its 28-pixel deadband; negative residuals clamp to zero. */
function filteredAxis(target, previous, elapsed, coefficient) {
  const difference = target - previous;
  const distance = Math.abs(difference);
  let residual = distance;
  if (distance > CAMERA_FILTER_DEADBAND) {
    const scale = (coefficient * 1000) | 0;
    residual = Math.max(0, (scale * distance) / (elapsed * distance + scale));
  }
  return difference < 0 ? target + residual : target - residual;
}

/** 51408d23: integer public coordinates, DOUBLE committed history, signed renderer milliseconds.
 * First commit snaps; probes do not initialize or commit. Retargeting never resets history.
 * Input is player feet; output is the filtered attached (0,-50) camera vector. */
export function evaluateCameraFilter(filter, pose, time, commit = true) {
  if (
    !Number.isFinite(pose?.x) ||
    !Number.isFinite(pose?.y) ||
    !Number.isFinite(time)
  ) {
    throw new Error("Invalid camera filter target or render time");
  }
  const clock = Math.trunc(time) | 0;
  const elapsed = (clock - filter.committedTime) | 0;
  let x = Math.trunc(pose.x),
    y = Math.trunc(pose.y + CAMERA_TARGET_Y);
  if (filter.initialized) {
    x = filteredAxis(x, filter.committedX, elapsed, filter.coefficient);
    y = filteredAxis(y, filter.committedY, elapsed, filter.coefficient);
  }
  filter.x = Math.trunc(x);
  filter.y = Math.trunc(y);
  if (commit) {
    filter.initialized = true;
    filter.committedX = x;
    filter.committedY = y;
    filter.committedTime = clock;
  }
  return filter;
}

/** Missing authored VR edges use geometry; present values still require valid coordinates. */
function vrCoordinate(value, fallback) {
  return value === undefined || value === null ? fallback : coordinate(value);
}

/** 00641ef1 defaults read the 00a43e7b physical rectangle, including its foothold margins and VRLimit. */
function cameraRect(physics) {
  if (!physics || !physics.map || !Array.isArray(physics.footholds)) {
    throw new Error("Camera requires original physics map and footholds");
  }
  const cached = cameraRects.get(physics);
  if (cached) return cached;
  if (physics.footholds.length > MAX_SEGMENTS) {
    throw new Error("Camera foothold budget exceeded");
  }
  const map = physics.map;
  const bounds = prepareBounds(physics.footholds, map);
  const rect = {
    left: vrCoordinate(map.VRLeft, bounds.left - 20),
    right: vrCoordinate(map.VRRight, bounds.right + 20),
    top: vrCoordinate(map.VRTop, bounds.top - 60),
    bottom: vrCoordinate(map.VRBottom, bounds.bottom + 100),
  };
  if (!Object.values(rect).every(Number.isFinite)) {
    throw new Error("Camera requires finite VR bounds or foothold geometry");
  }
  cameraRects.set(physics, rect);
  return rect;
}

/** 00641ef1 collapses equal/reversed center limits to a signed integer midpoint. */
function followAxis(position, start, end, extent) {
  const half = extent / 2;
  const low = start + half,
    high = end - half;
  const center =
    high <= low
      ? Math.trunc((low + high) / 2)
      : Math.max(low, Math.min(high, position));
  // Browser interpolation/odd viewport sizes must still feed whole-pixel world vectors.
  return Math.trunc(center - half);
}

/** Project the filtered camera vector to world-pixel top-left. physics is manifest.physics, not simulation.bounds.
 * At 800x600 uses original VR/half-screen rules; all other sizes generalize half-viewport as browser policy.
 * Explicit VR edges override physical bounds; missing edges use the recovered world rectangle. */
export function followCamera(camera, target, physics, viewport) {
  if (
    !camera ||
    !Number.isFinite(target?.x) ||
    !Number.isFinite(target?.y) ||
    !Number.isFinite(viewport?.width) ||
    !Number.isFinite(viewport?.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    throw new Error("Invalid camera position or viewport");
  }
  const rect = cameraRect(physics);
  camera.x = followAxis(target.x, rect.left, rect.right, viewport.width);
  camera.y = followAxis(target.y, rect.top, rect.bottom, viewport.height);
  return camera;
}
