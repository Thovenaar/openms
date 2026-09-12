import {
  astInventory,
  integerLiteral,
  NPC_SCRIPT_LIMITS,
  resolveVariable,
  spendAnalysisStep,
} from "./npc-script-ir.js";

function targetPath(node) {
  const path = [];
  let root = node;
  for (
    let depth = 0;
    root?.type === "MemberExpression" && depth < NPC_SCRIPT_LIMITS.depth;
    depth++
  ) {
    const index = integerLiteral(root.property);
    if (!root.computed || index === null || index < 0) return null;
    path.unshift(index);
    root = root.object;
  }
  return root?.type === "Identifier" ? { root, path } : null;
}

function aliasesRoot(node, name) {
  let value = node;
  for (
    let depth = 0;
    value?.type === "MemberExpression" && depth < NPC_SCRIPT_LIMITS.depth;
    depth++
  ) {
    value = value.object;
  }
  return value?.type === "Identifier" && value.name === name;
}

function originalArray(context, target, node) {
  let array = null;
  const before = aliasEscapeBoundary(context, node);
  for (const child of astInventory(context.root)) {
    spendAnalysisStep(context, child);
    if (
      child.type === "VariableDeclarator" &&
      child.id.name === target.root.name
    ) {
      if (array || context.nodeScopes.get(child) !== "global") {
        throw new Error("Array initialization requires one global declaration");
      }
      array = child.init;
    }
    rejectEscapedAlias(child, target.root.name, before);
    validateArrayWrite(context, child, target);
  }
  if (
    array?.type !== "ArrayExpression" ||
    astInventory(array).some(
      (child) =>
        !["ArrayExpression", "Literal", "UnaryExpression"].includes(child.type),
    )
  ) {
    throw new Error("Array initialization requires an original literal array");
  }
  return array;
}

function aliasEscapeBoundary(context, node) {
  let before = node.start,
    parent = context.parents.get(node);
  for (let depth = 0; parent && depth < NPC_SCRIPT_LIMITS.depth; depth++) {
    if (parent.type === "ForStatement") before = parent.end;
    parent = context.parents.get(parent);
  }
  return before;
}

function rejectEscapedAlias(child, name, before) {
  const value =
    child.type === "VariableDeclarator"
      ? child.init
      : child.type === "AssignmentExpression"
        ? child.right
        : null;
  if (
    child.start < before &&
    value &&
    astInventory(value).some(
      (entry) => entry.type === "Identifier" && entry.name === name,
    )
  ) {
    throw new Error("Array initialization cannot follow an escaped alias");
  }
}

function validateArrayWrite(context, child, target) {
  if (
    child.type !== "AssignmentExpression" ||
    !aliasesRoot(child.left, target.root.name)
  ) {
    return;
  }
  const write = targetPath(child.left);
  if (
    !write ||
    !write.path.length ||
    write.path.join() !== target.path.join() ||
    child.operator !== "=" ||
    context.scopeOwners.get(context.nodeScopes.get(child)) !== "start"
  ) {
    throw new Error(
      "Array initialization requires one fixed slot written only in start",
    );
  }
}

/** Pre-alias writes to one fixed slot are exactly an immutable replacement, not general mutation. */
export function lowerNpcArrayAssignment(context, scope, node) {
  const target = targetPath(node.left);
  if (
    context.scopeOwners.get(scope) !== "start" ||
    node.operator !== "=" ||
    !target?.path.length
  ) {
    throw new Error("Unsupported NPC array write");
  }
  const variable = resolveVariable(context, scope, target.root);
  if (!variable || variable.scope !== "global") {
    throw new Error("Array initialization requires a global literal binding");
  }
  const copy = structuredClone(originalArray(context, target, node));
  let array = copy;
  for (let depth = 0; depth < target.path.length; depth++) {
    const index = target.path[depth];
    if (array?.type !== "ArrayExpression" || index >= array.elements.length) {
      throw new Error("NPC array initialization index is out of range");
    }
    if (depth === target.path.length - 1) array.elements[index] = node.right;
    else array = array.elements[index];
  }
  return { ...node, left: target.root, right: copy };
}
