import { randomUUID } from "node:crypto";
import { ReactorSystem } from "../../client/src/world/reactor-system.js";
import { protocolError } from "../../shared/schema.js";
import { animationId } from "../../shared/motion-schema.js";
import {
  admitActor,
  ownedItem,
  operationFor,
  ruleError,
} from "./action-rules.js";
import { WorldAnimation } from "./world-animation.js";

const MAX_REGIONS = 16384;

/** Compile exact region frame geometry once; no sprite/resource/viewport authority on the server. */
export async function createFieldReactors(world, field) {
  const byId = new Map();
  const placements = field.manifest.reactors.placements;
  const required = new Set(
    placements.map((entry) => entry.entityId).filter(Boolean),
  );
  if (field.manifest.regions.length > MAX_REGIONS)
    {throw protocolError("CONTENT_MISMATCH");}
  const textures = new Map(Object.entries(field.manifest.textures));
  for (const descriptor of field.manifest.regions) {
    if (required.size === 0) break;
    const region = await world.content.json(descriptor);
    if (!Array.isArray(region.entities) || region.entities.length > 65536) {
      throw protocolError("CONTENT_MISMATCH");
    }
    for (const entity of region.entities) {
      if (!required.has(entity.id)) continue;
      byId.set(entity.id, new WorldAnimation(entity, textures));
      required.delete(entity.id);
    }
  }
  if (required.size) throw protocolError("CONTENT_MISMATCH");
  const controller = new FieldReactors(world, field, byId);
  for (const record of controller.records) record.id = randomUUID();
  field.reactors = controller;
  return controller;
}

/** The original bounded state/attack/skill/item/timeOut/respawn machine, with server persistence ports. */
class FieldReactors extends ReactorSystem {
  constructor(world, field, byId) {
    const context = {
      actor: null,
      operation: null,
      message: null,
      receipt: null,
    };
    const scene = {
      manifest: field.manifest,
      byId,
      get simulation() {
        return context.actor.simulation;
      },
    };
    const store = {
      get id() {
        return context.actor.id;
      },
      get profile() {
        return context.actor.profile;
      },
      profileTransactionPending: false,
      commitProfile: async (mutate) => {
        const actor = context.actor;
        const receipt = await world.participants.commit(
          actor,
          context.operation,
          [actor.id],
          (profiles) => {
            const draft = profiles.get(actor.id);
            admitActor(actor, world, context.message.fieldEpoch);
            ownedItem(draft, actor, context.message.action.itemId, world.now);
            mutate(draft);
            return {
              value: {
                kind: "world.reactor-offer",
                accepted: true,
                consumed: context.offer.event.count,
                reactorId: context.offer.record.id,
                scriptRewards: false,
              },
            };
          },
        );
        context.receipt = receipt;
        if (receipt.status !== "committed") throw protocolError(receipt.code);
      },
    };
    super(scene, store);
    this.context = context;
    this.world = world;
    this.field = field;
  }
  applyTransition(record, event, target) {
    const state = record.state?.id ?? -1;
    super.applyTransition(record, event, target);
    this.world.broadcast(this.field, {
      type: "event",
      fieldEpoch: this.field.epoch,
      event: {
        kind: "world.reactor",
        reactorId: record.id,
        placementId: record.placement.id,
        fromState: state,
        state: record.state?.id ?? -1,
        generation: record.transitions,
        impactTick: this.field.tick,
        scriptRewards: false,
      },
    });
  }
  async acceptOffer(record, event, request) {
    this.context.offer = { record, event };
    return super.acceptOffer(record, event, request);
  }
}

function selectActor(actor) {
  const controller = actor.field.reactors;
  if (!controller || controller.pending || controller.destroyed) return null;
  if (actor.state !== "active" || actor.profile.hp <= 0) return null;
  controller.context.actor = actor;
  return controller;
}

/** Geometry is the real accepted impact rectangle, facing and skillId (zero for basics). */
export function canStrikeReactor(world, actor, geometry) {
  const controller = selectActor(actor);
  return (
    controller?.canStrike(
      geometry.rectangle,
      geometry.facing,
      geometry.skillId ?? 0,
    ) ?? false
  );
}
export function strikeReactor(world, actor, geometry) {
  const controller = selectActor(actor);
  return (
    controller?.strike(
      geometry.rectangle,
      geometry.facing,
      geometry.skillId ?? 0,
    ) ?? false
  );
}

/** A field-wide reservation pauses reactor clocks/impacts until its durable debit settles. */
export async function offerReactor(actor, message, world) {
  if (actor.tradeId || actor.conversation) throw protocolError("NOT_ALLOWED");
  const controller = selectActor(actor);
  if (!controller) throw protocolError("SERVER_BUSY");
  ownedItem(actor.profile, actor, message.action.itemId, world.now);
  controller.context.operation = operationFor(message);
  controller.context.message = message;
  controller.context.receipt = null;
  try {
    const result = await controller.offer({
      actorId: actor.id,
      uid: message.action.itemId,
    });
    if (!result.ok)
      {throw ruleError({
        code: result.code,
        message: result.reason ?? result.code,
      });}
    world.invalidateField(actor.field);
    return controller.context.receipt;
  } finally {
    controller.context.actor = null;
    controller.context.operation = null;
    controller.context.message = null;
    controller.context.offer = null;
  }
}

export function advanceReactors(world, field, ms = 30) {
  field.reactors.step(ms);
}
export function settleFieldReactors(field) {
  return field.reactors.waitForIdle();
}
export function destroyFieldReactors(field) {
  field.reactors.destroy();
}

/** Hidden reactors remain published so a newly joined observer suppresses their static artwork. */
export function reactorEntities(field) {
  return field.reactors.records.map((record) => ({
    id: record.id,
    kind: "reactor",
    templateId: Number(record.placement.templateId),
    position: { x: record.placement.x, y: record.placement.y },
    velocity: { x: 0, y: 0 },
    foothold: null,
    facing: record.placement.flip ? 1 : -1,
    action: animationId("stand1"),
    actionStartTick: field.tick,
    appearance: null,
    reactor: {
      placementId: record.placement.id,
      state: record.state?.id ?? -1,
      phase: record.phase,
      action: record.action,
      elapsedMs: record.phaseMs,
      repeat: record.phase === "idle" && Boolean(record.state?.repeat),
      visible: Boolean(record.animation?.container.visible),
      generation: record.transitions,
      scriptRewards: false,
    },
  }));
}
