// Authorized Cosmic SERVER policy: FamilyUseHandler43–86 and server.maps.FieldLimit.
// These local scenes have no event-instance owner. Unpackaged destinations are refused.
const CANNOT_MIGRATE = 0x10;
const CANNOT_VIP_ROCK = 0x40;
const NO_FORCED_RETURN = 999999999;
const MAPLE_ISLAND_MAX = 2000001;

function requireTravel(condition, reason) {
  if (!condition) throw new Error(reason);
}

function admitMaps(origin, destination) {
  const from = origin.physics.map;
  const to = destination.physics.map;
  requireTravel(
    !((from.fieldLimit ?? 0) & CANNOT_MIGRATE),
    "The original source field forbids family migration.",
  );
  requireTravel(
    !((to.fieldLimit ?? 0) & CANNOT_VIP_ROCK),
    "The original destination field forbids family travel.",
  );
  const forcedReturn = to.forcedReturn ?? NO_FORCED_RETURN;
  const id = Number(destination.id);
  requireTravel(
    forcedReturn === NO_FORCED_RETURN || (id >= 0 && id <= MAPLE_ISLAND_MAX),
    "The original destination has a forced-return restriction.",
  );
  const portal = destination.physics.portals.find((entry) => entry.id === 0);
  requireTravel(portal, "The destination has no original portal zero.");
  return portal;
}

function travelParticipants(request, social) {
  const invitation = request.kind === "summon-invite";
  requireTravel(
    invitation || request.kind === "reunion" || request.kind === "summon",
    "Unknown family travel kind.",
  );
  const actor = social.getParticipant(
    invitation ? request.targetId : request.actorId,
  );
  const target = social.getParticipant(
    invitation ? request.actorId : request.targetId,
  );
  requireTravel(
    actor && target && actor !== target,
    "Choose a different loaded family member.",
  );
  return { invitation, actor, target };
}

/** Reserve complete scene resources before LocalSocial atomically spends reputation and moves a profile. */
export async function prepareFamilyTravel(request, social, hooks) {
  const { invitation, actor, target } = travelParticipants(request, social);
  const originId = actor.profile.location.mapId;
  const destinationId = target.profile.location.mapId;
  const [origin, destination] = await Promise.all([
    hooks.manifest(originId),
    hooks.manifest(destinationId),
  ]);
  const portal = admitMaps(origin, destination);
  requireTravel(
    hooks.isCurrent() &&
      actor.profile.location.mapId === originId &&
      target.profile.location.mapId === destinationId,
    "The family travel source changed while preparing the destination.",
  );
  const location = {
    mapId: destination.id,
    x: portal.x,
    y: portal.y - 10,
    facing: 1,
  };
  const scene =
    !invitation && actor === hooks.activeStore
      ? await hooks.prepareScene(destination, portal.id)
      : null;
  let settled = false;
  return {
    location,
    isCurrent() {
      return (
        !settled &&
        hooks.isCurrent() &&
        actor.profile.location.mapId === originId &&
        target.profile.location.mapId === destinationId &&
        (!scene || scene.isCurrent())
      );
    },
    publish() {
      requireTravel(!settled, "Family travel was already settled.");
      settled = true;
      if (scene) scene.publish();
      else hooks.refreshParticipant(actor.id, invitation);
    },
    release() {
      if (settled) return;
      settled = true;
      scene?.release();
    },
  };
}
