import { NPC_SCRIPT_LIMITS } from "./npc-script-ir.js";
import {
  NPC_ARTWORK_LIMITS,
  NPC_MARKUP_TOKENS,
  validNpcArtworkPath,
} from "../src/npc-script-markup.js";
import { npcBinary, npcUnary } from "../src/npc-script-values.js";

const MAX_ARTWORK_STATES = 30000;
const MAX_ARTWORK_VALUES = 8192;
const MAX_ARTWORK_PRODUCTS = 65536;
const MAX_ARTWORK_TEXT_UNITS = 2097152;
const UNKNOWN = "\u0000";
// The fallback recognizes unfinished image tokens; earlier complete tokens consume their delimiters.
const ARTWORK_SCAN = new RegExp(
  `${NPC_MARKUP_TOKENS.source}|#[fF][^#\\r\\n]*|#\\x00`,
  "g",
);

function state(expression, path = []) {
  return { expression, path, key: `${expression}:${path.join(",")}` };
}

function edges(context, current) {
  const node = context.expressions[current.expression],
    path = current.path;
  if (path.length > NPC_SCRIPT_LIMITS.depth) {
    throw new Error("Artwork index depth exceeded");
  }
  if (node.op === "variable") {
    return (context.assignments.get(node.name) ?? []).map((id) =>
      state(id, path),
    );
  }
  if (node.op === "index") {
    return indexEdges(context, node, path);
  }
  if (node.op === "array" && path.length) {
    return arrayEdges(node, path);
  }
  if (node.op === "conditional") {
    return [state(node.yes, path), state(node.no, path)];
  }
  if (node.op === "unary") return [state(node.value, path)];
  if (node.op === "logical" || node.op === "binary") {
    return [state(node.left, path), state(node.right, path)];
  }
  return [];
}

function indexEdges(context, node, path) {
  const index = context.expressions[node.index];
  return [
    state(node.value, [
      index.op === "literal" && Number.isSafeInteger(index.value)
        ? index.value
        : "all",
      ...path,
    ]),
  ];
}

function arrayEdges(node, path) {
  const index = path[0];
  const ids =
    index === "all"
      ? node.values
      : Number.isSafeInteger(index) && index >= 0 && index < node.values.length
        ? [node.values[index]]
        : [];
  return ids.map((id) => state(id, path.slice(1)));
}

function addValue(values, value) {
  if (
    typeof value === "string" &&
    value.length > NPC_SCRIPT_LIMITS.textLength
  ) {
    throw new Error("Artwork text length exceeded");
  }
  values.add(value);
  if (values.size > MAX_ARTWORK_VALUES) {
    throw new Error("Artwork finite value limit exceeded");
  }
}

function unknown(value) {
  return typeof value === "string" && value.includes(UNKNOWN);
}

function binary(operator, left, right) {
  if (
    operator === "+" &&
    (typeof left === "string" || typeof right === "string")
  ) {
    return String(left) + String(right);
  }
  if (unknown(left) || unknown(right)) return UNKNOWN;
  return npcBinary(operator, left, right);
}

function values(context, frame, cache, analysis) {
  const node = context.expressions[frame.current.expression];
  if (node.op === "literal" && !frame.current.path.length) {
    return new Set([node.value]);
  }
  if (node.op === "undefined" && !frame.current.path.length) {
    return new Set([undefined]);
  }
  const result = expressionValues(node, frame, cache, analysis);
  if (node.op === "variable" && context.unboundedAssignments.has(node.name)) {
    const fragments = [...result];
    result.clear();
    for (const value of fragments) {
      addValue(result, UNKNOWN + String(value) + UNKNOWN);
    }
  }
  if (!result.size) addValue(result, UNKNOWN);
  return result;
}

function expressionValues(node, frame, cache, analysis) {
  if (node.op === "binary" && !frame.current.path.length) {
    return binaryValues(node, frame, cache, analysis);
  }
  const result = new Set();
  if (node.op === "unary" && !frame.current.path.length) {
    for (const value of cache.get(frame.children[0].key)) {
      addValue(
        result,
        unknown(value) ? UNKNOWN : npcUnary(node.operator, value),
      );
    }
  } else {
    for (const child of frame.children) {
      for (const value of cache.get(child.key)) addValue(result, value);
    }
  }
  return result;
}

function binaryValues(node, frame, cache, analysis) {
  const result = new Set(),
    left = cache.get(frame.children[0].key),
    right = cache.get(frame.children[1].key);
  for (const a of left) {
    for (const b of right) {
      if (++analysis.products > MAX_ARTWORK_PRODUCTS) {
        throw new Error("Artwork cross-product limit exceeded");
      }
      addValue(result, binary(node.operator, a, b));
    }
  }
  return result;
}

/** Iterative postorder over lowered expressions and assignment/immutable-array edges. */
function finiteText(context, root, analysis) {
  const cache = new Map(),
    active = new Set(),
    work = [{ current: state(root), leave: false }];
  while (work.length) {
    if (++context.analysisSteps > NPC_SCRIPT_LIMITS.analysisSteps) {
      throw new Error("Artwork dependency analysis work limit exceeded");
    }
    if (++analysis.states > MAX_ARTWORK_STATES) {
      throw new Error("Artwork analysis state limit exceeded");
    }
    const frame = work.pop(),
      key = frame.current.key;
    if (frame.leave) {
      cache.set(key, values(context, frame, cache, analysis));
      active.delete(key);
    } else if (!cache.has(key)) {
      if (active.has(key)) {
        cache.set(key, new Set([UNKNOWN]));
        continue;
      }
      active.add(key);
      const children = edges(context, frame.current);
      work.push({ ...frame, leave: true, children });
      for (let index = children.length - 1; index >= 0; index--) {
        work.push({ current: children[index], leave: false });
      }
      if (work.length > MAX_ARTWORK_STATES) {
        throw new Error("Artwork analysis queue limit exceeded");
      }
    }
  }
  return cache.get(state(root).key);
}

function collectPaths(context, value, analysis) {
  if (typeof value !== "string") return;
  analysis.textUnits += value.length;
  if (analysis.textUnits > MAX_ARTWORK_TEXT_UNITS) {
    throw new Error("Artwork text analysis limit exceeded");
  }
  for (const match of value.matchAll(ARTWORK_SCAN)) {
    const token = match[0];
    if (token === `#${UNKNOWN}`) {
      throw new Error("Artwork token code has an unbounded fragment");
    }
    if (token[1] !== "f" && token[1] !== "F") continue;
    const path = token.slice(2, -1);
    if (!token.endsWith("#") || !validNpcArtworkPath(path)) {
      throw new Error(
        "Artwork path must have a complete finite source closure",
      );
    }
    context.dependencies.artworkPaths.add(path);
    if (context.dependencies.artworkPaths.size > NPC_ARTWORK_LIMITS.paths) {
      throw new Error("Artwork path limit exceeded");
    }
  }
}

/** Unknown ordinary text is harmless; unknown bytes inside an image path refuse the whole script. */
export function collectArtworkDependencies(context) {
  const analysis = { states: 0, products: 0, textUnits: 0 };
  for (const node of context.statements) {
    if (node.op !== "dialog" || node.text === null) continue;
    try {
      for (const value of finiteText(context, node.text, analysis)) {
        collectPaths(context, value, analysis);
      }
    } catch (error) {
      context.blockers.push({
        source: context.source.path,
        ...context.expressions[node.text].source,
        reason: error.message,
      });
      return;
    }
  }
}
