import {
  NPC_SCRIPT_LIMITS,
  astInventory,
  blockScript,
  call,
  cmMethod,
  integerLiteral,
  resolveVariable,
} from "./npc-script-ir.js";

const RESERVED = new Set(["cm", "Java", "undefined", "start", "action"]);

function shopFactoryImport(node) {
  return (
    call(node, "type") &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "Java" &&
    node.arguments.length === 1 &&
    node.arguments[0].type === "Literal" &&
    node.arguments[0].value === "server.ShopFactory"
  );
}

function declare(context, scope, declaration, kind) {
  const node = declaration.id;
  if (node.type !== "Identifier" || RESERVED.has(node.name)) {
    blockScript(
      context,
      node,
      "Destructured/reserved declarations are unsupported",
    );
    return;
  }
  const table = context.scopes.get(scope),
    existing = table.get(node.name);
  if (
    existing &&
    (kind !== "var" || existing.kind !== "var" || existing.host)
  ) {
    blockScript(
      context,
      node,
      "Redeclared lexical or host binding is unsupported",
    );
    return;
  }
  if (existing) return;
  if (context.variables.length >= NPC_SCRIPT_LIMITS.variables) {
    throw new Error("NPC variable limit");
  }
  const variable = {
    key: `${scope}:${node.name}`,
    name: node.name,
    scope,
    kind,
    host: shopFactoryImport(declaration.init) ? "shop-factory" : null,
    declarationEnd: declaration.end ?? node.end,
  };
  table.set(node.name, variable);
  context.variables.push(variable);
}

function isEntrypoint(node, parent) {
  return (
    parent?.type === "Program" &&
    ["start", "action"].includes(node.id?.name) &&
    !node.async &&
    !node.generator
  );
}

function functionScope(context, node, parent) {
  const name = node.id?.name;
  if (!isEntrypoint(node, parent)) {
    blockScript(
      context,
      node,
      "Only top-level synchronous start/action entrypoints are supported",
    );
    return null;
  }
  if (context.functions.has(name)) {
    blockScript(context, node, `Duplicate entrypoint: ${name}`);
    return null;
  }
  if (
    (name === "start" && node.params.length !== 0) ||
    node.params.length > 3
  ) {
    blockScript(context, node, "Unsupported NPC entrypoint parameters");
  }
  context.functions.set(name, node);
  context.scopes.set(name, new Map());
  for (const parameter of node.params) {
    declare(context, name, { id: parameter }, "parameter");
  }
  return name;
}

/** Function var hoisting is retained. Nested lexical bindings are explicitly refused. */
export function inspectScopes(context, root) {
  const nodes = astInventory(root),
    ownership = new WeakMap([[root, "global"]]);
  for (const node of nodes) {
    const parent = context.parents.get(node),
      inherited = ownership.get(node) ?? "global";
    let scope = inherited;
    if (node.type === "FunctionDeclaration") {
      scope = functionScope(context, node, parent) ?? inherited;
    }
    context.nodeScopes.set(node, scope);
    inheritChildScopes(context, node, scope, ownership);
    if (node.type === "VariableDeclaration") {
      inspectDeclarations(context, node, parent, scope);
    }
  }
  if (!context.functions.has("start")) {
    blockScript(context, root, "Missing start entrypoint");
  }
  context.astNodes = nodes.length;
}

function inheritChildScopes(context, node, scope, ownership) {
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      if (!child || typeof child.type !== "string") continue;
      context.parents.set(child, node);
      ownership.set(child, scope);
    }
  }
}

function inspectDeclarations(context, node, parent, scope) {
  const topLevel =
    parent?.type === "Program" ||
    context.parents.get(parent)?.type === "FunctionDeclaration";
  const staticImport = node.declarations.every((declaration) =>
    shopFactoryImport(declaration.init),
  );
  const hasStaticImport = node.declarations.some((declaration) =>
    shopFactoryImport(declaration.init),
  );
  if (
    (node.kind !== "var" && !staticImport) ||
    (hasStaticImport && !topLevel)
  ) {
    blockScript(
      context,
      node,
      "Only function-scoped var declarations and direct static ShopFactory imports are supported",
    );
  }
  for (const declaration of node.declarations) {
    declare(context, scope, declaration, node.kind);
  }
}

function javaShopReceiver(node) {
  if (!call(node, "sendShop") || node.arguments.length !== 1) return null;
  const client = node.arguments[0],
    shop = node.callee.object;
  if (cmMethod(client) !== "getClient" || client.arguments.length !== 0) {
    return null;
  }
  return call(shop, "getShop") && shop.arguments.length === 1 ? shop : null;
}

function javaShopBinding(shop) {
  const instance = shop.callee.object;
  if (!call(instance, "getInstance") || instance.arguments.length !== 0) {
    return null;
  }
  return instance.callee.object.type === "Identifier"
    ? instance.callee.object
    : null;
}

/** Translate only the complete, exact server.ShopFactory chain; Java is never run. */
export function staticJavaShop(context, scope, node) {
  const shop = javaShopReceiver(node);
  if (!shop) return null;
  const binding = javaShopBinding(shop),
    id = integerLiteral(shop.arguments[0]);
  if (!binding || id === null || id <= 0) return null;
  const variable = resolveVariable(context, scope, binding);
  if (variable?.host !== "shop-factory") return null;
  if (variable.scope === scope && variable.declarationEnd > node.start) {
    return null;
  }
  return {
    shopId: id,
    translation:
      "server.ShopFactory.getInstance().getShop(literal).sendShop(cm.getClient())",
  };
}

function loopInitializer(context, scope, node) {
  const declaration = node.init;
  if (
    declaration?.type !== "VariableDeclaration" ||
    declaration.kind !== "var" ||
    declaration.declarations.length !== 1
  ) {
    return null;
  }
  const entry = declaration.declarations[0],
    from = integerLiteral(entry.init);
  if (entry.id.type !== "Identifier" || from === null || from < 0) return null;
  const variable = resolveVariable(context, scope, entry.id);
  return variable ? { variable, from } : null;
}

function safeLoopBody(node, name) {
  for (const child of astInventory(node.body)) {
    if (
      [
        "ForStatement",
        "WhileStatement",
        "DoWhileStatement",
        "FunctionDeclaration",
      ].includes(child.type)
    ) {
      return false;
    }
    if (child.type === "UpdateExpression" && child.argument.name === name) {
      return false;
    }
    if (child.type === "AssignmentExpression" && child.left.name === name) {
      return false;
    }
    if (child.type === "VariableDeclarator" && child.id.name === name) {
      return false;
    }
  }
  return true;
}

function canonicalProgress(node, name) {
  const test = node.test,
    update = node.update;
  if (test?.type !== "BinaryExpression" || test.operator !== "<") return false;
  if (test.left.type !== "Identifier" || test.left.name !== name) return false;
  if (update?.type !== "UpdateExpression" || update.operator !== "++") {
    return false;
  }
  return update.argument.type === "Identifier" && update.argument.name === name;
}

function canonicalBound(node, from) {
  const maximum = integerLiteral(node);
  if (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.property.name === "length"
  ) {
    return true;
  }
  return (
    maximum !== null &&
    maximum <= NPC_SCRIPT_LIMITS.loopIterations &&
    maximum >= from
  );
}

/** Only canonical literal/array-bounded loops; every body operation is compiled separately. */
export function boundedLoop(context, scope, node) {
  const initial = loopInitializer(context, scope, node);
  if (!initial || !canonicalProgress(node, initial.variable.name)) return null;
  if (!canonicalBound(node.test.right, initial.from)) return null;
  if (!safeLoopBody(node, initial.variable.name)) return null;
  return {
    from: initial.from,
    variable: initial.variable.key,
    maxIterations: NPC_SCRIPT_LIMITS.loopIterations,
  };
}
