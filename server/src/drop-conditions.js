function mirroredParty(party, peer) {
  if (
    !peer ||
    peer.id !== party.id ||
    peer.leaderId !== party.leaderId ||
    peer.members.length !== party.members.length
  )
    {return false;}
  for (const id of party.members) if (!peer.members.includes(id)) return false;
  return true;
}

/** Actor owns reusable context; only real living mirrored same-field peers activate hunting. */
export function pickupConditionContext(actor) {
  actor.pickupConditions ??= { mapId: 0, partyHunting: false };
  const context = actor.pickupConditions;
  context.mapId = Number(actor.profile.location.mapId);
  context.partyHunting = false;
  const party = actor.profile.social?.party;
  if (!party) return context;
  for (const id of party.members) {
    if (id === actor.id) continue;
    const peer = actor.field.characters.get(id);
    if (
      peer?.state === "active" &&
      peer.profile.hp > 0 &&
      mirroredParty(party, peer.profile.social?.party)
    ) {
      context.partyHunting = true;
      break;
    }
  }
  return context;
}

/** No per-tick allocation after actor preparation; dormant card timers retain original conditions. */
export function refreshPickupConditions(actor) {
  const authority = actor.skills?.effects ?? actor.temporaryStats;
  const context = pickupConditionContext(actor);
  authority?.refreshConditions(context);
  return context;
}
