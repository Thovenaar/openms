import { accelerate, approach } from "../physics/dynamics.js";
import { hasMobStatus } from "./mob-skill-status.js";

/** 004fe802/00af29e0 base ability mass; not the player's glide controller. */
const MASS = 100;
/** 009bd799 emits intent outside a ten-pixel target band. */
const TARGET_BAND = 10;
const geometryGroups = new WeakMap();

/** 00a4484a..a44901: per-group X spans and original foothold membership. */
function flightGeometry(geometry) {
  const cached = geometryGroups.get(geometry);
  if (cached) return cached;
  const groups = [],
    byId = new Map();
  for (const segment of geometry.segments) {
    let group = byId.get(segment.group);
    if (!group) {
      group = {
        id: segment.group,
        left: Infinity,
        right: -Infinity,
        segments: [],
      };
      byId.set(segment.group, group);
      groups.push(group);
    }
    group.left = Math.min(group.left, segment.x1, segment.x2);
    group.right = Math.max(group.right, segment.x1, segment.x2);
    group.segments.push(segment);
  }
  if (!groups.length) {
    throw new Error("Flying controller requires original foothold groups");
  }
  geometryGroups.set(geometry, groups);
  return groups;
}

/** Offline deterministic seeds, not recovered server seeds. Seven independent native streams
 * prevent goal selection from consuming the combat/drop random word sequence. */
function flightRandomWords(record) {
  const words = new Uint32Array(21);
  let seed =
    (Number(record.authored.id) ^
      Math.imul(Number(record.id.slice(5)) + 1, 0x9e3779b1)) >>>
    0;
  for (let index = 0; index < words.length; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const part = index % 3;
    words[index] = seed | (part === 0 ? 2 : part === 1 ? 8 : 16);
  }
  return words;
}

/** 004165ec: native unsigned Tausworthe update; only the three live words are needed. */
function flightRandom(goals, stream) {
  const words = goals.random,
    index = stream * 3;
  const a = words[index],
    b = words[index + 1],
    c = words[index + 2];
  const x = (((a >>> 13) ^ (a & 0x7ffc0)) >>> 6) ^ ((a & 0xfffffffe) << 12);
  const y = (((b & 0x3f800000) ^ (b >>> 2)) >>> 23) ^ ((b & 0xfffffff8) << 4);
  const z = (((c & 0x1fffff00) ^ (c >>> 3)) >>> 8) ^ ((c & 0xfffffff0) << 17);
  words[index] = x;
  words[index + 1] = y;
  words[index + 2] = z;
  return (x ^ y ^ z) >>> 0;
}

function createFlightGoals(record, geometry) {
  return {
    groups: flightGeometry(geometry),
    random: flightRandomWords(record),
    group: null,
    remaining: 0,
    active: false,
    chasing: false,
    blocked: false,
    targetRevision: 0,
    leaseMs: 0,
    horizontal: 0,
    vertical: 0,
    ascent: false,
  };
}

/** Borrow immutable geometry/environment; allocate every flight field before play. */
export function createMobFlight(record, definition, simulation) {
  if (definition.movementType !== 3) return null;
  const g = simulation.effectiveSettings;
  for (const key of [
    "flyForce",
    "flySpeed",
    "swimForce",
    "swimSpeed",
    "floatDrag1",
    "baseDrag",
  ]) {
    if (!Number.isFinite(g?.[key]) || g[key] <= 0) {
      throw new Error("Missing original flying-mob physics coefficient");
    }
  }
  const bounds = simulation.bounds;
  if (
    !bounds ||
    ![bounds.left, bounds.right, bounds.top, bounds.bottom].every(
      Number.isFinite,
    ) ||
    bounds.left > bounds.right - 1 ||
    bounds.top > bounds.bottom - 1
  ) {
    throw new Error("Invalid original flying-mob world bounds");
  }
  return {
    vx: 0,
    vy: 0,
    bounds,
    waterAreas: simulation.waterAreas,
    mapSwimming: simulation.baseMode === "swim",
    swimming: false,
    flyAcceleration: g.flyForce / MASS,
    swimAcceleration: g.swimForce / MASS,
    baseFlySpeed: g.flySpeed,
    baseSwimSpeed: g.swimSpeed,
    drag: (g.floatDrag1 * g.baseDrag) / MASS,
    speedPercent: definition.flySpeedPercent,
    speedLimit: 0,
    acceleration: 0,
    goals: createFlightGoals(record, simulation.geometry),
    goalX: record.authored.x,
    goalY: record.authored.y,
  };
}

/** Native007046ac samples water at this actor, never at the local player. */
function flightSwimming(mob) {
  const flight = mob.flight;
  if (flight.mapSwimming) return true;
  const x = Math.trunc(mob.x),
    y = Math.trunc(mob.y);
  for (const area of flight.waterAreas) {
    if (
      x >= area.left &&
      x <= area.right &&
      y >= area.top &&
      y <= area.bottom
    ) {
      return true;
    }
  }
  return false;
}

/** Local aggro admits a target;009bbd88 owns its180–240s lease and resets a new chase. */
function flightTarget(mob, target) {
  const flight = mob.flight,
    goals = flight.goals;
  const revision = mob.aggro.damageInstances;
  const renewed = revision > goals.targetRevision;
  goals.targetRevision = revision;
  if (!target || (revision === 0 && !hasMobStatus(mob, "inert"))) {
    goals.chasing = false;
    goals.blocked = false;
    return null;
  }
  if (goals.blocked && !renewed) return null;
  if (!goals.chasing || renewed) {
    goals.leaseMs = (flightRandom(goals, 0) % 60000) + 180000;
  }
  if (!goals.chasing) {
    goals.active = false;
    goals.group = null;
    goals.remaining = 0;
    flight.goalX = 0;
    flight.goalY = 0;
  }
  goals.chasing = true;
  goals.blocked = false;
  return target;
}

function releaseFlightTarget(goals) {
  goals.chasing = false;
  goals.blocked = true;
}

/** Native POINT/PtInRect semantics: integer coordinates and half-open edges. */
function insideFlightGoal(flight, point, band) {
  const x = Math.trunc(point.x),
    y = Math.trunc(point.y);
  return (
    x >= flight.goalX - band &&
    x < flight.goalX + band &&
    y >= flight.goalY - band &&
    y < flight.goalY + band
  );
}

function flightIntent(mob) {
  const flight = mob.flight,
    goals = flight.goals;
  const dx = flight.goalX - mob.x,
    dy = flight.goalY - mob.y;
  goals.horizontal = Math.abs(dx) < TARGET_BAND ? 0 : Math.sign(dx);
  goals.vertical = Math.abs(dy) < TARGET_BAND ? -1 : 0;
  goals.ascent = goals.vertical === 0 && dy < 0;
}

/** 009bd9d9..da95:60–119 visits, X offset[-120,119], Y offset[-40,39]. */
function chaseFlightGoal(flight, target) {
  const goals = flight.goals;
  if (goals.remaining === 0) {
    goals.remaining = (flightRandom(goals, 0) % 60) + 60;
  }
  flight.goalX = Math.trunc(target.x) + (flightRandom(goals, 2) % 240) - 120;
  flight.goalY = Math.trunc(target.y) + (flightRandom(goals, 3) % 80) - 40;
  goals.group = null;
  goals.remaining--;
  goals.active = true;
}

/** 009bdacf..dc96: choose a group, then a foothold, distance and height.
 * The0050d811 tangent projection uses50.0 at00b3e6e8; rx0/rx1 do not constrain flight. */
function roamFlightGoal(flight) {
  const goals = flight.goals;
  if (goals.remaining < 1 || !goals.group) {
    goals.group = goals.groups[flightRandom(goals, 1) % goals.groups.length];
    goals.remaining =
      (goals.group.right -
        goals.group.left +
        40 +
        (flightRandom(goals, 0) % 200)) >>>
      3;
  }
  const segments = goals.group.segments;
  const segment = segments[flightRandom(goals, 4) % segments.length];
  const distance = flightRandom(goals, 5) % Math.trunc(segment.length);
  flight.goalX = Math.trunc(segment.x1 + segment.tx * distance);
  flight.goalY = Math.trunc(
    segment.y1 + segment.ty * distance + (flightRandom(goals, 6) % 60) - 50,
  );
  goals.remaining--;
  goals.active = true;
}

/** 009bd799 samples the old goal's intent before choosing its replacement.
 * Arrival uses±11; moving targets invalidate their waypoint outside±150. */
function flightGoal(mob, target) {
  const flight = mob.flight,
    goals = flight.goals;
  target = flightTarget(mob, target);
  goals.ascent = false;
  if (goals.active) {
    flightIntent(mob);
    if (
      insideFlightGoal(flight, mob, 11) ||
      (target && !insideFlightGoal(flight, target, 150))
    ) {
      goals.active = false;
    }
  }
  if (!goals.active) {
    if (target) {
      chaseFlightGoal(flight, target);
      if (goals.remaining < 1) {
        releaseFlightTarget(goals);
        target = null;
      }
    }
    if (!target) roamFlightGoal(flight);
  }
}

/** 009bca2a decrements this lease even when status/pose suppresses movement. */
export function stepMobFlightClock(flight, ms) {
  const goals = flight.goals;
  if (!goals.chasing) return;
  goals.leaseMs -= ms;
  if (goals.leaseMs < 0) releaseFlightTarget(goals);
}

/** 009b324e/333b: drag first removes overspeed, without crossing the limit. */
function flightOverspeed(velocity, limit, braking) {
  if (velocity > limit) return Math.max(limit, velocity - braking);
  if (velocity < -limit) return Math.min(-limit, velocity + braking);
  return velocity;
}

/** 009b313d..3414: non-player buoyancy, not the009b2ee3 player-glide branch.
 * Up input slows descent to+0.3*limit; actual ascent uses the separate impulse. */
function flightVertical(flight, vertical, seconds) {
  const velocity = flightOverspeed(
    flight.vy,
    flight.speedLimit,
    flight.drag * seconds,
  );
  if (vertical === 0) {
    return accelerate(
      velocity,
      flight.acceleration,
      flight.speedLimit,
      seconds,
    );
  }
  // Original doubles00afe800=0.3 and00af0d48=0.5; this controller emits only-1/0.
  const target = flight.speedLimit * 0.3;
  const acceleration = flight.acceleration * (velocity < target ? 0.5 : 1);
  return approach(velocity, target, acceleration * seconds);
}

/** Apply the intent sampled before native waypoint selection. */
function flightVelocity(mob, seconds) {
  const flight = mob.flight;
  const horizontal = flight.goals.horizontal;
  const vertical = flight.goals.vertical;
  flight.vx = flightOverspeed(
    flight.vx,
    flight.speedLimit,
    flight.drag * seconds,
  );
  flight.vx =
    horizontal === 0
      ? approach(flight.vx, 0, flight.drag * seconds)
      : accelerate(
          flight.vx,
          horizontal * flight.acceleration,
          flight.speedLimit,
          seconds,
        );
  flight.vy = flightVertical(flight, vertical, seconds);
  if (horizontal !== 0) mob.facing = horizontal;
}

/** 009b1d3d ascent impulse is-limit (water:-5*limit), then009b2c3c midpoint motion.
 * The owner supplies the fixed quantum; rendering and residency cannot advance it. */
export function stepMobFlight(mob, ms, target, movementScale) {
  const flight = mob.flight;
  flightGoal(mob, target);
  flight.swimming = flightSwimming(mob);
  const percent = Math.max(
    10,
    Math.min(140, flight.speedPercent + 100 * (movementScale - 1)),
  );
  const speed = flight.swimming ? flight.baseSwimSpeed : flight.baseFlySpeed;
  flight.speedLimit = (speed * percent) / 100;
  flight.acceleration = flight.swimming
    ? flight.swimAcceleration
    : flight.flyAcceleration;
  const seconds = ms / 1000;
  // Jump changes velocity before009b2c3c snapshots it for midpoint integration.
  if (flight.goals.ascent) {
    flight.vy = -flight.speedLimit * (flight.swimming ? 5 : 1);
  }
  const vx = flight.vx,
    vy = flight.vy;
  flightVelocity(mob, seconds);
  mob.x += (vx + flight.vx) * 0.5 * seconds;
  mob.y += (vy + flight.vy) * 0.5 * seconds;
  // 009be14f controller3 skips foothold collision and clips all four edges.
  const bounds = flight.bounds;
  mob.x = Math.max(bounds.left, Math.min(bounds.right - 1, mob.x));
  mob.y = Math.max(bounds.top, Math.min(bounds.bottom - 1, mob.y));
}

/** 009bbdfd mode3 ordinary/strong recoil starts with vy0 and brakes world X.
 * Its009b45c1 boundary is not the idle controller's authored patrol rectangle. */
export function moveMobFlightRecoil(mob, distance) {
  const flight = mob.flight,
    bounds = flight.bounds;
  const x = mob.x + distance;
  mob.x = Math.max(bounds.left, Math.min(bounds.right, x));
  mob.y = Math.max(bounds.top, mob.y);
  if (mob.x !== x) mob.knockbackSpeed = 0;
  flight.vx = mob.knockbackFacing * mob.knockbackSpeed;
  flight.vy = 0;
}

/** Death/respawn cannot retain an old chase velocity or change simulation order. */
export function resetMobFlight(mob) {
  const flight = mob.flight;
  if (!flight) return;
  flight.vx = 0;
  flight.vy = 0;
  const goals = flight.goals;
  goals.group = null;
  goals.remaining = 0;
  goals.active = false;
  goals.chasing = false;
  goals.blocked = false;
  goals.targetRevision = 0;
  goals.leaseMs = 0;
  goals.horizontal = 0;
  goals.vertical = 0;
  goals.ascent = false;
  flight.goalX = mob.spawnX;
  flight.goalY = mob.spawnY;
}
