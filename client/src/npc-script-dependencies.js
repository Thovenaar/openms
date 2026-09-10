import {
  NPC_READ_TYPES,
  NPC_RUNTIME_LIMITS as LIMITS,
  npcInteger,
  requireNpc,
} from "./npc-script-values.js";

function assignments(program) {
  const values = new Map(),
    mutated = new Set();
  for (const node of program.statements) {
    const entries =
      node.op === "declare"
        ? node.values
        : node.op === "assign" && node.operator === "="
          ? [node]
          : [];
    for (const entry of entries) {
      if (!values.has(entry.name)) values.set(entry.name, []);
      values.get(entry.name).push(entry.value);
    }
    if (
      node.op === "update" ||
      (node.op === "assign" && node.operator !== "=")
    ) {
      mutated.add(node.name);
    }
    if (node.op === "for") mutated.add(node.variable);
  }
  return { values, mutated };
}

function expandVariable(state, node, analysis) {
  const values = analysis.assignments.values.get(node.name);
  requireNpc(
    values?.length && !analysis.assignments.mutated.has(node.name),
    "NPC dependency uses an unbounded variable",
    "npc-dependency",
  );
  for (const expression of values) {
    analysis.queue.push({ expression, path: state.path });
  }
}

function expandIndex(state, node, analysis) {
  const index = analysis.context.program.expressions[node.index];
  const value =
    index.op === "literal" && Number.isSafeInteger(index.value)
      ? index.value
      : "all";
  requireNpc(
    state.path.length < LIMITS.depth,
    "NPC dependency index depth exceeded",
    "npc-dependency",
  );
  analysis.queue.push({ expression: node.value, path: [value, ...state.path] });
}

function expandArray(state, node, analysis) {
  requireNpc(
    state.path.length > 0,
    "NPC dependency unexpectedly contains an array",
    "npc-dependency",
  );
  const index = state.path[0],
    path = state.path.slice(1);
  if (index === "all") {
    for (const expression of node.values) {
      analysis.queue.push({ expression, path });
    }
  } else {
    requireNpc(
      index >= 0 && index < node.values.length,
      "NPC dependency index is out of range",
      "npc-dependency",
    );
    analysis.queue.push({ expression: node.values[index], path });
  }
}

function expand(state, node, analysis) {
  switch (node.op) {
    case "variable":
      expandVariable(state, node, analysis);
      break;
    case "index":
      expandIndex(state, node, analysis);
      break;
    case "conditional":
      analysis.queue.push(
        { expression: node.yes, path: state.path },
        { expression: node.no, path: state.path },
      );
      break;
    case "array":
      expandArray(state, node, analysis);
      break;
    default:
      requireNpc(
        false,
        "NPC dependency is not a complete finite literal set",
        "npc-dependency",
      );
  }
}

/** Mirror the compiler's finite literal/array/alias proof, independently of published ID lists. */
function finiteValues(analysis, expression, arrays = false) {
  analysis.queue = [{ expression, path: [] }];
  const seen = new Set(),
    result = new Set();
  for (let index = 0; index < analysis.queue.length; index++) {
    requireNpc(
      ++analysis.steps <= LIMITS.analysisSteps &&
        analysis.queue.length <= LIMITS.nodes,
      "NPC dependency analysis budget exceeded",
      "npc-dependency",
    );
    const state = analysis.queue[index],
      key = `${state.expression}:${state.path.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = analysis.context.program.expressions[state.expression];
    if (
      state.path.length === 0 &&
      (arrays ? node.op === "array" : node.op === "literal")
    ) {
      result.add(arrays ? node.values.length : npcInteger(node.value, 1));
    } else expand(state, node, analysis);
  }
  requireNpc(
    result.size > 0,
    "NPC dependency has no literal values",
    "npc-dependency",
  );
  return result;
}

function ids(analysis, family, expression) {
  const result = finiteValues(analysis, expression);
  for (const id of result) {
    requireNpc(
      analysis.context.dependencies[family].has(id),
      `NPC ${family} closure omitted an executable source ID`,
      "npc-dependency",
    );
  }
  return result;
}

function negativeLiteral(program, expression) {
  const node = program.expressions[expression];
  if (node?.op === "literal") {
    return typeof node.value === "number" && node.value < 0;
  }
  if (node?.op !== "unary" || node.operator !== "-") return false;
  const child = program.expressions[node.value];
  return (
    child.op === "literal" && typeof child.value === "number" && child.value > 0
  );
}

function effectDependencies(analysis, node) {
  if (node.kind === "meso") return;
  const family = node.kind === "item" ? "itemIds" : "questIds";
  const values = ids(analysis, family, node.args[0]);
  if (node.kind !== "item") {
    for (const id of values) analysis.context.forceQuestIds.add(id);
    if (node.args.length === 2) ids(analysis, "npcIds", node.args[1]);
    return;
  }
  itemEffectDependencies(analysis, node, values);
}

function itemEffectDependencies(analysis, node, values) {
  const grant =
    node.overload === "id-show" ||
    node.args.length === 1 ||
    !negativeLiteral(analysis.context.program, node.args[1]);
  for (const id of values) {
    requireNpc(
      !grant ||
        (Math.trunc(id / 1000000) !== 1 && Math.trunc(id / 1000) !== 5000),
      "NPC item grant requires pet/equipment customization authority",
      "npc-dependency",
    );
  }
  const showIndex =
    node.overload === "id-show" ? 1 : node.args.length === 3 ? 2 : -1;
  if (showIndex >= 0) {
    const show = analysis.context.program.expressions[node.args[showIndex]];
    requireNpc(
      show.op === "literal" && typeof show.value === "boolean",
      "NPC item show flag is not a literal boolean",
    );
  }
}

export function validateNpcReferences(context) {
  const program = context.program;
  const analysis = {
    context,
    assignments: assignments(program),
    steps: 0,
    queue: [],
  };
  context.forceQuestIds = new Set();
  for (const node of program.expressions) {
    if (node.op !== "read") continue;
    const family = NPC_READ_TYPES[node.kind][2];
    if (family) ids(analysis, family, node.args[0]);
  }
  for (const node of program.statements) {
    if (node.op === "effect") effectDependencies(analysis, node);
    if (node.op !== "for") continue;
    const test = program.expressions[node.test],
      bound = program.expressions[test.right];
    if (bound.op === "length") finiteValues(analysis, bound.value, true);
  }
}
