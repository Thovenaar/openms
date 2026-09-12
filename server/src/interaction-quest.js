import {
  stateOf,
  isNpcEndpoint,
  checkConditions,
  transaction,
} from "../../client/src/quests/quest-rules.js";
import {
  itemCount,
  isEquipped,
} from "../../client/src/items/inventory-model.js";
import { learnedGrowth } from "../../client/src/character/offline-progression.js";
import {
  currentNpc,
  requireInteraction,
  serverRandomSamples,
  INTERACTION_LIMITS,
} from "./interaction-common.js";
import { operationFor, admitActor } from "./action-rules.js";
import { finishQuestDialogue } from "./interaction-quest-dialogue.js";

const MAX_QUESTS = 4096;
const MAX_OFFERS = 128;

function questAdmission(record, profile, npcId, stage) {
  requireInteraction(
    record?.supported && record.stages?.[stage],
    "CONTENT_MISMATCH",
  );
  requireInteraction(
    stateOf(profile, record.id) === stage,
    "REQUIREMENTS_NOT_MET",
  );
  const endpoint = record.stages[stage];
  requireInteraction(isNpcEndpoint(endpoint, npcId), "NOT_ALLOWED");
  const context = { questId: record.id, npcId };
  requireInteraction(
    checkConditions(endpoint.check, profile, context).ok &&
      checkConditions(endpoint.actionCheck, profile, context).ok,
    "REQUIREMENTS_NOT_MET",
  );
  return endpoint;
}

export function questOffers(actor, world, lease) {
  const records = Object.values(world.content.catalog.quests.records);
  requireInteraction(records.length <= MAX_QUESTS, "CONTENT_MISMATCH");
  const offers = [];
  for (const record of records) {
    const stage = stateOf(actor.profile, record.id);
    if (
      stage > 1 ||
      !record.supported ||
      !isNpcEndpoint(record.stages[stage], lease.npcTemplateId)
    ) {
      continue;
    }
    const context = { npcId: lease.npcTemplateId, questId: record.id };
    if (
      !checkConditions(record.stages[stage].check, actor.profile, context).ok ||
      !checkConditions(record.stages[stage].actionCheck, actor.profile, context)
        .ok
    ) {
      continue;
    }
    requireInteraction(offers.length < MAX_OFFERS, "CONTENT_MISMATCH");
    offers.push({
      questId: record.id,
      action: stage === 0 ? "accept" : "claim",
    });
  }
  return offers;
}

/** Require the current authored confirmation before planning quest effects. */
function admitQuestConversation(actor, action, world) {
  const lease = actor.conversation;
  currentNpc(world, actor, lease);
  requireInteraction(
    action.conversationId === lease.id && action.step === lease.step,
    "STALE_REVISION",
  );
  const kind = action.kind === "quest.accept" ? "accept" : "claim";
  requireInteraction(
    lease.offers.some(
      (offer) => offer.questId === action.questId && offer.action === kind,
    ),
  );
  requireInteraction(
    lease.questDialogue?.mode === "confirm" &&
      lease.questDialogue.record.id === action.questId,
    "NOT_ALLOWED",
  );
  return lease;
}

/** One-shot development quest policy: authored supported Check/Act only; no repeat timers. */
export async function executeQuest(actor, message, world) {
  const action = message.action;
  requireInteraction(!actor.tradeId, "CHARACTER_BUSY");
  if (action.kind === "quest.abandon") {
    return abandonQuest(actor, message, world);
  }
  const lease = admitQuestConversation(actor, action, world);
  const kind = action.kind === "quest.accept" ? "accept" : "claim";
  const record = world.content.catalog.quests.records[action.questId];
  const stage = kind === "accept" ? 0 : 1;
  const now = Date.now();
  const sample = serverRandomSamples()[0];
  const receipt = await world.database.commit(
    actor,
    operationFor(message),
    (draft) => {
      currentNpc(world, actor, lease);
      questAdmission(record, draft, lease.npcTemplateId, stage);
      const growth = learnedGrowth(
        draft,
        world.content.catalog.ui.skills,
        now,
        { hp: 0, mp: 0 },
      );
      const result = transaction(draft, record, stage, {
        selected: action.rewardChoice,
        growth,
        items: world.content.items,
        random: () => sample,
        now,
      });
      requireInteraction(
        result.ok,
        result.code === "reward-choice"
          ? "INVALID_MESSAGE"
          : "REQUIREMENTS_NOT_MET",
      );
      if (stage === 1) {
        draft.settings.questTracker.ids =
          draft.settings.questTracker.ids.filter((id) => id !== record.id);
      }
      return { value: { questId: record.id, state: stage + 1 } };
    },
  );
  if (receipt.status === "committed") {
    lease.step++;
    lease.expiresAt = Date.now() + INTERACTION_LIMITS.leaseMs;
    finishQuestDialogue(actor, world, lease);
  }
  return receipt;
}

function abandonQuest(actor, message, world) {
  const id = message.action.questId;
  return world.database.commit(actor, operationFor(message), (draft) => {
    admitActor(actor, world, message.fieldEpoch);
    const record = world.content.catalog.quests.records[id];
    // The supported one-shot reference policy resets only this quest's progress, never items.
    requireInteraction(record?.supported, "CONTENT_MISMATCH");
    requireInteraction(
      stateOf(draft, id) === 1 && !(id >= 1200 && id <= 1399),
      "NOT_ALLOWED",
    );
    delete draft.quests[id];
    draft.settings.questTracker.ids = draft.settings.questTracker.ids.filter(
      (entry) => entry !== id,
    );
    return { value: { questId: id, abandoned: true } };
  });
}

function objectiveRows(record, profile, id) {
  const stage = record.stages[1];
  const rows = new Map();
  for (const check of [stage.check, stage.actionCheck]) {
    for (const item of check.items) {
      if (item.count <= 0) continue;
      const key = `item:${item.id}`;
      const required = Math.max(rows.get(key)?.required ?? 0, item.count);
      rows.set(key, {
        kind: "item",
        templateId: item.id,
        current:
          itemCount(profile, item.id) + (isEquipped(profile, item.id) ? 1 : 0),
        required,
      });
    }
    for (const mob of check.mobs) {
      const key = `kill:${mob.id}`;
      rows.set(key, {
        kind: "kill",
        templateId: mob.id,
        current: profile.quests[id]?.kills[mob.id] ?? 0,
        required: Math.max(rows.get(key)?.required ?? 0, mob.count),
      });
    }
  }
  requireInteraction(rows.size <= 128, "CONTENT_MISMATCH");
  return [...rows.values()];
}

export function progressQuestViews(actor, world) {
  const entries = Object.entries(actor.profile.quests);
  requireInteraction(entries.length <= MAX_QUESTS, "CONTENT_MISMATCH");
  const views = [];
  for (const [key, progress] of entries) {
    if (progress.state === 0) continue;
    const id = Number(key);
    const record = world.content.catalog.quests.records[id];
    requireInteraction(record, "CONTENT_MISMATCH");
    const stage = record.stages[1];
    const context = {
      questId: id,
      npcId: stage.check.npc || stage.actionCheck.npc,
    };
    const ready =
      progress.state === 1 &&
      record.supported &&
      checkConditions(stage.check, actor.profile, context).ok &&
      checkConditions(stage.actionCheck, actor.profile, context).ok;
    views.push({
      id,
      state: progress.state === 2 ? "claimed" : "active",
      ready: Boolean(ready),
      revision: actor.revision,
      objectives: objectiveRows(record, actor.profile, id),
    });
  }
  return views;
}
