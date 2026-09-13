import { protocolError } from "../../shared/schema.js";

const FOLLOW = Object.freeze({ loop: false, follow: true });

/** Allocate original affected-art slots before committing any recipient changes. */
export async function preparePartyVisual(actor, skill, targets) {
  if (!targets.length) return;
  const resources = actor.skills.resources;
  const path = resources.phasePath(
    skill,
    "affected",
    actor.skills.level(skill.id),
  );
  if (!path) return;
  const sequence = await resources.acquireSequence(skill, path, targets.length);
  if (!resources.hasSlots(sequence, targets.length)) {
    throw protocolError("SERVER_BUSY");
  }
}

/** These positions come from authoritative actors and use the existing visual snapshot stream. */
export function publishPartyVisuals(world, actor, plan, results) {
  const resources = actor.skills.resources;
  const sequence = resources.selectSequence(plan.skill, "affected", plan.rank);
  for (const result of results ?? []) {
    const target = world.actors.get(result.actorId);
    if (sequence && target?.field === actor.field) {
      resources.playSequence(sequence, target.simulation, FOLLOW);
    }
    if (result.hp > 0) {
      world.broadcast(actor.field, {
        type: "event",
        fieldEpoch: actor.field.epoch,
        event: {
          kind: "combat.recovery",
          actorId: result.actorId,
          hp: result.hp,
          mp: 0,
        },
      });
    }
  }
}
