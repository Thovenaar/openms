import {
  enumeration,
  integer,
  list,
  record,
  requireContent,
  text,
} from "./validation.js";

/** One conversation is a closed plain-text graph; every reference is an explicit node id. */
const DIALOGUE_LIMITS = Object.freeze({
  nodes: 16,
  options: 6,
  text: 512,
  label: 64,
  identity: 999999999,
});

/** Authored NPC conversations keep dense node ids and resolvable option targets. */
export function validateDialogueDefinition(value) {
  record(value, ["target", "start", "nodes"]);
  record(value.target, ["source", "kind", "id"], [], "target");
  enumeration(value.target.source, ["original"], "target/source");
  enumeration(value.target.kind, ["npc"], "target/kind");
  integer(value.target.id, 1, DIALOGUE_LIMITS.identity, "target/id");
  const nodes = list(value.nodes, DIALOGUE_LIMITS.nodes, "nodes");
  requireContent(nodes.length > 0, "Dialogue has no nodes", "nodes");
  for (const [index, node] of nodes.entries()) {
    validateNode(node, index, nodes.length);
  }
  integer(value.start, 0, nodes.length - 1, "start");
}

function validateNode(node, index, count) {
  const path = `nodes/${index}`;
  record(node, ["id", "text", "options"], [], path);
  integer(node.id, 0, count - 1, `${path}/id`);
  requireContent(
    node.id === index,
    "Dialogue node ids must be dense and ordered",
    `${path}/id`,
  );
  plainText(node.text, DIALOGUE_LIMITS.text, `${path}/text`);
  const options = list(
    node.options,
    DIALOGUE_LIMITS.options,
    `${path}/options`,
  );
  for (const [optionIndex, option] of options.entries()) {
    const optionPath = `${path}/options/${optionIndex}`;
    record(option, ["label", "next"], [], optionPath);
    plainText(option.label, DIALOGUE_LIMITS.label, `${optionPath}/label`);
    if (option.next !== null) {
      integer(option.next, 0, count - 1, `${optionPath}/next`);
    }
  }
}

function plainText(value, maximum, path) {
  text(value, maximum, path);
  requireContent(
    !value.includes("#"),
    "Use plain dialogue text; markup is not an authoring operation",
    path,
  );
}
