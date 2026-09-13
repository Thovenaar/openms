import { startQuestDialogue } from "./interaction-quest-dialogue.js";
import {
  NPC_MENU_HEADINGS,
  npcQuestGroup,
  npcTalkLabel,
} from "../../client/src/npc/npc-menu.js";
import {
  closeConversation,
  interactionReceipt,
  publishInteraction,
  requireInteraction,
  storeDialogue,
} from "./interaction-common.js";

/** The menu is server-built from authored quest titles and the admitted talk route. */
export function publishNpcMenu(actor, world, lease) {
  lease.menu.sort((left, right) => npcQuestGroup(left) - npcQuestGroup(right));
  const choices = lease.menu.map((entry) => entry.questId);
  const rows = questRows(world.content.catalog.quests, lease.menu);
  if (lease.route?.status === "supported") {
    choices.push(0);
    const npc = world.npc(actor, lease.npcId);
    const label = npcTalkLabel(
      npc.template,
      world.content.catalog.quests.npcScriptLabels,
    );
    rows.push(heading(2), `#d#L0# ${label}#l#k`);
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

function heading(index) {
  return `\r\n#fUI/UIWindow.img/UtilDlgEx/list${index}#`;
}

function questRows(quests, entries) {
  const rows = [];
  let previous = -1;
  for (const entry of entries) {
    const group = npcQuestGroup(entry);
    if (group !== previous) rows.push(heading(NPC_MENU_HEADINGS[group]));
    rows.push(
      `#b#L${entry.questId}# ${quests.records[entry.questId].name}#l#k`,
    );
    previous = group;
  }
  return rows;
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
