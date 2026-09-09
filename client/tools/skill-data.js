import { resolveNode } from "../src/assets/image.js";
import { publishSound } from "./audiovisual-data.js";

const MAX_NODES = 65536;
const MAX_DEPTH = 64;
const MAX_FRAMES = 512;
const STAT_FIELDS = ["pad", "pdd", "mad", "mdd", "acc", "eva", "speed", "jump"];
const BUFF_FIELDS = new Set([
  "hs",
  "time",
  "mpCon",
  "hpCon",
  "cooltime",
  ...STAT_FIELDS,
]);
const PASSIVE_HOOKS = {
  1000000: "recovery",
  1000001: "max-hp-progression",
  1000002: "endure",
  // 00764f44: trunc(character level * learned rank * 0.1), not an authored mp scalar.
  2000000: "mp-recovery",
  // 00764c72/00764d62/00764f44: authored time/hp/mp recovery only.
  4100002: "hp-mp-recovery",
  4200001: "hp-mp-recovery",
  // 00764f44: authored mp bonus to each natural recovery interval.
  1110000: "mp-recovery",
  1210000: "mp-recovery",
  11110000: "mp-recovery",
  11000000: "max-hp-progression",
};

/** Exhaustive classification is not an assertion that every original controller exists. */
export function classifySkill(record) {
  const p = record.properties;
  const ranks = Object.values(record.levels);
  const family = Math.floor(record.bookId / 100) % 10;
  if (record.bookId >= 800 && record.bookId < 1000) {
    return capability("server", "GM/event permission and map controller");
  }
  if (PASSIVE_HOOKS[record.id]) {
    const hook = PASSIVE_HOOKS[record.id];
    const result = capability("passive", null, hook);
    if (hook === "max-hp-progression") {
      result.reason =
        "Level-up growth x implemented; authored AP-investment growth y requires currently unavailable AP-allocation authority";
    }
    return result;
  }
  const controller =
    classifyActorController(p) ??
    classifyResourceController(ranks) ??
    classifyWeaponController(record, ranks, family);
  if (controller) return controller;
  if (admitsSelfBuff(record, ranks)) {
    return capability("self-buff", null, "derived-stats");
  }
  return classifyRemainingSkill(record, ranks);
}

/** Actor and map controllers take precedence over resource and weapon families. */
function classifyActorController(p) {
  if (p.summon) {
    return capability(
      "summon",
      "Summon actor, target, damage and lifetime controller",
    );
  }
  if (p.keydown || p.repeat || p.keydownend) {
    return capability(
      "channel",
      "Held-skill/channel state and authored release controller",
    );
  }
  if (p.cDoor || p.mDoor) {
    return capability("map", "Server portal creation and party authorization");
  }
  return null;
}

/** Rank-authored consumption and transitions require their original controllers. */
function classifyResourceController(ranks) {
  if (
    ranks.some(
      (r) => r.itemCon || r.itemConsume || r.bulletConsume || r.moneyCon,
    )
  ) {
    return capability(
      "consumable",
      "Slot-aware projectile/item/meso transaction and weapon controller",
    );
  }
  if (ranks.some((r) => r.morph || r.moveTo)) {
    return capability(
      "morph",
      "Morph/mount actor or map transition controller",
    );
  }
  return null;
}

/** Only the reconstructed sword attacks bypass weapon-family admission. */
function classifyWeaponController(record, ranks, family) {
  const p = record.properties;
  if (record.id === 1001004 || record.id === 1001005) {
    return capability("melee", null, "sword-attack");
  }
  if (p.ball || family === 3 || family === 4 || family === 5) {
    return capability(
      "weapon",
      "Weapon-specific actor, projectile/status and attack controller",
    );
  }
  if (family === 2 && ranks.some((r) => r.damage || r.mad)) {
    return capability(
      "magic",
      "Magic/element damage and spell target controller",
    );
  }
  return null;
}

/** Timed scalar ranks must contain only reconstructed derived-stat fields. */
function isStatBuffRank(rank) {
  return (
    rank.time > 0 &&
    STAT_FIELDS.some((key) => rank[key] !== undefined) &&
    Object.keys(rank).every((key) => BUFF_FIELDS.has(key))
  );
}

/** Affected/area/party branches cannot be reduced to a self-only cast. */
function admitsSelfBuff(record, ranks) {
  const p = record.properties;
  return (
    ranks.length > 0 &&
    ranks.every(isStatBuffRank) &&
    record.actions.length &&
    !p.affected &&
    !p.mob &&
    !p.special &&
    !p.weapon &&
    !p["weapon "]
  );
}

/** Preserve explicit unavailable reasons for otherwise unclassified skills. */
function classifyRemainingSkill(record, ranks) {
  const p = record.properties;
  if (!record.actions.length && !p.effect && !p.effect0 && !p.hit) {
    return capability(
      "passive",
      "Passive transition, weapon-stat or attack hook not reconstructed",
    );
  }
  if (ranks.some((r) => r.damage)) {
    return capability(
      "attack",
      "Skill-specific weapon/action, combo/status and damage controller",
    );
  }
  return capability(
    "special",
    "Party/target/status or exceptional skill controller; scalar shape alone does not establish self-cast semantics",
  );
}

function capability(activation, reason, hook = null) {
  return {
    activation,
    supported: reason === null,
    reason,
    hooks: hook ? [hook] : [],
  };
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
