import { randomUUID } from "node:crypto";
import { protocolError } from "../../shared/protocol.js";
import { createSimulation } from "../../client/src/physics/simulation.js";
import {
  arrivalPosition,
  nearestSavedArrival,
} from "../../client/src/world/field-arrival.js";
import { portalRouteStatus } from "../../client/src/world/portal-system.js";
import {
  revivalMap,
  REVIVAL_POLICY,
} from "../../client/src/character/revival.js";
import { fieldReference } from "./field-views.js";
import { prepareActorCombat } from "./field-combat.js";
import { releaseInteractions } from "./interactions.js";

export function portalContact(actor, portal) {
  const raw =
    actor.field.manifest.physics.map.$portalProperties?.[portal.id] ?? {};
  const automatic = portal.type === 3;
  const width = automatic ? Math.trunc((raw.hRange ?? 100) / 2) : 20;
  const height = automatic ? Math.trunc((raw.vRange ?? 100) / 2) : 50;
  const x = Math.trunc(actor.simulation.x),
    y = Math.trunc(actor.simulation.y);
  return (
    x >= portal.x - width &&
    x < portal.x + width &&
    y >= portal.y - height &&
    y < portal.y + height
  );
}

function portalDestination(actor, id) {
  const portal = actor.field.manifest.physics.portals.find(
    (entry) => entry.id === id,
  );
  if (!portal) throw protocolError("NOT_FOUND");
  if (!portalContact(actor, portal)) throw protocolError("NOT_IN_RANGE");
  if (actor.profile.hp <= 0) throw protocolError("NOT_ALLOWED");
  const raw =
    actor.field.manifest.physics.map.$portalProperties?.[portal.id] ?? {};
  const unsupported = portalRouteStatus(portal, raw);
  if (unsupported || raw.script) {
    actor.admission = `unsupported-content: ${unsupported ?? "portal script requires explicit server controller"}`;
    throw protocolError("REQUIREMENTS_NOT_MET");
  }
  return { mapId: portal.targetMap, portal: portal.targetName };
}

function destinationRequest(actor, destination) {
  if (destination.portalId !== undefined) {
    return portalDestination(actor, destination.portalId);
  }
  if (destination.revive !== undefined) {
    if (actor.profile.hp > 0) throw protocolError("NOT_ALLOWED");
    if (destination.revive !== "return") {
      actor.admission =
        "unsupported-content: revive consumable controller unavailable";
      throw protocolError("REQUIREMENTS_NOT_MET");
    }
    return { mapId: revivalMap(actor.field.manifest), portal: 0, revive: true };
  }
  return destination;
}

function destinationArrival(world, actor, target, request) {
  if (request.portal !== undefined) {
    return arrivalPosition(target.manifest, request.portal);
  }
  if (!request.randomSpawn) {
    return nearestSavedArrival(target.manifest, actor.profile.location);
  }
  const eligible = target.manifest.physics.portals.filter(
    (portal) =>
      (portal.type === 0 || portal.type === 1) &&
      portal.targetMap === 999999999,
  );
  if (!eligible.length) throw protocolError("CONTENT_MISMATCH");
  return arrivalPosition(
    target.manifest,
    eligible[Math.floor(world.random() * eligible.length)].id,
  );
}

function beginTransition(world, actor, destination) {
  if (
    actor.state !== "active" ||
    actor.field.characters.get(actor.id) !== actor
  ) {
    throw protocolError("STALE_FIELD");
  }
  if (world.now < actor.portalUntil) throw protocolError("COOLDOWN");
  const request = destinationRequest(actor, destination);
  const source = actor.field;
  const transitionId = randomUUID();
  const deadline = world.now + 5000;
  actor.state = "transitioning";
  actor.portalUntil = world.now + 500;
  world.neutralize(actor);
  return { request, source, transitionId, deadline };
}

function prepareTransition(world, actor, transition, target) {
  const { request, source, transitionId, deadline } = transition;
  if (Date.now() > deadline || target.characters.size >= 128) {
    throw protocolError("SERVER_BUSY");
  }
  const arrival = destinationArrival(world, actor, target, request);
  const simulation = createSimulation(target.physics, arrival);
  const reference = {
    instanceId: target.id,
    mapId: target.mapId,
    fieldEpoch: target.epoch,
    spawn: { x: arrival.x, y: arrival.y },
  };
  transition.target = target;
  transition.arrival = arrival;
  transition.simulation = simulation;
  transition.reference = reference;
  world.publish(actor, {
    type: "transition",
    transitionId,
    phase: "prepare",
    sourceEpoch: source.epoch,
    destination: reference,
    requiredContent: [world.content.catalog.maps[target.manifest.id].sha256],
    deadline,
    code: "OK",
  });
}

function commitTransition(world, actor, transition, operation) {
  const { request, source, target, arrival, reference, deadline } = transition;
  return world.database.commit(
    actor,
    {
      ...operation,
      membership: {
        instanceId: target.id,
        fieldEpoch: target.epoch,
      },
    },
    async (draft) => {
      if (
        actor.field !== source ||
        actor.state !== "transitioning" ||
        Date.now() > deadline
      ) {
        throw protocolError("STALE_FIELD");
      }
      if (
        !actor.session ||
        actor.session.revoked ||
        actor.session.expiresAt <= Date.now()
      ) {
        throw protocolError("SESSION_EXPIRED");
      }
      const outcome = operation.mutate ? await operation.mutate(draft) : {};
      draft.location = {
        mapId: target.manifest.id,
        x: arrival.x,
        y: arrival.y,
        facing: 1,
      };
      if (request.revive) {
        draft.hp = Math.min(draft.maxHP, REVIVAL_POLICY.restoredHP);
      }
      return {
        ...outcome,
        value: { ...outcome.value, destination: reference },
      };
    },
  );
}

function bindTransition(world, actor, transition) {
  const { source, target, arrival, simulation } = transition;
  releaseInteractions(actor, world);
  source.characters.delete(actor.id);
  actor.field = target;
  actor.arrival = arrival;
  actor.simulation = simulation;
  target.characters.set(actor.id, actor);
  actor.state = "active";
  actor.inputQueue.clear();
  actor.lastInputTick = target.tick;
  prepareActorCombat(world, actor);
}

function publishTransition(world, actor, transition) {
  const { transitionId, source, target, deadline } = transition;
  world.publish(actor, {
    type: "transition",
    transitionId,
    phase: "committed",
    sourceEpoch: source.epoch,
    destination: fieldReference(actor),
    requiredContent: [],
    deadline,
    code: "OK",
  });
  world.publish(actor, { type: "snapshot-request" });
  world.invalidateField(source);
  world.invalidateField(target);
}

function rollbackTransition(world, actor, transition) {
  const { transitionId, source, deadline } = transition;
  actor.state = "active";
  actor.simulation.movementLocked = actor.profile.hp <= 0;
  world.publish(actor, {
    type: "transition",
    transitionId,
    phase: "aborted",
    sourceEpoch: source.epoch,
    destination: null,
    requiredContent: [],
    deadline,
    code: "TRANSITION_FAILED",
  });
}

/** Internal trusted destination only; gameplay portal intent never carries a map/XY. */
export async function transitionActor(world, actor, destination, operation) {
  const transition = beginTransition(world, actor, destination);
  let committed = false;
  try {
    const target = await world.fieldFor(transition.request.mapId, actor.realm);
    prepareTransition(world, actor, transition, target);
    const receipt = await commitTransition(world, actor, transition, operation);
    if (receipt.status !== "committed") return receipt;
    bindTransition(world, actor, transition);
    committed = true;
    publishTransition(world, actor, transition);
    return receipt;
  } finally {
    if (!committed) rollbackTransition(world, actor, transition);
  }
}
