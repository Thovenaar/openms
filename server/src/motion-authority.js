/** Where the server, not the client, owns an actor's XY.
 *
 *  Product policy: the browser is the source of truth for the character's own
 *  position and velocity. The authority adopts every ordinary report so its own
 *  hit/admission simulation follows the player, and the [MotionWatchdog](watchdog.js)
 *  only records motion the kernel cannot explain and closes the session when a
 *  pattern is impossible. It never nudges an honest client.
 *
 *  A checkpoint is `authoritative` only for state the browser genuinely cannot
 *  predict:
 *  - a field transition or portal commit,
 *  - death (revival owns the arrival),
 *  - an authored map seat,
 *  - a movement skill the browser does not simulate (teleport, rush, assault,
 *    dash, wings): `SkillWorldController.ownsMotion`.
 *
 *  Mob knockback and the predicted `impulse` skills are **not** here: the client
 *  applies those impulses to its own kernel, so the trajectory is its own. */
export function serverOwnsPosition(actor, sim) {
  // A pending inventory/skill database transaction does not own movement.
  if (actor.transition || actor.profile?.hp <= 0) return true;
  if (!sim) return true;
  if (sim.seat !== null) return true;
  return Boolean(actor.skills?.worldController?.ownsMotion);
}

/** Only the current admitted combat action may explain its local prediction lock. */
export function combatMotionOwner(actor) {
  const field = actor.skillField;
  return {
    feedbackId: field?.feedbackId ?? null,
    inputSeq: field?.feedbackInputSeq ?? null,
    locked: Boolean(field?.blocksMovement),
  };
}
