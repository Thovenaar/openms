import { createHash, randomUUID } from "node:crypto";
import { closedRecord, protocolError } from "../../shared/protocol.js";
import { developmentCanonical } from "../../shared/development.js";
import { conjureDevelopmentItem } from "./field-development-items.js";
import { CharacterDevelopment } from "../../client/src/character/character-development.js";
import {
  stageJobPreset,
  applyJobPresetLoadout,
} from "../../client/src/development/character-presets.js";
import { createMobs } from "../../client/src/combat/offline-mobs.js";
import { createSimulation } from "../../client/src/physics/simulation.js";
import { captureMotion, restoreMotion } from "../../shared/motion.js";
import {
  validateKeyBindings,
  validateProfile,
} from "../../client/src/profile/profile-validation.js";

const PROFILE_FIELDS = [
  "name",
  "level",
  "job",
  "exp",
  "hp",
  "mp",
  "baseMaxHP",
  "baseMaxMP",
  "str",
  "dex",
  "int",
  "luk",
  "meso",
  "fame",
  "remainingAp",
  "remainingSp",
  "skills",
  "keyBindings",
];
const GLOBALS = [
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

function integer(value, low, high) {
  if (
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < low ||
    value > high
  ) {
    throw protocolError("INVALID_MESSAGE");
  }
}

/** One closed field set bounds explicit developer edits, alone or in a staged preset draft. */
function admitProfilePatch(patch) {
  closedRecord(patch, [], PROFILE_FIELDS);
  if (!Object.keys(patch).length) {
    throw protocolError("INVALID_MESSAGE");
  }
  for (const [key, value] of Object.entries(patch)) {
    if (key === "name") {
      if (typeof value !== "string" || !value.length || value.length > 32) {
        throw protocolError("INVALID_MESSAGE");
      }
    } else if (
      key === "remainingSp" ||
      key === "skills" ||
      key === "keyBindings"
    ) {
      admitProfileDomain(key, value);
    } else {
      integer(value, key === "fame" ? -30000 : 0, 2147483647);
    }
  }
}

function admitProfileAction(action) {
  closedRecord(action, ["kind", "patch"]);
  admitProfilePatch(action.patch);
}

function admitProfileDomain(key, value) {
  if (key === "keyBindings") {
    validateKeyBindings(value);
    return;
  }
  if (key === "remainingSp") {
    if (!Array.isArray(value) || value.length !== 10) {
      throw protocolError("INVALID_MESSAGE");
    }
    for (const amount of value) integer(amount, 0, 2147483647);
    return;
  }
  admitSkillDictionary(value);
}

/** Learned-skill dictionaries stay bounded before traversal; ids are canonical decimals. */
function admitSkillDictionary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError("INVALID_MESSAGE");
  }
  const entries = Object.entries(value);
  if (entries.length > 4096) throw protocolError("INVALID_MESSAGE");
  for (const [id, skill] of entries) {
    if (!/^(0|[1-9][0-9]*)$/.test(id)) throw protocolError("INVALID_MESSAGE");
    integer(Number(id), 0, 4294967295);
    closedRecord(skill, ["level", "masterLevel", "expiresAt"]);
    integer(skill.level, 0, 2147483647);
    integer(skill.masterLevel, 0, 2147483647);
    if (skill.expiresAt !== null) {
      integer(skill.expiresAt, 0, Number.MAX_SAFE_INTEGER);
    }
  }
}

function admitPhysicsAction(action) {
  closedRecord(action, ["kind", "globals", "map"]);
  closedRecord(action.globals, [], GLOBALS);
  closedRecord(action.map, [], ["fs"]);
  for (const value of Object.values(action.globals)) {
    if (!Number.isFinite(value) || value <= 0 || value > 1000000) {
      throw protocolError("INVALID_MESSAGE");
    }
  }
  if (
    action.map.fs !== undefined &&
    (!Number.isFinite(action.map.fs) ||
      action.map.fs < 0 ||
      action.map.fs > 100)
  ) {
    throw protocolError("INVALID_MESSAGE");
  }
}

/** Closed HTTP-only schema; neither arbitrary patches nor field coordinates are accepted. */
export function developmentAction(action) {
  switch (action?.kind) {
    case "map":
      closedRecord(action, ["kind", "mapId"]);
      integer(action.mapId, 0, 999999998);
      break;
    case "preset":
      // A staged preset may carry the developer's explicit edits into one atomic draft.
      closedRecord(action, ["kind", "job"], ["patch"]);
      integer(action.job, 0, 9999);
      if (action.patch !== undefined) admitProfilePatch(action.patch);
      break;
    case "profile":
      admitProfileAction(action);
      break;
    case "conjure":
      closedRecord(action, ["kind", "itemId", "quantity"]);
      integer(action.itemId, 1, 99999999);
      integer(action.quantity, 1, 65535);
      break;
    case "spawn":
      closedRecord(action, ["kind", "templateId", "count"]);
      integer(action.templateId, 1, 99999999);
      integer(action.count, 1, 10);
      break;
    case "pause":
      closedRecord(action, ["kind", "paused"]);
      if (typeof action.paused !== "boolean") {
        throw protocolError("INVALID_MESSAGE");
      }
      break;
    case "step":
      closedRecord(action, ["kind", "ticks"]);
      integer(action.ticks, 1, 4);
      break;
    case "physics":
      admitPhysicsAction(action);
      break;
    default:
      throw protocolError("INVALID_MESSAGE");
  }
  return action;
}

export function admitDeveloper(world, actor) {
  if (!world.development || actor.role !== "developer") {
    throw protocolError("NOT_ALLOWED");
  }
  if (
    actor.state !== "active" ||
    actor.field.characters.get(actor.id) !== actor
  ) {
    throw protocolError("STALE_FIELD");
  }
}

function admitSharedControl(world, actor) {
  admitDeveloper(world, actor);
  for (const peer of actor.field.characters.values()) {
    if (
      peer.role !== "developer" ||
      peer.realm !== actor.realm ||
      peer.accountId !== actor.accountId
    ) {
      throw protocolError("NOT_ALLOWED");
    }
  }
}

function operationFor(actor, request) {
  return {
    operationId: request.operationId,
    digest: createHash("sha256")
      .update(developmentCanonical(request.action))
      .digest("hex"),
    expectedRevision: actor.revision,
    domain: "character",
    kind: `development.${request.action.kind}`,
    fieldEpoch: actor.field.epoch,
  };
}

async function profileEdit(world, actor, action, operation) {
  let receipt;
  const profile = { ...actor.profile };
  delete profile.onlineState;
  const store = {
    profile,
    profileTransactionPending: false,
    async commitProfile(mutator) {
      receipt = await world.participants.commit(
        actor,
        operation,
        [actor.id],
        async (profiles) => {
          const draft = profiles.get(actor.id);
          const onlineState = draft.onlineState;
          delete draft.onlineState;
          await mutator(draft);
          draft.onlineState = onlineState;
        },
      );
      if (receipt.status !== "committed") throw protocolError(receipt.code);
    },
  };
  const editor = new CharacterDevelopment(store, world.content.catalog, {
    random: world.random,
  });
  await editor.edit(action.patch);
  return receipt;
}

async function presetEdit(world, actor, action, operation) {
  const profile = { ...actor.profile };
  delete profile.onlineState;
  const staged = stageJobPreset(world.content.catalog.ui, profile, action.job);
  // Staged preset values are the base; the developer's explicit edits win, matching the
  // offline draft the developer reviewed, and both commit inside one transaction.
  const patch = action.patch
    ? { ...staged.patch, ...action.patch }
    : staged.patch;
  if (patch.job !== action.job) {
    throw protocolError("INVALID_MESSAGE");
  }
  let receipt;
  const store = {
    profile,
    profileTransactionPending: false,
    async commitProfile(mutator) {
      receipt = await world.participants.commit(
        actor,
        operation,
        [actor.id],
        async (profiles) => {
          const draft = profiles.get(actor.id);
          const onlineState = draft.onlineState;
          delete draft.onlineState;
          await mutator(draft);
          applyJobPresetLoadout(draft, world.content.catalog.ui, action.job);
          validateProfile(draft, world.content.catalog.ui.items);
          draft.onlineState = onlineState;
        },
      );
      if (receipt.status !== "committed") throw protocolError(receipt.code);
    },
  };
  const editor = new CharacterDevelopment(store, world.content.catalog, {
    random: world.random,
  });
  await editor.edit(patch);
  return receipt;
}

function prepareSharedControl(actor, action) {
  if (action.kind === "physics") return preparePhysics(actor, action);
  if (action.kind === "step" && !actor.field.paused) {
    throw protocolError("NOT_ALLOWED");
  }
  return null;
}

function applySharedControl(world, actor, action, prepared) {
  if (action.kind === "pause") {
    actor.field.paused = action.paused;
    for (const peer of actor.field.characters.values()) world.neutralize(peer);
  } else if (action.kind === "step") {
    for (let tick = 0; tick < action.ticks; tick++) {
      world.tickField(actor.field);
    }
  } else if (action.kind === "spawn") {
    actor.field.mobs.push(...prepared);
    actor.field.developmentSpawns += prepared.length;
  } else if (action.kind === "physics") {
    actor.field.physics = prepared.physics;
    for (const [peer, simulation] of prepared.simulations) {
      peer.simulation = simulation;
    }
  }
}

export async function developActor(world, actor, request) {
  admitDeveloper(world, actor);
  const action = developmentAction(request.action);
  const operation = operationFor(actor, request);
  const existing = actor.developmentReceipts.get(request.operationId);
  if (existing) {
    if (existing.digest !== operation.digest) {
      throw protocolError("OPERATION_CONFLICT");
    }
    return existing.receipt;
  }
  const previous = await world.database.receipt(actor, operation);
  if (previous) return previous;
  reserveDevelopment(world, actor, request);
  actor.pending = true;
  actor.pendingOperation = operation.operationId;
  actor.pendingOwner = actor.id;
  try {
    return await dispatchDevelopment(world, actor, action, operation);
  } finally {
    actor.pending = false;
    actor.pendingOperation = null;
    actor.pendingOwner = null;
    world.participants.signalIdle();
  }
}

function reserveDevelopment(world, actor, request) {
  admitDeveloper(world, actor);
  if (
    !actor.connection ||
    actor.connection.data.closed ||
    actor.connection.data.epoch !== request.connectionEpoch
  ) {
    throw protocolError("STALE_CONNECTION");
  }
  if (!actor.connection.data.ready) throw protocolError("NOT_ALLOWED");
  if (
    actor.retiring ||
    actor.deliveryError ||
    world.participants.busy(actor) ||
    actor.developmentReceipts.size >= 1024
  ) {
    throw protocolError("SERVER_BUSY");
  }
}

async function dispatchDevelopment(world, actor, action, operation) {
  if (action.kind === "map") {
    return world.transition(actor, { mapId: action.mapId }, operation);
  }
  if (action.kind === "profile") {
    return profileEdit(world, actor, action, operation);
  }
  if (action.kind === "preset") {
    return presetEdit(world, actor, action, operation);
  }
  if (action.kind === "conjure") {
    return conjureDevelopmentItem(world, actor, action, operation);
  }
  admitSharedControl(world, actor);
  const prepared =
    action.kind === "spawn"
      ? await prepareMonsterSpawns(
          world,
          actor,
          action.templateId,
          action.count,
        )
      : prepareSharedControl(actor, action);
  const receipt = await world.database.commit(actor, operation, () => ({
    value: { kind: action.kind },
  }));
  if (receipt.status !== "committed") return receipt;
  applySharedControl(world, actor, action, prepared);
  world.invalidateField(actor.field);
  actor.developmentReceipts.set(operation.operationId, {
    digest: operation.digest,
    receipt,
  });
  return receipt;
}

function preparePhysics(actor, action) {
  if (!actor.field.paused) throw protocolError("NOT_ALLOWED");
  const physics = {
    ...actor.field.physics,
    globals: { ...actor.field.physics.globals, ...action.globals },
    map: { ...actor.field.physics.map, ...action.map },
  };
  const simulations = [];
  for (const peer of actor.field.characters.values()) {
    const simulation = createSimulation(physics, peer.simulation);
    const motion = captureMotion(peer.simulation);
    const effectiveSettings = { ...simulation.effectiveSettings };
    restoreMotion(simulation, motion);
    simulation.effectiveSettings = effectiveSettings;
    simulations.push([peer, simulation]);
  }
  return { physics, simulations };
}

function admitMonsterSpawn(world, actor, templateId, count) {
  admitSharedControl(world, actor);
  const field = actor.field;
  const foothold = actor.simulation.foothold;
  if (!foothold || foothold.dx <= 0 || actor.profile.hp <= 0 || field.paused) {
    throw protocolError("NOT_ALLOWED");
  }
  integer(templateId, 1, 99999999);
  integer(count, 1, 10);
  if (
    field.mobs.length + field.npcs.size + 256 + count > 2048 ||
    field.developmentSpawns + count > 128
  ) {
    throw protocolError("SERVER_BUSY");
  }
  const entry = world.content.catalog.monsters?.[templateId];
  if (!entry) throw protocolError("NOT_FOUND");
  return entry;
}

function monsterPlacements(actor, plan) {
  const { foothold, entry, templateId, count } = plan;
  const placements = [];
  for (let index = 0; index < count; index++) {
    const x = Math.round(
      Math.max(
        foothold.x1,
        Math.min(
          foothold.x2,
          actor.simulation.x + actor.simulation.facing * 60,
        ),
      ),
    );
    const y = Math.round(
      foothold.y1 + ((x - foothold.x1) * foothold.dy) / foothold.dx,
    );
    placements.push({
      id: randomUUID(),
      kind: "mob",
      template: entry.template,
      source: "server-development",
      authored: {
        id: String(templateId).padStart(7, "0"),
        type: "m",
        x,
        y,
        cy: y,
        fh: foothold.id,
        rx0: foothold.x1,
        rx1: foothold.x2,
        f: actor.simulation.facing > 0 ? 0 : 1,
        hide: 0,
        mobTime: -1,
      },
    });
  }
  return placements;
}

function prepareSpawnedMobs(actor, mobs) {
  for (const mob of mobs) {
    if (!mob.active) {
      actor.admission = `unsupported-content: ${mob.inactiveReason}`;
      throw protocolError("REQUIREMENTS_NOT_MET");
    }
    if (
      mob.attacks.some(
        (attack) => !attack.supported || attack.properties.disease,
      )
    ) {
      actor.admission =
        "unsupported-content: mob attack controller unavailable";
      throw protocolError("REQUIREMENTS_NOT_MET");
    }
    mob.developmentSpawn = true;
    mob.spawnMs = 0;
    mob.opacity = 0;
  }
}

export async function prepareMonsterSpawns(world, actor, templateId, count) {
  const entry = admitMonsterSpawn(world, actor, templateId, count);
  const field = actor.field;
  const foothold = actor.simulation.foothold;
  const source = await world.content.map(entry.mapId);
  if (actor.field !== field) throw protocolError("STALE_FIELD");
  const placements = monsterPlacements(actor, {
    entry,
    foothold,
    templateId,
    count,
  });
  const mobs = createMobs(
    { placements, templates: source.life.templates },
    actor.simulation,
  );
  prepareSpawnedMobs(actor, mobs);
  return mobs;
}
