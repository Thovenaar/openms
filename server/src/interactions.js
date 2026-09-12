import { executeNpc } from "./interaction-npc.js";
import { executeQuest } from "./interaction-quest.js";
import { executeShop } from "./interaction-shop.js";
import { executeTrade, closeTrade } from "./interaction-trade.js";
import { executeChat } from "./interaction-chat.js";
import {
  closeConversation,
  currentNpc,
  interactionState,
  requireInteraction,
  INTERACTION_LIMITS,
} from "./interaction-common.js";
import { actionDomain } from "../../shared/protocol.js";

export { getInteractionContent } from "./interaction-common.js";

/** Unknown or unrelated leases yield zero rather than leaking another participant's state. */
export function currentInteractionRevision(actor, action, world) {
  const domain = actionDomain(action);
  if (domain === "inventory") return actor.inventoryRevision;
  if (domain === "social") return actor.socialRevision;
  if (domain === "character") return actor.revision;
  if (domain === "conversation") {
    const lease = actor.conversation;
    return lease?.id === action.conversationId ? lease.step : 0;
  }
  const id = action.tradeId ?? action.invitationId;
  const room = world.interactions?.trades.get(id);
  if (!room || actor.tradeId !== id || !room.participants.includes(actor.id)) {
    return 0;
  }
  return room.revision;
}

export async function executeInteraction(actor, message, world) {
  const kind = message.action.kind;
  if (kind === "npc.open" || kind === "npc.answer") {
    return executeNpc(actor, message, world);
  }
  if (["quest.accept", "quest.claim", "quest.abandon"].includes(kind)) {
    const receipt = await executeQuest(actor, message, world);
    if (receipt.status === "committed") {
      world.publish(actor, { type: "snapshot-request" });
    }
    return receipt;
  }
  if (["shop.buy", "shop.sell", "shop.recharge"].includes(kind)) {
    return executeShop(actor, message, world);
  }
  if (
    [
      "trade.invite",
      "trade.answer",
      "trade.offer",
      "trade.confirm",
      "trade.cancel",
    ].includes(kind)
  ) {
    return executeTrade(actor, message, world);
  }
  requireInteraction(kind === "chat.send", "INVALID_MESSAGE");
  return executeChat(actor, message, world);
}

/** Final disconnect/field handoff revokes leases; no escrow has been debited. */
export function releaseInteractions(actor, world) {
  closeConversation(actor, world);
  const room = interactionState(world).trades.get(actor.tradeId);
  if (room && !room.busy) closeTrade(world, room);
}

function leaseExpired(actor, world) {
  const lease = actor.conversation ?? actor.shop;
  if (!lease) return false;
  try {
    currentNpc(world, actor, lease);
    return false;
  } catch (error) {
    if (
      [
        "UNAUTHENTICATED",
        "SESSION_EXPIRED",
        "CHARACTER_BUSY",
        "NOT_FOUND",
        "NOT_IN_RANGE",
        "NOT_ALLOWED",
        "STALE_FIELD",
      ].includes(error.code)
    ) {
      return true;
    }
    throw error;
  }
}

function tradeSessionExpired(actor, now) {
  return (
    !actor.session || actor.session.revoked || actor.session.expiresAt <= now
  );
}

function tradeExpired(room, world, now) {
  if (room.expiresAt <= now) return true;
  const first = world.actors.get(room.participants[0]);
  const second = world.actors.get(room.participants[1]);
  if (
    !first ||
    !second ||
    first.field !== second.field ||
    first.field.epoch !== room.fieldEpoch ||
    first.profile.hp <= 0 ||
    second.profile.hp <= 0
  ) {
    return true;
  }
  if (tradeSessionExpired(first, now) || tradeSessionExpired(second, now)) {
    return true;
  }
  try {
    world.nearby(first, second.id, "player", INTERACTION_LIMITS.range);
    return false;
  } catch (error) {
    if (["NOT_FOUND", "NOT_IN_RANGE", "NOT_ALLOWED"].includes(error.code)) {
      return true;
    }
    throw error;
  }
}

/** Called from the scheduler; no per-tick allocation when the one-second slice is not due. */
export function sweepInteractions(world) {
  const state = interactionState(world);
  const now = Date.now();
  if (now < (state.nextSweep ?? 0)) return;
  state.nextSweep = now + 1000;
  requireInteraction(
    world.actors.size <= 2048 && state.trades.size <= 2048,
    "SERVER_BUSY",
  );
  for (const actor of world.actors.values()) {
    if (!actor.pending && leaseExpired(actor, world)) {
      closeConversation(actor, world);
    }
  }
  for (const room of state.trades.values()) {
    if (!room.busy && tradeExpired(room, world, now)) closeTrade(world, room);
  }
}
