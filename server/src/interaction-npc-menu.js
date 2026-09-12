import { startQuestDialogue } from "./interaction-quest-dialogue.js";
import {
  closeConversation,
  interactionReceipt,
  publishInteraction,
  requireInteraction,
  storeDialogue,
} from "./interaction-common.js";

/** The menu is server-built from authored quest titles and the admitted talk route. */
export function publishNpcMenu(actor, world, lease) {
  const choices = lease.menu.map((entry) => entry.questId);
  const rows = lease.menu.map(
    (entry) =>
      `#L${entry.questId}#${world.content.catalog.quests.records[entry.questId].name}#l`,
  );
  if (lease.route?.status === "supported") {
    choices.push(0);
    rows.push(
      `#L0#${world.content.catalog.quests.strings.npc[lease.npcTemplateId]}#l`,
    );
  }
  requireInteraction(
    choices.length > 0 && choices.length <= 128,
    "CONTENT_MISMATCH",
  );
  const contentId = storeDialogue(world, actor, lease, rows.join("\r\n"));
  publishInteraction(world, actor, {
    kind: "dialogue",
    conversationId: lease.id,
    step: lease.step,
    npcId: lease.npcId,
    npcTemplateId: lease.npcTemplateId,
    native: {
      kind: "choice",
      speaker: 0,
      prev: false,
      next: false,
      defaultValue: null,
    },
    contentId,
    choices,
    input: "choice",
    minimum: null,
    maximum: null,
  });
}

export function answerNpcMenu(actor, message, world, lease) {
  const answer = message.action.answer;
  if (answer.kind === "cancel") {
    closeConversation(actor, world);
    return interactionReceipt(lease.step + 1);
  }
  requireInteraction(answer.kind === "choice", "INVALID_MESSAGE");
  if (answer.choiceId === 0) {
    requireInteraction(lease.route?.status === "supported", "CONTENT_MISMATCH");
    lease.menu = null;
    return null;
  }
  requireInteraction(
    lease.menu.some((entry) => entry.questId === answer.choiceId),
    "NOT_ALLOWED",
  );
  startQuestDialogue(actor, world, lease, answer.choiceId);
  return interactionReceipt(lease.step);
}
