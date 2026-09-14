/** Cosmic Character.levelUp broadcasts foreign effect 0 to every field peer. */
export function broadcastLevelUp(world, actor, levels) {
  if (!Number.isSafeInteger(levels) || levels < 0 || levels > 200) {
    throw new Error("Invalid level-up count");
  }
  if (levels === 0) return;
  world.broadcast(actor.field, {
    type: "event",
    fieldEpoch: actor.field.epoch,
    event: { kind: "combat.level-up", actorId: actor.id },
  });
}
