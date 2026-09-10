import {
  NPC_SCRIPT_LIMITS,
  addDependency,
  blockScript,
  cmMethod,
  resolveVariable,
  sourceSpan,
  spendAnalysisStep,
  textDependencies,
} from "./npc-script-ir.js";
import {
  NPC_MARKUP_FAMILIES,
  NPC_MARKUP_TOKENS,
  npcMarkupId,
} from "../src/npc-script-markup.js";

const BINARY = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "==",
  "!=",
  "===",
  "!==",
  "<",
  "<=",
  ">",
  ">=",
]);
const UNARY = new Set(["!", "+", "-", "typeof"]);
const READS = Object.freeze({
  getMeso: ["meso", 0, 0],
  getLevel: ["level", 0, 0],
  getJobId: ["job", 0, 0],
  getText: ["input-text", 0, 0],
  getQuestStatus: ["quest-state", 1, 1, "questIds"],
  isQuestCompleted: ["quest-completed", 1, 1, "questIds"],
  isQuestStarted: ["quest-started", 1, 1, "questIds"],
  isQuestActive: ["quest-started", 1, 1, "questIds"],
  itemQuantity: ["item-count", 1, 1, "itemIds"],
  haveItem: ["have-item", 1, 2, "itemIds"],
  canHold: ["can-hold", 1, 2, "itemIds"],
});

function expressionChildren(node) {
  switch (node.type) {
    case "ArrayExpression":
      return node.elements;
    case "BinaryExpression":
    case "LogicalExpression":
      return [node.left, node.right];
    case "UnaryExpression":
      return [node.argument];
    case "ConditionalExpression":
      return [node.test, node.consequent, node.alternate];
    case "MemberExpression":
      return node.computed ? [node.object, node.property] : [node.object];
    case "CallExpression":
      return node.arguments;
    default:
      return [];
  }
}

function allowedLiteral(node) {
  if (node.regex || node.bigint) return false;
  if (node.value === null || typeof node.value === "boolean") return true;
  if (typeof node.value === "number") return Number.isSafeInteger(node.value);
  return (
    typeof node.value === "string" &&
    node.value.length <= NPC_SCRIPT_LIMITS.textLength
  );
}

function literal(context, node) {
  if (!allowedLiteral(node)) {
    blockScript(
      context,
      node,
      "Only bounded strings, safe integers, booleans and null are literal values",
    );
    return null;
  }
  textDependencies(context, node);
  return {
    op: "literal",
    value: node.value,
    raw: context.text.slice(node.start, node.end),
  };
}

function localRead(context, node, refs) {
  const method = cmMethod(node),
    spec = Object.hasOwn(READS, method) ? READS[method] : null;
  if (!spec || refs.length < spec[1] || refs.length > spec[2]) {
    blockScript(
      context,
      node,
      `Unsupported expression call: ${method ?? context.text.slice(node.callee.start, node.callee.end)}`,
    );
    return null;
  }
  if (spec[3]) {
    context.dependencyRequests.push({
      kind: spec[3],
      expression: refs[0],
      node,
    });
  }
  return { op: "read", kind: spec[0], args: refs };
}

function binaryExpression(context, node, refs) {
  if (!BINARY.has(node.operator)) return null;
  if (node.operator === "+") {
    context.concatenations.push({ left: refs[0], right: refs[1], node });
  }
  return {
    op: "binary",
    operator: node.operator,
    left: refs[0],
    right: refs[1],
  };
}

function valueExpression(node, refs) {
  if (
    node.type === "ArrayExpression" &&
    refs.length <= NPC_SCRIPT_LIMITS.arrayLength &&
    !node.elements.includes(null)
  ) {
    return { op: "array", values: refs };
  }
  if (node.type !== "MemberExpression" || node.optional) return null;
  if (node.computed) return { op: "index", value: refs[0], index: refs[1] };
  if (node.property.name === "length") return { op: "length", value: refs[0] };
  return null;
}

function operatorExpression(node, refs) {
  if (
    node.type === "LogicalExpression" &&
    ["&&", "||"].includes(node.operator)
  ) {
    return {
      op: "logical",
      operator: node.operator,
      left: refs[0],
      right: refs[1],
    };
  }
  if (node.type === "UnaryExpression" && UNARY.has(node.operator)) {
    return { op: "unary", operator: node.operator, value: refs[0] };
  }
  return null;
}

function compositeExpression(context, node, refs) {
  let result = null;
  switch (node.type) {
    case "ArrayExpression":
    case "MemberExpression":
      result = valueExpression(node, refs);
      break;
    case "BinaryExpression":
      result = binaryExpression(context, node, refs);
      break;
    case "LogicalExpression":
    case "UnaryExpression":
      result = operatorExpression(node, refs);
      break;
    case "ConditionalExpression":
      result = { op: "conditional", test: refs[0], yes: refs[1], no: refs[2] };
      break;
    case "CallExpression":
      return localRead(context, node, refs);
    default:
      break;
  }
  if (!result) {
    blockScript(context, node, `Unsupported expression: ${node.type}`);
  }
  return result;
}

function expressionRecord(context, scope, node, refs) {
  if (node.type === "Literal") return literal(context, node);
  if (node.type !== "Identifier") {
    return compositeExpression(context, node, refs);
  }
  if (node.name === "undefined") return { op: "undefined" };
  const variable = resolveVariable(context, scope, node);
  if (variable?.host) {
    blockScript(
      context,
      node,
      "Host imports may only occur in the exact static ShopFactory translation",
    );
    return null;
  }
  return variable ? { op: "variable", name: variable.key } : null;
}

/** Postorder graph lowering; logical/conditional edges remain lazy at runtime. */
export function compileExpression(context, scope, root) {
  if (context.expressionRefs.has(root)) return context.expressionRefs.get(root);
  const pending = [{ node: root, leave: false }];
  let steps = 0;
  while (pending.length && steps++ < NPC_SCRIPT_LIMITS.nodes * 2) {
    const { node, leave } = pending.pop();
    if (!node) {
      blockScript(context, root, "Sparse expressions are unsupported");
      continue;
    }
    if (context.expressionRefs.has(node)) continue;
    const children = expressionChildren(node);
    if (!leave) {
      pending.push({ node, leave: true });
      for (let index = children.length - 1; index >= 0; index--) {
        pending.push({ node: children[index], leave: false });
      }
      continue;
    }
    if (context.expressions.length >= NPC_SCRIPT_LIMITS.expressions) {
      throw new Error("NPC expression limit");
    }
    const refs = children.map(
      (child) => context.expressionRefs.get(child) ?? null,
    );
    const record = expressionRecord(context, scope, node, refs);
    const id = context.expressions.length;
    context.expressions.push({
      ...(record ?? { op: "unsupported" }),
      source: sourceSpan(node),
    });
    context.expressionRefs.set(node, id);
  }
  if (pending.length) throw new Error("NPC expression traversal limit");
  return context.expressionRefs.get(root);
}

function dependencyIndex(context, expression) {
  const record = context.expressions[expression];
  return record?.op === "literal" && Number.isSafeInteger(record.value)
    ? record.value
    : "all";
}

function dependencyEdges(context, work, state, record) {
  if (record.op === "variable") {
    const assignments = context.assignments.get(record.name) ?? [];
    if (!assignments.length || context.unboundedAssignments.has(record.name)) {
      return false;
    }
    for (const expression of assignments) {
      work.push({ expression, path: state.path });
    }
  } else if (record.op === "index") {
    work.push({
      expression: record.value,
      path: [dependencyIndex(context, record.index), ...state.path],
    });
  } else if (record.op === "conditional") {
    work.push(
      { expression: record.yes, path: state.path },
      { expression: record.no, path: state.path },
    );
  } else if (record.op === "array" && state.path.length) {
    return arrayDependencyEdges(work, state.path, record);
  } else return false;
  return true;
}

function arrayDependencyEdges(work, sourcePath, record) {
  const [index, ...path] = sourcePath;
  if (index === "all") {
    for (const expression of record.values) work.push({ expression, path });
  } else if (index >= 0 && index < record.values.length) {
    work.push({ expression: record.values[index], path });
  } else return false;
  return true;
}

function dependencyLeaf(record, state, op) {
  return record?.op === op && state.path.length === 0;
}

function suffixEdges(context, work, state, record) {
  if (record.op === "binary" && record.operator === "+") {
    work.push({ expression: record.right, path: state.path });
  } else if (record.op === "variable") {
    for (const expression of context.assignments.get(record.name) ?? []) {
      work.push({ expression, path: state.path });
    }
  } else {
    dependencyEdges(context, work, state, record);
  }
}

function trailingMarkupCode(record) {
  if (record.op !== "literal" || typeof record.value !== "string") return null;
  const match = /#([ptivzmocuay@])$/.exec(record.value);
  if (!match) return null;
  let consumed = 0;
  for (const token of record.value.matchAll(NPC_MARKUP_TOKENS)) {
    consumed = token.index + token[0].length;
  }
  return match.index >= consumed ? match : null;
}

/** Resolve aliased string prefixes before collecting finite markup ID expressions. */
export function collectConcatenationDependencies(context) {
  for (const request of context.concatenations) {
    const work = [{ expression: request.left, path: [] }],
      seen = new Set();
    let index = 0;
    for (; index < work.length && index < NPC_SCRIPT_LIMITS.nodes; index++) {
      spendAnalysisStep(context, request.node);
      const state = work[index],
        key = `${state.expression}:${state.path.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const record = context.expressions[state.expression];
      if (!record) continue;
      const match = trailingMarkupCode(record);
      if (match) {
        context.dependencyRequests.push({
          kind: NPC_MARKUP_FAMILIES[match[1]],
          markupCode: match[1],
          expression: request.right,
          node: request.node,
        });
      } else suffixEdges(context, work, state, record);
      if (work.length > NPC_SCRIPT_LIMITS.nodes) break;
    }
    if (index < work.length) {
      blockScript(
        context,
        request.node,
        "Text dependency traversal limit exceeded",
      );
    }
  }
}

function recordDependency(context, request, id) {
  if (request.markupCode && Number.isSafeInteger(id)) {
    id = npcMarkupId(request.markupCode, id);
  }
  addDependency(context, request.kind, id, request.node);
  if (!request.plainGrant) return;
  const equipment = Math.floor(id / 1000000) === 1;
  const pet = Math.floor(id / 1000) === 5000;
  if (equipment || pet) {
    blockScript(
      context,
      request.node,
      `gainItem(${id}) requires pet/equipment-customization authority (AbstractPlayerInteraction.java:593-638), not a plain local stack grant`,
    );
  }
}

/** Close over every possible literal-array selection, never over a guessed current branch. */
export function collectExpressionDependencies(context) {
  for (const request of context.dependencyRequests) {
    const work = [{ expression: request.expression, path: [] }],
      seen = new Set();
    let found = false,
      complete = true,
      index = 0;
    for (; index < work.length && index < NPC_SCRIPT_LIMITS.nodes; index++) {
      spendAnalysisStep(context, request.node);
      const state = work[index],
        key = `${state.expression}:${state.path.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const record = context.expressions[state.expression];
      if (dependencyLeaf(record, state, "literal")) {
        recordDependency(context, request, record.value);
        found = true;
      } else if (!record || !dependencyEdges(context, work, state, record)) {
        complete = false;
      }
      if (work.length > NPC_SCRIPT_LIMITS.nodes) break;
    }
    if (!complete || !found || index < work.length) {
      blockScript(
        context,
        request.node,
        `${request.kind} must have a complete finite literal dependency set`,
      );
    }
  }
}

/** A length-bound loop must close over literal bounded arrays, including aliases. */
export function collectLoopBounds(context) {
  for (const request of context.loopBounds) {
    const work = [{ expression: request.expression, path: [] }],
      seen = new Set();
    let found = false,
      complete = true,
      index = 0;
    for (; index < work.length && index < NPC_SCRIPT_LIMITS.nodes; index++) {
      spendAnalysisStep(context, request.node);
      const state = work[index],
        key = `${state.expression}:${state.path.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const record = context.expressions[state.expression];
      if (dependencyLeaf(record, state, "array")) found = true;
      else if (!record || !dependencyEdges(context, work, state, record)) {
        complete = false;
      }
      if (work.length > NPC_SCRIPT_LIMITS.nodes) break;
    }
    if (!complete || !found || index < work.length) {
      blockScript(
        context,
        request.node,
        "Loop length must have a finite literal-array bound",
      );
    }
  }
}
