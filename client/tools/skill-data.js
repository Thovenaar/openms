import { resolveNode } from "../src/assets/image.js";
import { publishSound } from "./audiovisual-data.js";
import { classifyStateSkill } from "../src/skills/skill-state-rules.js";
import { classifyCombatSkill } from "../src/skills/skill-combat-rules.js";
import { classifyWorldSkill } from "../src/skills/skill-world-rules.js";
import { classifyUtilitySkill } from "../src/skills/skill-utility-rules.js";

const MAX_NODES = 65536;
const MAX_DEPTH = 64;
const MAX_FRAMES = 512;
/** Exact original identities dispatch to implemented owners; artwork never implies semantics. */
export function classifySkill(record) {
  if (record.flags.disabled) {
    return unavailable("disabled", "Disabled by the original skill record");
  }
  if (record.bookId >= 800 && record.bookId < 1000) {
    return unavailable("server", "Original GM/event permission is required");
  }
  if (record.flags.timeLimited) {
    return unavailable(
      "event",
      "Original time-limited event entitlement is required",
    );
  }
  const classification =
    classifyUtilitySkill(record) ??
    classifyWorldSkill(record) ??
    classifyStateSkill(record) ??
    classifyCombatSkill(record);
  if (!classification) {
    throw new Error(`Unclassified original skill ${record.id}`);
  }
  return classification;
}

function unavailable(activation, reason) {
  return { activation, supported: false, reason, hooks: [], owner: null };
}

/** Parent links preserve the resolved original sound identity, including alias targets. */
function nodePath(node) {
  const parts = [];
  for (let depth = 0; node && depth <= MAX_DEPTH; depth++, node = node.parent) {
    parts.push(node.name);
  }
  if (node) throw new Error("Skill source depth exceeded");
  return parts.reverse().filter(Boolean).join("/");
}

export async function skillSounds(context, root, key) {
  const branch = root.children[key] ?? root.children[String(Number(key))];
  if (!branch) {
    return { present: false, source: `Sound.wz:Skill.img/${key}`, leaves: {} };
  }
  const leaves = Object.create(null);
  const queue = [{ node: branch, path: "", depth: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    let node;
    try {
      node = resolveNode(entry.node);
    } catch (error) {
      leaves[entry.path] = {
        available: false,
        alias: entry.node.value,
        reason: error.message,
      };
      continue;
    }
    if (node.type === "Sound_DX8") {
      const source = `Sound.wz:Skill.img/${key}/${entry.path}`;
      leaves[entry.path] = {
        available: true,
        source,
        resolvedSource: `Sound.wz:Skill.img/${nodePath(node)}`,
        alias: entry.node.type === "UOL" ? entry.node.value : null,
        descriptor: await publishSound(context, node, source),
      };
      continue;
    }
    if (entry.depth >= MAX_DEPTH) throw new Error("Skill sound depth exceeded");
    for (const [name, child] of Object.entries(node.children)) {
      if (queue.length >= MAX_NODES) {
        throw new Error("Skill sound node bound exceeded");
      }
      queue.push({
        node: child,
        path: entry.path ? `${entry.path}/${name}` : name,
        depth: entry.depth + 1,
      });
    }
  }
  return { present: true, source: `Sound.wz:Skill.img/${key}`, leaves };
}

/** Publish every authored visual sequence, including nested level/CharLevel branches. */
export async function skillVisuals(context, input) {
  const result = Object.create(null);
  const queue = [{ node: input.node, path: "", depth: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    let node;
    try {
      node = resolveNode(entry.node);
    } catch (error) {
      result[entry.path] = {
        available: false,
        source: `${input.source}/${entry.path}`,
        reason: error.message,
      };
      continue;
    }
    if (node.type === "Canvas") {
      result[entry.path] = await visualSequence(context, input, entry.path, [
        ["0", node],
      ]);
      continue;
    }
    const children = Object.entries(node.children);
    const frames = collectVisualFrames(children, entry.path, result);
    if (frames.length) {
      result[entry.path] = await visualSequence(
        context,
        input,
        entry.path,
        frames,
      );
    }
    enqueueVisualChildren(queue, entry, children, frames);
  }
  return result;
}

/** Numeric canvas children form one authored sequence; retain alias failures. */
function collectVisualFrames(children, path, result) {
  const frames = [];
  for (const [name, child] of children) {
    if (!/^\d+$/.test(name)) continue;
    try {
      if (resolveNode(child).type === "Canvas") frames.push([name, child]);
    } catch (error) {
      result[`${path}/${name}`] = {
        available: false,
        reason: error.message,
      };
    }
  }
  return frames;
}

/** Bound traversal without re-enqueuing sequence frames or root icons. */
function enqueueVisualChildren(queue, entry, children, frames) {
  if (entry.depth >= MAX_DEPTH) {
    throw new Error("Skill visual depth exceeded");
  }
  for (const [name, child] of children) {
    if (
      (!entry.path && name.startsWith("icon")) ||
      frames.some(([frame]) => frame === name)
    ) {
      continue;
    }
    if (queue.length >= MAX_NODES) {
      throw new Error("Skill visual node bound exceeded");
    }
    queue.push({
      node: child,
      path: entry.path ? `${entry.path}/${name}` : name,
      depth: entry.depth + 1,
    });
  }
}

/** WZ numeric strings are numbers; negative alpha inherits the prior endpoint. */
function visualFrameTiming(node, carried, source) {
  const delay = Number(node.children.delay?.value ?? 120);
  const a0 = Number(node.children.a0?.value ?? -1),
    a1 = Number(node.children.a1?.value ?? -1);
  const start = a0 < 0 ? carried : a0,
    end = a1 < 0 ? start : a1;
  validateVisualFrameTiming(delay, start, end, source);
  return { delay, start, end };
}

/** Milliseconds and byte alpha endpoints retain the existing strict bounds. */
function validateVisualFrameTiming(delay, start, end, source) {
  if (
    ![delay, start, end].every(Number.isFinite) ||
    delay < 0 ||
    delay > 60000 ||
    start < 0 ||
    start > 255 ||
    end < 0 ||
    end > 255
  ) {
    throw new Error(
      `Invalid skill frame timing/alpha: ${source} (${delay},${start},${end})`,
    );
  }
}

async function visualSequence(context, input, path, children) {
  if (children.length > MAX_FRAMES) {
    throw new Error("Skill frame bound exceeded");
  }
  children.sort((a, b) => Number(a[0]) - Number(b[0]));
  const frames = [];
  let durationMs = 0,
    carried = 255;
  for (const [, child] of children) {
    const node = resolveNode(child);
    const { delay, start, end } = visualFrameTiming(
      node,
      carried,
      `${input.source}/${path}/${child.name}`,
    );
    frames.push({
      delay,
      parts: [{ ...(await context.part(node)), opacity: start / 255 }],
      alphaEnd: end / 255,
    });
    durationMs += delay;
    carried = end;
  }
  const id = `skill:${input.id}:${path}`;
  const entity = {
    id,
    order: 0,
    kind: "effect",
    x: 0,
    y: 0,
    z: 0,
    visible: true,
    flip: false,
    opacity: 1,
    action: "play",
    actions: { play: frames },
  };
  const source = `${input.source}/${path}`;
  return {
    available: true,
    source,
    durationMs,
    bundle: await context.bundle({
      id,
      entities: [entity],
      metadata: { source, durationMs },
    }),
  };
}
