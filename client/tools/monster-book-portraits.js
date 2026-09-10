import { at, resolveNode, value } from "../src/assets/image.js";

const MAX_LINKS = 32;
const MAX_FRAMES = 1024;
const MAX_ACTIONS = 38;
// 008677cc ranks the00bec4c8 action table;004a6c05/decoded strings prove its exact names.
const ACTIONS = [
  { rank: 1, names: ["stand", "fly"] },
  { rank: 2, names: ["move", "jump"] },
  {
    rank: 3,
    names: Array.from({ length: 8 }, (_, index) => `attack${index + 1}`).concat(
      "attackF",
      Array.from({ length: 16 }, (_, index) => `skill${index + 1}`),
      "skillF",
    ),
  },
  { rank: 4, names: ["hit1", "hit2", "hitF"] },
  { rank: 5, names: ["die1", "die2", "dieF"] },
];

async function artworkRoot(context, original, mobId) {
  const seen = new Set([mobId]);
  let root = original,
    id = mobId;
  for (let hop = 0; hop < MAX_LINKS; hop++) {
    const link = value(at(root, "info"), "link", null);
    if (link === null) return { root, id };
    if (
      typeof link !== "string" ||
      !/^\d{1,7}$/.test(link) ||
      seen.has(Number(link))
    ) {
      throw new Error(`Invalid Monster Book mob link ${mobId}/${link}`);
    }
    id = Number(link);
    seen.add(id);
    root = await context.image("Mob", `${String(id).padStart(7, "0")}.img`);
  }
  throw new Error(`Monster Book mob link limit ${mobId}`);
}

function actionKeys(node) {
  const keys = Object.keys(resolveNode(node).children).filter((key) =>
    /^\d+$/.test(key),
  );
  if (!keys.length || keys.length > MAX_FRAMES) {
    throw new Error("Monster Book pose frame limit");
  }
  return keys.sort((a, b) => Number(a) - Number(b));
}

/** Validate authored timing and expand the portrait's shared pixel bounds. */
function poseTiming(frame, bounds) {
  // Original mob action loader 0040cb2e pushes 0x78 before reading delay string0x15f8.
  const delay = Number(value(frame, "delay", 120));
  const origin = value(frame, "origin", null);
  if (
    !Number.isInteger(delay) ||
    delay < 0 ||
    delay > 60000 ||
    !origin ||
    !Number.isFinite(origin.x) ||
    !Number.isFinite(origin.y)
  ) {
    throw new Error("Invalid Monster Book pose timing or origin");
  }
  bounds.left = Math.min(bounds.left, -origin.x);
  bounds.top = Math.min(bounds.top, -origin.y);
  bounds.right = Math.max(bounds.right, frame.width - origin.x);
  bounds.bottom = Math.max(bounds.bottom, frame.height - origin.y);
  return delay;
}

/** Absent alpha endpoints inherit the previous frame's terminal value. */
function poseAlpha(frame, alpha) {
  const initial = Number(value(frame, "a0", -1)),
    final = Number(value(frame, "a1", -1));
  const start = initial >= 0 ? initial : alpha;
  const end = final >= 0 ? final : start;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start > 255 ||
    end < 0 ||
    end > 255
  ) {
    throw new Error("Invalid Monster Book pose alpha");
  }
  return { start, end };
}

async function poseFrames(context, node, bounds) {
  const frames = [];
  let alpha = 255;
  for (const key of actionKeys(node)) {
    const frame = resolveNode(at(node, key));
    if (frame.type !== "Canvas") {
      throw new Error("Monster Book pose is not a canvas");
    }
    const delay = poseTiming(frame, bounds);
    const { start, end } = poseAlpha(frame, alpha);
    frames.push({
      delay,
      parts: [{ ...(await context.part(frame)), opacity: start / 255 }],
      alphaEnd: end / 255,
    });
    alpha = end;
  }
  return frames;
}

async function rankedFrames(context, root, bounds) {
  const actions = Object.create(null),
    poses = [];
  const authoredDefault = root.children.info?.children.default;
  if (authoredDefault) {
    const frames = await poseFrames(
      context,
      resolveNode(authoredDefault),
      bounds,
    );
    for (let rank = 1; rank <= 5; rank++) actions[`rank${rank}`] = frames;
    return { actions, poses: ["info/default"] };
  }
  const frames = [];
  let total = 0;
  for (const group of ACTIONS) {
    for (const name of group.names) {
      if (!root.children[name]) continue;
      const pose = await poseFrames(
        context,
        resolveNode(root.children[name]),
        bounds,
      );
      total += pose.length;
      if (total > MAX_FRAMES || poses.length >= MAX_ACTIONS) {
        throw new Error("Monster Book portrait budget exceeded");
      }
      for (const frame of pose) frames.push(frame);
      poses.push(name);
    }
    if (frames.length) actions[`rank${group.rank}`] = frames.slice();
  }
  return { actions, poses };
}

/** One owned lazy bundle per card monster. No shared scene-entity leases or inventory ownership. */
export async function monsterBookPortrait(context, original, mobId) {
  const { root, id } = await artworkRoot(context, original, mobId);
  const bounds = {
    left: Infinity,
    top: Infinity,
    right: -Infinity,
    bottom: -Infinity,
  };
  const { actions, poses } = await rankedFrames(context, root, bounds);
  if (!actions.rank1) {
    return {
      available: false,
      reason: `Mob.wz:${String(id).padStart(7, "0")}.img has no original stand, fly or info/default book portrait.`,
    };
  }
  const entity = {
    id: "MonsterPortrait",
    kind: "ui",
    order: 0,
    x: 0,
    y: 0,
    z: 0,
    visible: true,
    flip: false,
    opacity: 1,
    action: "rank1",
    actions,
  };
  const descriptor = await context.bundle({
    id: `ui:monster-book-portrait:${mobId}`,
    entities: [entity],
    metadata: {
      source: `Mob.wz:${String(id).padStart(7, "0")}.img`,
      poses,
      bounds,
      timing:
        "Original frame delays; absent mob delay120ms at0040cb2e; rank-gated action sequence008677cc.",
      assets: {
        MonsterPortrait: {
          id: "MonsterPortrait",
          width: bounds.right - bounds.left,
          height: bounds.bottom - bounds.top,
          origin: { x: -bounds.left, y: -bounds.top },
          delay: null,
        },
      },
    },
  });
  return { available: true, descriptor };
}
