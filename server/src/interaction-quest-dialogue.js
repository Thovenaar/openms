import { QuestDialogue } from "../../client/src/quests/quest-dialogue.js";
import {
  stateOf,
  checkConditions,
} from "../../client/src/quests/quest-rules.js";
import {
  closeConversation,
  currentNpc,
  interactionReceipt,
  publishInteraction,
  requireInteraction,
  storeDialogue,
  INTERACTION_LIMITS,
} from "./interaction-common.js";

function status(record, npcId, profile) {
  const state = stateOf(profile, record.id);
  if (!record.supported || state > 1) {
    return { ok: false, state, code: "quest" };
  }
  const stage = record.stages[state];
  const context = { questId: record.id, npcId };
  const result = checkConditions(stage.check, profile, context);
  if (!result.ok) return { ...result, state };
  return { ...checkConditions(stage.actionCheck, profile, context), state };
}

export function startQuestDialogue(actor, world, lease, questId) {
  const record = world.content.catalog.quests.records[questId];
  requireInteraction(
    record && status(record, lease.npcTemplateId, actor.profile).ok,
    "REQUIREMENTS_NOT_MET",
  );
  const system = {
    store: { profile: actor.profile },
    status: (entry, npcId) => status(entry, npcId, actor.profile),
  };
  const dialogue = new QuestDialogue(system, record, lease.npcTemplateId);
  const view = dialogue.snapshot();
  requireInteraction(view.choices.length <= 128, "CONTENT_MISMATCH");
  storeDialogue(world, actor, lease, view.text);
  lease.questDialogue = dialogue;
  lease.step++;
  lease.menu = null;
  lease.view = null;
  return publishQuestDialogue(actor, world, lease);
}

export function publishQuestDialogue(actor, world, lease) {
  const dialogue = lease.questDialogue;
  dialogue.system.store.profile = actor.profile;
  const view = dialogue.snapshot();
  lease.offers = [];
  if (
    view.mode === "confirm" &&
    status(dialogue.record, lease.npcTemplateId, actor.profile).ok
  ) {
    lease.offers.push({
      questId: view.questId,
      action: view.stage === 0 ? "accept" : "claim",
    });
  }
  if (view.mode === "closed") {
    closeConversation(actor, world);
    return;
  }
  requireInteraction(view.choices.length <= 128, "CONTENT_MISMATCH");
  const contentId = storeDialogue(world, actor, lease, view.text);
  publishInteraction(world, actor, {
    kind: "dialogue",
    conversationId: lease.id,
    step: lease.step,
    npcId: lease.npcId,
    npcTemplateId: lease.npcTemplateId,
    native: {
      kind: view.choices.length ? "choice" : "say",
      speaker: 0,
      prev: view.canPrevious,
      next: view.mode !== "confirm",
      defaultValue: null,
    },
    contentId,
    choices: view.choices,
    input: view.choices.length ? "choice" : "next",
    minimum: null,
    maximum: null,
  });
  publishInteraction(world, actor, {
    kind: "quest.offer",
    conversationId: lease.id,
    step: lease.step,
    npcId: lease.npcId,
    npcTemplateId: lease.npcTemplateId,
    quests: lease.offers,
  });
}

export function answerQuestDialogue(actor, message, world, lease) {
  currentNpc(world, actor, lease);
  const dialogue = lease.questDialogue;
  const answer = message.action.answer;
  const view = dialogue.snapshot();
  if (answer.kind === "next" || answer.kind === "choice") {
    requireInteraction(
      dialogue.steps < 2048 &&
        view.mode !== "confirm" &&
        view.mode !== "closed",
      "NOT_ALLOWED",
    );
    requireInteraction(
      view.choices.length
        ? answer.kind === "choice" && view.choices.includes(answer.choiceId)
        : answer.kind === "next",
      "NOT_ALLOWED",
    );
  }
  if (answer.kind === "cancel") {
    if (!dialogue.reject()) {
      closeConversation(actor, world);
      return interactionReceipt(lease.step + 1);
    }
  } else if (answer.kind === "previous") {
    requireInteraction(dialogue.previous());
  } else {
    requireInteraction(
      answer.kind === "next" || answer.kind === "choice",
      "INVALID_MESSAGE",
    );
    const outcome = dialogue.advance(
      answer.kind === "choice" ? answer.choiceId : null,
    );
    requireInteraction(outcome.ok, "NOT_ALLOWED");
  }
  lease.step++;
  lease.expiresAt = Date.now() + INTERACTION_LIMITS.leaseMs;
  publishQuestDialogue(actor, world, lease);
  return interactionReceipt(lease.step);
}

export function finishQuestDialogue(actor, world, lease) {
  const dialogue = lease.questDialogue;
  dialogue.committed({ ok: true });
  lease.offers = [];
  publishQuestDialogue(actor, world, lease);
}
