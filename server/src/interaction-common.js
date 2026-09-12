import { createHash, randomBytes } from "node:crypto";
import { protocolError } from "../../shared/protocol.js";
import { admitActor } from "./action-rules.js";

// Versioned online development policies, not recovered native-server constants.
export const INTERACTION_LIMITS = Object.freeze({
  range: 180,
  leaseMs: 120000,
  tradeMs: 120000,
  invitationMs: 30000,
  contentEntries: 4096,
  contentBytes: 16777216,
  textBytes: 65536,
  workers: 8,
  workerMs: 1500,
  effects: 4096,
});

export function requireInteraction(condition, code = "NOT_ALLOWED") {
  if (!condition) throw protocolError(code);
}

export function interactionState(world) {
  if (!world.interactions) {
    world.interactions = {
      content: new Map(),
      contentBytes: 0,
      contentOwners: 0,
      trades: new Map(),
      workers: 0,
      references: null,
    };
  }
  return world.interactions;
}

export function interactionReceipt(revision, value) {
  return {
    status: "committed",
    code: "OK",
    domainRevision: revision,
    transactionId: null,
    ...(value === undefined ? {} : { value }),
  };
}

export function publishInteraction(world, actor, event) {
  world.publish(actor, { type: "event", fieldEpoch: actor.field.epoch, event });
}

export function closeConversation(actor, world) {
  const id = actor.conversation?.id ?? actor.shop?.id;
  actor.conversation = null;
  actor.shop = null;
  if (id) {
    publishInteraction(world, actor, {
      kind: "dialogue.closed",
      conversationId: id,
    });
  }
}

export function currentNpc(world, actor, lease, transitioning = false) {
  requireInteraction(
    lease &&
      lease.fieldEpoch === actor.field.epoch &&
      lease.expiresAt > Date.now(),
    "SESSION_EXPIRED",
  );
  admitActor(actor, world, lease.fieldEpoch, transitioning);
  requireInteraction(
    (actor.state === "active" ||
      (transitioning && actor.state === "transitioning")) &&
      actor.profile.hp > 0 &&
      !actor.tradeId,
    "CHARACTER_BUSY",
  );
  return world.npc(actor, lease.npcId);
}

export function freshLease(actor, npc) {
  return {
    id: crypto.randomUUID(),
    npcId: npc.id,
    npcTemplateId: npc.templateId,
    fieldEpoch: actor.field.epoch,
    step: 0,
    expiresAt: Date.now() + INTERACTION_LIMITS.leaseMs,
    offers: [],
  };
}

export function requireCharacterRevision(actor, message) {
  requireInteraction(
    message.expectedRevision === actor.revision,
    "STALE_REVISION",
  );
}

export function serverRandomSamples() {
  const bytes = randomBytes(INTERACTION_LIMITS.effects * 4);
  const samples = new Float64Array(INTERACTION_LIMITS.effects);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = bytes.readUInt32LE(index * 4) / 4294967296;
  }
  return samples;
}

export function sampleReader(samples) {
  let cursor = 0;
  return function random() {
    requireInteraction(cursor < samples.length, "SERVER_BUSY");
    return samples[cursor++];
  };
}

function pruneContent(state, now) {
  for (const [hash, entry] of state.content) {
    for (const [owner, expiry] of entry.owners) {
      if (expiry <= now) {
        entry.owners.delete(owner);
        state.contentOwners--;
      }
    }
    if (entry.owners.size) continue;
    state.content.delete(hash);
    state.contentBytes -= entry.bytes;
  }
}

/** Dynamic authored markup is private: hashes are not bearer authorization. */
export function storeDialogue(world, actor, lease, text) {
  const state = interactionState(world);
  const value = { text, npcTemplateId: lease.npcTemplateId };
  const encoded = JSON.stringify(value);
  const bytes = Buffer.byteLength(encoded);
  requireInteraction(bytes <= INTERACTION_LIMITS.textBytes, "CONTENT_MISMATCH");
  const hash = createHash("sha256").update(encoded).digest("hex");
  pruneContent(state, Date.now());
  let entry = state.content.get(hash);
  if (!entry) {
    requireInteraction(
      state.content.size < INTERACTION_LIMITS.contentEntries &&
        state.contentBytes + bytes <= INTERACTION_LIMITS.contentBytes,
      "SERVER_BUSY",
    );
    entry = { value, bytes, owners: new Map() };
    state.content.set(hash, entry);
    state.contentBytes += bytes;
  }
  if (!entry.owners.has(actor.id)) {
    requireInteraction(
      state.contentOwners < INTERACTION_LIMITS.contentEntries,
      "SERVER_BUSY",
    );
    state.contentOwners++;
  }
  entry.owners.set(actor.id, lease.expiresAt);
  return hash;
}

export function getInteractionContent(world, actor, hash) {
  const state = interactionState(world);
  pruneContent(state, Date.now());
  const entry = state.content.get(hash);
  if (!actor || actor.state !== "active" || !entry?.owners.has(actor.id)) {
    return null;
  }
  return entry.value;
}
