import {
  CharacterBindings,
  EXPRESSION_NAMES,
} from "../../client/src/input/character-bindings.js";
import { validateAvatarRecord } from "../../client/src/character/avatar-composition.js";
import { setSimulationSeat } from "../../client/src/physics/simulation.js";
import { protocolError } from "../../shared/schema.js";
import { interactionReceipt } from "./interaction-common.js";
import { admitActor } from "./action-rules.js";

/** Prepare authored expression resources before replacing the live bindings. */
function worldActionScene(world, actor, face) {
  const durations = new Map(Object.entries(face.expressionDurations));
  const expressions = new Set(
    EXPRESSION_NAMES.filter((name) => face.frames[name]?.length),
  );
  return {
    get manifest() {
      return actor.field.manifest;
    },
    get simulation() {
      return actor.simulation;
    },
    actor: {
      expressions,
      expressionDurations: durations,
      setExpression(name, duration) {
        actor.expression = {
          name,
          startedAt: world.now,
          expiresAt: world.now + duration,
        };
      },
    },
  };
}

function worldActionGameplay(world, actor) {
  return {
    prepared: true,
    get dead() {
      return actor.profile.hp <= 0;
    },
    get destroyed() {
      return actor.state === "retired";
    },
    get phase() {
      return (
        actor.skillField?.phase ??
        (actor.attackState?.active || world.now < (actor.castUntil ?? 0)
          ? "attack"
          : "idle")
      );
    },
    get alertTimerMs() {
      return (
        actor.skillField?.alertTimerMs ??
        Math.max(0, (actor.alertUntil ?? 0) - world.now)
      );
    },
  };
}

function worldActionHooks(world, actor) {
  return {
    now: () => world.now,
    report: (reason) => {
      actor.admission = reason;
    },
    isBlocked: () =>
      actor.state !== "active" || Boolean(actor.tradeId || actor.conversation),
  };
}

/** The native character controller receives authoritative getters, never a local profile store. */
export async function prepareActorWorldActions(world, actor) {
  const entry =
    world.content.catalog.ui.avatar.entries[actor.profile.appearance.face];
  if (!entry || entry.kind !== "face") throw protocolError("CONTENT_MISMATCH");
  const bundle = await world.content.json(entry.descriptor);
  const face = validateAvatarRecord(bundle.metadata?.avatar);
  const scene = worldActionScene(world, actor, face);
  const store = {
    get profile() {
      return actor.profile;
    },
  };
  const gameplay = worldActionGameplay(world, actor);
  const previous = actor.worldActions;
  actor.worldActions = new CharacterBindings(
    scene,
    store,
    gameplay,
    worldActionHooks(world, actor),
  );
  if (previous) {
    actor.worldActions.lastEmotionAt = previous.lastEmotionAt;
    actor.worldActions.lastSeatAt = previous.lastSeatAt;
  }
  actor.expression ??= null;
  actor.worldActionFace = actor.profile.appearance.face;
}

/** Validate destination seats before travel commits; lifetime guards retain the same actor owner. */
export function prepareActorWorldActionField(actor, manifest) {
  const actions = actor.worldActions;
  if (!actions) throw protocolError("CONTENT_MISMATCH");
  const scene = {
    manifest,
    actor: actions.scene.actor,
    get simulation() {
      return actor.simulation;
    },
  };
  const next = new CharacterBindings(
    scene,
    actions.store,
    actions.gameplay,
    actions.hooks,
  );
  next.inherit(actions);
  return next;
}

export function bindActorWorldActions(actor, prepared) {
  actor.worldActions = prepared;
}

export async function executeWorldAction(actor, message, world) {
  if (actor.worldActionFace !== actor.profile.appearance.face)
    {await prepareActorWorldActions(world, actor);}
  admitActor(actor, world, message.fieldEpoch);
  const actions = actor.worldActions;
  if (!actions) throw protocolError("CONTENT_MISMATCH");
  const request = message.action;
  let accepted;
  if (request.kind === "expression.use")
    {accepted = actions.emote(request.expression);}
  else if (request.kind === "expression.cash")
    {accepted = actions.useCashExpression(request.templateId);}
  else if (request.kind === "seat.toggle") accepted = actions.sit();
  else throw protocolError("INVALID_MESSAGE");
  if (!accepted) {
    const reason = actions.lastResult?.reason ?? "Character action unavailable";
    throw protocolError(
      reason.startsWith("Wait") ? "COOLDOWN" : "REQUIREMENTS_NOT_MET",
    );
  }
  if (request.kind === "seat.toggle") actor.actionStartTick = actor.field.tick;
  world.invalidateField(actor.field);
  return interactionReceipt(actor.revision, {
    kind: "world.character-action",
    action: request.kind,
  });
}

/** Called immediately before authoritative movement, using shared held-input fields. */
export function beforeWorldPhysics(world, actor) {
  actor.worldActions?.beforePhysics(actor.input);
  if (actor.expression && actor.expression.expiresAt <= world.now)
    {actor.expression = null;}
}
export function clearActorSeat(actor) {
  if (actor.simulation?.seat) setSimulationSeat(actor.simulation, null);
}
export function actorWorldFields(actor) {
  return {
    expression: actor.expression ?? null,
    seat: actor.simulation.seat ?? null,
  };
}
