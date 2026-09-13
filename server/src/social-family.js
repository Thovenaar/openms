import {
  SocialContext,
  memberIds,
  socialRequire,
} from "../../client/src/social/local-social-context.js";
import { applyFamilyProgress } from "../../client/src/social/local-social-family.js";
import { prepareFamilyTravel } from "../../client/src/social/family-travel.js";
export { familyRate } from "../../client/src/social/local-social-family.js";

/** Trusted reward producers add this complete mirrored cohort to their existing atomic commit. */
export function familyProgressIds(profile) {
  return profile.social.family ? memberIds(profile.social.family) : [];
}

/** No wire action calls this function; event is authored by the committed kill/level producer. */
export function applyOnlineFamilyProgress(
  drafts,
  actorId,
  event,
  { now, operationId },
) {
  const context = new SocialContext(
    drafts,
    actorId,
    { requestId: operationId },
    now,
  );
  context.allowed = new Set(drafts.keys());
  applyFamilyProgress(context, event);
  return context.result.applied;
}

export function familyTravelRequest(actorId, request, profile) {
  if (request.kind === "family.entitlement" && request.entitlement <= 1) {
    return {
      actorId,
      targetId: request.targetId,
      kind: request.entitlement === 0 ? "reunion" : "summon-invite",
    };
  }
  if (request.kind !== "invitation.accept") return null;
  const invitation = profile.social.invitations.find(
    (entry) => entry.id === request.invitationId,
  );
  return invitation?.kind === "family-summon" && invitation.toId === actorId
    ? { actorId, targetId: invitation.fromId, kind: "summon" }
    : null;
}

/** Reuse the exact pure map-limit policy; OnlineWorld owns actual scene/membership preparation. */
export async function prepareSocialTravel(world, actor, profiles, request) {
  const sourceEpoch = actor.field.epoch;
  const stores = new Map();
  for (const [id, profile] of profiles) stores.set(id, { id, profile });
  const facade = { getParticipant: (id) => stores.get(id) };
  const prepared = await prepareFamilyTravel(request, facade, {
    manifest: (mapId) => world.content.map(mapId),
    isCurrent: () =>
      world.actors.get(actor.id) === actor &&
      actor.field.epoch === sourceEpoch &&
      !actor.session.revoked,
  });
  const originId = profiles.get(
    request.kind === "summon-invite" ? request.targetId : actor.id,
  ).location.mapId;
  const destinationId = prepared.location.mapId;
  return {
    location: prepared.location,
    release: prepared.release,
    isCurrent: prepared.isCurrent,
    actorId: actor.id,
    targetId: request.targetId,
    validate(drafts) {
      const travelerId =
        request.kind === "summon-invite" ? request.targetId : actor.id;
      const hostId =
        request.kind === "summon-invite" ? actor.id : request.targetId;
      socialRequire(
        prepared.isCurrent() &&
          drafts.get(travelerId)?.location.mapId === originId &&
          drafts.get(hostId)?.location.mapId === destinationId,
        "social-conflict",
        "A family travel participant moved while consent was being committed.",
      );
    },
  };
}
