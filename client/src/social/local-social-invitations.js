import {
  acceptFriend,
  acceptMessenger,
  acceptParty,
} from "./local-social-actions.js";
import { acceptAlliance, acceptGuild } from "./local-social-groups.js";
import { acceptFamily, acceptSummon } from "./local-social-family.js";
import {
  admitInvitationPreference,
  cancelGroupInvitations,
  memberIds,
  pendingInvitation,
  socialRequire,
} from "./local-social-context.js";

const ACCEPT = Object.freeze({
  friend: acceptFriend,
  party: acceptParty,
  guild: acceptGuild,
  "guild-create": acceptGuild,
  alliance: acceptAlliance,
  "alliance-create": acceptAlliance,
  family: acceptFamily,
  messenger: acceptMessenger,
  "family-summon": acceptSummon,
});

function accept(context) {
  const request = pendingInvitation(context);
  socialRequire(
    request.toId === context.actorId,
    "invitation-recipient",
    "Only the invited local character may accept this request.",
  );
  admitInvitationPreference(context, request.kind, request.toId);
  if (request.kind === "party" && request.groupName === "Join request") {
    socialRequire(
      context.get().settings.gameOptions.allowPartySearch,
      "search-disabled",
      "Party Search requests are disabled in Game Options.",
    );
  }
  const handler = ACCEPT[request.kind];
  handler(context, request);
  context.removeInvitations((entry) => entry.id === request.id);
}

function decline(context) {
  const request = pendingInvitation(context);
  socialRequire(
    request.toId === context.actorId || request.fromId === context.actorId,
    "invitation-participant",
    "Only an invitation participant may decline or cancel it.",
  );
  context.removeInvitations((entry) => entry.id === request.id);
  if (request.kind === "alliance-create") {
    cancelCharter(context, request, "alliance");
  }
  if (request.kind === "guild-create") cancelCharter(context, request, "guild");
  context.result.cancelled = request.fromId === context.actorId;
}

function cancelCharter(context, request, kind) {
  const group = context.get(request.fromId).social[kind];
  if (!group?.forming || group.id !== request.groupId) return;
  if (kind === "guild") {
    const party = context.get(request.fromId).social.party;
    if (party?.leaderId === request.fromId) {
      context.mirror("party", null, memberIds(party));
    }
  }
  context.mirror(kind, null, memberIds(group));
  cancelGroupInvitations(context, kind, group.id);
}

export const INVITATION_ACTIONS = Object.freeze({
  "invitation.accept": accept,
  "invitation.decline": decline,
});
