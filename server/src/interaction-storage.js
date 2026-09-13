import {
  applyStorageTransfer,
  storageInteger,
} from "../../client/src/npc/npc-storage-rules.js";
import { operationFor } from "./action-rules.js";
import {
  closeConversation,
  currentNpc,
  interactionReceipt,
  publishInteraction,
  requireCharacterRevision,
  requireInteraction,
  INTERACTION_LIMITS,
} from "./interaction-common.js";

function admitStorage(actor, world, lease) {
  currentNpc(world, actor, lease);
  requireInteraction(actor.conversation === lease, "SESSION_EXPIRED");
  requireInteraction(actor.profile.level >= 15, "REQUIREMENTS_NOT_MET");
}

export async function openStorage(actor, world, lease) {
  admitStorage(actor, world, lease);
  const npc = world.content.catalog.ui.npcPortraits[lease.npcTemplateId];
  requireInteraction(npc?.storage, "CONTENT_MISMATCH");
  storageInteger(npc.storage.putFee, 0, 2147483647);
  storageInteger(npc.storage.getFee, 0, 2147483647);
  const account = await world.participants.storage(actor);
  admitStorage(actor, world, lease);
  lease.view = { kind: "storage", npcId: lease.npcTemplateId };
  actor.storage = {
    lease,
    fees: { putFee: npc.storage.putFee, getFee: npc.storage.getFee },
    npcName: npc.name ?? "",
    account,
  };
  publishStorage(actor, world);
}

/** Load account state before reconnect projection; never mark an unloaded Trunk ready. */
export async function prepareStorage(actor, world) {
  if (!actor.storage) return;
  admitStorage(actor, world, actor.storage.lease);
  actor.storage.account = await world.participants.storage(actor);
}

export function storageProjection(actor) {
  const storage = actor.storage;
  if (!storage) return null;
  return {
    kind: "storage",
    storageSession: storage.lease.id,
    revision: storage.lease.step,
    npcId: storage.lease.npcTemplateId,
    npcName: storage.npcName,
    fees: storage.fees,
    account: storage.account,
  };
}

export function publishStorage(actor, world) {
  const event = storageProjection(actor);
  if (!event) return;
  actor.nativeInteractions ??= new Map();
  actor.nativeInteractions.delete("dialogue");
  actor.nativeInteractions.delete("shop");
  actor.nativeInteractions.set("storage", [event]);
  publishInteraction(world, actor, event);
}

export async function executeStorage(actor, message, world) {
  const storage = actor.storage;
  requireInteraction(storage, "SESSION_EXPIRED");
  admitStorage(actor, world, storage.lease);
  requireCharacterRevision(actor, message);
  requireInteraction(
    storage.lease.id === message.action.storageSession,
    "SESSION_EXPIRED",
  );
  if (message.action.kind === "storage.close") {
    closeStorage(actor, world);
    return interactionReceipt(actor.revision);
  }
  requireInteraction(
    message.action.kind === "storage.execute",
    "INVALID_MESSAGE",
  );
  const request = message.action.request;
  requireInteraction(
    !request.uid || !actor.itemLocks?.has(request.uid),
    "CHARACTER_BUSY",
  );
  const receipt = await world.participants.account(
    actor,
    operationFor(message),
    message.action.storageRevision,
    (draft, account) => {
      admitStorage(actor, world, storage.lease);
      requireInteraction(actor.storage === storage, "SESSION_EXPIRED");
      applyStorageTransfer(draft, account, request, {
        items: world.content.items,
        fees: storage.fees,
      });
      return {
        value: {
          kind: "storage.transaction",
          storageSession: storage.lease.id,
          action: request.kind,
          storageRevision: message.action.storageRevision + 1,
        },
      };
    },
  );
  if (receipt.status === "committed" && actor.storage === storage) {
    storage.lease.expiresAt = Date.now() + INTERACTION_LIMITS.leaseMs;
    await prepareStorage(actor, world);
    publishStorage(actor, world);
    world.publish(actor, { type: "snapshot-request" });
  }
  return receipt;
}

export function closeStorage(actor, world) {
  const storage = actor.storage;
  if (!storage) return;
  actor.storage = null;
  actor.nativeInteractions?.delete("storage");
  publishInteraction(world, actor, {
    kind: "storage.closed",
    storageSession: storage.lease.id,
  });
  if (actor.conversation === storage.lease) closeConversation(actor, world);
}
