import { combatOperation } from "./combat-rewards.js";
import { nextQuestWake, expireQuestRuns } from "./quest-lifecycle.js";

/** One bounded scheduled producer per actor; no client clock, polling request or reward grant. */
export function advanceQuestSchedule(world, actor) {
  if (actor.questTask) return;
  if (actor.questScheduleProfile !== actor.profile) {
    actor.questScheduleProfile = actor.profile;
    actor.questNextAt = nextQuestWake(actor.profile, world.now);
  }
  if (!(world.now >= actor.questNextAt)) return;
  actor.questNextAt = Infinity;
  actor.questTask = world.participants
    .commitProduced(
      actor,
      combatOperation(actor, "quest.lifecycle"),
      () => [],
      (drafts) => ({
        value: {
          kind: "quest.lifecycle",
          expired: expireQuestRuns(drafts.get(actor.id), world.now),
        },
      }),
    )
    .then((receipt) => {
      if (receipt.status !== "committed") actor.questNextAt = world.now + 1000;
      else actor.questScheduleProfile = null;
    })
    .catch((error) => {
      actor.admission = error.code ?? error.message;
      actor.questNextAt = world.now + 1000;
    })
    .finally(() => {
      actor.questTask = null;
    });
}
