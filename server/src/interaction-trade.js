import {
  TRADE_SLOTS,
  tradeFee,
  tradeInteger,
  admitTradeMesoProposal,
  tradeReceivedTotal,
  revalidateOffer,
  applyTradeItems,
  applyTradeMesos,
} from "../../client/src/social/local-trade-rules.js";
import {
  TRADE_CHAT_LENGTH,
  TRADE_CHAT_LINES,
  TRADE_CHAT_BYTES,
  TRADE_TERMINAL_STATES,
} from "../../shared/trade-protocol.js";
import { validUnicode } from "../../shared/schema.js";
import { itemView, actorEntity } from "./field-views.js";
import { operationFor, admitActor, ruleError } from "./action-rules.js";
import {
  interactionState,
  interactionReceipt,
  publishInteraction,
  requireInteraction,
  requireCharacterRevision,
  INTERACTION_LIMITS,
} from "./interaction-common.js";

const MAX_TRADES = 2048;
const INVITE_INTERVAL_MS = 3000;
const CHAT_INTERVAL_MS = 300;

function eligible(world, actor, peer) {
  requireInteraction(
    actor &&
      peer &&
      actor !== peer &&
      actor.state === "active" &&
      peer.state === "active" &&
      actor.profile.hp > 0 &&
      peer.profile.hp > 0,
    "NOT_ALLOWED",
  );
  admitActor(actor, world, actor.field.epoch);
  admitActor(peer, world, peer.field.epoch);
  requireInteraction(actor.field === peer.field, "NOT_FOUND");
  world.nearby(actor, peer.id, "player", INTERACTION_LIMITS.range);
  requireInteraction(
    !actor.profile.social.blacklist.includes(peer.id) &&
      !peer.profile.social.blacklist.includes(actor.id),
    "NOT_ALLOWED",
  );
}

function roomActors(world, room) {
  requireInteraction(room.expiresAt > Date.now(), "SESSION_EXPIRED");
  const actors = room.participants.map((id) => world.actors.get(id));
  eligible(world, actors[0], actors[1]);
  requireInteraction(
    actors.every(
      (actor) =>
        actor.tradeId === room.id &&
        actor.field.epoch === room.fieldEpoch &&
        actor.playSession ===
          room.sessions[room.participants.indexOf(actor.id)],
    ),
    "SESSION_EXPIRED",
  );
  return actors;
}

function tradeOfferView(world, room, index) {
  const ownerId = room.participants[index];
  const actor = world.actors.get(ownerId);
  const offer = room.offers[index];
  return {
    ownerId,
    items: offer.items.map((entry) => ({
      slot: entry.slot,
      item: itemView(
        entry.item,
        actor?.inventoryRevision ?? room.inventoryRevisions[index],
        false,
        world.content.items,
      ),
      quantity: entry.count,
    })),
    mesos: offer.mesos,
    confirmed: offer.confirmed,
  };
}

export function publishTrade(world, room, state = room.state) {
  const event = {
    kind: "trade",
    tradeId: room.id,
    revision: room.revision,
    state,
    expiresAt: room.expiresAt,
    participants: room.participants,
    members: room.members,
    offers: [tradeOfferView(world, room, 0), tradeOfferView(world, room, 1)],
    messages: room.messages.slice(),
    result: room.result,
  };
  for (const id of room.participants) {
    const actor = world.actors.get(id);
    if (!actor) continue;
    try {
      publishInteraction(world, actor, event);
    } catch (error) {
      world.deliveryFailed(actor, error);
    }
  }
}

function terminalBase(room) {
  return {
    kind: "trade.result",
    tradeId: room.id,
    revision: room.revision + 1,
    participantIds: room.participants.slice(),
  };
}

function cancelledResult(room, state) {
  return {
    ...terminalBase(room),
    ok: true,
    code: state === "declined" ? "trade-declined" : "trade-cancelled",
    side: null,
    reason:
      room.expiresAt <= Date.now()
        ? room.state === "invited"
          ? "The trade invitation expired."
          : "The trade room expired."
        : "The trade invitation or room is no longer available.",
  };
}

function releaseTradeParticipants(world, room) {
  for (const id of room.participants) {
    const actor = world.actors.get(id);
    if (actor?.tradeId !== room.id) continue;
    actor.tradeId = null;
    actor.itemLocks?.clear();
    actor.tradeMesos = 0;
  }
}

/** Accepted commits drain. Every other terminal path releases only this room's reservations. */
export function closeTrade(world, room, state = "cancelled", result = null) {
  if (TRADE_TERMINAL_STATES.includes(room.state)) return room.result;
  requireInteraction(TRADE_TERMINAL_STATES.includes(state), "INVALID_MESSAGE");
  requireInteraction(
    result !== null || state === "cancelled" || state === "declined",
    "INVALID_MESSAGE",
  );
  room.result = result ?? cancelledResult(room, state);
  room.state = state;
  room.revision = room.result.revision;
  releaseTradeParticipants(world, room);
  interactionState(world).trades.delete(room.id);
  publishTrade(world, room);
  return room.result;
}

function cancelTrade(world, room, side, declined = false) {
  const state = declined ? "declined" : "cancelled";
  const result = closeTrade(world, room, state, {
    ...terminalBase(room),
    ok: true,
    code: declined ? "trade-declined" : "trade-cancelled",
    side,
    reason: declined
      ? "The trade invitation was declined."
      : "The trade was cancelled.",
  });
  return interactionReceipt(room.revision, result);
}

function invite(actor, message, world) {
  requireCharacterRevision(actor, message);
  const now = Date.now();
  requireInteraction(
    now - (actor.lastTradeInvite ?? 0) >= INVITE_INTERVAL_MS,
    "RATE_LIMITED",
  );
  const peer = world.actors.get(message.action.targetId);
  eligible(world, actor, peer);
  requireInteraction(
    !actor.tradeId &&
      !peer.tradeId &&
      !peer.pending &&
      !actor.conversation &&
      !peer.conversation &&
      peer.profile.settings.gameOptions.allowTrade,
    "CHARACTER_BUSY",
  );
  const state = interactionState(world);
  requireInteraction(state.trades.size < MAX_TRADES, "SERVER_BUSY");
  const room = {
    id: crypto.randomUUID(),
    revision: 1,
    state: "invited",
    participants: [actor.id, peer.id],
    sessions: [actor.playSession, peer.playSession],
    inventoryRevisions: [actor.inventoryRevision, peer.inventoryRevision],
    fieldEpoch: actor.field.epoch,
    expiresAt: now + INTERACTION_LIMITS.invitationMs,
    busy: false,
    messages: [],
    chatBytes: 0,
    chatSequence: 0,
    lastChat: [0, 0],
    result: null,
    offers: [
      { items: [], mesos: 0, confirmed: false },
      { items: [], mesos: 0, confirmed: false },
    ],
  };
  actor.tradeId = peer.tradeId = room.id;
  room.members = [actor, peer].map((member) => ({
    id: member.id,
    appearance: actorEntity(member).appearance,
  }));
  actor.lastTradeInvite = now;
  state.trades.set(room.id, room);
  publishTrade(world, room);
  return interactionReceipt(actor.revision);
}

function getRoom(actor, message, world) {
  const id = message.action.invitationId ?? message.action.tradeId;
  const room = interactionState(world).trades.get(id);
  requireInteraction(
    room && actor.tradeId === id && room.participants.includes(actor.id),
    "NOT_FOUND",
  );
  requireInteraction(!room.busy, "CHARACTER_BUSY");
  if (room.expiresAt <= Date.now()) {
    closeTrade(world, room);
    requireInteraction(false, "SESSION_EXPIRED");
  }
  requireInteraction(
    message.expectedRevision === room.revision,
    "STALE_REVISION",
  );
  return room;
}

function answer(actor, message, world, room) {
  requireInteraction(
    room.state === "invited" && room.participants[1] === actor.id,
    "NOT_ALLOWED",
  );
  if (!message.action.accept) return cancelTrade(world, room, 1, true);
  const actors = roomActors(world, room);
  requireInteraction(!actors[0].pending, "CHARACTER_BUSY");
  requireInteraction(
    actor.profile.settings.gameOptions.allowTrade,
    "NOT_ALLOWED",
  );
  room.state = "open";
  room.revision++;
  room.expiresAt = Date.now() + INTERACTION_LIMITS.tradeMs;
  publishTrade(world, room);
  return interactionReceipt(room.revision);
}

function offeredItems(actor, requested, world) {
  requireInteraction(
    requested.length <= TRADE_SLOTS &&
      new Set(requested.map((entry) => entry.itemId)).size ===
        requested.length &&
      new Set(requested.map((entry) => entry.slot)).size === requested.length,
    "INVALID_MESSAGE",
  );
  const items = [];
  for (const entry of requested) {
    tradeInteger(entry.slot, 1, TRADE_SLOTS, "slot");
    const item = actor.profile.inventory.find(
      (candidate) => candidate.uid === entry.itemId,
    );
    requireInteraction(item, "NOT_FOUND");
    const offer = {
      item: structuredClone(item),
      count: entry.quantity,
      slot: entry.slot,
    };
    revalidateOffer(actor.profile, offer, world.content.catalog, Date.now());
    items.push(offer);
  }
  return items;
}

function recordsFor(profiles, offers, world) {
  return profiles.map((profile, index) =>
    offers[index].items.map((offer) => {
      const record = revalidateOffer(
        profile,
        offer,
        world.content.catalog,
        Date.now(),
      );
      requireInteraction(
        JSON.stringify(record.item.upgrade) ===
          JSON.stringify(offer.item.upgrade),
        "STALE_REVISION",
      );
      return record;
    }),
  );
}

function receivedTotal(actor) {
  return actor.tradeReceivedSession === actor.playSession
    ? (actor.tradeReceivedMesos ?? 0)
    : 0;
}

function receivedPlan(actors, profiles, offers) {
  return actors.map((actor, index) =>
    tradeReceivedTotal(
      profiles[index].level,
      receivedTotal(actor),
      offers[1 - index].mesos,
    ),
  );
}

function validateCapacity(actors, offers, world) {
  const drafts = actors.map((actor) => structuredClone(actor.profile));
  const records = recordsFor(drafts, offers, world);
  applyTradeItems(drafts, records);
  applyTradeMesos(
    drafts,
    offers.map((offer) => offer.mesos),
  );
}

/** Native offers are additive and occupied slots never mutate; removal cancels the room. */
function admitOfferChange(actor, previous, next) {
  requireInteraction(!previous.confirmed, "NOT_ALLOWED");
  for (const entry of previous.items) {
    const retained = next.items.find((item) => item.slot === entry.slot);
    requireInteraction(
      retained &&
        retained.itemId === entry.item.uid &&
        retained.quantity === entry.count,
      "NOT_ALLOWED",
    );
  }
  const amount = next.mesos - previous.mesos;
  tradeInteger(amount, 0, actor.profile.meso - previous.mesos, "mesos");
  if (amount > 0) admitTradeMesoProposal(actor.profile.level, amount);
  requireInteraction(
    amount > 0 || next.items.length > previous.items.length,
    "NOT_ALLOWED",
  );
}

function replaceOffer(actor, message, world, room) {
  requireInteraction(room.state === "open", "NOT_ALLOWED");
  const actors = roomActors(world, room);
  requireInteraction(
    !actors.some((peer) => peer !== actor && peer.pending),
    "CHARACTER_BUSY",
  );
  const index = room.participants.indexOf(actor.id);
  admitOfferChange(actor, room.offers[index], message.action);
  const offer = {
    items: offeredItems(actor, message.action.items, world),
    mesos: message.action.mesos,
    confirmed: false,
  };
  const offers = room.offers.slice();
  offers[index] = offer;
  validateCapacity(actors, offers, world);
  room.offers = offers;
  room.revision++;
  actor.itemLocks = new Set(offer.items.map((entry) => entry.item.uid));
  actor.tradeMesos = offer.mesos;
  room.expiresAt = Date.now() + INTERACTION_LIMITS.tradeMs;
  publishTrade(world, room);
  return interactionReceipt(room.revision);
}

function feedback(error) {
  const known = /^[a-z][a-z0-9-]{0,63}$/.test(error.code ?? "");
  const mapped = ruleError(error);
  return {
    kind: "trade.feedback",
    ok: false,
    code: known ? error.code : mapped.code,
    reason: known ? String(error.message).slice(0, 512) : mapped.code,
  };
}

function failTrade(world, room, error) {
  const detail = feedback(error);
  return closeTrade(world, room, "failed", {
    ...terminalBase(room),
    ok: false,
    code: "trade-failed",
    cause: detail.code,
    reason: detail.reason,
  });
}

function publishConfirmedTrade(world, actor, room, receipt) {
  room.offers[room.participants.indexOf(actor.id)].confirmed = true;
  room.revision = receipt.value.revision;
  room.expiresAt = Date.now() + INTERACTION_LIMITS.tradeMs;
  publishTrade(world, room, "confirmed");
  try {
    world.publish(actor, { type: "snapshot-request" });
  } catch (error) {
    world.deliveryFailed(actor, error);
  }
}

async function confirm(actor, message, world, room) {
  requireInteraction(room.state === "open", "NOT_ALLOWED");
  const actors = roomActors(world, room);
  const index = room.participants.indexOf(actor.id);
  requireInteraction(!room.offers[index].confirmed, "NOT_ALLOWED");
  const peer = actors[1 - index];
  requireInteraction(!peer.pending, "CHARACTER_BUSY");
  room.busy = true;
  peer.pending = true;
  peer.pendingOperation = message.operationId;
  peer.pendingOwner = actor.id;
  try {
    validateCapacity(actors, room.offers, world);
    if (room.offers[1 - index].confirmed) {
      return await commitTrade(actor, message, world, room);
    }
    const next = room.revision + 1;
    const receipt = await world.database.commit(
      actor,
      { ...operationFor(message), domainRevision: next },
      () => {
        roomActors(world, room);
        requireInteraction(
          room.revision === message.expectedRevision,
          "STALE_REVISION",
        );
        return {
          domainRevision: next,
          value: {
            kind: "trade.confirmed",
            tradeId: room.id,
            revision: next,
            side: index,
          },
        };
      },
    );
    if (receipt.status === "committed") {
      publishConfirmedTrade(world, actor, room, receipt);
    } else failTrade(world, room, receipt);
    return receipt;
  } catch (error) {
    failTrade(world, room, error);
    throw error;
  } finally {
    peer.pending = false;
    peer.pendingOperation = null;
    peer.pendingOwner = null;
    room.busy = false;
    world.participants.signalIdle();
  }
}

function completedResult(room) {
  const mesos = room.offers.map((offer) => offer.mesos);
  const fees = mesos.map(tradeFee);
  return {
    ...terminalBase(room),
    ok: true,
    code: "trade-completed",
    fees,
    netReceived: [mesos[1] - fees[1], mesos[0] - fees[0]],
  };
}

async function commitTrade(actor, message, world, room) {
  const participants = roomActors(world, room);
  // The initiator must be first for its operation/session fence; DB orders row locks.
  const actors = [actor, participants.find((entry) => entry !== actor)];
  const offers = actors.map(
    (entry) => room.offers[room.participants.indexOf(entry.id)],
  );
  let received;
  const receipt = await world.participants.commit(
    actor,
    { ...operationFor(message), domainRevision: room.revision + 1 },
    actors.map((entry) => entry.id),
    (profiles) => {
      const drafts = actors.map((entry) => profiles.get(entry.id));
      roomActors(world, room);
      requireInteraction(
        room.revision === message.expectedRevision,
        "STALE_REVISION",
      );
      received = receivedPlan(actors, drafts, offers);
      const records = recordsFor(drafts, offers, world);
      applyTradeItems(drafts, records);
      applyTradeMesos(
        drafts,
        offers.map((offer) => offer.mesos),
      );
      return {
        domainRevision: room.revision + 1,
        value: completedResult(room),
      };
    },
  );
  if (receipt.status !== "committed") {
    failTrade(world, room, receipt);
    return receipt;
  }
  requireInteraction(receipt.value?.kind === "trade.result", "SERVER_BUSY");
  if (received) {
    for (let index = 0; index < 2; index++) {
      actors[index].tradeReceivedSession = actors[index].playSession;
      actors[index].tradeReceivedMesos = received[index];
    }
  }
  room.offers[room.participants.indexOf(actor.id)].confirmed = true;
  closeTrade(world, room, "committed", receipt.value);
  for (const participant of actors) {
    try {
      world.publish(participant, { type: "snapshot-request" });
    } catch (error) {
      world.deliveryFailed(participant, error);
    }
  }
  return receipt;
}

function sendChat(actor, message, world, room) {
  requireInteraction(room.state === "open", "NOT_ALLOWED");
  roomActors(world, room);
  const text = message.action.text;
  requireInteraction(
    typeof text === "string" &&
      text.trim() &&
      text.length <= TRADE_CHAT_LENGTH &&
      validUnicode(text) &&
      !/[^\u0020-\u007e\u0080-\uffff]/u.test(text),
    "INVALID_MESSAGE",
  );
  const side = room.participants.indexOf(actor.id);
  const now = Date.now();
  requireInteraction(
    now - room.lastChat[side] >= CHAT_INTERVAL_MS,
    "RATE_LIMITED",
  );
  const bytes = Buffer.byteLength(text, "utf8");
  while (
    room.messages.length &&
    (room.messages.length >= TRADE_CHAT_LINES ||
      room.chatBytes + bytes > TRADE_CHAT_BYTES)
  ) {
    room.chatBytes -= Buffer.byteLength(room.messages.shift().text, "utf8");
  }
  room.messages.push({
    sequence: ++room.chatSequence,
    side,
    name: actor.profile.name,
    text,
  });
  room.chatBytes += bytes;
  room.lastChat[side] = now;
  room.expiresAt = now + INTERACTION_LIMITS.tradeMs;
  // Chat never invalidates consent or an outstanding native quantity/confirmation dialog.
  publishTrade(world, room);
  return interactionReceipt(room.revision);
}

/** Scheduler hook: expire invitations and revoke invalid field/session/blacklist rooms. */
export function sweepTrade(world, room, now) {
  if (room.busy || TRADE_TERMINAL_STATES.includes(room.state)) return;
  if (room.expiresAt <= now) {
    closeTrade(world, room);
    return;
  }
  try {
    roomActors(world, room);
  } catch (error) {
    if (
      [
        "NOT_FOUND",
        "NOT_IN_RANGE",
        "NOT_ALLOWED",
        "STALE_FIELD",
        "STALE_CONNECTION",
        "UNAUTHENTICATED",
        "SESSION_EXPIRED",
      ].includes(error.code)
    ) {
      closeTrade(world, room);
    } else throw error;
  }
}

export async function executeTrade(actor, message, world) {
  let room = null;
  try {
    if (message.action.kind === "trade.invite")
      {return invite(actor, message, world);}
    room = getRoom(actor, message, world);
    switch (message.action.kind) {
      case "trade.answer":
        return answer(actor, message, world, room);
      case "trade.offer":
        return replaceOffer(actor, message, world, room);
      case "trade.confirm":
        return await confirm(actor, message, world, room);
      case "trade.chat":
        return sendChat(actor, message, world, room);
      case "trade.cancel":
        return cancelTrade(world, room, room.participants.indexOf(actor.id));
      default:
        requireInteraction(false, "INVALID_MESSAGE");
    }
  } catch (error) {
    const detail = feedback(error);
    const operation = {
      ...operationFor(message),
      domainRevision: room?.revision ?? message.expectedRevision,
    };
    return world.database.commit(actor, operation, () => ({
      code: ruleError(error).code,
      value: room?.result ?? detail,
    }));
  }
}
