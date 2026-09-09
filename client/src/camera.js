import { coordinate, MAX_SEGMENTS } from "./physics/geometry.js";

// Physics manifests are immutable. Cache geometry once, never scan footholds per frame.
const cameraRects = new WeakMap();
// 00437b32: the camera target vector is attached fifty pixels above local-user feet.
const CAMERA_TARGET_Y = -50;

/** Missing authored VR edges use geometry; present values still require valid coordinates. */
function vrCoordinate(value, fallback) {
  return value === undefined || value === null ? fallback : coordinate(value);
}

/** Original 00641ef1 VR defaults use geometry globals; foothold extrema are the explicit local interpretation. */
function cameraRect(physics) {
  if (!physics || !physics.map || !Array.isArray(physics.footholds)) {
    throw new Error("Camera requires original physics map and footholds");
  }
  const cached = cameraRects.get(physics);
  if (cached) return cached;
  if (physics.footholds.length > MAX_SEGMENTS) {
    throw new Error("Camera foothold budget exceeded");
  }
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const foothold of physics.footholds) {
    const x1 = coordinate(foothold.x1),
      x2 = coordinate(foothold.x2);
    const y1 = coordinate(foothold.y1),
      y2 = coordinate(foothold.y2);
    left = Math.min(left, x1, x2);
    right = Math.max(right, x1, x2);
    top = Math.min(top, y1, y2);
    bottom = Math.max(bottom, y1, y2);
  }
  const map = physics.map;
  const rect = {
    left: vrCoordinate(map.VRLeft, left - 20),
    right: vrCoordinate(map.VRRight, right + 20),
    top: vrCoordinate(map.VRTop, top - 60),
    bottom: vrCoordinate(map.VRBottom, bottom + 100),
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

/** Mutate world-pixel top-left camera. physics is the immutable manifest.physics, not simulation.bounds.
 * At 800x600 uses original VR/half-screen rules; all other sizes generalize half-viewport as browser policy.
 * VRLimit affects physical clipping, not this camera rectangle. Returns the same camera object. */
export function followCamera(camera, pose, physics, viewport) {
  if (
    !camera ||
    !Number.isFinite(pose?.x) ||
    !Number.isFinite(pose?.y) ||
    !Number.isFinite(viewport?.width) ||
    !Number.isFinite(viewport?.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    throw new Error("Invalid camera position or viewport");
  }
  const rect = cameraRect(physics);
  camera.x = followAxis(pose.x, rect.left, rect.right, viewport.width);
  camera.y = followAxis(
    pose.y + CAMERA_TARGET_Y,
    rect.top,
    rect.bottom,
    viewport.height,
  );
  return camera;
}
