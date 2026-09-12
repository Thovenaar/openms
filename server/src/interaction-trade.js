import {
  revalidateOffer,
  applyTradeItems,
  applyTradeMesos,
} from "../../client/src/social/local-trade-rules.js";
import { itemView } from "./field-views.js";
import { operationFor, admitActor } from "./action-rules.js";
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
        actor.tradeId === room.id && actor.field.epoch === room.fieldEpoch,
    ),
    "SESSION_EXPIRED",
  );
  return actors;
}

export function publishTrade(world, room, state = room.state) {
  const offers = [];
  for (let index = 0; index < 2; index++) {
    const actor = world.actors.get(room.participants[index]);
    if (!actor) continue;
    const offer = room.offers[index];
    offers.push({
      ownerId: actor.id,
      items: offer.items.map((entry) => ({
        item: itemView(
          entry.item,
          actor.inventoryRevision,
          false,
          world.content.items,
        ),
        quantity: entry.count,
      })),
      mesos: offer.mesos,
      confirmed: offer.confirmed,
    });
  }
  const event = {
    kind: "trade",
    tradeId: room.id,
    revision: room.revision,
    state,
    participants: room.participants,
    offers,
  };
  for (const id of room.participants) {
    const actor = world.actors.get(id);
    if (actor) publishInteraction(world, actor, event);
  }
}

export function closeTrade(world, room, state = "cancelled") {
  room.state = state;
  for (const id of room.participants) {
    const actor = world.actors.get(id);
    if (actor?.tradeId !== room.id) continue;
    actor.tradeId = null;
    actor.itemLocks?.clear();
    actor.tradeMesos = 0;
  }
  interactionState(world).trades.delete(room.id);
  publishTrade(world, room, state);
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
    fieldEpoch: actor.field.epoch,
    expiresAt: now + INTERACTION_LIMITS.invitationMs,
    busy: false,
    offers: [
      { items: [], mesos: 0, confirmed: false },
      { items: [], mesos: 0, confirmed: false },
    ],
  };
  actor.tradeId = peer.tradeId = room.id;
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
  requireInteraction(room.expiresAt > Date.now(), "SESSION_EXPIRED");
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
  const actors = roomActors(world, room);
  requireInteraction(!actors[0].pending, "CHARACTER_BUSY");
  if (!message.action.accept) {
    closeTrade(world, room);
    return interactionReceipt(room.revision);
  }
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
    requested.length <= 9 &&
      new Set(requested.map((entry) => entry.itemId)).size === requested.length,
    "INVALID_MESSAGE",
  );
  const items = [];
  for (const entry of requested) {
    const item = actor.profile.inventory.find(
      (candidate) => candidate.uid === entry.itemId,
    );
    requireInteraction(item, "NOT_FOUND");
    const offer = { item: structuredClone(item), count: entry.quantity };
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

function validateCapacity(actors, offers, world) {
  const drafts = actors.map((actor) => structuredClone(actor.profile));
  const records = recordsFor(drafts, offers, world);
  applyTradeItems(drafts, records);
  applyTradeMesos(
    drafts,
    offers.map((offer) => offer.mesos),
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
  const offer = {
    items: offeredItems(actor, message.action.items, world),
    mesos: message.action.mesos,
    confirmed: false,
  };
  const offers = [...room.offers];
  offers[index] = offer;
  validateCapacity(actors, offers, world);
  room.offers = offers;
  room.revision++;
  for (const entry of room.offers) entry.confirmed = false;
  actor.itemLocks = new Set(offer.items.map((entry) => entry.item.uid));
  actor.tradeMesos = offer.mesos;
  room.expiresAt = Date.now() + INTERACTION_LIMITS.tradeMs;
  publishTrade(world, room);
  return interactionReceipt(room.revision);
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
  try {
    validateCapacity(actors, room.offers, world);
    if (!room.offers[1 - index].confirmed) {
      const receipt = await world.database.commit(
        actor,
        { ...operationFor(message), domainRevision: room.revision },
        () => {
          roomActors(world, room);
          requireInteraction(
            room.revision === message.expectedRevision,
            "STALE_REVISION",
          );
          return { domainRevision: room.revision };
        },
      );
      if (receipt.status === "committed") {
        room.offers[index].confirmed = true;
        publishTrade(world, room, "confirmed");
        world.publish(actor, { type: "snapshot-request" });
      }
      return receipt;
    }
    return await commitTrade(actor, message, world, room);
  } finally {
    peer.pending = false;
    room.busy = false;
  }
}

async function commitTrade(actor, message, world, room) {
  const actors = roomActors(world, room).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const offers = actors.map(
    (entry) => room.offers[room.participants.indexOf(entry.id)],
  );
  const receipt = await world.database.commitMany(
    actors,
    { ...operationFor(message), domainRevision: room.revision },
    (drafts) => {
      roomActors(world, room);
      requireInteraction(
        room.revision === message.expectedRevision &&
          room.expiresAt > Date.now(),
        "STALE_REVISION",
      );
      const records = recordsFor(drafts, offers, world);
      applyTradeItems(drafts, records);
      applyTradeMesos(
        drafts,
        offers.map((offer) => offer.mesos),
      );
      return {
        domainRevision: room.revision,
        value: { tradeId: room.id, participants: room.participants },
      };
    },
  );
  if (receipt.status === "committed") {
    room.offers[room.participants.indexOf(actor.id)].confirmed = true;
    closeTrade(world, room, "committed");
    for (const participant of actors) {
      world.publish(participant, { type: "snapshot-request" });
    }
  }
  return receipt;
}

export function executeTrade(actor, message, world) {
  if (message.action.kind === "trade.invite") {
    return invite(actor, message, world);
  }
  const room = getRoom(actor, message, world);
  if (message.action.kind === "trade.answer") {
    return answer(actor, message, world, room);
  }
  if (message.action.kind === "trade.offer") {
    return replaceOffer(actor, message, world, room);
  }
  if (message.action.kind === "trade.confirm") {
    return confirm(actor, message, world, room);
  }
  requireInteraction(message.action.kind === "trade.cancel", "INVALID_MESSAGE");
  closeTrade(world, room);
  return interactionReceipt(room.revision);
}
