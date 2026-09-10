import { validateNpcReferences } from "./npc-script-dependencies.js";
import { validNpcArtworkPath } from "./npc-script-markup.js";
import {
  NPC_DIALOG_TYPES,
  NPC_READ_TYPES,
  NPC_RUNTIME_LIMITS as LIMITS,
  npcInteger,
  requireNpc,
} from "./npc-script-values.js";

export const NPC_SCRIPT_REQUIREMENTS = Object.freeze([
  "atomic-local-turn",
  "finite-checked-scalar-arithmetic",
  "schema5-item-template-capacity-and-instance-admission",
  "quest-state-only-definition:no-timers-no-custom-progress-no-repeat-counters",
  "rendered-markup-dependencies-closed",
  "dialog:say",
  "dialog:yes-no",
  "dialog:accept-decline",
  "dialog:choice",
  "dialog:number",
  "dialog:text",
]);
export const NPC_DEPENDENCY_FAMILIES = Object.freeze([
  "itemIds",
  "questIds",
  "shopIds",
  "npcIds",
  "mapIds",
  "mobIds",
  "artworkPaths",
]);
const BINARY = [
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
];
const EXPRESSIONS = Object.freeze({
  literal: "value raw",
  undefined: "",
  variable: "name",
  array: "values",
  index: "value index",
  length: "value",
  unary: "operator value",
  binary: "operator left right",
  logical: "operator left right",
  conditional: "test yes no",
  read: "kind args",
});
const STATEMENTS = Object.freeze({
  block: "body",
  if: "test yes no",
  declare: "values",
  assign: "name operator value",
  update: "name delta",
  for: "from variable maxIterations init test update body",
  "call-action": "args",
  dialog:
    "method kind rawType internalType speaker text prev next defaultValue min max minLength maxLength lengthPolicy",
  effect: "kind args overload",
  shop: "shopId translation",
  dispose: "",
  return: "",
  empty: "",
});

function shape(value, fields, required = fields) {
  requireNpc(
    value && typeof value === "object" && !Array.isArray(value),
    "Expected an NPC record",
  );
  const keys = Object.keys(value),
    allowed = fields ? fields.split(" ") : [];
  requireNpc(
    keys.every((key) => allowed.includes(key)),
    "Unknown NPC artifact field",
  );
  for (const key of required ? required.split(" ") : []) {
    requireNpc(Object.hasOwn(value, key), `Missing NPC field ${key}`);
  }
}

function list(value, limit) {
  requireNpc(
    Array.isArray(value) && value.length <= limit,
    "NPC list exceeds its bound",
  );
  return value;
}

/** Check plain data, cycles, depth and aggregate size before structured cloning. */
function boundedCopy(value) {
  const queue = [{ value, depth: 0 }],
    seen = new Set();
  let characters = 0;
  for (let index = 0; index < queue.length; index++) {
    requireNpc(
      queue.length <= LIMITS.analysisSteps,
      "NPC artifact node budget exceeded",
    );
    const entry = queue[index],
      node = entry.value;
    requireNpc(entry.depth <= LIMITS.depth, "NPC artifact depth exceeded");
    if (typeof node === "string") characters += node.length;
    requireNpc(
      characters <= LIMITS.sourceBytes * 16,
      "NPC artifact string budget exceeded",
    );
    if (node === null || typeof node !== "object") {
      requireNpc(
        node === null || ["string", "number", "boolean"].includes(typeof node),
        "NPC artifact is not JSON data",
      );
      if (typeof node === "number") {
        requireNpc(Number.isFinite(node), "Nonfinite NPC artifact number");
      }
      continue;
    }
    requireNpc(!seen.has(node), "Cyclic or aliased NPC artifact");
    seen.add(node);
    requireNpc(
      Array.isArray(node) ||
        Object.getPrototypeOf(node) === Object.prototype ||
        Object.getPrototypeOf(node) === null,
      "NPC artifact has a host prototype",
    );
    const keys = Object.keys(node);
    requireNpc(
      keys.length <= LIMITS.analysisSteps,
      "NPC object budget exceeded",
    );
    if (Array.isArray(node)) {
      requireNpc(keys.length === node.length, "Sparse NPC artifact array");
    }
    for (const key of keys) {
      requireNpc(
        !["__proto__", "constructor", "prototype"].includes(key),
        "Forbidden NPC artifact key",
      );
      const field = Object.getOwnPropertyDescriptor(node, key);
      requireNpc(
        Object.hasOwn(field, "value"),
        "NPC artifact accessor is forbidden",
      );
      queue.push({ value: field.value, depth: entry.depth + 1 });
    }
  }
  return structuredClone(value);
}

function sourceSpan(source) {
  shape(source, "start end line column");
  npcInteger(source.start, 0, LIMITS.sourceBytes);
  npcInteger(source.end, source.start, LIMITS.sourceBytes);
  npcInteger(source.line, 1, LIMITS.sourceBytes);
  npcInteger(source.column, 0, LIMITS.sourceBytes);
}

function ref(id, maximum) {
  npcInteger(id, 0, maximum - 1);
}

function expressionEdges(node) {
  switch (node.op) {
    case "array":
      return node.values;
    case "read":
      return node.args;
    case "unary":
    case "length":
      return [node.value];
    case "index":
      return [node.value, node.index];
    case "binary":
    case "logical":
      return [node.left, node.right];
    case "conditional":
      return [node.test, node.yes, node.no];
    default:
      return [];
  }
}

function validateLiteral(node) {
  requireNpc(
    node.value === null ||
      typeof node.value === "boolean" ||
      Number.isSafeInteger(node.value) ||
      (typeof node.value === "string" &&
        node.value.length <= LIMITS.textLength),
    "Invalid NPC literal",
  );
  requireNpc(
    typeof node.raw === "string" && node.raw.length <= LIMITS.sourceBytes,
    "Missing NPC literal spelling",
  );
}

function validateExpression(node, id, bindings) {
  requireNpc(
    Object.hasOwn(EXPRESSIONS, node?.op),
    "Unknown NPC expression operation",
  );
  const fields = `op source${EXPRESSIONS[node.op] ? ` ${EXPRESSIONS[node.op]}` : ""}`;
  shape(node, fields);
  sourceSpan(node.source);
  for (const edge of expressionEdges(node)) ref(edge, id);
  switch (node.op) {
    case "literal":
      validateLiteral(node);
      break;
    case "variable":
      requireNpc(bindings.has(node.name), "Unknown NPC variable");
      break;
    case "array":
      list(node.values, LIMITS.arrayLength);
      break;
    case "unary":
      requireNpc(
        ["!", "+", "-", "typeof"].includes(node.operator),
        "Unknown NPC unary operator",
      );
      break;
    case "binary":
      requireNpc(BINARY.includes(node.operator), "Unknown NPC binary operator");
      break;
    case "logical":
      requireNpc(
        ["&&", "||"].includes(node.operator),
        "Unknown NPC logical operator",
      );
      break;
    case "read": {
      const spec = Object.hasOwn(NPC_READ_TYPES, node.kind)
        ? NPC_READ_TYPES[node.kind]
        : null;
      requireNpc(spec, "Unknown NPC local read");
      list(node.args, spec[1]);
      requireNpc(node.args.length >= spec[0], "Missing NPC read argument");
      break;
    }
  }
}

function bindingList(values, scope, all) {
  const seen = new Set();
  for (const name of list(values, LIMITS.variables)) {
    requireNpc(
      typeof name === "string" &&
        name.startsWith(`${scope}:`) &&
        /^[A-Za-z_$][\w$]*$/.test(name.slice(scope.length + 1)) &&
        !seen.has(name),
      "Invalid scoped NPC binding",
    );
    seen.add(name);
    all.add(name);
  }
  return seen;
}

function functions(program) {
  shape(program.functions, "start action", "start");
  const all = new Set(),
    scopes = { global: bindingList(program.globals, "global", all) };
  for (const name of Object.keys(program.functions)) {
    const entry = program.functions[name];
    shape(entry, "entry parameters locals");
    ref(entry.entry, program.statements.length);
    scopes[name] = bindingList(entry.locals, name, all);
    const parameters = bindingList(entry.parameters, name, all);
    requireNpc(
      parameters.size <= (name === "start" ? 0 : 3),
      "Invalid NPC callback parameters",
    );
    for (const parameter of parameters) {
      requireNpc(
        scopes[name].has(parameter),
        "NPC parameter missing from locals",
      );
    }
  }
  requireNpc(all.size <= LIMITS.variables, "NPC variable budget exceeded");
  return { all, scopes };
}

function requirement(context, name) {
  requireNpc(context.requirements.has(name), `Missing NPC requirement ${name}`);
}

function validateDialog(node, context) {
  const spec = Object.hasOwn(NPC_DIALOG_TYPES, node.method)
    ? NPC_DIALOG_TYPES[node.method]
    : null;
  requireNpc(spec, "Unknown NPC dialog method");
  for (const key of Object.keys(spec)) {
    requireNpc(
      node[key] === spec[key],
      "Inconsistent NPC raw/internal dialog type",
    );
  }
  npcInteger(node.speaker, 0, 3);
  requirement(context, `dialog:${node.kind}`);
  requirement(context, "rendered-markup-dependencies-closed");
  if (node.kind === "number") {
    npcInteger(node.min);
    npcInteger(node.max, node.min);
    npcInteger(node.defaultValue, node.min, node.max);
  } else if (node.kind === "text") {
    requireNpc(
      node.defaultValue === "" &&
        node.minLength === 0 &&
        node.maxLength === LIMITS.inputLength &&
        node.lengthPolicy ===
          "bounded-browser-input; source-packet-length-fields-zero",
      "Unsupported NPC input policy",
    );
  }
  const options =
    node.kind === "say"
      ? "prev next"
      : node.kind === "number"
        ? "defaultValue min max"
        : node.kind === "text"
          ? "defaultValue minLength maxLength lengthPolicy"
          : "";
  shape(
    node,
    `op source method kind rawType internalType speaker text${options ? ` ${options}` : ""}`,
  );
}

function validateEffect(node, context) {
  const maximum = node.kind === "meso" ? 1 : node.kind === "item" ? 3 : 2;
  requireNpc(
    ["meso", "item", "quest-start", "quest-complete"].includes(node.kind),
    "Unknown NPC effect",
  );
  list(node.args, maximum);
  requireNpc(node.args.length >= 1, "Missing NPC effect argument");
  requirement(context, "atomic-local-turn");
  if (node.kind === "item") {
    requireNpc(
      ["id-show", "id-quantity-show"].includes(node.overload),
      "Unknown NPC item overload",
    );
    if (node.overload === "id-show") {
      requireNpc(node.args.length === 2, "Invalid NPC item show overload");
    }
    requirement(
      context,
      "schema5-item-template-capacity-and-instance-admission",
    );
  } else {
    requireNpc(
      !Object.hasOwn(node, "overload"),
      "Unexpected NPC effect overload",
    );
  }
  if (node.kind.startsWith("quest-")) {
    requirement(
      context,
      "quest-state-only-definition:no-timers-no-custom-progress-no-repeat-counters",
    );
    context.forceQuests = true;
  }
  context.hasEffects = true;
}

function statementEdges(node) {
  if (node.op === "block") return node.body;
  if (node.op === "if") {
    return node.no === null ? [node.yes] : [node.yes, node.no];
  }
  if (node.op === "for") return [node.init, node.body];
  return [];
}

function statementExpressions(node) {
  switch (node.op) {
    case "if":
    case "for":
      return [node.test];
    case "declare":
      return node.values.map((entry) => entry.value);
    case "assign":
      return [node.value];
    case "call-action":
    case "effect":
      return node.args;
    case "dialog":
      return [node.text];
    default:
      return [];
  }
}

function validateLoop(node, program) {
  npcInteger(node.from, 0, LIMITS.loopIterations);
  requireNpc(
    node.maxIterations === LIMITS.loopIterations,
    "Invalid NPC loop budget",
  );
  shape(node.update, "op name delta");
  requireNpc(
    node.update.op === "update" &&
      node.update.name === node.variable &&
      node.update.delta === 1,
    "NPC loop must advance its declared counter",
  );
  validateLoopInitializer(node, program);
  validateLoopTest(node, program);
}

function validateLoopInitializer(node, program) {
  const init = program.statements[node.init];
  requireNpc(
    init?.op === "declare" &&
      init.values?.length === 1 &&
      init.values[0].name === node.variable,
    "NPC loop has an inconsistent initializer",
  );
  const from = program.expressions[init.values[0].value];
  requireNpc(
    from?.op === "literal" && from.value === node.from,
    "NPC loop initializer was altered",
  );
}

function validateLoopTest(node, program) {
  const test = program.expressions[node.test];
  requireNpc(
    test?.op === "binary" &&
      test.operator === "<" &&
      program.expressions[test.left]?.op === "variable" &&
      program.expressions[test.left].name === node.variable,
    "NPC loop has an inconsistent test",
  );
  const bound = program.expressions[test.right];
  requireNpc(
    bound?.op === "length" ||
      (bound?.op === "literal" &&
        Number.isInteger(bound.value) &&
        bound.value >= node.from &&
        bound.value <= LIMITS.loopIterations),
    "NPC loop bound is not canonical",
  );
}

function validateStatement(node, id, context) {
  requireNpc(
    Object.hasOwn(STATEMENTS, node?.op),
    "Unknown NPC statement operation",
  );
  const fields = `op source${STATEMENTS[node.op] ? ` ${STATEMENTS[node.op]}` : ""}`;
  shape(
    node,
    fields,
    node.op === "dialog" || node.op === "effect" ? "op source" : fields,
  );
  sourceSpan(node.source);
  for (const edge of statementEdges(node)) {
    ref(edge, context.program.statements.length);
    requireNpc(edge > id, "Cyclic/backward NPC statement reference");
  }
  for (const edge of statementExpressions(node)) {
    ref(edge, context.program.expressions.length);
  }
  validateStatementOperation(node, context);
}

function validateStatementOperation(node, context) {
  switch (node.op) {
    case "block":
      list(node.body, LIMITS.statements);
      break;
    case "declare":
      validateDeclarations(node.values);
      break;
    case "assign":
      validateAssignment(node, context);
      break;
    case "update":
      requireNpc(
        node.delta === 1 || node.delta === -1,
        "Invalid NPC increment",
      );
      break;
    case "for":
      validateLoop(node, context.program);
      break;
    case "call-action":
      requireNpc(
        list(node.args, 3).length === 3 && context.program.functions.action,
        "Invalid NPC action call",
      );
      break;
    case "dialog":
      validateDialog(node, context);
      break;
    case "effect":
      validateEffect(node, context);
      break;
    case "shop":
      validateShop(node, context);
      break;
  }
}

function validateDeclarations(values) {
  for (const entry of list(values, LIMITS.variables)) {
    shape(entry, "name value");
  }
}

function validateAssignment(node, context) {
  requireNpc(
    ["=", "+=", "-=", "*=", "/=", "%="].includes(node.operator),
    "Unknown NPC assignment",
  );
  if (node.operator !== "=") {
    requirement(context, "finite-checked-scalar-arithmetic");
  }
}

function validateShop(node, context) {
  npcInteger(node.shopId, 1);
  requireNpc(
    context.dependencies.shopIds.has(node.shopId),
    "NPC shop is outside dependency closure",
  );
  requireNpc(
    [
      "cm.openShopNPC(literal)",
      "server.ShopFactory.getInstance().getShop(literal).sendShop(cm.getClient())",
    ].includes(node.translation),
    "Unknown NPC shop translation",
  );
}

function expressionScopes(program, scope, allowed) {
  const valid = new Uint8Array(program.expressions.length);
  for (let id = 0; id < program.expressions.length; id++) {
    const node = program.expressions[id];
    valid[id] =
      node.op !== "variable" ||
      allowed.global.has(node.name) ||
      allowed[scope].has(node.name)
        ? 1
        : 0;
    for (const edge of expressionEdges(node)) if (!valid[edge]) valid[id] = 0;
  }
  return valid;
}

function scopeStatements(context, scopes) {
  const program = context.program,
    owners = new Uint8Array(program.statements.length);
  const roots = [{ entry: program.initial, scope: "global" }];
  for (const scope of Object.keys(program.functions)) {
    roots.push({ entry: program.functions[scope].entry, scope });
  }
  for (const root of roots) {
    scopeRoot({ program, owners, scopes }, root);
  }
  requireNpc(
    owners.every((owner) => owner === 1),
    "Unowned NPC statement",
  );
}

function validateScopedWrites(node, work, scope, scopes) {
  const writes =
    node.op === "declare"
      ? node.values.map((entry) => entry.name)
      : ["assign", "update"].includes(node.op)
        ? [node.name]
        : [];
  for (const name of writes) {
    requireNpc(
      (scopes.global.has(name) || scopes[scope].has(name)) &&
        name !== work.loop,
      "Invalid scoped NPC write or loop counter mutation",
    );
  }
  if (node.op === "call-action") {
    requireNpc(scope === "start", "Recursive/invalid NPC callback call");
  }
  if (node.op === "return") {
    requireNpc(scope !== "global", "NPC return outside a callback");
  }
  if (node.op === "for") {
    requireNpc(work.loop === null, "Nested NPC loops are not admitted");
  }
}

function scopeRoot({ program, owners, scopes }, root) {
  const expressions = expressionScopes(program, root.scope, scopes);
  const queue = [{ id: root.entry, loop: null, depth: 0 }];
  for (let index = 0; index < queue.length; index++) {
    requireNpc(
      queue.length <= LIMITS.statements,
      "NPC statement traversal limit",
    );
    const work = queue[index],
      node = program.statements[work.id];
    requireNpc(
      !owners[work.id] && work.depth <= LIMITS.depth,
      "Shared or too-deep NPC statement",
    );
    owners[work.id] = 1;
    for (const id of statementExpressions(node)) {
      requireNpc(expressions[id], "Cross-scope NPC expression");
    }
    validateScopedWrites(node, work, root.scope, scopes);
    for (const id of statementEdges(node)) {
      queue.push({
        id,
        depth: work.depth + 1,
        loop: node.op === "for" && id === node.body ? node.variable : work.loop,
      });
    }
  }
}

function largest(left, right) {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function sum(left, right) {
  return left === null || right === null ? null : Math.min(2, left + right);
}

function outputSummary(node, summaries, action) {
  if (node.op === "return") return { normal: null, returned: 0 };
  if (node.op === "dialog" || node.op === "shop") {
    return { normal: 1, returned: null };
  }
  if (node.op === "call-action") return { normal: action, returned: null };
  if (node.op === "if") {
    const yes = summaries[node.yes],
      no =
        node.no === null ? { normal: 0, returned: null } : summaries[node.no];
    return {
      normal: largest(yes.normal, no.normal),
      returned: largest(yes.returned, no.returned),
    };
  }
  if (node.op === "for") {
    const body = summaries[node.body],
      normal =
        body.normal === null
          ? 0
          : Math.min(2, body.normal * node.maxIterations);
    return { normal, returned: sum(normal, body.returned) };
  }
  let normal = 0,
    returned = null;
  for (const id of node.op === "block" ? node.body : []) {
    if (normal === null) break;
    returned = largest(returned, sum(normal, summaries[id].returned));
    normal = sum(normal, summaries[id].normal);
  }
  return { normal, returned };
}

function validateOutputs(program) {
  const summaries = new Array(program.statements.length);
  let action = 0;
  // Lowered source roots are initial, start, action in source declaration order.
  // Two fixed passes resolve start->action even when action precedes start in source.
  for (let pass = 0; pass < 2; pass++) {
    for (let id = program.statements.length - 1; id >= 0; id--) {
      summaries[id] = outputSummary(program.statements[id], summaries, action);
    }
    const result = program.functions.action
      ? summaries[program.functions.action.entry]
      : null;
    action = result ? (largest(result.normal, result.returned) ?? 0) : 0;
  }
  const initial = summaries[program.initial],
    start = summaries[program.functions.start.entry];
  requireNpc(
    action <= 1 &&
      (largest(initial.normal, initial.returned) ?? 0) +
        (largest(start.normal, start.returned) ?? 0) <=
        1,
    "NPC callback can emit multiple views",
  );
}

function envelope(input) {
  requireNpc(
    input?.status === "supported" && input.program && input.source,
    "NPC source route is not completely supported",
    "npc-unsupported",
  );
  requireNpc(
    Array.isArray(input.blockers) && input.blockers.length === 0,
    "NPC route retains source blockers",
  );
  // Routing/SQL metadata is owned by the router; copy only this execution envelope.
  return boundedCopy({
    source: input.source,
    program: input.program,
    requirements: input.requirements,
    dependencies: input.dependencies,
  });
}

function admitDependencies(value) {
  shape(value, NPC_DEPENDENCY_FAMILIES.join(" "));
  const result = {};
  for (const family of NPC_DEPENDENCY_FAMILIES) {
    const ids = list(value[family], LIMITS.dependencies),
      seen = new Set();
    for (const id of ids) {
      if (family === "artworkPaths") {
        requireNpc(validNpcArtworkPath(id), "Invalid NPC artwork dependency");
      } else npcInteger(id, 1);
      requireNpc(!seen.has(id), "Duplicate NPC dependency");
      seen.add(id);
    }
    result[family] = seen;
  }
  return result;
}

function freezeArtifact(value) {
  const queue = [value];
  for (let index = 0; index < queue.length; index++) {
    requireNpc(
      queue.length <= LIMITS.analysisSteps,
      "NPC freeze budget exceeded",
    );
    const node = queue[index];
    if (!node || typeof node !== "object") continue;
    Object.freeze(node);
    for (const child of Object.values(node)) {
      if (child && typeof child === "object") queue.push(child);
    }
  }
}

function validateExpressions(program, bindings) {
  const depths = new Uint16Array(program.expressions.length);
  let edges = 0;
  for (let id = 0; id < program.expressions.length; id++) {
    const node = program.expressions[id];
    validateExpression(node, id, bindings);
    depths[id] = 1;
    for (const edge of expressionEdges(node)) {
      requireNpc(
        ++edges <= LIMITS.analysisSteps,
        "NPC expression edge budget exceeded",
      );
      depths[id] = Math.max(depths[id], depths[edge] + 1);
    }
    requireNpc(
      depths[id] <= LIMITS.depth,
      "NPC expression depth exceeds admission",
    );
  }
}

function validateProvenanceAndSemantics(artifact) {
  const program = artifact.program;
  shape(artifact.source, "path sha256");
  requireNpc(
    typeof artifact.source.path === "string" &&
      artifact.source.path.length > 0 &&
      artifact.source.path.length <= 4096 &&
      /^[a-f0-9]{64}$/.test(artifact.source.sha256),
    "Invalid NPC source provenance",
  );
  shape(
    program,
    "schemaVersion initial functions globals expressions statements limits sourceOffsetUnit valueSemantics turnSemantics",
  );
  requireNpc(
    program.schemaVersion === 1 &&
      program.sourceOffsetUnit === "utf16-code-unit" &&
      program.valueSemantics ===
        "bounded-primitives-and-immutable-arrays; integer-index-only; lazy-logical-and-conditional" &&
      program.turnSemantics ===
        "run-callback-to-completion-then-atomically-commit-before-publishing-view",
    "Unknown NPC IR semantics",
  );
  shape(program.limits, Object.keys(LIMITS).join(" "));
  for (const key of Object.keys(LIMITS)) {
    requireNpc(
      program.limits[key] === LIMITS[key],
      "Altered NPC execution limits",
    );
  }
  list(program.expressions, LIMITS.expressions);
  list(program.statements, LIMITS.statements);
  ref(program.initial, program.statements.length);
}

/** Structural/source-contract admission, not a signature: router authenticates packaged bytes. */
export function admitNpcScript(input) {
  const artifact = envelope(input),
    program = artifact.program;
  validateProvenanceAndSemantics(artifact);
  const requirements = new Set(
    list(artifact.requirements, NPC_SCRIPT_REQUIREMENTS.length),
  );
  requireNpc(
    requirements.size === artifact.requirements.length,
    "Duplicate NPC requirement",
  );
  for (const name of requirements) {
    requireNpc(
      NPC_SCRIPT_REQUIREMENTS.includes(name),
      `Unsupported NPC requirement ${name}`,
    );
  }
  const context = {
    program,
    requirements,
    dependencies: admitDependencies(artifact.dependencies),
    source: artifact.source,
    hasEffects: false,
    forceQuests: false,
  };
  const bindings = functions(program);
  validateExpressions(program, bindings.all);
  for (let id = 0; id < program.statements.length; id++) {
    validateStatement(program.statements[id], id, context);
  }
  scopeStatements(context, bindings.scopes);
  validateOutputs(program);
  validateNpcReferences(context);
  freezeArtifact(artifact);
  return context;
}
