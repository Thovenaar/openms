import { at, value, resolveNode } from "../src/assets/image.js";

// Original ordinary action table 004a38e7, unique names for indices 0..39.
const STANDARD_ACTIONS = Object.freeze([
  "walk1",
  "walk2",
  "stand1",
  "stand2",
  "alert",
  "swingO1",
  "swingO2",
  "swingO3",
  "swingOF",
  "swingT1",
  "swingT2",
  "swingT3",
  "swingTF",
  "swingP1",
  "swingP2",
  "swingPF",
  "stabO1",
  "stabO2",
  "stabOF",
  "stabT1",
  "stabT2",
  "stabTF",
  "shoot1",
  "shoot2",
  "shootF",
  "heal",
  "proneStab",
  "prone",
  "fly",
  "jump",
  "ladder",
  "rope",
  "dead",
  "sit",
]);
const POSE_ALIASES = Object.freeze([
  "alert2",
  "alert3",
  "alert4",
  "alert5",
  "alert6",
  "paralyze",
  "ladder2",
  "rope2",
  "prone2",
]);
const EQUIPMENT = Object.freeze([
  "00002000.img",
  "00012000.img",
  "Hair/00030000.img",
  "Face/00020000.img",
  "Coat/01040002.img",
  "Pants/01060002.img",
  "Shoes/01072001.img",
  "Weapon/01302000.img",
]);
const MAX_FRAMES = 4096;
const MAX_PARTS = 256;
const MAX_ALIAS_HOPS = 64;
// 00406abd reads delay with fallback 0x96 for both direct and alias frames.
const ORIGINAL_DELAY_MS = 150;

/** Resolve Character action/frame aliases, not relative UOLs (handled by at).
 * 00406abd records the target action/frame and retains the alias's own timing.
 * Selected ordinary aliases contain no geometric transforms; reject new ones. */
function bodyPose(body, action, index) {
  const visited = new Set();
  for (let hop = 0; hop < MAX_ALIAS_HOPS; hop++) {
    const key = `${action}/${index}`;
    if (visited.has(key)) throw new Error(`Cyclic body action alias ${key}`);
    visited.add(key);
    const frame = at(body, key);
    if (
      frame.children.move ||
      value(frame, "rotate", 0) ||
      value(frame, "flip", 0)
    ) {
      throw new Error(`Unclassified ordinary body transform ${key}`);
    }
    const target = value(frame, "action");
    if (target === undefined) {
      if (frame.children.frame) {
        throw new Error(`Frame alias without action ${key}`);
      }
      return { action, index, frame };
    }
    const targetFrame = value(frame, "frame", 0);
    if (
      typeof target !== "string" ||
      !Number.isInteger(targetFrame) ||
      targetFrame < 0
    ) {
      throw new Error(`Invalid body action alias ${key}`);
    }
    action = target;
    index = String(targetFrame);
  }
  throw new Error("Body action alias traversal exceeded limit");
}

/** Death is an original composition substitution, not a guessed pose alias.
 * 00407757 strips clothing/weapon; 0041272c uses jump for the head/hair/face. */
function equipmentFrame(item, slot, pose, expression = "default") {
  const dead = pose.action === "dead";
  if (dead && slot >= 4) return null;
  if (slot === 3) return faceFrame(item, pose, expression);
  const action = dead && slot !== 0 ? "jump" : pose.action;
  const root = item.children[action];
  // A weapon has only its authored families; no invented alternate-family artwork.
  if (!root && slot === 7) return null;
  if (!root) {
    throw new Error(`Missing equipment action ${item.source}/${action}`);
  }
  const index = dead && slot !== 0 ? "0" : pose.index;
  return authoredEquipmentFrame(root, index, item.source);
}

/** The body face flag admits exactly the authored default or first hit frame. */
function faceFrame(item, pose, expression) {
  if (!value(pose.frame, "face", 0)) return null;
  return at(item, expression === "default" ? "default" : "hit/0");
}

/** Keep missing frames distinct from an entirely unauthored weapon family. */
function authoredEquipmentFrame(root, index, source) {
  if (!resolveNode(root).children[index]) {
    throw new Error(`Missing equipment frame ${source}/${root.name}/${index}`);
  }
  return at(root, index);
}

/** Direct action/frame canvases include the weapon's authored weapon child.
 * The only nested variant in the selected loadout is the skin-indexed hair shade. */
function appendFrameCanvases(candidates, frame) {
  const start = candidates.length;
  const children = Object.values(frame.children);
  if (children.length > MAX_PARTS) {
    throw new Error("Avatar frame part bound exceeded");
  }
  for (const child of children) {
    const canvas = resolveNode(child);
    if (canvas.type === "Canvas") {
      candidates.push(canvas);
    } else if (child.name === "hairShade") {
      const shade = at(canvas, "0");
      if (shade.type !== "Canvas") {
        throw new Error("Missing original avatar hair shade canvas");
      }
      candidates.push(shade);
    } else if (Object.keys(canvas.children).length) {
      throw new Error(`Unclassified avatar part family ${child.name}`);
    }
  }
  if (candidates.length === start) {
    throw new Error(`Missing authored avatar frame canvases ${frame.name}`);
  }
}

/** Retain every selected authored canvas; absent weapon families remain absent. */
function candidatesFor(equipment, pose, expression = "default") {
  const candidates = [];
  for (let slot = 0; slot < equipment.length; slot++) {
    const frame = equipmentFrame(equipment[slot], slot, pose, expression);
    if (!frame) continue;
    appendFrameCanvases(candidates, frame);
  }
  if (candidates.length > MAX_PARTS) {
    throw new Error("Avatar composition part bound exceeded");
  }
  return candidates;
}

/** 00402442 starts each component at its authored canvas origin. context.part
 * subtracts that origin, so positions here are origin-relative displacements. */
function canvasComponent(canvas, positions) {
  const origin = value(canvas, "origin");
  if (!origin || !Number.isInteger(origin.x) || !Number.isInteger(origin.y)) {
    throw new Error(`Invalid avatar origin ${canvas.name}`);
  }
  const entries = Object.entries(at(canvas, "map").children);
  if (!entries.length || entries.length > MAX_PARTS) {
    throw new Error(`Invalid avatar anchor count ${canvas.name}`);
  }
  const anchors = new Map();
  for (const [name, child] of entries) {
    const vector = resolveNode(child).value;
    if (!vector || !Number.isInteger(vector.x) || !Number.isInteger(vector.y)) {
      throw new Error(`Invalid avatar anchor ${canvas.name}/${name}`);
    }
    anchors.set(name, { x: vector.x, y: vector.y });
  }
  const position = { x: 0, y: 0 };
  positions.set(canvas, position);
  return { anchors, positions: [position] };
}

/** 00401a17 aligns the integer centroids of all common anchors. Its four IDIV
 * instructions truncate each centroid before subtraction, not the difference. */
function componentOffset(target, source) {
  let targetX = 0;
  let targetY = 0;
  let sourceX = 0;
  let sourceY = 0;
  let count = 0;
  for (const [name, vector] of source.anchors) {
    const existing = target.anchors.get(name);
    if (!existing) continue;
    targetX += existing.x;
    targetY += existing.y;
    sourceX += vector.x;
    sourceY += vector.y;
    count++;
  }
  if (!count) return null;
  return {
    x: Math.trunc(targetX / count) - Math.trunc(sourceX / count),
    y: Math.trunc(targetY / count) - Math.trunc(sourceY / count),
  };
}

/** 00401b0d..00401b7d translates new anchors and every source component member;
 * common anchors retain the destination's positions. */
function mergeComponents(target, source, offset) {
  for (const [name, vector] of source.anchors) {
    if (!target.anchors.has(name)) {
      target.anchors.set(name, {
        x: vector.x + offset.x,
        y: vector.y + offset.y,
      });
    }
  }
  for (const position of source.positions) {
    position.x += offset.x;
    position.y += offset.y;
    target.positions.push(position);
  }
}

/** 0040197d searches components in insertion order, not drawing-depth order. */
function connectedComponent(components, source) {
  for (const target of components) {
    if (target === source) continue;
    const offset = componentOffset(target, source);
    if (offset) return { target, offset };
  }
  return null;
}

/** 00402442 preserves the first component's coordinate system while repeatedly
 * merging connected components. Unconnected authored components remain intact. */
function insertComponent(components, component) {
  components.push(component);
  for (let merge = 0; merge < MAX_PARTS; merge++) {
    const connection = connectedComponent(components, component);
    if (!connection) return;
    let { target, offset } = connection;
    let source = component;
    if (component === components[0]) {
      source = target;
      target = component;
      offset = { x: -offset.x, y: -offset.y };
    }
    mergeComponents(target, source, offset);
    components.splice(components.indexOf(source), 1);
    component = target;
  }
  throw new Error("Avatar component merge bound exceeded");
}

/** The original renderer composes a forest, not a single body-rooted graph.
 * 00401de9 renders every slot-visible component; no unmatched limb is dropped. */
function placeCandidates(candidates, pose) {
  if (!candidates.some((canvas) => canvas.name === "body")) {
    throw new Error(`Missing body canvas ${pose.action}/${pose.index}`);
  }
  const positions = new Map();
  const components = [];
  for (const canvas of candidates) {
    insertComponent(components, canvasComponent(canvas, positions));
  }
  return positions;
}

/** Compose the resolved body and equipment using authored timing/depth/anchors. */
async function avatarFrame(context, equipment, zmap, request) {
  const original = at(equipment[0], `${request.action}/${request.index}`);
  const pose = bodyPose(equipment[0], request.action, request.index);
  const candidates = candidatesFor(equipment, pose);
  const positions = placeCandidates(candidates, pose);
  const parts = [];
  for (const canvas of candidates) {
    const position = positions.get(canvas);
    const z = value(canvas, "z");
    const rank = typeof z === "number" ? z : zmap.indexOf(z);
    if (!Number.isFinite(rank) || rank === -1) {
      throw new Error(`Unknown avatar z ${z}`);
    }
    const part = await context.part(canvas, position.x, position.y, -rank);
    if (canvas.name === "face") part.expression = "default";
    parts.push(part);
  }
  await appendHitFaceParts(context, equipment, zmap, { pose, parts });
  const authoredDelay = value(original, "delay", ORIGINAL_DELAY_MS);
  // 00406abd: negative alias delays become absolute durations and also contribute
  // to the original pre-action sum. That sum is not a local damaging-frame rule.
  if (
    !Number.isFinite(authoredDelay) ||
    authoredDelay === 0 ||
    (authoredDelay < 0 && !original.children.action)
  ) {
    throw new Error(
      `Invalid ordinary body delay ${request.action}/${request.index}`,
    );
  }
  return { delay: Math.abs(authoredDelay), parts };
}

/** Hit expressions use their own anchor composition, but publish only the face. */
async function appendHitFaceParts(context, equipment, zmap, composition) {
  const { pose, parts } = composition;
  if (!value(pose.frame, "face", 0)) return;
  const hitCandidates = candidatesFor(equipment, pose, "hit");
  const hitPositions = placeCandidates(hitCandidates, pose);
  for (const canvas of hitCandidates) {
    if (canvas.name !== "face") continue;
    const position = hitPositions.get(canvas);
    const z = value(canvas, "z");
    const rank = typeof z === "number" ? z : zmap.indexOf(z);
    if (!Number.isFinite(rank) || rank === -1) {
      throw new Error(`Unknown face z ${z}`);
    }
    const part = await context.part(canvas, position.x, position.y, -rank);
    part.expression = "hit";
    parts.push(part);
  }
}

function frameIndices(bodyAction) {
  const indices = Object.keys(bodyAction.children).filter((key) =>
    /^\d+$/.test(key),
  );
  if (!indices.length || indices.length > MAX_FRAMES) {
    throw new Error("Invalid avatar action frame count");
  }
  indices.sort((left, right) => Number(left) - Number(right));
  for (let index = 0; index < indices.length; index++) {
    if (Number(indices[index]) !== index) {
      throw new Error("Noncontiguous avatar frames");
    }
  }
  return indices;
}

/** Complete original standard families and ordinary pose aliases for this loadout.
 * Skill/mount transformations require their separate action controllers; artwork
 * availability here never grants a skill or activates an attack rectangle. */
export async function extractAvatar(context) {
  const zmap = Object.keys(context.image("Base", "zmap.img").children);
  const equipment = EQUIPMENT.map((path) => context.image("Character", path));
  const actions = Object.create(null);
  for (const action of [...STANDARD_ACTIONS, ...POSE_ALIASES]) {
    const indices = frameIndices(at(equipment[0], action));
    const frames = [];
    for (const index of indices) {
      frames.push(
        await avatarFrame(context, equipment, zmap, { action, index }),
      );
    }
    // 004a38e7 marks these direct actions bidirectional; 00406abd appends N-2..1.
    if (action === "stand1" || action === "stand2" || action === "alert") {
      for (let index = frames.length - 2; index > 0; index--) {
        frames.push(frames[index]);
      }
    }
    actions[action] = frames;
  }
  return { actions, equipment: equipment.map((node) => node.source) };
}
