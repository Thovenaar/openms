import {
  NPC_SCRIPT_LIMITS,
  astInventory,
  cmMethod,
  integerLiteral,
  member,
  playerMethod,
  spendAnalysisStep,
} from "./npc-script-ir.js";

/** Copy syntax iteratively, substituting only value identifiers (never property names). */
function substitute(context, root, bindings) {
  const copies = new Map();
  const nodes = astInventory(root);
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    spendAnalysisStep(context, node);
    if (node.type === "Identifier" && bindings.has(node.name)) {
      copies.set(node, bindings.get(node.name));
      continue;
    }
    const copy = { ...node };
    for (const [key, value] of Object.entries(node)) {
      if (key === "property" && !node.computed) continue;
      if (Array.isArray(value)) {
        copy[key] = value.map((child) => copies.get(child) ?? child);
      } else if (copies.has(value)) copy[key] = copies.get(value);
    }
    copies.set(node, copy);
  }
  return copies.get(root);
}

function literal(node, value) {
  return {
    type: "Literal",
    value,
    start: node.start,
    end: node.end,
    loc: node.loc,
  };
}

function condition(node, test, yes, no) {
  return {
    type: "ConditionalExpression",
    test,
    consequent: yes,
    alternate: no,
    start: node.start,
    end: node.end,
    loc: node.loc,
  };
}

function loopVariable(node) {
  const init = node.init;
  if (
    init?.type !== "VariableDeclaration" ||
    init.kind !== "var" ||
    init.declarations.length !== 1
  ) {
    throw new Error("Helper loop requires one var initializer");
  }
  const declaration = init.declarations[0];
  if (declaration.id.type !== "Identifier") {
    throw new Error("Helper loop requires an identifier counter");
  }
  return { name: declaration.id.name, from: integerLiteral(declaration.init) };
}

function validateLoopCounter(node, name) {
  const test = node.test,
    update = node.update;
  if (
    test?.type !== "BinaryExpression" ||
    test.operator !== "<" ||
    test.left.name !== name ||
    update?.type !== "UpdateExpression" ||
    update.operator !== "++" ||
    update.argument.name !== name
  ) {
    throw new Error(
      "Helper loop requires a canonical counter comparison and update",
    );
  }
}

function loopIterations(node, arrays) {
  const { name, from } = loopVariable(node);
  validateLoopCounter(node, name);
  const end = member(node.test.right, "length")
    ? arrays.get(node.test.right.object.name)
    : integerLiteral(node.test.right);
  if (
    from === null ||
    !Number.isSafeInteger(end) ||
    from < 0 ||
    end < from ||
    end - from > NPC_SCRIPT_LIMITS.loopIterations
  ) {
    throw new Error(
      "Helper loop requires a finite canonical literal-array bound",
    );
  }
  return { name, from, end };
}

function expandLoop(node, arrays) {
  const loop = loopIterations(node, arrays),
    statements = [];
  for (let index = loop.from; index <= loop.end; index++) {
    statements.push({
      ...node.init,
      declarations: [
        { ...node.init.declarations[0], init: literal(node, index) },
      ],
    });
    if (index < loop.end) statements.push(node.body);
  }
  return statements;
}

function helperBindings(helper, prefix) {
  const bindings = new Map();
  for (const parameter of helper.params) {
    addHelperBinding(bindings, parameter, prefix);
  }
  for (const node of astInventory(helper.body)) {
    if (node.type === "VariableDeclarator") {
      addHelperBinding(bindings, node.id, prefix);
    }
  }
  return bindings;
}

function addHelperBinding(bindings, node, prefix) {
  if (
    node.type !== "Identifier" ||
    bindings.has(node.name) ||
    ["cm", "Array", "undefined"].includes(node.name)
  ) {
    throw new Error(
      "Helper bindings require distinct function-scoped identifiers",
    );
  }
  if (bindings.size >= NPC_SCRIPT_LIMITS.variables) {
    throw new Error("Helper binding limit");
  }
  bindings.set(node.name, {
    ...node,
    type: "NpcHelperValue",
    name: `${prefix}:${node.name}`,
  });
}

function helperValue(context, node, bindings) {
  const value = substitute(context, node, bindings);
  for (const child of astInventory(value)) {
    if (child.type === "Identifier") child.npcGlobal = true;
  }
  return value;
}

function helperDeclarations(context, frame, node, bindings) {
  if (node.kind !== "var") throw new Error("Helper locals require var");
  for (const declaration of node.declarations) {
    if (declaration.id.type !== "Identifier" || !declaration.init) {
      throw new Error("Helper locals require initialized identifiers");
    }
    const value = {
      ...declaration,
      type: "NpcHelperSet",
      name: bindings.get(declaration.id.name).name,
      value: helperValue(context, declaration.init, bindings),
      body: null,
    };
    delete value.id;
    delete value.init;
    frame.target[frame.key] = value;
    frame.target = value;
    frame.key = "body";
  }
}

/** Build lazy control edges, but retain every argument, initializer and test evaluation. */
function lowerHelper(context, helper, args, options) {
  const { arrays, prefix } = options,
    bindings = helperBindings(helper, prefix);
  const result = {
    ...helper,
    type: "NpcHelperExpression",
    args,
    bindings: [...bindings.values()].map((binding) => binding.name),
    body: null,
  };
  delete result.id;
  delete result.params;
  const queue = [{ body: helper.body.body, target: result, key: "body" }];
  for (let index = 0; index < queue.length; index++) {
    if (queue.length > NPC_SCRIPT_LIMITS.nodes) {
      throw new Error("Helper path limit exceeded");
    }
    lowerHelperFrame(context, queue[index], { queue, bindings, arrays });
  }
  return result;
}

function lowerHelperFrame(context, frame, paths) {
  const { queue, bindings, arrays } = paths;
  if (!frame.body.length) {
    throw new Error("Pure helper must return on every path");
  }
  const node = frame.body[0];
  spendAnalysisStep(context, node);
  frame.body = frame.body.slice(1);
  switch (node.type) {
    case "ReturnStatement":
      if (!node.argument) throw new Error("Helper requires a return value");
      frame.target[frame.key] = helperValue(context, node.argument, bindings);
      return;
    case "IfStatement": {
      const value = condition(
        node,
        helperValue(context, node.test, bindings),
        null,
        null,
      );
      frame.target[frame.key] = value;
      queue.push({
        body: [node.consequent, ...frame.body],
        target: value,
        key: "consequent",
      });
      queue.push({
        body: node.alternate ? [node.alternate, ...frame.body] : frame.body,
        target: value,
        key: "alternate",
      });
      return;
    }
    case "BlockStatement":
      frame.body = [...node.body, ...frame.body];
      break;
    case "ForStatement":
      frame.body = [...expandLoop(node, arrays), ...frame.body];
      break;
    case "VariableDeclaration":
      helperDeclarations(context, frame, node, bindings);
      break;
    default:
      throw new Error(`Unsupported pure helper statement: ${node.type}`);
  }
  queue.push(frame);
}

function pureExpressions(root, helpers) {
  for (const node of astInventory(root)) {
    if (
      [
        "AssignmentExpression",
        "UpdateExpression",
        "AwaitExpression",
        "YieldExpression",
        "NewExpression",
      ].includes(node.type)
    ) {
      return false;
    }
    if (node.type !== "CallExpression") continue;
    if (node.callee.type === "Identifier" && helpers.has(node.callee.name)) {
      continue;
    }
    if (!pureHostRead(node)) return false;
  }
  return true;
}

function pureHostRead(node) {
  if (node.arguments.length) return false;
  if (["getMapId", "getPlayer"].includes(cmMethod(node))) return true;
  return playerMethod(node) === "getMapId";
}

/** Keep the existing argument/initializer syntax boundary; values need not be total. */
function boundedHelperValue(root) {
  if (!root) return false;
  const nodes = astInventory(root),
    receivers = new Set();
  for (const node of nodes) {
    if (node.type !== "CallExpression") continue;
    if (!pureHostRead(node)) return false;
    receivers.add(node.callee);
  }
  return nodes.every((node) => boundedHelperNode(node, receivers));
}

function boundedHelperNode(node, receivers) {
  if (node.type === "Literal") {
    if (node.regex || node.bigint) return false;
    if (typeof node.value === "number") return Number.isSafeInteger(node.value);
    if (typeof node.value === "string") {
      return node.value.length <= NPC_SCRIPT_LIMITS.textLength;
    }
    return node.value === null || typeof node.value === "boolean";
  }
  if (node.type === "ArrayExpression") {
    return (
      node.elements.length <= NPC_SCRIPT_LIMITS.arrayLength &&
      !node.elements.includes(null)
    );
  }
  return (
    ["Identifier", "NpcHelperValue", "CallExpression"].includes(node.type) ||
    (node.type === "MemberExpression" && receivers.has(node))
  );
}

function validateEagerHelperValues(node, helpers) {
  if (node.type === "VariableDeclarator" && !boundedHelperValue(node.init)) {
    throw new Error("Helper initializer requires a bounded value");
  }
  if (
    node.type === "CallExpression" &&
    helpers.has(node.callee.name) &&
    node.arguments.some((argument) => !boundedHelperValue(argument))
  ) {
    throw new Error("Helper arguments require bounded values");
  }
}

/** Validate complete authored helpers before lowering into checked evaluation frames. */
function validateHelper(context, helper, helpers) {
  const nodes = astInventory(helper);
  const updates = new Set(
    nodes
      .filter((node) => node.type === "ForStatement")
      .map((node) => node.update),
  );
  const allowed = HELPER_SYNTAX;
  for (const node of nodes) {
    spendAnalysisStep(context, node);
    if (
      !allowed.has(node.type) ||
      (node.type === "FunctionDeclaration" && node !== helper) ||
      (node.type === "UpdateExpression" && !updates.has(node))
    ) {
      throw new Error("Unsupported pure helper syntax");
    }
    if (node.type === "CallExpression" && !pureExpressions(node, helpers)) {
      throw new Error("Helper host effects are unsupported");
    }
    validateHelperOperator(node);
    validateEagerHelperValues(node, helpers);
  }
}

const HELPER_SYNTAX = new Set([
  "FunctionDeclaration",
  "Identifier",
  "BlockStatement",
  "ReturnStatement",
  "IfStatement",
  "ForStatement",
  "VariableDeclaration",
  "VariableDeclarator",
  "Literal",
  "ArrayExpression",
  "MemberExpression",
  "CallExpression",
  "BinaryExpression",
  "LogicalExpression",
  "ConditionalExpression",
  "UnaryExpression",
  "UpdateExpression",
]);

function validateHelperOperator(node) {
  if (
    node.type === "BinaryExpression" &&
    ![
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
      "instanceof",
    ].includes(node.operator)
  ) {
    throw new Error("Unsupported helper operator");
  }
  if (
    node.type === "UnaryExpression" &&
    !["!", "+", "-", "typeof"].includes(node.operator)
  ) {
    throw new Error("Unsupported helper unary operator");
  }
}

function helperInventory(root) {
  const helpers = new Map(),
    arrays = new Map();
  for (const node of root.body) {
    if (
      node.type === "FunctionDeclaration" &&
      !["start", "action"].includes(node.id?.name) &&
      astInventory(node.body).some(
        (child) => child.type === "ReturnStatement" && child.argument,
      )
    ) {
      if (helpers.has(node.id.name)) {
        throw new Error("Duplicate helper declaration");
      }
      helpers.set(node.id.name, node);
    }
    if (node.type !== "VariableDeclaration") continue;
    for (const entry of node.declarations) {
      if (entry.init?.type === "ArrayExpression") {
        arrays.set(entry.id.name, entry);
      }
    }
  }
  return { helpers, arrays };
}

function functionLocals(node) {
  const names = new Set(node.params.map((parameter) => parameter.name));
  for (const child of astInventory(node.body)) {
    if (child.type === "VariableDeclarator") names.add(child.id.name);
  }
  return names;
}

function arrayBindingTarget(node) {
  if (node.type === "VariableDeclarator") return node.id;
  if (!["AssignmentExpression", "UpdateExpression"].includes(node.type)) {
    return null;
  }
  let target = node.left ?? node.argument;
  for (
    let depth = 0;
    target.type === "MemberExpression" && depth < NPC_SCRIPT_LIMITS.depth;
    depth++
  ) {
    target = target.object;
  }
  return target;
}

function immutableArrayBounds(context, root, arrays) {
  const bounds = new Map();
  for (const [name, declaration] of arrays) {
    bounds.set(name, declaration.init.elements.length);
  }
  for (const statement of root.body) {
    const locals =
      statement.type === "FunctionDeclaration"
        ? functionLocals(statement)
        : new Set();
    for (const node of astInventory(statement)) {
      spendAnalysisStep(context, node);
      const target = arrayBindingTarget(node);
      if (
        !target ||
        locals.has(target.name) ||
        arrays.get(target.name) === node
      ) {
        continue;
      }
      bounds.delete(target.name);
    }
  }
  return bounds;
}

function validateHelperBindings(root, helpers) {
  for (const node of astInventory(root)) {
    if (
      (node.type === "VariableDeclarator" && helpers.has(node.id?.name)) ||
      (node.type === "AssignmentExpression" && helpers.has(node.left?.name)) ||
      (node.type === "FunctionDeclaration" &&
        node.params.some((parameter) => helpers.has(parameter.name)))
    ) {
      throw new Error("Helper bindings cannot be shadowed or reassigned");
    }
  }
}

function helperBounds(context, helpers, arrays) {
  const bounds = new Map();
  for (const [name, helper] of helpers) {
    if (
      helper.async ||
      helper.generator ||
      helper.params.some((parameter) => parameter.type !== "Identifier")
    ) {
      throw new Error("Helper requires synchronous identifier parameters");
    }
    validateHelper(context, helper, helpers);
    const localBounds = new Map(arrays);
    for (const local of functionLocals(helper)) localBounds.delete(local);
    // Validate even unused helpers; no discarded body can hide unsupported syntax.
    lowerHelper(context, helper, helper.params, {
      arrays: localBounds,
      prefix: "validation",
    });
    bounds.set(name, localBounds);
  }
  return bounds;
}

function replaceHelperCall(context, node, helper, lowering) {
  if (
    node.arguments.length !== helper.params.length ||
    node.arguments.some((arg) => !boundedHelperValue(arg))
  ) {
    throw new Error(
      "Helper arguments must be bounded values and match declared parameters",
    );
  }
  const value = lowerHelper(context, helper, node.arguments, {
    arrays: lowering.bounds.get(node.callee.name),
    prefix: `helper#${lowering.nextBinding++}`,
  });
  for (const key of Object.keys(node)) delete node[key];
  Object.assign(node, value);
}

function replaceHelperPass(context, result, lowering) {
  let changed = false;
  const nodes = astInventory(result);
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    if (node.type !== "CallExpression" || node.callee.type !== "Identifier") {
      continue;
    }
    const helper = lowering.helpers.get(node.callee.name);
    if (!helper) continue;
    replaceHelperCall(context, node, helper, lowering);
    changed = true;
  }
  return changed;
}

function validateAcyclicHelpers(context, helpers) {
  const pending = new Map();
  for (const [name, helper] of helpers) {
    const calls = new Set();
    for (const node of astInventory(helper)) {
      spendAnalysisStep(context, node);
      if (node.type === "CallExpression" && helpers.has(node.callee.name)) {
        calls.add(node.callee.name);
      }
    }
    pending.set(name, calls);
  }
  const finished = new Set();
  for (let pass = 0; pass < helpers.size; pass++) {
    for (const [name, calls] of pending) {
      spendAnalysisStep(context, helpers.get(name));
      if (helperCallsResolved(context, calls, finished, helpers.get(name))) {
        finished.add(name);
        pending.delete(name);
      }
    }
    if (!pending.size) return;
  }
  throw new Error("Recursive helper calls are unsupported");
}

function helperCallsResolved(context, calls, finished, helper) {
  for (const callee of calls) {
    spendAnalysisStep(context, helper);
    if (!finished.has(callee)) return false;
  }
  return true;
}

export function lowerNpcHelpers(context, root) {
  const { helpers, arrays } = helperInventory(root);
  if (!helpers.size) return root;
  validateHelperBindings(root, helpers);
  validateAcyclicHelpers(context, helpers);
  const bounds = immutableArrayBounds(context, root, arrays);
  const helperArrayBounds = helperBounds(context, helpers, bounds);
  const result = {
    ...root,
    body: root.body.filter((node) => !helpers.has(node.id?.name)),
  };
  const lowering = { helpers, bounds: helperArrayBounds, nextBinding: 0 };
  for (let pass = 0; pass <= helpers.size; pass++) {
    if (!replaceHelperPass(context, result, lowering)) return result;
  }
  throw new Error("Recursive helper calls are unsupported");
}
