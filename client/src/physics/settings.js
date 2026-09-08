const GLOBAL_KEYS = [
  "walkForce",
  "walkSpeed",
  "walkDrag",
  "slipForce",
  "slipSpeed",
  "floatDrag1",
  "floatDrag2",
  "floatCoefficient",
  "swimForce",
  "swimSpeed",
  "flyForce",
  "flySpeed",
  "gravityAcc",
  "fallSpeed",
  "jumpSpeed",
  "maxFriction",
  "minFriction",
  "swimSpeedDec",
  "flyJumpDec",
];
const MAX_OPTIONS = 1024;
const UNSUPPORTED_MAP = [
  "gravity",
  "drag",
  "speed",
  "jump",
  "fieldType",
  "fieldLimit",
  "forceMove",
  "moveLimit",
  "noJump",
  "noFall",
  "noSlip",
  "onUserEnter",
  "onFirstUserEnter",
];
/** Preserve original global keys; base modifiers are from 004fe802/00a45c5b.
 * Map option consumers remain explicitly blocked until their units are proven. */
export function prepareSettings(world) {
  if (world.schemaVersion !== 1 || !world.map || !world.globals) {
    throw new Error("Unsupported physics world schema");
  }
  const fs = mapFriction(world.map.fs);
  const settings = {
    mass: 100,
    gravity: 1,
    drag: fs,
    forceScale: fs,
    friction: fs,
    quantumMs: 30,
    avatar: "original-base-attributes",
  };
  for (const key of GLOBAL_KEYS) {
    const value = world.globals[key];
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Missing or nonpositive original Physics.img/${key}`);
    }
    settings[key] = value;
  }
  if (settings.minFriction > settings.maxFriction) {
    throw new Error("Reversed original friction clamps");
  }
  return settings;
}

/** 0052b2b5 default1; 00a45cd6 normalizes explicit zero to1. */
function mapFriction(value = 1) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Invalid map fs multiplier");
  }
  return value === 0 ? 1 : value;
}
/** Allocate diagnostics once, never while stepping. */
export function prepareBlocked(world) {
  const blocked = [];
  appendMapBlocks(world.map, blocked);
  appendSegmentBlocks(world.footholds, blocked);
  if (world.ladders.some(missingFlags)) {
    blocked.push(
      "ladder: omitted l/uf flag defaults unresolved; capture disabled for those ladders",
    );
  }
  if ((world.unsupported?.length ?? 0) > 0) {
    blocked.push(
      "world.unsupported: retained extraction uncertainties present",
    );
  }
  return blocked;
}

function appendMapBlocks(map, blocked) {
  if (Object.keys(map).length > MAX_OPTIONS) {
    throw new Error("Unsupported map option count");
  }
  for (const key of UNSUPPORTED_MAP) {
    const value = map[key];
    if (value !== undefined && value !== 0 && value !== "") {
      blocked.push(
        `map.${key}: original active consumer not fully reconstructed`,
      );
    }
  }
  appendSectionBlocks(map, blocked);
}

function appendSectionBlocks(map, blocked) {
  const unknown = Object.keys(map.$unrecognized ?? {});
  if (unknown.length > MAX_OPTIONS) {
    throw new Error("Unsupported map section count");
  }
  for (const key of unknown) {
    if (key !== "swimArea") {
      blocked.push(`map.${key}: active-section semantics unresolved`);
    }
  }
  if (map.$objectPhysics && Object.keys(map.$objectPhysics).length > 0) {
    blocked.push(
      "map.$objectPhysics: dynamic object collision/motion unresolved",
    );
  }
  if (map.fly && map.$unrecognized?.swimArea) {
    blocked.push("fly/swimArea overlap: jump-mode precedence unresolved");
  }
}

function missingFlags(ladder) {
  return ladder.ladder === null || ladder.uf === null;
}

function appendSegmentBlocks(footholds, blocked) {
  for (const segment of footholds) {
    const properties = segment.properties ?? {};
    if (properties.force && Math.abs(properties.force) < 100) {
      blocked.push(
        "foothold.force: sub-unit opposing-input division by zero in original",
      );
      break;
    }
  }
}

export function createDiagnostics() {
  return {
    ticks: 0,
    simulatedMs: 0,
    backlogMs: 0,
    overload: false,
    overloadCount: 0,
    transitionLimit: false,
    fault: null,
    unsupportedAttack: false,
    unsupportedLadderFlags: false,
    originalCadenceVerified: true,
    policies: [
      "binary64 arithmetic replaces original x87 intermediates",
      "collision rational comparisons use binary64 instead of original integer products",
      "rare object/group collision exceptions require original dynamic actor context",
      "base avatar only: equipment, skills, mounts and morphs not applied",
      "active unsupported map options are reported, not given guessed coefficients",
    ],
  };
}
