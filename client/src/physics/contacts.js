import {
  attachGround,
  crossingFraction,
  detachGround,
  MAX_TRANSITIONS,
  projectGround,
} from "./geometry.js";
import { clipAir, clipGround } from "./bounds.js";

/** 009b3fd1: interpolate endpoint speed, truncate consumed milliseconds, coast residual. */
export function groundContacts(sim, seconds, startPosition, startSpeed) {
  let remainingMs = clipGround(sim, startPosition, Math.round(seconds * 1000));
  if (reenterEndpoint(sim, startPosition)) {
    projectGround(sim);
    return;
  }
  for (let count = 0; count < MAX_TRANSITIONS; count++) {
    const segment = sim.foothold;
    const before = sim.position < 0;
    if (!before && sim.position <= segment.length) {
      projectGround(sim);
      return;
    }
    const endpoint = before ? 0 : segment.length;
    const fraction =
      (endpoint - startPosition) / (sim.position - startPosition);
    remainingMs -= Math.trunc(remainingMs * fraction);
    sim.speed = startSpeed + (sim.speed - startSpeed) * fraction;
    sim.position = endpoint;
    const next = before ? segment.prev : segment.next;
    if (!transferEndpoint(sim, next, before, remainingMs)) return;
    startPosition = sim.position;
    startSpeed = sim.speed;
    sim.position += sim.speed * remainingMs * 0.001;
  }
  sim.diagnostics.transitionLimit = true;
  sim.diagnostics.fault = "foothold-transition-limit";
}

/** 009b3fd1 entry: follow the endpoint's reverse link when it is not reciprocal. */
function reenterEndpoint(sim, startPosition) {
  const segment = sim.foothold;
  if (startPosition <= 0 && sim.position > 0) {
    return redirectEndpoint(sim, segment.prev?.next, false);
  }
  if (startPosition >= segment.length && sim.position < segment.length) {
    return redirectEndpoint(sim, segment.next?.prev, true);
  }
  return false;
}

function redirectEndpoint(sim, alternate, atEnd) {
  if (!alternate || alternate === sim.foothold) return false;
  if (alternate.tx > 0) {
    sim.foothold = alternate;
    sim.footholdId = alternate.id;
  } else sim.speed = 0;
  sim.position = atEnd ? sim.foothold.length : 0;
  return true;
}

function transferEndpoint(sim, next, before, remainingMs) {
  if (next?.tx > 0) {
    sim.foothold = next;
    sim.footholdId = next.id;
    sim.position = before ? next.length : 0;
    if ((before && sim.speed > 0) || (!before && sim.speed < 0)) sim.speed = 0;
    return true;
  }
  if (blocksEdge(next, before)) {
    sim.speed = 0;
    projectGround(sim);
    return false;
  }
  projectGround(sim);
  detachGround(sim);
  queueAirContinuation(sim, remainingMs);
  sim.x += sim.vx * remainingMs * 0.001;
  sim.y += sim.vy * remainingMs * 0.001;
  return false;
}

function queueAirContinuation(sim, remainingMs) {
  const sweep = sim.contactScratch;
  sweep.pendingAir = remainingMs > 0;
  sweep.remainingMs = remainingMs;
  sweep.entryX = sim.x;
  sweep.entryY = sim.y;
  sweep.entryVx = sim.vx;
  sweep.entryVy = sim.vy;
}

function blocksEdge(segment, before) {
  if (!segment) return false;
  return before ? segment.ty >= 0 : segment.ty <= 0;
}

/** 009b34c8/009b19d0: first sweep plus one original secondary wall pass. */
export function airContacts(sim, seconds, oldVx, oldVy) {
  const sweep = sim.contactScratch;
  const secondary = sweep.pendingAir;
  let remainingMs = initializeAirSweep(sim, seconds);
  remainingMs = clipAir(sim, sweep, remainingMs);
  if (secondary) {
    oldVx = sweep.entryVx;
    oldVy = sweep.entryVy;
    sweep.pendingAir = false;
  }
  for (let pass = secondary ? 1 : 0; pass < 2; pass++) {
    sweep.x = sim.x;
    sweep.y = sim.y;
    collectContacts(sim);
    if (!sweep.first) return;
    const endVx = sim.vx;
    const endVy = sim.vy;
    const oldSpeed = sim.speed;
    sim.vx = oldVx + (endVx - oldVx) * sweep.fraction;
    sim.vy = oldVy + (endVy - oldVy) * sweep.fraction;
    const chosen = chooseContact(sim);
    if (chosen.id === sim.ignoredFootholdId) {
      sim.vx = endVx;
      sim.vy = endVy;
      sim.speed = oldSpeed;
      return;
    }
    locateContact(sim, chosen);
    remainingMs -= Math.trunc(remainingMs * sweep.fraction);
    if (chosen.tx > 0) {
      landContact(sim, chosen, pass === 0 ? remainingMs : 0);
      return;
    }
    const contactSpeed = sim.speed;
    sim.vx = endVx;
    sim.vy = endVy;
    slideWall(sim, chosen);
    if (pass !== 0) {
      sim.vx = contactSpeed * chosen.tx;
      sim.vy = contactSpeed * chosen.ty;
      return;
    }
    sim.x += (contactSpeed * chosen.tx + sim.vx) * remainingMs * 0.0005;
    sim.y += (contactSpeed * chosen.ty + sim.vy) * remainingMs * 0.0005;
    if (remainingMs <= 0) return;
  }
}

function initializeAirSweep(sim, seconds) {
  const sweep = sim.contactScratch;
  sweep.previousX = sweep.pendingAir ? sweep.entryX : sim.previousX;
  sweep.previousY = sweep.pendingAir ? sweep.entryY : sim.previousY;
  return sweep.pendingAir ? sweep.remainingMs : Math.round(seconds * 1000);
}

function landContact(sim, chosen, remainingMs) {
  recordFallLanding(sim);
  const speed = sim.horizontalInput * sim.speed >= 0 ? sim.speed * 0.5 : 0;
  attachGround(sim, chosen);
  sim.speed = speed;
  sim.ignoredFootholdId = 0;
  const startPosition = sim.position;
  sim.position += speed * remainingMs * 0.001;
  groundContacts(sim, remainingMs * 0.001, startPosition, speed);
  sim.contactScratch.pendingAir = false;
}

/** 009cbb9f: a real floor attachment in ordinary freefall proposes source -3.
 * 0096c1d3 excludes existing floor contact, water, flight and positive float mode. */
function recordFallLanding(sim) {
  const landing = sim.landing;
  if (
    sim.foothold ||
    sim.state === "ladder" ||
    sim.movementMode !== "air" ||
    landing.forbidden ||
    landing.terminalTicks <= landing.thresholdTicks
  ) {
    return;
  }
  landing.amount = Math.max(
    1,
    36 - Math.trunc(336 / (landing.terminalTicks - 18)),
  );
  landing.facing = sim.facing;
  landing.sequence++;
  landing.terminalTicks = 0;
}

/** Integer intersection X then Y on the integer sweep, 009b38xx. */
function locateContact(sim, chosen) {
  const sweep = sim.contactScratch;
  const oldX = Math.trunc(sweep.previousX);
  const oldY = Math.trunc(sweep.previousY);
  const dx = Math.trunc(sweep.x) - oldX;
  const dy = Math.trunc(sweep.y) - oldY;
  sim.x = Math.trunc(oldX + dx * sweep.fraction);
  sim.y =
    dx === 0
      ? chosen.y1 + ((sim.x - chosen.x1) * chosen.dy) / chosen.dx
      : oldY + ((sim.x - oldX) * dy) / dx;
  const position =
    Math.abs(chosen.tx) > 0.5
      ? (sim.x - chosen.x1) / chosen.tx
      : (sim.y - chosen.y1) / chosen.ty;
  sim.position = Math.max(0, Math.min(chosen.length, position));
  sim.x = chosen.x1 + chosen.tx * sim.position;
  sim.y = chosen.y1 + chosen.ty * sim.position;
}

function collectContacts(sim) {
  const sweep = sim.contactScratch;
  sweep.first = null;
  sweep.last = null;
  sweep.fraction = 2;
  for (const segment of sim.geometry.segments) {
    if (!eligible(sim, segment)) continue;
    const hit = crossingFraction(sweep, segment);
    if (hit < 0 || hit > sweep.fraction) continue;
    collectEndpointPair(sweep, segment, hit);
  }
}

function collectEndpointPair(sweep, segment, hit) {
  const dx = Math.trunc(sweep.x) - Math.trunc(sweep.previousX);
  const dy = Math.trunc(sweep.y) - Math.trunc(sweep.previousY);
  const firstSide =
    (segment.y1 - Math.trunc(sweep.previousY)) * dx -
    (segment.x1 - Math.trunc(sweep.previousX)) * dy;
  const lastSide =
    (segment.y2 - Math.trunc(sweep.previousY)) * dx -
    (segment.x2 - Math.trunc(sweep.previousX)) * dy;
  let first = segment;
  let last = segment;
  if (firstSide === 0) {
    last = segment.prev;
    if (!last || !endpointCrosses(last, first, sweep)) return;
  } else if (lastSide === 0) {
    first = segment.next;
    if (!first || !endpointCrosses(last, first, sweep)) return;
  }
  if (hit < sweep.fraction) {
    sweep.first = first;
    sweep.last = last;
    sweep.fraction = hit;
    return;
  }
  if (sideOf(sweep.first, first.x1, first.y1) < 0) sweep.first = first;
  if (sideOf(sweep.last, last.x2, last.y2) < 0) sweep.last = last;
}

function sideOf(segment, x, y) {
  return segment.dx * (y - segment.y1) - segment.dy * (x - segment.x1);
}

/** Exact endpoint wedge predicate 009b3f1b. */
function endpointCrosses(first, last, sweep) {
  const x = Math.trunc(sweep.x);
  const y = Math.trunc(sweep.y);
  const convex = sideOf(first, last.x2, last.y2) > 0;
  const firstSide = sideOf(first, x, y) > 0;
  const lastSide = sideOf(last, x, y) > 0;
  return convex ? firstSide && lastSide : firstSide || lastSide;
}

function chooseContact(sim) {
  const { first, last } = sim.contactScratch;
  const firstSpeed = first.tx * sim.vx + first.ty * sim.vy;
  const lastSpeed = last.tx * sim.vx + last.ty * sim.vy;
  sim.speed = firstSpeed;
  if (first === last || (firstSpeed > 0.001 && lastSpeed > 0.001)) return first;
  sim.speed = lastSpeed;
  if (firstSpeed < -0.001 && lastSpeed < -0.001) return last;
  sim.speed = 0;
  return first.tx > 0 ? first : last;
}

/** 009b34c8: ordinary actors accept a wall from either space or contact group. */
function eligible(sim, segment) {
  return (
    segment.tx > 0 ||
    segment.group === sim.spaceGroup ||
    segment.group === sim.contactGroup
  );
}

function slideWall(sim, segment) {
  const speed = sim.vx * segment.tx + sim.vy * segment.ty;
  sim.vx = speed * segment.tx;
  sim.vy = speed * segment.ty;
}

/** 0094c4f8 / 00a4549d / 00a45585: support query gates dropping, not landing selection. */
export function dropTarget(sim) {
  const x = Math.trunc(sim.x);
  const y = Math.trunc(sim.y);
  let chosen = null;
  let chosenY = -Infinity;
  for (const segment of sim.geometry.segments) {
    const floorY = dropFloorY(segment, x);
    if (floorY > y + 300 || floorY <= chosenY) continue;
    chosen = segment;
    chosenY = floorY;
  }
  if (!chosen || chosen === sim.foothold) {
    chosen = null;
    chosenY = y + 600;
    for (const segment of sim.geometry.segments) {
      const floorY = dropFloorY(segment, x);
      if (floorY < y + 300 || floorY >= chosenY) continue;
      chosen = segment;
      chosenY = floorY;
    }
  }
  return chosenY > y - 5 && chosenY < y + 5 ? null : chosen;
}

function dropFloorY(segment, x) {
  if (segment.tx <= 0 || x < segment.x1 || x > segment.x2) return Infinity;
  return segment.y1 + Math.trunc(((x - segment.x1) * segment.dy) / segment.dx);
}
