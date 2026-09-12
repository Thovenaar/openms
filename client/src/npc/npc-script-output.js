// Static lower-bound checks complement the VM's authoritative per-turn output guard.
// Calls may depend on mutable dialogue status, so their outputs are checked at execution.
const EMPTY = Object.freeze({ normal: 0, returned: null, broken: null });

function largest(a, b) {
  if (a === null) return b;
  return b === null ? a : Math.max(a, b);
}

function smallest(a, b) {
  if (a === null) return b;
  return b === null ? a : Math.min(a, b);
}

function sum(a, b) {
  return a === null || b === null ? null : Math.min(2, a + b);
}

function append(left, right) {
  return {
    normal: sum(left.normal, right.normal),
    returned: largest(left.returned, sum(left.normal, right.returned)),
    broken: largest(left.broken, sum(left.normal, right.broken)),
  };
}

function merge(left, right) {
  return {
    // Sibling conditions can be correlated through callback variables.
    // Count only guaranteed fallthrough outputs; the VM guards the actual path.
    normal: smallest(left.normal, right.normal),
    returned: largest(left.returned, right.returned),
    broken: largest(left.broken, right.broken),
  };
}

function switchOutput(node, summaries) {
  let suffix = EMPTY,
    result = EMPTY;
  for (let index = node.cases.length - 1; index >= 0; index--) {
    suffix = append(summaries[node.cases[index].body], suffix);
    result = merge(result, suffix);
  }
  return {
    normal: largest(result.normal, result.broken),
    returned: result.returned,
    broken: null,
  };
}

function summary(node, summaries) {
  if (node.op === "return") return { ...EMPTY, normal: null, returned: 0 };
  if (node.op === "break") return { ...EMPTY, normal: null, broken: 0 };
  if (["dialog", "shop", "storage"].includes(node.op)) {
    return { ...EMPTY, normal: 1 };
  }
  if (node.op === "if") {
    return merge(
      summaries[node.yes],
      node.no === null ? EMPTY : summaries[node.no],
    );
  }
  if (node.op === "switch") return switchOutput(node, summaries);
  if (node.op === "for") {
    const body = summaries[node.body];
    const repeated =
      body.normal === null ? 0 : Math.min(2, body.normal * node.maxIterations);
    return {
      normal: largest(repeated, sum(repeated, body.broken)),
      returned: sum(repeated, body.returned),
      broken: null,
    };
  }
  let result = EMPTY;
  for (const id of node.op === "block" ? node.body : []) {
    result = append(result, summaries[id]);
  }
  return result;
}

/** Statements are a bounded, forward-only graph already checked by the caller. */
export function npcOutputsWithinLimit(program) {
  const summaries = new Array(program.statements.length);
  for (let id = summaries.length - 1; id >= 0; id--) {
    summaries[id] = summary(program.statements[id], summaries);
  }
  for (const entry of Object.values(program.functions)) {
    const value = summaries[entry.entry];
    if ((largest(value.normal, value.returned) ?? 0) > 1) return false;
  }
  const initial = summaries[program.initial],
    start = summaries[program.functions.start.entry];
  return (
    (largest(initial.normal, initial.returned) ?? 0) +
      (largest(start.normal, start.returned) ?? 0) <=
    1
  );
}
