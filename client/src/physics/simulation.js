import {
  detachGround,
  MAX_COORDINATE,
  prepareSegments,
  projectGround,
} from "./geometry.js";
import { airContacts, dropTarget, groundContacts } from "./contacts.js";
import { airVelocity, floatVelocity, groundVelocity } from "./dynamics.js";
import {
  captureLadder,
  climb,
  prepareLadders,
  releaseLadder,
} from "./ladders.js";
import {
  createDiagnostics,
  prepareBlocked,
  prepareSettings,
} from "./settings.js";
import { prepareWaterAreas, updateEnvironment } from "./environment.js";
import { prepareBounds } from "./bounds.js";

/** Catch-up bound is browser policy; original 009b195f returns the30ms quantum. */
const MAX_CATCH_UP = 8;
const QUANTUM_MS = 30;
const SECONDS = QUANTUM_MS / 1000;
const INPUT_KEYS = [
  "left",
  "right",
  "up",
  "down",
  "jump",
  "attack",
  "jumpPressed",
];

/** Bounded collision scratch is allocated once, never while resolving contacts. */
function createContactScratch() {
  return {
    previousX: 0,
    previousY: 0,
    x: 0,
    y: 0,
    fraction: 0,
    segment: null,
    first: null,
    last: null,
    pendingAir: false,
    remainingMs: 0,
    entryX: 0,
    entryY: 0,
    entryVx: 0,
    entryVy: 0,
  };
}

/** Validate contract physics metadata and allocate all reusable state before play.
 * Coordinates are original world pixels at the avatar's feet. */
export function createSimulation(world, spawn) {
  if (!Number.isFinite(spawn.x) || !Number.isFinite(spawn.y)) {
    throw new Error("Nonfinite simulation spawn");
  }
  if (
    Math.abs(spawn.x) > MAX_COORDINATE ||
    Math.abs(spawn.y) > MAX_COORDINATE
  ) {
    throw new Error("Simulation spawn exceeds supported coordinate range");
  }
  const effectiveSettings = prepareSettings(world);
  const geometry = prepareSegments(world.footholds);
  if (geometry.segments.length === 0) {
    throw new Error("Map has no playable foothold geometry");
  }
  const ladders = prepareLadders(world.ladders);
  const bounds = prepareBounds(geometry.segments, world.map);
  const x = Math.max(bounds.left, Math.min(bounds.right, spawn.x));
  const y = Math.max(bounds.top, Math.min(bounds.bottom, spawn.y));
  const sim = {
    x,
    y,
    vx: 0,
    vy: 0,
    previousX: x,
    previousY: y,
    state: "air",
    facing: 1,
    action: "jump",
    crouching: false,
    footholdId: 0,
    ladderId: 0,
    foothold: null,
    ladder: null,
    position: 0,
    speed: 0,
    contactLayer: 7,
    contactGroup: 0,
    horizontalInput: 0,
    contactScratch: createContactScratch(),
    ignoredFootholdId: 0,
    geometry,
    ladders,
    bounds,
    accumulatorMs: 0,
    accumulatorError: 0,
    groundJumpSequence: 0,
    movementMode: "air",
    baseMode: world.map.swim ? "swim" : world.map.fly ? "fly" : "air",
    waterAreas: prepareWaterAreas(world.map),
    effectiveSettings,
    blocked: prepareBlocked(world),
    diagnostics: createDiagnostics(),
  };
  updateEnvironment(sim);
  sim.state = sim.movementMode;
  updateAction(sim);
  return sim;
}

/** Mutate reusable state/input; retain overload backlog for subsequent calls.
 * Input booleans are held states except jumpPressed, which is one edge. */
export function advanceSimulation(sim, input, elapsedMs) {
  validateInput(input, elapsedMs);
  if (sim.diagnostics.fault) return sim;
  const adjusted = elapsedMs - sim.accumulatorError;
  const elapsed = sim.accumulatorMs + adjusted;
  if (!Number.isFinite(elapsed) || elapsed > Number.MAX_SAFE_INTEGER) {
    throw new Error("Simulation elapsed time exceeds exact millisecond range");
  }
  sim.accumulatorError = elapsed - sim.accumulatorMs - adjusted;
  sim.accumulatorMs = elapsed;
  let steps = 0;
  for (; steps < MAX_CATCH_UP && sim.accumulatorMs >= QUANTUM_MS; steps++) {
    step(sim, input);
    sim.accumulatorMs -= QUANTUM_MS;
    sim.diagnostics.ticks++;
    sim.diagnostics.simulatedMs += QUANTUM_MS;
    if (sim.diagnostics.fault) break;
  }
  sim.diagnostics.backlogMs = sim.accumulatorMs;
  sim.diagnostics.overload = sim.accumulatorMs >= QUANTUM_MS;
  if (sim.diagnostics.overload) sim.diagnostics.overloadCount++;
  return sim;
}

function validateInput(input, elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error(
      "Simulation elapsed milliseconds must be finite and nonnegative",
    );
  }
  for (const key of INPUT_KEYS) {
    if (typeof input[key] !== "boolean") {
      throw new Error("Simulation input must contain booleans");
    }
  }
}

function step(sim, input) {
  sim.previousX = sim.x;
  sim.previousY = sim.y;
  updateEnvironment(sim);
  const horizontal = Number(input.right) - Number(input.left);
  sim.horizontalInput = horizontal;
  const vertical = Number(input.down) - Number(input.up);
  if (horizontal !== 0) sim.facing = horizontal;
  sim.crouching = sim.state === "ground" && input.down;
  sim.diagnostics.unsupportedAttack = input.attack;
  acceptJump(sim, input, horizontal);
  if (sim.state === "ladder") climb(sim, vertical);
  else integrate(sim, sim.crouching ? 0 : horizontal, vertical);
  captureLadder(sim, vertical);
  updateAction(sim);
  if (!Number.isFinite(sim.x + sim.y + sim.vx + sim.vy)) {
    sim.diagnostics.fault = "nonfinite-motion";
  }
}

function integrate(sim, direction, vertical) {
  if (sim.foothold) {
    const previous = sim.speed;
    const startPosition = sim.position;
    sim.speed = groundVelocity(sim, direction, SECONDS);
    sim.position += (previous + sim.speed) * SECONDS * 0.5;
    groundContacts(sim, SECONDS, startPosition, previous);
    if (sim.contactScratch.pendingAir) {
      airContacts(sim, SECONDS, sim.vx, sim.vy);
    }
  } else {
    const vx = sim.vx;
    const vy = sim.vy;
    sim.state = sim.movementMode;
    if (sim.state === "air") airVelocity(sim, direction, SECONDS);
    else floatVelocity(sim, direction, vertical, SECONDS);
    sim.x += (vx + sim.vx) * SECONDS * 0.5;
    sim.y += (vy + sim.vy) * SECONDS * 0.5;
    airContacts(sim, SECONDS, vx, vy);
  }
}

function acceptJump(sim, input, direction) {
  if (!input.jumpPressed) return;
  input.jumpPressed = false;
  if (sim.state === "ladder") {
    if (direction === 0) return;
    releaseLadder(sim);
    sim.vx = direction * sim.effectiveSettings.walkSpeed * 1.3;
    const scale = sim.movementMode === "air" ? 0.5 : 0.3;
    sim.vy = -sim.effectiveSettings.jumpSpeed * scale;
    return;
  }
  if (!sim.foothold) {
    floatJump(sim, direction);
    return;
  }
  if (input.down) {
    beginDrop(sim);
    return;
  }
  projectGround(sim);
  const speed = sim.effectiveSettings.walkSpeed;
  if (direction * sim.vx < speed * 0.8) sim.vx += direction * speed * 0.8;
  if (direction * sim.vx > speed) sim.vx = direction * speed;
  sim.y = Math.floor(sim.y - 1);
  const scale = sim.movementMode === "air" ? 1 : 0.7;
  sim.vy = -sim.effectiveSettings.jumpSpeed * scale;
  sim.crouching = false;
  // Accepted normal ground jumps notify presentation without changing integration.
  if (sim.movementMode === "air") {
    sim.groundJumpSequence = (sim.groundJumpSequence + 1) >>> 0;
  }
  detachGround(sim);
}

/** 009b1d3d: repeated buoyant jumps; fly impulse has its own WZ reduction. */
function floatJump(sim, direction) {
  const g = sim.effectiveSettings;
  if (sim.movementMode === "swim") sim.vy = -g.swimSpeed * 5;
  if (sim.movementMode === "fly") {
    sim.vy = -g.flyJumpDec * g.flySpeed * 5;
    if (direction !== 0) sim.vx *= 2;
  }
}

function beginDrop(sim) {
  if (sim.foothold.properties.forbidFallDown) return;
  const target = dropTarget(sim);
  if (!target) return;
  sim.ignoredFootholdId = sim.foothold.id;
  sim.y = Math.floor(sim.y - 1);
  sim.vx = 0;
  // Original 009b1c51 / 00b3e3a0, not a tuned browser impulse.
  sim.vy = -0.35355339 * sim.effectiveSettings.jumpSpeed;
  sim.crouching = false;
  detachGround(sim);
}

function updateAction(sim) {
  if (sim.state === "ladder") {
    sim.action = sim.ladder.ladder ? "ladder" : "rope";
  } else if (sim.state !== "ground") sim.action = "jump";
  else if (sim.crouching) sim.action = "prone";
  else sim.action = sim.speed === 0 ? "stand1" : "walk1";
}

/** Allocate only on explicit inspection, never from the fixed-step loop. */
export function snapshotSimulation(sim) {
  return {
    x: sim.x,
    y: sim.y,
    vx: sim.vx,
    vy: sim.vy,
    state: sim.state,
    previousX: sim.previousX,
    previousY: sim.previousY,
    accumulatorMs: sim.accumulatorMs,
    footholdId: sim.footholdId,
    ladderId: sim.ladderId,
    ignoredFootholdId: sim.ignoredFootholdId,
    contactLayer: sim.contactLayer,
    contactGroup: sim.contactGroup,
    bounds: { ...sim.bounds },
    facing: sim.facing,
    action: sim.action,
    crouching: sim.crouching,
    movementMode: sim.movementMode,
    effectiveSettings: { ...sim.effectiveSettings },
    blocked: [...sim.blocked],
    diagnostics: {
      ...sim.diagnostics,
      policies: [...sim.diagnostics.policies],
    },
  };
}
