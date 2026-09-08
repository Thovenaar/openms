/** 004fe802 / 00af29e0: base movement-ability mass. */
const MASS = 100;
/** 004fe802 / 00af32d8: base slope-slip threshold. */
const SLIP_THRESHOLD = 0.9;

/** 009b2bcb: accelerate only toward force-directed speed bound. */
export function accelerate(velocity, acceleration, limit, seconds) {
  if (limit < 0) return velocity;
  if (acceleration > 0 && velocity < limit) {
    return Math.min(limit, velocity + acceleration * seconds);
  }
  if (acceleration <= 0 && velocity > -limit) {
    return Math.max(-limit, velocity + acceleration * seconds);
  }
  return velocity;
}

/** Original braking does not overshoot zero/the selected bound. */
export function approach(value, target, amount) {
  if (value > target) return Math.max(target, value - amount);
  return Math.min(target, value + amount);
}

/** Original flat/slope ground branch 009b23f2; base avatar modifiers only. */
export function groundVelocity(sim, direction, seconds) {
  const g = sim.effectiveSettings;
  if (unresolvedConveyor(sim, direction)) return sim.speed;
  const slope = sim.foothold.ty;
  const magnitude = Math.abs(slope);
  const square = slope * slope;
  const uphill = -Math.sign(slope);
  const friction = Math.max(
    g.minFriction,
    Math.min(g.maxFriction, g.friction * sim.foothold.friction),
  );
  const drag = (g.walkDrag * friction * (friction < 1 ? 0.5 : 1)) / MASS;
  const swimScale = sim.movementMode === "swim" ? g.swimSpeedDec : 1;
  const baseLimit =
    g.walkSpeed * swimScale * conveyorScale(sim.foothold.conveyor, direction);
  const downhillLimit = baseLimit * (1 + square);
  const force =
    conveyorForce(sim.foothold.conveyor, direction, swimScale) *
    g.walkForce *
    g.forceScale *
    (slope < 0 ? 1 - square : 1 + square);
  const velocityLimit = uphill * sim.speed > 0 ? baseLimit : downhillLimit;
  sim.speed = brakeOverspeed(sim.speed, velocityLimit, drag * seconds);
  if (magnitude > SLIP_THRESHOLD) {
    return steepVelocity(sim, direction, force, seconds);
  }
  if (direction === 0 && sim.foothold.conveyor === 0) {
    return approach(sim.speed, 0, drag * seconds);
  }
  const limit = uphill * force > 0 ? baseLimit : downhillLimit;
  return accelerate(sim.speed, force / MASS, limit, seconds);
}

/** 009b2582..2712: force is signed hundredths, integer magnitude controls limits. */
function conveyorScale(conveyor, direction) {
  if (conveyor === 0) return 1;
  const magnitude = Math.abs(Math.trunc(conveyor));
  if (direction === 0) return magnitude;
  return direction * conveyor > 0 ? magnitude * 2 : 0.2 / magnitude;
}

function conveyorForce(conveyor, direction, swimScale) {
  if (direction === 0) return conveyor;
  return direction * swimScale * conveyorScale(conveyor, direction);
}

function unresolvedConveyor(sim, direction) {
  const conveyor = sim.foothold.conveyor;
  if (direction * conveyor >= 0 || Math.abs(conveyor) >= 1) return false;
  sim.diagnostics.fault = "original-conveyor-division-by-zero";
  return true;
}

/** Original 009b29xx steep-slip branch; uphill input halves natural sliding. */
function steepVelocity(sim, direction, walkForce, seconds) {
  const g = sim.effectiveSettings;
  const slope = sim.foothold.ty;
  const uphill = -Math.sign(slope);
  let force = slope * g.slipForce;
  let limit = Math.abs(slope) * g.slipSpeed;
  if (direction * uphill > 0) {
    force *= 0.5;
    limit *= 0.5;
  } else if (direction !== 0 || sim.foothold.conveyor !== 0) {
    force += walkForce;
    const swimScale = sim.movementMode === "swim" ? g.swimSpeedDec : 1;
    limit +=
      (1 + slope * slope) *
      g.walkSpeed *
      swimScale *
      conveyorScale(sim.foothold.conveyor, direction);
  }
  if (uphill * sim.speed > 0) {
    const friction = Math.max(
      g.minFriction,
      Math.min(g.maxFriction, g.friction * sim.foothold.friction),
    );
    const drag = (g.walkDrag * friction * (friction < 1 ? 0.5 : 1)) / MASS;
    sim.speed = approach(sim.speed, 0, drag * seconds);
  }
  return accelerate(sim.speed, force / MASS, limit, seconds);
}

function brakeOverspeed(value, limit, amount) {
  if (value > limit) return approach(value, limit, amount);
  if (value < -limit) return approach(value, -limit, amount);
  return value;
}

/** Ordinary-air branch 009b2c3c, global offsets 28/30/38/60/68. */
export function airVelocity(sim, direction, seconds) {
  const g = sim.effectiveSettings;
  const fallLimit = g.fallSpeed * g.gravity;
  if (sim.vy > fallLimit) {
    sim.vy = approach(
      sim.vy,
      fallLimit,
      ((g.floatDrag2 * g.drag) / MASS) * seconds,
    );
  }
  sim.vy = accelerate(sim.vy, g.gravityAcc * g.gravity, fallLimit, seconds);
  const drag = g.floatDrag2 * g.drag;
  const limit = (g.walkSpeed / g.walkForce) * drag;
  if (direction !== 0) {
    sim.vx = accelerate(sim.vx, (direction * drag * 2) / MASS, limit, seconds);
    return;
  }
  const coefficient = sim.vy < g.fallSpeed * g.gravity ? g.floatCoefficient : 1;
  sim.vx = approach(sim.vx, 0, ((drag * coefficient) / MASS) * seconds);
}

/** Buoyant branch 009b2c3c: independent force and drag on both axes. */
export function floatVelocity(sim, horizontal, vertical, seconds) {
  const g = sim.effectiveSettings;
  const swimming = sim.state === "swim";
  const force = swimming ? g.swimForce : g.flyForce;
  const limit = swimming ? g.swimSpeed : g.flySpeed;
  const drag = (g.floatDrag1 * g.drag) / MASS;
  sim.vx = brakeOverspeed(sim.vx, limit, drag * seconds);
  if (horizontal === 0) sim.vx = approach(sim.vx, 0, drag * seconds);
  else sim.vx = accelerate(sim.vx, (horizontal * force) / MASS, limit, seconds);
  floatVertical(sim, vertical, seconds);
}

function floatVertical(sim, vertical, seconds) {
  const g = sim.effectiveSettings;
  const swimming = sim.state === "swim";
  const force = swimming ? g.swimForce : g.flyForce;
  const limit = swimming ? g.swimSpeed : g.flySpeed;
  const drag = (g.floatDrag1 * g.drag) / MASS;
  const verticalLimit = swimming ? limit : g.fallSpeed * 0.015;
  sim.vy = brakeOverspeed(sim.vy, verticalLimit, drag * seconds);
  if (vertical === 0 || (!swimming && vertical < 0)) {
    sim.vy = accelerate(sim.vy, force / MASS, verticalLimit, seconds);
    return;
  }
  let target = vertical < 0 ? -limit * 0.3 : limit * 1.5;
  if (!swimming) target = verticalLimit * 7;
  const acceleration = (force / MASS) * (sim.vy < target ? 0.5 : 1);
  sim.vy = approach(sim.vy, target, acceleration * seconds);
}
