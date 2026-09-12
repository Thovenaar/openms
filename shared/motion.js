import { advanceSimulation } from "../client/src/physics/simulation.js";
import { protocolError, validate } from "./schema.js";
import {
  diagnosticsSchema,
  landingSchema,
  MOTION_SCALARS,
  motionSchema,
  scratchSchema,
  SETTINGS_KEYS,
} from "./motion-schema.js";
export {
  ANIMATION_ACTIONS,
  animationId,
  animationName,
  motionSchema,
} from "./motion-schema.js";

const SCRATCH_KEYS = Object.keys(scratchSchema.fields);
const LANDING_KEYS = Object.keys(landingSchema.fields);
const DIAGNOSTIC_KEYS = Object.keys(diagnosticsSchema.fields);
const SCRATCH_REFS = ["segment", "first", "last"];

export function createHeldInput() {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    attack: false,
    jumpPressed: false,
    attackPressed: false,
  };
}

function validHeldAxis(value) {
  return (
    Number.isInteger(value) &&
    value >= -1 &&
    value <= 1 &&
    !Object.is(value, -0)
  );
}

/** Convert a validated held wire sample; key edges are never supplied by the peer. */
export function assignHeldInput(input, wire) {
  if (
    !validHeldAxis(wire.horizontal) ||
    !validHeldAxis(wire.vertical) ||
    typeof wire.jump !== "boolean" ||
    typeof wire.attack !== "boolean"
  ) {
    throw protocolError();
  }
  input.jumpPressed = wire.jump && !input.jump;
  input.attackPressed = wire.attack && !input.attack;
  input.left = wire.horizontal === -1;
  input.right = wire.horizontal === 1;
  input.up = wire.vertical === -1;
  input.down = wire.vertical === 1;
  input.jump = wire.jump;
  input.attack = wire.attack;
  return input;
}

/** Exactly one existing kernel quantum. Online scheduling never enters offline catch-up. */
export function stepMotion(sim, input) {
  if (
    sim.advancing ||
    sim.accumulatorMs !== 0 ||
    sim.accumulatorError !== 0 ||
    sim.diagnostics.fault
  ) {
    throw protocolError("RESYNC_REQUIRED");
  }
  if (!sim.onlineHeldInput) {
    sim.onlineHeldInput = {
      horizontal: 0,
      vertical: 0,
      jump: false,
      attack: false,
    };
  }
  const held = sim.onlineHeldInput;
  held.horizontal = Number(input.right) - Number(input.left);
  held.vertical = Number(input.down) - Number(input.up);
  held.jump = input.jump;
  held.attack = input.attack;
  const previousTicks = sim.diagnostics.ticks;
  advanceSimulation(sim, input, 30);
  if (
    sim.diagnostics.fault ||
    sim.diagnostics.ticks !== previousTicks + 1 ||
    sim.accumulatorMs !== 0
  ) {
    throw protocolError("RESYNC_REQUIRED");
  }
  return sim;
}

function copyFields(source, keys) {
  const result = {};
  for (const key of keys) {
    result[key] = Object.is(source[key], -0) ? 0 : source[key];
  }
  return result;
}

function captureWorldMovement(source) {
  const form = source.form;
  return {
    wingsX: source.wingsX,
    equipmentFs: source.equipmentFs,
    equipmentSwim: source.equipmentSwim,
    form:
      form === null
        ? null
        : {
            speed: form.speed ?? null,
            jump: form.jump ?? null,
            swim: form.swim,
            fs: form.fs ?? null,
            riding: form.riding === true,
          },
  };
}

/** Immutable geometry is identified, never serialized or borrowed into received state. */
export function captureMotion(sim) {
  if (sim.advancing) throw protocolError("RESYNC_REQUIRED");
  const state = copyFields(sim, MOTION_SCALARS);
  state.foothold = sim.foothold?.id ?? null;
  state.ladder = sim.ladder?.id ?? null;
  state.seat = sim.seat ? { x: sim.seat.x, y: sim.seat.y } : null;
  state.worldMovement = captureWorldMovement(sim.worldMovement);
  state.effectiveSettings = copyFields(sim.effectiveSettings, SETTINGS_KEYS);
  state.landing = copyFields(sim.landing, LANDING_KEYS);
  state.contactScratch = copyFields(sim.contactScratch, SCRATCH_KEYS);
  for (const key of SCRATCH_REFS) {
    state.contactScratch[key] = sim.contactScratch[key]?.id ?? null;
  }
  state.diagnostics = copyFields(sim.diagnostics, DIAGNOSTIC_KEYS);
  state.held = sim.onlineHeldInput
    ? { ...sim.onlineHeldInput }
    : { horizontal: 0, vertical: 0, jump: false, attack: false };
  validate(state, motionSchema);
  return state;
}

function segmentReference(sim, id) {
  if (id === null) return null;
  const segment = sim.geometry.byId.get(id);
  if (!segment) throw protocolError("CONTENT_MISMATCH");
  return segment;
}

function ladderReference(sim, id) {
  if (id === null) return null;
  for (const entry of sim.ladders) {
    if (entry.id === id) return entry;
  }
  throw protocolError("CONTENT_MISMATCH");
}

function validateReferenceState(state, foothold, ladder) {
  if (
    state.footholdId !== (foothold?.id ?? 0) ||
    state.ladderId !== (ladder?.id ?? 0)
  ) {
    throw protocolError();
  }
  if (
    (state.state === "ground") !== (foothold !== null) ||
    (state.state === "ladder") !== (ladder !== null)
  ) {
    throw protocolError();
  }
}

function validateFootholdPosition(state, foothold) {
  if (
    foothold &&
    (foothold.tx <= 0 || state.position < 0 || state.position > foothold.length)
  ) {
    throw protocolError();
  }
}

function resolveReferences(sim, state) {
  const foothold = segmentReference(sim, state.foothold);
  const ladder = ladderReference(sim, state.ladder);
  validateReferenceState(state, foothold, ladder);
  validateFootholdPosition(state, foothold);
  if (state.ignoredFootholdId !== 0) {
    segmentReference(sim, state.ignoredFootholdId);
  }
  if (
    state.spaceGroup !== sim.geometry.spaceGroup ||
    state.baseMode !== sim.baseMode ||
    state.fieldLimit !== sim.fieldLimit
  ) {
    throw protocolError("CONTENT_MISMATCH");
  }
  const scratch = copyFields(state.contactScratch, SCRATCH_KEYS);
  for (const key of SCRATCH_REFS) {
    scratch[key] = segmentReference(sim, state.contactScratch[key]);
  }
  return { foothold, ladder, scratch };
}

/** Validate every field/reference before changing the simulation; checkpoint owns no live references. */
export function restoreMotion(sim, state) {
  if (sim.advancing) throw protocolError("RESYNC_REQUIRED");
  validate(state, motionSchema);
  const references = resolveReferences(sim, state);
  const worldMovement = captureWorldMovement(state.worldMovement);
  const seat =
    state.seat === null ? null : { x: state.seat.x, y: state.seat.y };
  for (const key of MOTION_SCALARS) sim[key] = state[key];
  sim.foothold = references.foothold;
  sim.ladder = references.ladder;
  sim.seat = seat;
  Object.assign(sim.contactScratch, references.scratch);
  Object.assign(sim.landing, state.landing);
  Object.assign(sim.effectiveSettings, state.effectiveSettings);
  Object.assign(sim.diagnostics, state.diagnostics);
  Object.assign(sim.worldMovement, worldMovement);
  if (!sim.onlineHeldInput) {
    sim.onlineHeldInput = {
      horizontal: 0,
      vertical: 0,
      jump: false,
      attack: false,
    };
  }
  Object.assign(sim.onlineHeldInput, state.held);
  return sim;
}
