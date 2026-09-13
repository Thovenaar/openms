/** Original x86 equations: docs/drop-motion.md and ghidra-drop-motion evidence. */
export const DROP_MOTION = Object.freeze({
  quantumMs: 30,
  hoverAmplitude: 3,
  hoverPhase: 0.09424769999999999,
  itemRotationMs: 300,
  pickupMs: 700,
  // 00505559..005055d8 fades spawn mode3 to zero in1000ms;005050ab caps its lifetime.
  disappearFadeMs: 1000,
  disappearLifetimeMs: 3000,
});

/** 00506142 vector+0xa0 -> Shape2D51408b08: zero-angle mode repeats360deg/300ms.
 * The renderer may advance the visual clock within one admitted update interval.
 */
export function dropRotation(motion, elapsed = 0, item = true) {
  if (!item || (motion.state !== "launching" && motion.state !== "falling")) {
    return 0;
  }
  return (
    (((motion.age + elapsed) % DROP_MOTION.itemRotationMs) /
      DROP_MOTION.itemRotationMs) *
    Math.PI *
    2
  );
}

/** Native asymmetric rounding, 005051c3..005051dc; do not use Math.round. */
function nativeRound(value) {
  return Math.trunc(value >= 0 ? value + 0.5 : value - 0.499999999);
}

/** 005064ff: source/landing Y are packet coordinates; ownership type 3 is explosive. */
export function flightDuration(sourceY, groundY, explosive = false) {
  const scale = explosive ? 1.8 : 1;
  if (sourceY <= groundY) return Math.trunc(scale * 1000);
  const apex = explosive ? 180 : 100;
  const height = groundY + apex - sourceY;
  if (height < 0) {
    throw new Error("Native drop apex cannot reach landing foothold");
  }
  const root = Math.sqrt(height * 2.5);
  return Math.trunc(
    Math.min((Math.trunc(root) + 1) * 30 + scale * 500, scale * 1000),
  );
}

/** Initialize preallocated motion state; source and destination are finite field points. */
export function launchDrop(slot, source, point, explosive = false) {
  slot.state = "waiting";
  slot.age = 0;
  slot.phaseAge = 0;
  slot.sourceX = slot.x = Math.trunc(source.x);
  slot.sourceY = slot.y = Math.trunc(source.y);
  slot.groundX = Math.trunc(point.x);
  slot.groundY = Math.trunc(point.y);
  slot.durationMs = flightDuration(slot.sourceY, slot.groundY, explosive);
  slot.launchSpeed = explosive ? 720 : 400;
  slot.rotation = 0;
  slot.alpha = 1;
}

/** 00505117..00505426; returns true only on the landing transition. */
export function stepDropFlight(slot) {
  const age = slot.phaseAge;
  slot.rotation = dropRotation(slot, 0, Boolean(slot.itemId));
  if (slot.state === "falling") {
    slot.y = nativeRound(slot.sourceY + (age / 1000) * slot.launchSpeed);
    if (slot.y < slot.groundY) return false;
  } else {
    const late =
      age <= 500 ? 0 : Math.min(1, (age - 500) / (slot.durationMs - 500));
    const horizontal = Math.min(1, age * 0.002) + late;
    slot.x = nativeRound(
      slot.sourceX + (slot.groundX - slot.sourceX) * 0.5 * horizontal,
    );
    const seconds = age * 0.001;
    slot.y = nativeRound(
      slot.sourceY - seconds * slot.launchSpeed + seconds * seconds * 400,
    );
    if (age < slot.durationMs) return false;
    if (slot.sourceY < slot.groundY) {
      slot.state = "falling";
      slot.phaseAge = 0;
      slot.x = slot.groundX;
      return false;
    }
  }
  slot.state = "grounded";
  slot.phaseAge = 0;
  slot.x = slot.groundX;
  slot.y = slot.groundY;
  slot.rotation = 0;
  return true;
}

/** Spawn mode3 fades during ordinary flight, not after landing (0050552a..00505626). */
export function fadeDisappearingDrop(slot) {
  const remaining =
    DROP_MOTION.disappearFadeMs - (slot.age - DROP_MOTION.quantumMs);
  slot.alpha = Math.max(
    0,
    Math.trunc((255 * remaining) / DROP_MOTION.disappearFadeMs) / 255,
  );
  return (
    slot.state === "grounded" || slot.age > DROP_MOTION.disappearLifetimeMs
  );
}

/** 00504d98..00504e44: integer projection of the original 30ms sine oscillator. */
export function hoverDrop(slot) {
  slot.y = Math.trunc(
    slot.groundY +
      DROP_MOTION.hoverAmplitude *
        Math.sin((slot.phaseAge / 30) * DROP_MOTION.hoverPhase),
  );
}

/** 004416db: 700ms live-target interpolation with a 40px quadratic pickup arc. */
export function collectDrop(slot) {
  const age = slot.phaseAge;
  if (age >= DROP_MOTION.pickupMs) return true;
  const target = slot.target;
  const remaining = DROP_MOTION.pickupMs - age;
  slot.x = Math.trunc(
    (remaining * slot.sourceX + age * Math.trunc(target.x)) / 700,
  );
  slot.y = dropDrawY(slot, 0);
  slot.alpha =
    age <= 420 ? 1 : (255 + Math.trunc(((420 - age) * 192) / 280)) / 255;
  return false;
}

/** Project the packet-space Y with native canvas centering before integer division. */
export function dropDrawY(slot, halfHeight) {
  if (slot.state === "grounded" || slot.state === "pending") {
    return Math.trunc(
      slot.groundY -
        halfHeight +
        DROP_MOTION.hoverAmplitude *
          Math.sin((slot.phaseAge / 30) * DROP_MOTION.hoverPhase),
    );
  }
  if (slot.state !== "collecting") return slot.y - halfHeight;
  const age = slot.phaseAge;
  const targetY = Math.trunc(slot.target.y) - Math.trunc(slot.targetHeight / 2);
  return (
    Math.trunc(
      ((700 - age) * (slot.sourceY - halfHeight) + age * targetY) / 700,
    ) -
    40 +
    Math.trunc(((age - 350) * (age - 350) * 160) / 490000)
  );
}
