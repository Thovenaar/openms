import { memberIds } from "../../client/src/social/local-social-context.js";
import { admitActor } from "./action-rules.js";
import {
  interactionReceipt,
  requireInteraction,
} from "./interaction-common.js";
import {
  publicPeerSchema,
  socialPresentationSchema,
  SOCIAL_MAX_PROJECTION_NODES,
} from "../../shared/social-protocol.js";
import { validate } from "../../shared/schema.js";

const MAX_PARTICIPANTS = 512;
const LOAD_BATCH = 32;
const GROUPS = ["party", "guild", "alliance", "family", "messenger"];

function linkedIds(actor) {
  const social = actor.profile.social,
    ids = new Set([actor.id]);
  for (const kind of GROUPS)
    {if (social[kind]) for (const id of memberIds(social[kind])) ids.add(id);}
  for (const friend of social.friends) ids.add(friend.id);
  for (const id of social.blacklist) ids.add(id);
  for (const invite of social.invitations) {
    ids.add(invite.fromId);
    ids.add(invite.toId);
  }
  return ids;
}

async function loadProjectionProfiles(world, ids) {
  requireInteraction(ids.size <= MAX_PARTICIPANTS, "SERVER_BUSY");
  const ordered = [...ids],
    result = new Map();
  for (let offset = 0; offset < ordered.length; offset += LOAD_BATCH) {
    const batch = await Promise.all(
      ordered
        .slice(offset, offset + LOAD_BATCH)
        .map((id) => projectionProfile(world, id)),
    );
    for (const entry of batch) if (entry) result.set(entry[0], entry[1]);
  }
  return result;
}

/** Directory selections and unilateral blacklist labels may outlive a deleted character. */
async function projectionProfile(world, reference, resolve = false) {
  try {
    const id = resolve
      ? await world.participants.resolve(reference)
      : reference;
    const profiles = await world.participants.load([id]);
    return [id, profiles.get(id)];
  } catch (error) {
    if (error.code === "NOT_FOUND") return null;
    throw error;
  }
}

function publicFamily(family) {
  if (!family) return null;
  return {
    id: family.id,
    leaderId: family.leaderId,
    precept: family.precept,
    members: family.members.map(
      ({
        id,
        parentId,
        reputation,
        reputationDay,
        todayReputation,
        totalReputation,
      }) => ({
        id,
        parentId,
        reputation,
        reputationDay,
        todayReputation,
        totalReputation,
      }),
    ),
  };
}

function publicGuild(guild) {
  if (!guild) return null;
  const { id, name, leaderId, members, ranks, notice, emblem, forming } = guild;
  return structuredClone({
    id,
    name,
    leaderId,
    members,
    ranks,
    notice,
    emblem,
    forming,
  });
}

function publicAppearance(profile) {
  const { skin, face, hair } = profile.appearance;
  return {
    gender: profile.gender,
    appearance: { skin, face, hair },
    equipment: profile.equipment.map(({ id, slot }) => ({ id, slot })),
  };
}

function isOnline(world, id) {
  const actor = world.actors.get(id);
  return Boolean(
    actor?.state === "active" &&
    actor.session &&
    !actor.session.revoked &&
    actor.session.expiresAt > Date.now(),
  );
}

function visibleHealth(actor, id, peer, online) {
  return (
    id === actor.id ||
    (online &&
      actor.profile.social.party?.members.includes(id) &&
      peer?.field === actor.field)
  );
}

function rosterGuild(actor, profile) {
  const guildId = profile.social.guild?.id;
  const sharedGuild =
    guildId &&
    (actor.profile.social.guild?.id === guildId ||
      actor.profile.social.alliance?.guilds.includes(guildId));
  return sharedGuild ? publicGuild(profile.social.guild) : null;
}

function publicSearch(profile) {
  return profile.settings.gameOptions.allowPartySearch &&
    !profile.social.search?.paused
    ? structuredClone(profile.social.search)
    : null;
}

function rosterParticipant({ world, actor, familyIds }, id, profile) {
  const online = isOnline(world, id);
  const health = visibleHealth(actor, id, world.actors.get(id), online);
  const portrait =
    id === actor.id || actor.profile.social.messenger?.members.includes(id);
  return {
    id,
    name: profile.name,
    level: profile.level,
    job: profile.job,
    mapId: profile.location.mapId,
    hp: health ? profile.hp : null,
    maxHp: health ? profile.maxHP : null,
    online,
    portrait: portrait ? publicAppearance(profile) : null,
    search: publicSearch(profile),
    guild: rosterGuild(actor, profile),
    family: familyIds.has(id) ? publicFamily(profile.social.family) : null,
  };
}

function publicContactAllowed(actor, id, profile) {
  return Boolean(
    profile &&
      !actor.profile.social.blacklist.includes(id) &&
      !profile.social.blacklist.includes(actor.id),
  );
}

async function selectFamilyProjection(actor, world, targetId, selection) {
  if (!targetId) return targetId;
  const targetEntry = await projectionProfile(world, targetId, true);
  const [resolved, target] = targetEntry ?? [];
  if (!publicContactAllowed(actor, resolved, target)) return null;
  selection.ids.add(resolved);
  selection.familyIds.add(resolved);
  if (target.social.family) {
    for (const id of memberIds(target.social.family)) {
      selection.ids.add(id);
      selection.familyIds.add(id);
    }
  }
  return targetId;
}

async function projectionSelection(actor, world, query, targetId) {
  const ids = linkedIds(actor);
  const selection = {
    ids,
    familyIds: new Set(
      actor.profile.social.family
        ? memberIds(actor.profile.social.family)
        : [actor.id],
    ),
  };
  const directory = await world.participants.search({
    name: query || null,
    limit: 128,
  });
  for (const entry of directory) ids.add(entry.id);
  const listings = await world.participants.search({
    partySearch: true,
    limit: 128,
  });
  for (const entry of listings) ids.add(entry.id);
  if (actor.socialSelectedId) ids.add(actor.socialSelectedId);
  selection.targetId = await selectFamilyProjection(actor, world, targetId, selection);
  return selection;
}

function selectedPublicPeer(world, actor, profiles) {
  const id = actor.socialSelectedId;
  const selected = profiles.get(id);
  return publicContactAllowed(actor, id, selected)
    ? publicPeer(world, id, selected)
    : null;
}

/** Prepare before the first snapshot; no ready-shaped empty fallback is published. */
export async function prepareSocial(actor, world, query = "", targetId = null) {
  const selection = await projectionSelection(actor, world, query, targetId);
  const { ids, familyIds } = selection;
  const profiles = await loadProjectionProfiles(world, ids);
  const participants = [];
  const context = { world, actor, familyIds };
  for (const [id, profile] of profiles) {
    participants.push(rosterParticipant(context, id, profile));
  }
  const view = {
    projectionId: actor.socialProjectionId ?? null,
    participants,
    familyRates: world.familyRates === true,
    familyTravel: typeof world.travelParticipants === "function",
    selectedPeer: selectedPublicPeer(world, actor, profiles),
  };
  validate(view, socialPresentationSchema, SOCIAL_MAX_PROJECTION_NODES);
  actor.socialPresentation = view;
  actor.socialQuery = { query, targetId: selection.targetId };
  actor.socialSearchFingerprint = JSON.stringify(actor.profile.social.search);
  return view;
}

/** Synchronize authorized party health with the live owner, without fetching or allocating per tick. */
export function socialPresentation(actor, world) {
  const view = actor.socialPresentation;
  requireInteraction(view, "CONTENT_MISMATCH");
  for (const member of view.participants) {
    const peer = world.actors.get(member.id);
    member.online = isOnline(world, member.id);
    if (peer) member.mapId = peer.profile.location.mapId;
    const health = visibleHealth(actor, member.id, peer, member.online);
    member.hp = health && peer ? peer.profile.hp : null;
    member.maxHp = health && peer ? peer.profile.maxHP : null;
  }
  return view;
}

function searchDirectoryChanged(world, changed) {
  for (const id of changed) {
    const actor = world.actors.get(id);
    if (
      actor &&
      actor.socialSearchFingerprint !==
        JSON.stringify(actor.profile.social.search)
    )
      {return true;}
  }
  return false;
}

function watchesSocialChange(actor, changed, directoryChanged) {
  return Boolean(
    actor.socialPresentation &&
      (directoryChanged ||
        changed.has(actor.id) ||
        (actor.socialSelectedId && changed.has(actor.socialSelectedId)) ||
        actor.socialPresentation.participants.some((entry) => changed.has(entry.id))),
  );
}

export async function refreshSocial(world, ids) {
  const changed = new Set(ids);
  requireInteraction(world.actors.size <= 128, "SERVER_BUSY");
  const refreshes = [];
  const directoryChanged = searchDirectoryChanged(world, changed);
  for (const actor of world.actors.values()) {
    if (watchesSocialChange(actor, changed, directoryChanged)) refreshes.push(actor);
  }
  for (const actor of refreshes) {
    try {
      await prepareSocial(
        actor,
        world,
        actor.socialQuery?.query ?? "",
        actor.socialQuery?.targetId ?? null,
      );
    } catch (error) {
      world.deliveryFailed(actor, error);
    }
  }
  return refreshes.map((actor) => actor.id);
}

export function destroySocial(actor) {
  actor.socialPresentation = null;
  actor.socialQuery = null;
  actor.socialSelectedId = null;
  actor.socialProjectionId = null;
  actor.socialSearchFingerprint = null;
}

export async function executeSocialRead(actor, message, world) {
  admitActor(actor, world, message.fieldEpoch);
  actor.socialProjectionId = message.operationId;
  await prepareSocial(
    actor,
    world,
    message.action.query,
    message.action.targetId,
  );
  admitActor(actor, world, message.fieldEpoch);
  await world.participants.publish([actor.id]);
  return interactionReceipt(actor.socialRevision, {
    kind: "social.read",
    projectionId: message.operationId,
  });
}

function publicGroupIdentity(group) {
  return group ? { id: group.id, name: group.name } : null;
}

/** Explicit allowlist: no inventory UIDs, private bag, balance, quest progress, gifts or entitlements. */
export function publicPeer(world, id, profile) {
  const peer = {
    identity: {
      id,
      revision: world.actors.get(id)?.revision ?? null,
      online: isOnline(world, id),
    },
    name: profile.name,
    level: profile.level,
    job: profile.job,
    fame: profile.fame,
    ...publicAppearance(profile),
    guild: publicGroupIdentity(profile.social.guild),
    alliance: publicGroupIdentity(profile.social.alliance),
    wishlist: [...profile.cash.wishlist],
    book: {
      cover: profile.monsterBook.cover,
      cards: Object.entries(profile.monsterBook.cards).map(([card, count]) => ({
        id: Number(card),
        count,
      })),
    },
    medals: Object.entries(profile.quests)
      .filter(
        ([quest, state]) =>
          Number(quest) >= 29000 &&
          state.state === 2 &&
          world.content.catalog.quests.records[quest]?.info?.viewMedalItem,
      )
      .map(([quest]) => Number(quest)),
  };
  validate(peer, publicPeerSchema);
  return peer;
}

export async function executePeerInfo(actor, message, world) {
  admitActor(actor, world, message.fieldEpoch);
  const id = await world.participants.resolve(message.action.targetId);
  const profile = (await world.participants.load([id])).get(id);
  requireInteraction(
    !actor.profile.social.blacklist.includes(id) &&
      !profile.social.blacklist.includes(actor.id),
    "NOT_ALLOWED",
  );
  actor.socialSelectedId = id;
  actor.socialProjectionId = message.operationId;
  await prepareSocial(
    actor,
    world,
    actor.socialQuery?.query ?? "",
    actor.socialQuery?.targetId ?? null,
  );
  admitActor(actor, world, message.fieldEpoch);
  await world.participants.publish([actor.id]);
  return interactionReceipt(actor.socialRevision, {
    kind: "social.peer",
    targetId: id,
    projectionId: message.operationId,
  });
}

export async function executeSocialResolve(actor, message, world) {
  admitActor(actor, world, message.fieldEpoch);
  const targetId = await world.participants.resolve(message.action.name);
  return interactionReceipt(actor.socialRevision, {
    kind: "social.identity",
    targetId,
  });
}
