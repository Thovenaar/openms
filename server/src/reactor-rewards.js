import {
  reactorReward,
  rollReactorRewards,
} from "../../client/src/world/reactor-rewards.js";
import {
  prepareDropPlan,
  commitKillDrops,
  releaseKillDrops,
} from "./field-drops.js";
import { combatOperation } from "./combat-rewards.js";
import { protocolError } from "../../shared/schema.js";

/** Capture the hitter and field before async work; every terminal generation has one producer. */
export function rewardReactor(controller, record) {
  const { world, field } = controller;
  const actor = record.rewardActor;
  const reward = reactorReward(
    world.content.catalog.drops.reactors,
    record.template.descriptor,
  );
  if (!actor || !reward || record.rewardGeneration === record.transitions) {
    return;
  }
  record.rewardGeneration = record.transitions;
  record.rewardPending = true;
  const task = commitReward(world, actor, field, { record, reward });
  controller.rewardJobs.add(task);
  task
    .catch((error) => {
      world.log?.("reactor.reward.failed", {
        reactor: record.placement.id,
        code: error.code ?? error.message,
      });
      actor.admission = error.code ?? error.message;
      world.publish(actor, { type: "snapshot-request" });
    })
    .finally(() => {
      record.rewardPending = false;
      controller.rewardJobs.delete(task);
    });
}

async function commitReward(world, actor, field, { record, reward }) {
  const operation = combatOperation(actor, "reactor.reward");
  let plan = null;
  try {
    const receipt = await world.participants.commitProduced(
      actor,
      operation,
      () => [actor.id],
      (drafts) => {
        if (actor.field !== field || field.characters.get(actor.id) !== actor) {
          throw protocolError("STALE_FIELD");
        }
        const output = rollReactorRewards(
          reward,
          drafts.get(actor.id),
          world.content.items,
          world.random,
        );
        plan = prepareDropPlan(world, actor, record.placement, output);
        return {
          value: { kind: "reactor.reward", dropPlanId: plan.id },
          grantEntitlements: plan.grantEntitlements,
        };
      },
    );
    if (plan) {
      const published = commitKillDrops(world, actor, plan, receipt);
      record.lastOutcome = published
        ? (plan.refusal ?? "reactor-drops-published")
        : "reactor-reward-refused";
      world.invalidateField(field);
    }
  } finally {
    if (plan) releaseKillDrops(field, plan);
  }
}
