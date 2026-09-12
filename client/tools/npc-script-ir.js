import { parse, tokenizer } from "acorn";
import {
  NPC_MARKUP_FAMILIES,
  NPC_MARKUP_TOKENS,
  npcMarkupId,
} from "../src/npc/npc-script-markup.js";
const DEPENDENCY_TOKENS = new RegExp(
  `${NPC_MARKUP_TOKENS.source}|#[ptivzmocuay@]\\d+:?#?`,
  "g",
);

/** Engineering limits, not recovered game/protocol constants. */
export const NPC_SCRIPT_LIMITS = Object.freeze({
  sourceBytes: 1000000,
  tokens: 50000,
  nodes: 30000,
  depth: 128,
  expressions: 20000,
  statements: 10000,
  analysisSteps: 200000,
  variables: 512,
  arrayLength: 256,
  loopIterations: 256,
  stepsPerTurn: 100000,
  turnsPerSession: 2048,
  textLength: 32768,
  inputLength: 4096,
  dependencies: 8192,
});

/** Raw NPC message and CUtilDlgEx renderer enums are deliberately separate. */
export const NPC_DIALOG_METHODS = Object.freeze({
  sendNext: {
    kind: "say",
    rawType: 0,
    internalType: 0,
    prev: false,
    next: true,
  },
  sendPrev: {
    kind: "say",
    rawType: 0,
    internalType: 0,
    prev: true,
    next: false,
  },
  sendNextPrev: {
    kind: "say",
    rawType: 0,
    internalType: 0,
    prev: true,
    next: true,
  },
  sendOk: {
    kind: "say",
    rawType: 0,
    internalType: 0,
    prev: false,
    next: false,
  },
  sendYesNo: { kind: "yes-no", rawType: 1, internalType: 1 },
  sendAcceptDecline: { kind: "accept-decline", rawType: 12, internalType: 1 },
  sendSimple: { kind: "choice", rawType: 4, internalType: 4 },
  sendGetNumber: { kind: "number", rawType: 3, internalType: 2 },
  sendGetText: { kind: "text", rawType: 2, internalType: 3 },
});

export function sourceSpan(node) {
  return {
    start: node.start,
    end: node.end,
    line: node.loc.start.line,
    column: node.loc.start.column,
  };
}

export function blockScript(context, node, reason) {
  context.blockers.push({
    source: context.source.path,
    ...sourceSpan(node),
    reason,
  });
}

export function spendAnalysisStep(context, node) {
  if (++context.analysisSteps <= NPC_SCRIPT_LIMITS.analysisSteps) return;
  const error = new Error("NPC dependency analysis work limit exceeded");
  error.pos = node.start;
  error.loc = node.loc.start;
  throw error;
}

/** Exact noncomputed member access; never an arbitrary host dispatch. */
export function member(node, name) {
  return (
    node?.type === "MemberExpression" &&
    !node.computed &&
    !node.optional &&
    node.property.type === "Identifier" &&
    node.property.name === name
  );
}

export function call(node, name) {
  return (
    node?.type === "CallExpression" &&
    !node.optional &&
    member(node.callee, name)
  );
}

export function cmMethod(node) {
  const callee = node?.callee;
  if (
    node?.type !== "CallExpression" ||
    node.optional ||
    callee?.computed ||
    callee?.type !== "MemberExpression" ||
    callee.object.type !== "Identifier" ||
    callee.object.name !== "cm" ||
    callee.property.type !== "Identifier"
  ) {
    return null;
  }
  return callee.property.name;
}

/** Exact authored Character receiver aliases; host objects never enter the value IR. */
export function playerMethod(node) {
  if (
    node?.type !== "CallExpression" ||
    node.optional ||
    node.callee.computed ||
    node.callee.type !== "MemberExpression"
  ) {
    return null;
  }
  const receiver = node.callee.object;
  const clientPlayer =
    call(receiver, "getPlayer") &&
    member(receiver.callee.object, "c") &&
    receiver.callee.object.object.type === "Identifier" &&
    receiver.callee.object.object.name === "cm";
  if (
    (!["getPlayer", "getChar"].includes(cmMethod(receiver)) && !clientPlayer) ||
    receiver.arguments.length
  ) {
    return null;
  }
  return node.callee.property.name;
}

export function integerLiteral(node) {
  if (node?.type === "Literal" && Number.isSafeInteger(node.value)) {
    return node.value;
  }
  if (
    node?.type === "UnaryExpression" &&
    node.operator === "-" &&
    node.argument.type === "Literal" &&
    Number.isSafeInteger(node.argument.value)
  ) {
    return -node.argument.value;
  }
  return null;
}

/** Token/depth preflight bounds the third-party parser before building its AST. */
export function parseNpcSource(text) {
  if (Buffer.byteLength(text, "utf8") > NPC_SCRIPT_LIMITS.sourceBytes) {
    throw new Error("NPC source byte limit exceeded");
  }
  const options = { ecmaVersion: 2020, sourceType: "script", locations: true };
  const tokens = tokenizer(text, options);
  let depth = 0;
  for (let count = 0; count <= NPC_SCRIPT_LIMITS.tokens; count++) {
    const token = tokens.getToken(),
      label = token.type.label;
    if (label === "eof") return parse(text, options);
    if (["(", "[", "{", "${"].includes(label)) depth++;
    if ([")", "]", "}"].includes(label)) depth--;
    if (depth > NPC_SCRIPT_LIMITS.depth) {
      throw new Error("NPC syntax depth limit exceeded");
    }
  }
  throw new Error("NPC token limit exceeded");
}

/** Iterative complete AST inventory; node limits precede every queue expansion. */
export function astInventory(root) {
  const queue = [root];
  for (let index = 0; index < queue.length; index++) {
    for (const value of Object.values(queue[index])) {
      const children = Array.isArray(value) ? value : [value];
      if (children.length > NPC_SCRIPT_LIMITS.nodes) {
        throw new Error("NPC AST collection limit");
      }
      for (const child of children) {
        if (!child || typeof child.type !== "string") continue;
        if (queue.length >= NPC_SCRIPT_LIMITS.nodes) {
          throw new Error("NPC AST node limit");
        }
        queue.push(child);
      }
    }
  }
  return queue;
}

export function resolveVariable(context, scope, node) {
  const name = node?.type === "Identifier" ? node.name : null;
  let variable = null;
  for (let depth = 0; scope && depth <= NPC_SCRIPT_LIMITS.depth; depth++) {
    variable = context.scopes.get(scope)?.get(name);
    if (variable) break;
    scope = context.scopeParents.get(scope);
  }
  if (!variable) {
    blockScript(
      context,
      node,
      `Undeclared or unsupported identifier: ${name ?? node.type}`,
    );
    return null;
  }
  return variable;
}

export function dependencySets() {
  return Object.fromEntries(
    [
      "itemIds",
      "questIds",
      "shopIds",
      "npcIds",
      "mapIds",
      "mobIds",
      "artworkPaths",
    ].map((name) => [name, new Set()]),
  );
}

export function addDependency(context, kind, id, node) {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
    blockScript(context, node, `Invalid ${kind} dependency: ${id}`);
    return;
  }
  const set = context.dependencies[kind];
  if (set.size >= NPC_SCRIPT_LIMITS.dependencies && !set.has(id)) {
    blockScript(context, node, `${kind} dependency limit exceeded`);
    return;
  }
  set.add(id);
}

/** Text is never rewritten; markup scanning only contributes asset dependencies. */
export function textDependencies(context, node) {
  if (typeof node.value !== "string") return;
  for (const match of node.value.matchAll(DEPENDENCY_TOKENS)) {
    const code = match[0][1],
      family = NPC_MARKUP_FAMILIES[code];
    if (family) {
      addDependency(
        context,
        family,
        npcMarkupId(code, Number(match[0].match(/\d+/)[0])),
        node,
      );
    }
  }
}
