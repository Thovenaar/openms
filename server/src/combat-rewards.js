import { randomUUID, createHash } from "node:crypto";
import {
  awardExperience,
  learnedGrowth,
} from "../../client/src/character/offline-progression.js";
import {
  familyProgressIds,
  applyOnlineFamilyProgress,
} from "./social-family.js";
import {
  prepareKillDrops,
  commitKillDrops,
  releaseKillDrops,
} from "./field-drops.js";
import { progressQuestViews } from "./interaction-quest.js";

import { protocolError } from "../../shared/schema.js";
import { commitPickpocketDrops, releaseSkillDrops } from "./skill-drops.js";

export function combatOperation(actor, kind, operationId = randomUUID()) {
  return {
    operationId,
    kind,
    domain: "character",
    fieldEpoch: actor.field.epoch,
    expectedRevision: actor.revision,
    digest: createHash("sha256")
      .update(`${kind}:${actor.id}:${actor.field.epoch}:${operationId}`)
      .digest("hex"),
  };
}

/** One generation has one producer; EXP, quests, family and loot escrow share its receipt. */
export async function rewardKill(world, actor, mob, showdown = 0) {
  if (mob.rewardGeneration === mob.deaths) return;
  mob.rewardGeneration = mob.deaths;
  const field = actor.field;
  const operation = combatOperation(actor, "combat.reward");
  mob.killDropRate = 1 + showdown / 100;
  let plan = null;
  const pickpocket = actor.skillDrops.takePickpocketPlan();
  let newlyReady = [];
  try {
    const receipt = await world.participants.commitProduced(
      actor,
      operation,
      familyProgressIds,
      async (drafts) => {
        if (
          world.actors.get(actor.id) !== actor ||
          actor.field !== field ||
          field.characters.get(actor.id) !== actor
        ) {
          throw protocolError("STALE_FIELD");
        }
        plan = await prepareKillDrops(world, actor, mob);
        const profile = drafts.get(actor.id);
        const beforeReady = readyQuests(profile, actor, world);
        const { amount, levels } = awardKillProgress(
          world, actor, drafts, { mob, operation },
        );
        newlyReady = [...readyQuests(profile, actor, world)].filter(
          (id) => !beforeReady.has(id),
        );
        return {
          value: {
            kind: "combat.reward",
            amount,
            levels,
            dropPlanId: plan.id,
            pickpocketPlanId: pickpocket?.id ?? null,
          },
          grantEntitlements: pickpocket
            ? [...plan.grantEntitlements, ...pickpocket.grantEntitlements]
            : plan.grantEntitlements,
        };
      },
    );
    if (receipt.status !== "committed" || !plan) return;
    commitKillDrops(world, actor, plan, receipt);
    if (pickpocket) commitPickpocketDrops(world, actor, pickpocket, receipt);
    if (receipt.value?.dropPlanId !== plan.id) return;
    publishKillReward(world, actor, receipt, { field, newlyReady });
  } finally {
    if (plan) releaseKillDrops(field, plan);
    if (pickpocket) releaseSkillDrops(pickpocket);
  }
}

function awardKillProgress(world, actor, drafts, { mob, operation }) {
  const profile = drafts.get(actor.id);
  const amount = mob.expAmount;
  const growth = learnedGrowth(
    profile, world.content.catalog.ui.skills, world.now, { hp: 0, mp: 0 },
  );
  const levels = awardExperience(profile, amount, growth, world.content.items);
  progressKills(profile, actor, world, mob.templateId);
  const context = { now: world.now, operationId: operation.operationId };
  applyOnlineFamilyProgress(
    drafts, actor.id,
    { kind: mob.template.info.boss ? "boss" : "kill", maxHp: mob.maxHP },
    context,
  );
  for (let index = 0; index < levels; index++) {
    applyOnlineFamilyProgress(drafts, actor.id, { kind: "level", maxHp: 0 }, context);
  }
  return { amount, levels };
}

function publishKillReward(world, actor, receipt, { field, newlyReady }) {
  world.publish(actor, {
    type: "event",
    fieldEpoch: field.epoch,
    event: {
      kind: "combat.reward",
      actorId: actor.id,
      amount: receipt.value.amount,
      levels: receipt.value.levels,
    },
  });
  for (const questId of newlyReady) {
    world.publish(actor, {
      type: "event",
      fieldEpoch: field.epoch,
      event: { kind: "quest.ready", questId, questRevision: actor.revision },
    });
  }
}

function progressKills(profile, actor, world, templateId) {
  const viewActor = { ...actor, profile };
  for (const quest of progressQuestViews(viewActor, world)) {
    if (quest.state !== "active") continue;
    for (const objective of quest.objectives) {
      if (objective.kind !== "kill" || objective.templateId !== templateId)
        {continue;}
      profile.quests[quest.id].kills[templateId] = Math.min(
        objective.required,
        objective.current + 1,
      );
    }
  }
}

function readyQuests(profile, actor, world) {
  const result = new Set();
  for (const quest of progressQuestViews({ ...actor, profile }, world)) {
    if (quest.ready) result.add(quest.id);
  }
  return result;
}
