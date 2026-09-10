import {
  NPC_DIALOG_METHODS,
  NPC_SCRIPT_LIMITS,
  addDependency,
  blockScript,
  cmMethod,
  dependencySets,
  integerLiteral,
  parseNpcSource,
  resolveVariable,
  sourceSpan,
} from "./npc-script-ir.js";
import {
  collectConcatenationDependencies,
  collectExpressionDependencies,
  collectLoopBounds,
  compileExpression,
} from "./npc-script-expressions.js";
import {
  boundedLoop,
  inspectScopes,
  staticJavaShop,
} from "./npc-script-scope.js";
import { validateCallbackOutputs } from "./npc-script-flow.js";
import { collectArtworkDependencies } from "./npc-script-artwork.js";

const EFFECTS = Object.freeze({
  gainMeso: { kind: "meso", min: 1, max: 1 },
  gainItem: { kind: "item", min: 1, max: 3, dependency: "itemIds" },
  forceStartQuest: {
    kind: "quest-start",
    min: 1,
    max: 2,
    dependency: "questIds",
  },
  startQuest: { kind: "quest-start", min: 1, max: 2, dependency: "questIds" },
  forceCompleteQuest: {
    kind: "quest-complete",
    min: 1,
    max: 2,
    dependency: "questIds",
  },
  completeQuest: {
    kind: "quest-complete",
    min: 1,
    max: 2,
    dependency: "questIds",
  },
});

function compilerContext(text, source) {
  return {
    text,
    source,
    blockers: [],
    astNodes: 0,
    analysisSteps: 0,
    scopes: new Map([["global", new Map()]]),
    functions: new Map(),
    variables: [],
    parents: new WeakMap(),
    nodeScopes: new WeakMap(),
    expressionRefs: new WeakMap(),
    expressions: [],
    statements: [],
    assignments: new Map(),
    dependencies: dependencySets(),
    dependencyRequests: [],
    concatenations: [],
    loopBounds: [],
    requirements: new Set(),
    unboundedAssignments: new Set(),
  };
}

function rememberAssignment(context, name, value) {
  if (!context.assignments.has(name)) context.assignments.set(name, []);
  context.assignments.get(name).push(value);
}

function declarationStatement(context, scope, node) {
  const values = [];
  for (const declaration of node.declarations) {
    const variable = resolveVariable(context, scope, declaration.id);
    if (!variable || variable.host || !declaration.init) continue;
    const value = compileExpression(context, scope, declaration.init);
    values.push({ name: variable.key, value });
    rememberAssignment(context, variable.key, value);
  }
  return { op: "declare", values };
}

function assignmentStatement(context, scope, node) {
  const target =
    node.type === "AssignmentExpression" ? node.left : node.argument;
  const variable = resolveVariable(context, scope, target);
  if (!variable || variable.host || variable.kind === "const") {
    blockScript(
      context,
      node,
      "Only mutable local scalar/array bindings may be assigned",
    );
    return { op: "unsupported" };
  }
  if (
    node.type === "UpdateExpression" &&
    ["++", "--"].includes(node.operator)
  ) {
    context.unboundedAssignments.add(variable.key);
    return {
      op: "update",
      name: variable.key,
      delta: node.operator === "++" ? 1 : -1,
    };
  }
  if (!["=", "+=", "-=", "*=", "/=", "%="].includes(node.operator)) {
    blockScript(
      context,
      node,
      `Unsupported assignment operator: ${node.operator}`,
    );
    return { op: "unsupported" };
  }
  const value = compileExpression(context, scope, node.right);
  if (node.operator === "=") rememberAssignment(context, variable.key, value);
  else {
    if (node.operator === "+=") {
      context.concatenations.push({
        left: compileExpression(context, scope, target),
        right: value,
        node,
      });
      rememberAssignment(context, variable.key, value);
    }
    context.unboundedAssignments.add(variable.key);
    context.requirements.add("finite-checked-scalar-arithmetic");
  }
  return { op: "assign", name: variable.key, operator: node.operator, value };
}

function numberOptions(context, node) {
  const bounds = node.arguments.slice(1).map(integerLiteral);
  if (
    bounds.length !== 3 ||
    bounds.some(
      (value) => value === null || value < -2147483648 || value > 2147483647,
    )
  ) {
    blockScript(
      context,
      node,
      "Number prompt requires literal signed-int default/min/max",
    );
  } else if (bounds[1] > bounds[0] || bounds[0] > bounds[2]) {
    blockScript(
      context,
      node,
      "Authored number default is outside min/max; native normalization is not represented",
    );
  }
  return {
    speaker: 0,
    defaultValue: bounds[0],
    min: bounds[1],
    max: bounds[2],
  };
}

function promptOptions(context, node, kind) {
  const args = node.arguments;
  if (kind === "number") return numberOptions(context, node);
  if (kind === "text") {
    if (args.length !== 1) {
      blockScript(context, node, "Unsupported sendGetText overload");
    }
    return {
      speaker: 0,
      defaultValue: "",
      minLength: 0,
      maxLength: NPC_SCRIPT_LIMITS.inputLength,
      lengthPolicy: "bounded-browser-input; source-packet-length-fields-zero",
    };
  }
  if (args.length < 1 || args.length > 2) {
    blockScript(context, node, "Unsupported speaker prompt overload");
  }
  const speaker = args.length === 2 ? integerLiteral(args[1]) : 0;
  if (speaker === null || speaker < 0 || speaker > 3) {
    blockScript(
      context,
      node,
      "Speaker must be a literal NPC protocol value 0..3",
    );
  }
  return { speaker };
}

function dialogStatement(context, scope, node, spec) {
  const options = promptOptions(context, node, spec.kind),
    text = node.arguments[0];
  if (!text) blockScript(context, node, "Missing authored dialog text");
  context.requirements.add(`dialog:${spec.kind}`);
  context.requirements.add("rendered-markup-dependencies-closed");
  return {
    op: "dialog",
    method: cmMethod(node),
    ...spec,
    ...options,
    text: text ? compileExpression(context, scope, text) : null,
  };
}

function itemEffect(context, node, refs) {
  const args = node.arguments,
    last = args.at(-1);
  const showOnly =
    args.length === 2 &&
    last.type === "Literal" &&
    typeof last.value === "boolean";
  if (
    args.length === 3 &&
    (last.type !== "Literal" || typeof last.value !== "boolean")
  ) {
    blockScript(
      context,
      node,
      "gainItem show-message flag must be a literal boolean",
    );
  }
  const quantity = args.length === 1 || showOnly ? 1 : integerLiteral(args[1]);
  context.dependencyRequests.push({
    kind: "itemIds",
    expression: refs[0],
    node,
    plainGrant: quantity === null || quantity >= 0,
  });
  context.requirements.add(
    "schema5-item-template-capacity-and-instance-admission",
  );
  return {
    op: "effect",
    kind: "item",
    args: refs,
    overload: showOnly ? "id-show" : "id-quantity-show",
  };
}

function effectStatement(context, scope, node, spec) {
  const args = node.arguments;
  if (args.length < spec.min || args.length > spec.max) {
    blockScript(context, node, "Unsupported local effect overload");
  }
  const refs = args.map((argument) =>
    compileExpression(context, scope, argument),
  );
  context.requirements.add("atomic-local-turn");
  if (spec.kind === "item") return itemEffect(context, node, refs);
  if (spec.dependency && refs.length) {
    context.dependencyRequests.push({
      kind: spec.dependency,
      expression: refs[0],
      node,
    });
  }
  if (spec.kind.startsWith("quest-")) {
    if (refs.length === 2) {
      context.dependencyRequests.push({
        kind: "npcIds",
        expression: refs[1],
        node,
      });
    }
    context.requirements.add(
      "quest-state-only-definition:no-timers-no-custom-progress-no-repeat-counters",
    );
  }
  return { op: "effect", kind: spec.kind, args: refs };
}

function continuationCall(context, scope, node) {
  if (node.callee.type !== "Identifier" || node.callee.name !== "action") {
    return null;
  }
  if (
    scope !== "start" ||
    !context.functions.has("action") ||
    node.arguments.length !== 3
  ) {
    return null;
  }
  return {
    op: "call-action",
    args: node.arguments.map((argument) =>
      compileExpression(context, scope, argument),
    ),
  };
}

function terminalCall(context, node, method) {
  if (method === "dispose" && node.arguments.length === 0) {
    return { op: "dispose" };
  }
  if (method !== "openShopNPC" || node.arguments.length !== 1) return null;
  const shopId = integerLiteral(node.arguments[0]);
  addDependency(context, "shopIds", shopId, node);
  return { op: "shop", shopId, translation: "cm.openShopNPC(literal)" };
}

function callStatement(context, scope, node) {
  const javaShop = staticJavaShop(context, scope, node);
  if (javaShop) {
    addDependency(context, "shopIds", javaShop.shopId, node);
    return { op: "shop", ...javaShop };
  }
  const method = cmMethod(node);
  if (Object.hasOwn(NPC_DIALOG_METHODS, method)) {
    return dialogStatement(context, scope, node, NPC_DIALOG_METHODS[method]);
  }
  if (Object.hasOwn(EFFECTS, method)) {
    return effectStatement(context, scope, node, EFFECTS[method]);
  }
  const terminal =
    terminalCall(context, node, method) ??
    continuationCall(context, scope, node);
  if (terminal) return terminal;
  blockScript(
    context,
    node,
    `Unsupported statement call: ${method ?? context.text.slice(node.callee.start, node.callee.end)}`,
  );
  return { op: "unsupported" };
}

function expressionStatement(context, scope, node) {
  const expression = node.expression;
  if (["AssignmentExpression", "UpdateExpression"].includes(expression.type)) {
    return assignmentStatement(context, scope, expression);
  }
  if (expression.type === "CallExpression") {
    return callStatement(context, scope, expression);
  }
  if (expression.type === "Literal" && typeof expression.value === "string") {
    blockScript(
      context,
      node,
      "Script directives are unsupported; semantics must not be changed by dropping them",
    );
    return { op: "unsupported" };
  }
  blockScript(
    context,
    node,
    `Unsupported expression statement: ${expression.type}`,
  );
  return { op: "unsupported" };
}

function childStatement(context, work, node) {
  if (!node) return null;
  if (context.statements.length >= NPC_SCRIPT_LIMITS.statements) {
    throw new Error("NPC statement limit");
  }
  const id = context.statements.length;
  context.statements.push(null);
  work.push({ node, id });
  return id;
}

function controlStatement(context, work, node, scope) {
  if (node.type === "BlockStatement" || node.type === "Program") {
    return {
      op: "block",
      body: node.body
        .filter((child) => child.type !== "FunctionDeclaration")
        .map((child) => childStatement(context, work, child)),
    };
  }
  if (node.type === "IfStatement") {
    return {
      op: "if",
      test: compileExpression(context, scope, node.test),
      yes: childStatement(context, work, node.consequent),
      no: childStatement(context, work, node.alternate),
    };
  }
  if (node.type === "ForStatement") {
    const loop = boundedLoop(context, scope, node);
    if (!loop) {
      blockScript(
        context,
        node,
        "Only canonical finite literal/array menu-building for loops are supported",
      );
    }
    if (loop && node.test.right.type === "MemberExpression") {
      context.loopBounds.push({
        expression: compileExpression(context, scope, node.test.right.object),
        node,
      });
    }
    return {
      op: "for",
      ...loop,
      init: childStatement(context, work, node.init),
      test: node.test ? compileExpression(context, scope, node.test) : null,
      update: node.update
        ? assignmentStatement(context, scope, node.update)
        : null,
      body: childStatement(context, work, node.body),
    };
  }
  return null;
}

function leafStatement(context, scope, node) {
  if (node.type === "VariableDeclaration") {
    return declarationStatement(context, scope, node);
  }
  if (node.type === "ExpressionStatement") {
    return expressionStatement(context, scope, node);
  }
  if (node.type === "EmptyStatement") return { op: "empty" };
  if (node.type === "ReturnStatement" && !node.argument) {
    return { op: "return" };
  }
  blockScript(context, node, `Unsupported statement: ${node.type}`);
  return { op: "unsupported" };
}

function compileBody(context, root) {
  const work = [],
    entry = childStatement(context, work, root);
  for (let index = 0; index < work.length; index++) {
    const { node, id } = work[index],
      scope = context.nodeScopes.get(node) ?? "global";
    const record =
      controlStatement(context, work, node, scope) ??
      leafStatement(context, scope, node);
    context.statements[id] = { ...record, source: sourceSpan(node) };
  }
  return entry;
}

function compiledProgram(context, root) {
  const initial = compileBody(context, root),
    functions = {};
  for (const [name, node] of context.functions) {
    functions[name] = {
      entry: compileBody(context, node.body),
      parameters: node.params.map(
        (parameter) =>
          context.scopes.get(name).get(parameter.name)?.key ?? null,
      ),
      locals: [...context.scopes.get(name).values()]
        .filter((variable) => !variable.host)
        .map((variable) => variable.key),
    };
  }
  collectConcatenationDependencies(context);
  collectExpressionDependencies(context);
  collectLoopBounds(context);
  collectArtworkDependencies(context);
  return {
    schemaVersion: 1,
    initial,
    functions,
    globals: context.variables
      .filter((variable) => variable.scope === "global" && !variable.host)
      .map((variable) => variable.key),
    expressions: context.expressions,
    statements: context.statements,
    limits: NPC_SCRIPT_LIMITS,
    sourceOffsetUnit: "utf16-code-unit",
    valueSemantics:
      "bounded-primitives-and-immutable-arrays; integer-index-only; lazy-logical-and-conditional",
    turnSemantics:
      "run-callback-to-completion-then-atomically-commit-before-publishing-view",
  };
}

/** Complete-source closed-world compilation; any blocker removes the entire executable IR. */
export function compileNpcScript(input) {
  const { text, path, sha256 } = input;
  const context = compilerContext(text, { path, sha256 });
  let program = null;
  try {
    const root = parseNpcSource(text);
    inspectScopes(context, root);
    program = compiledProgram(context, root);
    if (!context.blockers.length) {
      validateCallbackOutputs(context, program, root);
    }
  } catch (error) {
    context.blockers.push({
      source: path,
      start: error.pos ?? 0,
      end: error.pos ?? 0,
      line: error.loc?.line ?? 1,
      column: error.loc?.column ?? 0,
      reason: `Complete-source compilation failed: ${error.message}`,
    });
  }
  return {
    schemaVersion: 1,
    source: { path, sha256 },
    status: context.blockers.length ? "blocked" : "supported",
    blockers: context.blockers,
    astNodes: context.astNodes,
    requirements: [...context.requirements].sort(),
    dependencies: Object.fromEntries(
      Object.entries(context.dependencies).map(([kind, values]) => [
        kind,
        kind === "artworkPaths"
          ? [...values].sort()
          : [...values].sort((a, b) => a - b),
      ]),
    ),
    program: context.blockers.length ? null : program,
  };
}
