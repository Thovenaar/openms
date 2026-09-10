import { memberIds } from "./local-social-context.js";

/** Destructive browser reset policy: only the reset character loses gameplay data.
 * Groups detach atomically; surviving family subtrees retain all earned reputation. */
export function resetSocialParticipant(context, fresh) {
  const self = context.get(),
    original = structuredClone(self.social);
  cancelFoundingRequests(context);
  detachParty(context, original.party);
  detachAlliance(context, original);
  detachGuild(context, original.guild);
  detachFamily(context, original.family);
  detachMessenger(context, original.messenger);
  for (const friend of original.friends) {
    const peer = context.get(friend.id);
    peer.social.friends = peer.social.friends.filter(
      (entry) => entry.id !== context.actorId,
    );
  }
  context.removeInvitations(
    (entry) =>
      entry.fromId === context.actorId || entry.toId === context.actorId,
  );
  Object.assign(self, structuredClone(fresh));
}

function cancelFoundingRequests(context) {
  const requests = [...context.get().social.invitations];
  for (const kind of ["guild", "alliance"]) {
    const group = context.get().social[kind];
    if (group?.forming) cancelFoundingGroup(context, kind, group);
  }
  for (const request of requests) {
    if (!["guild-create", "alliance-create"].includes(request.kind)) continue;
    const kind = request.kind === "guild-create" ? "guild" : "alliance";
    const founder = context.get(request.fromId),
      group = founder.social[kind];
    if (!group?.forming || group.id !== request.groupId) continue;
    cancelFoundingGroup(context, kind, group);
  }
}

function cancelFoundingGroup(context, kind, group) {
  const founder = context.get(group.leaderId);
  if (kind === "guild" && founder.social.party?.leaderId === group.leaderId) {
    context.mirror("party", null, memberIds(founder.social.party));
  }
  context.mirror(kind, null, memberIds(group));
  context.removeInvitations((entry) => entry.groupId === group.id);
}

function detachParty(context, party) {
  if (!party || context.get(party.leaderId).social.party?.id !== party.id) {
    return;
  }
  const previous = memberIds(party);
  if (party.leaderId === context.actorId) {
    context.mirror("party", null, previous);
    context.removeInvitations(
      (entry) => entry.kind === "party" && entry.groupId === party.id,
    );
    for (const id of previous) context.get(id).social.search = null;
    return;
  }
  party.members = party.members.filter((id) => id !== context.actorId);
  context.mirror("party", party, previous);
}

function detachGuild(context, guild) {
  if (!guild) return;
  const previous = memberIds(guild);
  if (guild.leaderId === context.actorId) {
    context.mirror("guild", null, previous);
    context.removeInvitations((entry) => entry.groupId === guild.id);
    return;
  }
  // A cancelled founding charter must not be resurrected by the old snapshot.
  if (!context.get(guild.leaderId).social.guild) return;
  guild.members = guild.members.filter((entry) => entry.id !== context.actorId);
  context.mirror("guild", guild, previous);
}

function detachAlliance(context, social) {
  const alliance = social.alliance;
  if (!alliance) return;
  const previous = memberIds(alliance);
  if (alliance.leaderId === context.actorId) {
    context.mirror("alliance", null, previous);
    context.removeInvitations((entry) => entry.groupId === alliance.id);
    return;
  }
  const disbanded =
    social.guild?.leaderId === context.actorId ? social.guild : null;
  const removed = new Set(disbanded ? memberIds(disbanded) : [context.actorId]);
  alliance.members = alliance.members.filter((entry) => !removed.has(entry.id));
  if (disbanded) {
    alliance.guilds = alliance.guilds.filter((id) => id !== disbanded.id);
  }
  context.mirror("alliance", alliance, previous);
}

function familySubtree(family, root) {
  const selected = new Set([root.id]);
  for (let pass = 0; pass < family.members.length; pass++) {
    let changed = false;
    for (const member of family.members) {
      if (selected.has(member.parentId) && !selected.has(member.id)) {
        selected.add(member.id);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return family.members.filter((entry) => selected.has(entry.id));
}

function detachFamily(context, family) {
  if (!family) return;
  const previous = memberIds(family);
  family.members = family.members.filter(
    (entry) => entry.id !== context.actorId,
  );
  for (const member of family.members) {
    if (member.parentId === context.actorId) member.parentId = null;
  }
  const roots = family.members.filter((entry) => entry.parentId === null);
  context.mirror("family", null, previous);
  for (const root of roots) {
    const group = {
      id: root.id === family.leaderId ? family.id : context.uid(),
      leaderId: root.id,
      members: familySubtree(family, root),
      precept: family.precept,
    };
    context.mirror("family", group);
  }
}

function detachMessenger(context, session) {
  if (!session) return;
  const previous = memberIds(session);
  session.members = session.members.filter((id) => id !== context.actorId);
  context.mirror(
    "messenger",
    session.members.length ? session : null,
    previous,
  );
}
