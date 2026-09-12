import {
  executeInteraction,
  currentInteractionRevision,
} from "./interactions.js";
import {
  executeInventory,
  executeDrop,
  executePickup,
} from "./action-inventory.js";
import { executeCharacter, rebuildActorEffects } from "./action-character.js";
import { admitActor, operationFor, reject, ruleError } from "./action-rules.js";

const EPHEMERAL_ACTIONS = new Set([
  "npc.open",
  "npc.answer",
  "trade.invite",
  "trade.answer",
  "trade.offer",
  "trade.cancel",
  "chat.send",
]);
const MAX_EPHEMERAL_RECEIPTS = 4096;
// These handlers mutate durable domains but do not publish their own replacement views.
const LOCAL_SNAPSHOT_ACTIONS = new Set([
  "inventory.move",
  "equipment.equip",
  "equipment.unequip",
  "item.use",
  "equipment.scroll",
  "item.drop",
  "mesos.drop",
  "drop.pickup",
  "stats.allocate",
  "skills.allocate",
  "buff.cancel",
]);

/** A replay returns its original receipt but always reconciles against current authority. */
function publishReceipt(actor, world, receipt) {
  if (receipt.status === "committed") {
    world.publish(actor, { type: "snapshot-request" });
  }
  return receipt;
}

/** Class-1 outcomes belong to one play session, including its reconnect grace. */
function ephemeralReceipts(actor) {
  if (!actor.operationReceipts || actor.receiptSession !== actor.playSession) {
    actor.operationReceipts = new Map();
    actor.receiptSession = actor.playSession;
  }
  return actor.operationReceipts;
}

function cachedReceipt(receipts, operation) {
  const entry = receipts.get(operation.operationId);
  if (!entry) return null;
  if (entry.digest === operation.digest) return entry.receipt;
  return {
    status: "rejected",
    code: "OPERATION_CONFLICT",
    domainRevision: entry.receipt.domainRevision,
    transactionId: null,
  };
}

function dispatchCharacter(actor, message, world, operation) {
  switch (message.action.kind) {
    case "portal.enter":
      return world.transition(
        actor,
        { portalId: message.action.portalId },
        operation,
      );
    case "revive.request":
      return world.transition(
        actor,
        { revive: message.action.method },
        operation,
      );
    case "skill.cast":
      return world.cast(actor, message.action, operation);
    case "buff.cancel":
    case "stats.allocate":
    case "skills.allocate":
      return executeCharacter(actor, message, world, operation);
    case "npc.open":
    case "quest.accept":
    case "quest.claim":
    case "quest.abandon":
    case "trade.invite":
      return executeInteraction(actor, message, world);
    default:
      reject("INVALID_MESSAGE", "The action has no character handler.");
  }
}

function dispatchInventory(actor, message, world, operation) {
  switch (message.action.kind) {
    case "drop.pickup":
      return executePickup(actor, message, world, operation);
    case "item.drop":
    case "mesos.drop":
      return executeDrop(actor, message, world, operation);
    case "inventory.move":
    case "equipment.equip":
    case "equipment.unequip":
    case "item.use":
    case "equipment.scroll":
      return executeInventory(actor, message, world, operation);
    case "shop.buy":
    case "shop.sell":
    case "shop.recharge":
      return executeInteraction(actor, message, world);
    default:
      reject("INVALID_MESSAGE", "The action has no inventory handler.");
  }
}

function dispatch(actor, message, world, operation) {
  switch (operation.domain) {
    case "character":
      return dispatchCharacter(actor, message, world, operation);
    case "inventory":
      return dispatchInventory(actor, message, world, operation);
    case "conversation":
    case "trade":
    case "invitation":
    case "social":
      return executeInteraction(actor, message, world);
    default:
      reject("INVALID_MESSAGE", "The action has no protocol handler.");
  }
}

/** Receipt lookups must finish before reserving the actor or checking session capacity. */
function admitOperationSlot(actor, receipts, ephemeral) {
  if (actor.pending) {
    reject("SERVER_BUSY", "Another character operation is in flight.");
  }
  if (ephemeral && receipts.size >= MAX_EPHEMERAL_RECEIPTS) {
    reject(
      "SERVER_BUSY",
      "The play-session ephemeral receipt capacity is exhausted.",
    );
  }
  actor.pending = true;
}

/** One authority entry: durable duplicate lookup precedes all transient domain admission. */
export async function executeAction(actor, message, world) {
  const operation = operationFor(message);
  if (["conversation", "trade", "invitation"].includes(operation.domain)) {
    operation.domainRevision = currentInteractionRevision(
      actor,
      message.action,
      world,
    );
  }
  const receipts = ephemeralReceipts(actor);
  const cached = cachedReceipt(receipts, operation);
  if (cached) return publishReceipt(actor, world, cached);
  const previous = await world.database.receipt(actor, operation);
  if (previous) return publishReceipt(actor, world, previous);
  const settled = cachedReceipt(receipts, operation);
  if (settled) return publishReceipt(actor, world, settled);
  const ephemeral = EPHEMERAL_ACTIONS.has(message.action.kind);
  admitOperationSlot(actor, receipts, ephemeral);
  try {
    admitActor(actor, world, message.fieldEpoch);
    const receipt = await dispatch(actor, message, world, operation);
    if (
      receipt.status === "committed" &&
      (message.action.kind === "item.use" ||
        message.action.kind === "buff.cancel")
    ) {
      rebuildActorEffects(actor, world);
    }
    if (ephemeral && receipt.transactionId === null) {
      receipts.set(operation.operationId, {
        digest: operation.digest,
        receipt,
      });
    }
    return LOCAL_SNAPSHOT_ACTIONS.has(message.action.kind)
      ? publishReceipt(actor, world, receipt)
      : receipt;
  } catch (error) {
    const failure = ruleError(error);
    // Rejections are receipts too; no mutated draft is ever installed on this path.
    const receipt = await world.database.commit(actor, operation, () => ({
      code: failure.code,
    }));
    return publishReceipt(actor, world, receipt);
  } finally {
    actor.pending = false;
  }
}
