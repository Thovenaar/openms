import {
  closeConversation,
  interactionReceipt,
  publishInteraction,
  requireInteraction,
  storeDialogue,
  INTERACTION_LIMITS,
} from "./interaction-common.js";

// Versioned authored-dialogue policy, not recovered native-server constants.
const AUTHORED_DIALOGUE_LIMITS = Object.freeze({
  nodes: 16,
  options: 6,
  text: 512,
  label: 64,
});

/** Authored prose is displayed verbatim: the '#' markup alphabet is never admitted. */
function admittedProse(value, limit) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= limit &&
    !value.includes("#")
  );
}

/** Untrusted release overlay: one bounded plain-text graph, admitted whole or refused whole. */
export function admitAuthoredDialogue(section) {
  if (section === null || section === undefined) return null;
  requireInteraction(
    typeof section === "object" && !Array.isArray(section),
    "CONTENT_MISMATCH",
  );
  const source = section.nodes;
  requireInteraction(
    Array.isArray(source) &&
      source.length > 0 &&
      source.length <= AUTHORED_DIALOGUE_LIMITS.nodes,
    "CONTENT_MISMATCH",
  );
  const start = section.start;
  requireInteraction(
    Number.isSafeInteger(start) && start >= 0 && start < source.length,
    "CONTENT_MISMATCH",
  );
  const nodes = new Array(source.length);
  for (const node of source) {
    requireInteraction(
      node &&
        Number.isSafeInteger(node.id) &&
        node.id >= 0 &&
        node.id < source.length &&
        !nodes[node.id],
      "CONTENT_MISMATCH",
    );
    requireInteraction(
      admittedProse(node.text, AUTHORED_DIALOGUE_LIMITS.text),
      "CONTENT_MISMATCH",
    );
    const sourceOptions = node.options;
    requireInteraction(
      Array.isArray(sourceOptions) &&
        sourceOptions.length <= AUTHORED_DIALOGUE_LIMITS.options,
      "CONTENT_MISMATCH",
    );
    const options = new Array(sourceOptions.length);
    for (let index = 0; index < sourceOptions.length; index++) {
      const option = sourceOptions[index];
      requireInteraction(
        option && typeof option === "object" && !Array.isArray(option),
        "CONTENT_MISMATCH",
      );
      requireInteraction(
        admittedProse(option.label, AUTHORED_DIALOGUE_LIMITS.label),
        "CONTENT_MISMATCH",
      );
      const next = option.next;
      requireInteraction(
        next === null ||
          (Number.isSafeInteger(next) && next >= 0 && next < source.length),
        "CONTENT_MISMATCH",
      );
      options[index] = { label: option.label, next };
    }
    // Choice ids are dense node indices, so the wire never carries an authored id.
    nodes[node.id] = {
      id: node.id,
      text: node.text,
      options,
      choices: options.map((_, index) => index),
    };
  }
  return { start, nodes };
}

/** Authored nodes publish the original dialogue shape: one plain page plus #L choice rows. */
export function publishAuthoredNode(actor, world, lease, nodeId) {
  const node = lease.authored.nodes[nodeId];
  lease.authoredNode = nodeId;
  const rows = [node.text];
  for (let index = 0; index < node.options.length; index++) {
    rows.push(`#L${index}# ${node.options[index].label}#l`);
  }
  const contentId = storeDialogue(world, actor, lease, rows.join("\r\n"));
  publishInteraction(world, actor, {
    kind: "dialogue",
    conversationId: lease.id,
    step: lease.step,
    npcId: lease.npcId,
    npcTemplateId: lease.npcTemplateId,
    native: {
      kind: node.options.length ? "choice" : "say",
      speaker: 0,
      prev: false,
      next: false,
      defaultValue: null,
    },
    contentId,
    choices: node.choices,
    input: node.options.length ? "choice" : "next",
    minimum: null,
    maximum: null,
  });
}

/** Revisiting a node is allowed; the graph, not a counter, bounds an authored conversation. */
export function startAuthoredDialogue(actor, world, lease, route) {
  const program = route.dialogue;
  requireInteraction(program, "CONTENT_MISMATCH");
  lease.authored = program;
  lease.menu = null;
  lease.view = null;
  lease.step++;
  publishAuthoredNode(actor, world, lease, program.start);
  return lease.step;
}

export function answerAuthoredDialogue(actor, message, world, lease) {
  const answer = message.action.answer;
  if (answer.kind === "cancel") {
    closeConversation(actor, world);
    return interactionReceipt(lease.step + 1);
  }
  const node = lease.authored.nodes[lease.authoredNode];
  if (!node.options.length) {
    requireInteraction(answer.kind === "next", "NOT_ALLOWED");
    closeConversation(actor, world);
    return interactionReceipt(lease.step + 1);
  }
  requireInteraction(answer.kind === "choice", "INVALID_MESSAGE");
  requireInteraction(
    Number.isSafeInteger(answer.choiceId) &&
      answer.choiceId >= 0 &&
      answer.choiceId < node.options.length,
    "NOT_ALLOWED",
  );
  const next = node.options[answer.choiceId].next;
  if (next === null) {
    closeConversation(actor, world);
    return interactionReceipt(lease.step + 1);
  }
  lease.step++;
  lease.expiresAt = Date.now() + INTERACTION_LIMITS.leaseMs;
  publishAuthoredNode(actor, world, lease, next);
  return interactionReceipt(lease.step);
}
