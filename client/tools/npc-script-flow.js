import { NPC_SCRIPT_LIMITS, blockScript } from "./npc-script-ir.js";

const EMPTY = Object.freeze({ normal: 0, returned: null });

function largest(left, right) {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function sum(left, right) {
  return left === null || right === null ? null : Math.min(2, left + right);
}

function sequence(body, summaries) {
  let normal = 0,
    returned = null;
  for (const child of body) {
    if (normal === null) break;
    const next = summaries.get(child);
    returned = largest(returned, sum(normal, next.returned));
    normal = sum(normal, next.normal);
  }
  return { normal, returned };
}

function conditional(record, summaries) {
  const yes = summaries.get(record.yes),
    no = record.no === null ? EMPTY : summaries.get(record.no);
  return {
    normal: largest(yes.normal, no.normal),
    returned: largest(yes.returned, no.returned),
  };
}

function repeated(record, summaries) {
  const body = summaries.get(record.body);
  const normal =
    body.normal === null ? 0 : Math.min(2, body.normal * record.maxIterations);
  return { normal, returned: sum(normal, body.returned) };
}

function statementSummary(record, summaries, action) {
  switch (record.op) {
    case "block":
      return sequence(record.body, summaries);
    case "if":
      return conditional(record, summaries);
    case "for":
      return repeated(record, summaries);
    case "return":
      return { normal: null, returned: 0 };
    case "dialog":
    case "shop":
      return { normal: 1, returned: null };
    case "call-action":
      return { normal: action, returned: null };
    default:
      return EMPTY;
  }
}

function children(record) {
  if (record.op === "block") return record.body;
  if (record.op === "if") {
    return record.no === null ? [record.yes] : [record.yes, record.no];
  }
  if (record.op === "for") return [record.body];
  return [];
}

/** The lowered statement graph is a finite tree; action calls have one nonrecursive edge. */
function callbackOutputs(context, root, action) {
  const work = [{ id: root, leave: false }],
    summaries = new Map();
  let steps = 0;
  while (work.length && steps++ < NPC_SCRIPT_LIMITS.statements * 2) {
    const entry = work.pop(),
      record = context.statements[entry.id];
    if (entry.leave) {
      summaries.set(entry.id, statementSummary(record, summaries, action));
      continue;
    }
    work.push({ ...entry, leave: true });
    for (const id of children(record)) work.push({ id, leave: false });
  }
  if (work.length) throw new Error("NPC callback output analysis limit");
  const result = summaries.get(root);
  return largest(result.normal, result.returned) ?? 0;
}

/** Never admit a route that would require silently choosing one of several emitted views. */
export function validateCallbackOutputs(context, program, root) {
  const actionNode = context.functions.get("action");
  const action = actionNode
    ? callbackOutputs(context, program.functions.action.entry, 0)
    : 0;
  const start = callbackOutputs(context, program.functions.start.entry, action);
  const initial = callbackOutputs(context, program.initial, 0);
  if (action > 1) {
    blockScript(
      context,
      actionNode,
      "A callback can emit multiple dialogs/shops; ordered multi-packet presentation is unsupported",
    );
  }
  if (initial + start > 1) {
    blockScript(
      context,
      root,
      "Initial/start execution can emit multiple dialogs/shops; no terminal-call selection is permitted",
    );
  }
}
