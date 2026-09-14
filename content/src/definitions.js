import {
  CONTENT_LIMITS,
  enumeration,
  hash,
  identity,
  integer,
  jsonDocument,
  list,
  originalRef,
  record,
  reference,
  requireContent,
  text,
} from "./validation.js";
import { validateMap } from "./map-definition.js";
import { validateQuest } from "./quest-definition.js";
import { validateDropDefinition } from "./drop-definition.js";
import { validateDialogueDefinition } from "./dialogue-definition.js";

export const CONTENT_KINDS = Object.freeze([
  "map",
  "mob",
  "quest",
  "drops",
  "dialogue",
]);
const STATS = [
  "maxHP",
  "maxMP",
  "level",
  "exp",
  "PADamage",
  "PDDamage",
  "MADamage",
  "MDDamage",
  "acc",
  "eva",
  "pushed",
  "speed",
];

/** Closed documents keep uploaded code and unknown gameplay operations out of the content layer. */
export function validateDefinition(kind, value) {
  jsonDocument(value);
  enumeration(kind, CONTENT_KINDS, "kind");
  if (kind === "map") validateMap(value);
  if (kind === "mob") validateMob(value);
  if (kind === "quest") validateQuest(value);
  if (kind === "drops") validateDropDefinition(value);
  if (kind === "dialogue") validateDialogueDefinition(value);
  return structuredClone(value);
}

function validateMob(value) {
  record(value, ["base", "stats"], ["appearance"], "definition");
  originalRef(value.base, ["mob"], "base");
  record(value.stats, [], STATS, "stats");
  for (const [key, stat] of Object.entries(value.stats)) {
    const minimum = key === "speed" ? -100 : key === "maxHP" ? 1 : 0;
    integer(stat, minimum, key === "speed" ? 100 : 2147483647, `stats/${key}`);
  }
  if (value.appearance !== undefined) validateAppearance(value.appearance);
}

/** New images use explicit sprite-sheet frames, origins, delays and body geometry. */
export function validateAppearance(value) {
  if (value?.source === "original") {
    return originalRef(value, ["mob", "entity"], "appearance");
  }
  record(value, ["source", "assetId", "actions"], [], "appearance");
  enumeration(value.source, ["upload"], "appearance/source");
  hash(value.assetId, "appearance/assetId");
  const names = Object.keys(value.actions ?? {});
  requireContent(
    names.length > 0 && names.length <= 32,
    "Invalid action count",
    "appearance/actions",
  );
  let totalFrames = 0,
    totalPixels = 0;
  for (const name of names) {
    requireContent(
      /^[a-z][a-zA-Z0-9]{0,31}$/.test(name),
      "Invalid action name",
      name,
    );
    const frames = list(value.actions[name], CONTENT_LIMITS.frames, name);
    requireContent(frames.length > 0, "Action has no frames", name);
    for (const frame of frames) {
      validateFrame(frame, name);
      totalFrames++;
      totalPixels += frame.width * frame.height;
      requireContent(
        totalFrames <= CONTENT_LIMITS.frames && totalPixels <= 16777216,
        "Animation frame/pixel budget exceeded",
        name,
      );
    }
  }
}

function validateFrame(frame, path) {
  record(
    frame,
    ["x", "y", "width", "height", "originX", "originY", "delay"],
    ["body"],
    path,
  );
  for (const key of ["x", "y"]) {
    integer(frame[key], 0, CONTENT_LIMITS.imageSide - 1, path);
  }
  for (const key of ["width", "height"]) {
    integer(frame[key], 1, CONTENT_LIMITS.imageSide, path);
  }
  for (const key of ["originX", "originY"]) {
    integer(frame[key], -32768, 32768, path);
  }
  integer(frame.delay, 1, 60000, path);
  if (frame.body !== undefined) rectangle(frame.body, path);
}

export function rectangle(value, path) {
  record(value, ["left", "top", "right", "bottom"], [], path);
  for (const number of Object.values(value)) {
    integer(number, -1000000, 1000000, path);
  }
  requireContent(
    value.left < value.right && value.top < value.bottom,
    "Rectangle is inverted or empty",
    path,
  );
}

/** Save requests use optimistic revisions; an operation ID makes network retries idempotent. */
export function validateSave(value) {
  record(value, [
    "projectId",
    "id",
    "kind",
    "name",
    "baseAssetBuildId",
    "definition",
    "expectedRevision",
    "operationId",
  ]);
  identity(value.projectId, "projectId");
  identity(value.id, "id");
  text(value.name, 120, "name");
  hash(value.baseAssetBuildId, "baseAssetBuildId");
  integer(
    value.expectedRevision,
    0,
    CONTENT_LIMITS.revisionsPerContent - 1,
    "expectedRevision",
  );
  requireContent(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value.operationId,
    ),
    "Invalid operation ID",
  );
  const definition = validateDefinition(value.kind, value.definition);
  return { ...value, definition };
}

export function validateContentRef(value) {
  record(value, ["projectId", "id", "revision"]);
  identity(value.projectId, "projectId");
  identity(value.id, "id");
  integer(value.revision, 1, CONTENT_LIMITS.revisionsPerContent, "revision");
  return value;
}

/** References are explicit and bounded; no arbitrary object traversal or name-based binding. */
export function definitionReferences(kind, value) {
  const refs = [];
  if (kind === "mob") {
    refs.push(
      value.base,
      ...(value.appearance?.source === "original" ? [value.appearance] : []),
    );
  }
  if (kind === "map") {
    refs.push(value.base);
    for (const entity of value.entities) {
      if (entity.appearance.source === "original") refs.push(entity.appearance);
    }
    for (const spawn of value.spawns) refs.push(spawn.mob);
  }
  if (kind === "quest") {
    refs.push(value.startNpc, value.endNpc, ...value.prerequisites);
    for (const objective of value.objectives) refs.push(objective.target);
    for (const reward of value.rewards.items) refs.push(reward.item);
  }
  if (kind === "drops") refs.push(value.target);
  return refs;
}

export function referenceKey(value) {
  reference(value, ["map", "mob", "quest", "item", "sound", "entity", "npc"]);
  return [
    value.source,
    value.kind,
    value.id,
    value.mapId ?? "",
    value.revision ?? "",
  ].join(":");
}
