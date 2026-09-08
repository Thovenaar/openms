import { at, value, resolveNode } from "../src/assets/image.js";

const MAX_PORTALS = 4096;
const MAX_FRAMES = 1024;
// Original 0xc0041f78 minus common B=-0x40000000, matching existing map depths.
const PORTAL_DEPTH = 270200;
// 0043ea3e -> 0043f768: PUSH 0x78 before reading string ID 0x15f8.
const ORIGINAL_FRAME_DELAY_MS = 120;
const STATES = ["portalStart", "portalContinue", "portalExit"];

/** Shared frame extraction retains alpha and original origins; normalize WZ numeric strings. */
async function portalFrames(context, node) {
  node = resolveNode(node);
  const children = Object.keys(node.children)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b));
  if (!children.length || children.length > MAX_FRAMES) {
    throw new Error("Portal frame count exceeds extraction bounds");
  }
  const result = await context.frames(node);
  if (result.length !== children.length) {
    throw new Error("Portal frame count mismatch");
  }
  for (let index = 0; index < result.length; index++) {
    const delay = Number(
      value(at(node, children[index]), "delay", ORIGINAL_FRAME_DELAY_MS),
    );
    if (!Number.isSafeInteger(delay) || delay <= 0) {
      throw new Error("Invalid portal frame delay");
    }
    result[index].delay = delay;
  }
  return result;
}

/** Original helper selection; unknown named variants are not silently replaced by default. */
function graphics(node) {
  const type = value(node, "pt", null);
  if (type === 2 || type === 4 || type === 7) return "portal/game/pv";
  if (type !== 10 && type !== 11) return null;
  const image = value(node, "image", "");
  if (typeof image !== "string" && typeof image !== "number") {
    throw new Error("Invalid portal image variant");
  }
  const variant = image === "" ? "default" : String(image);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(variant)) {
    throw new Error("Invalid portal variant name");
  }
  return `portal/game/${type === 10 ? "ph" : "psh"}/${variant}`;
}

/** Resolve and cache one bounded original portal animation family. */
async function cachedActions(context, helper, path, cache) {
  if (cache.has(path)) return cache.get(path);
  let resource = helper;
  for (const key of path.split("/")) resource = resource?.children[key];
  if (!resource) return null;
  const actions = {};
  if (path === "portal/game/pv") {
    actions.default = await portalFrames(context, resource);
  } else {
    for (const state of STATES) {
      actions[state] = await portalFrames(context, at(resource, state));
    }
  }
  cache.set(path, actions);
  return actions;
}

/** No route metadata is duplicated here: portalId indexes physics.portals/$portalProperties. */
async function extractOne(context, node, helper, actionCache) {
  const path = graphics(node);
  const record = {
    portalId: Number(node.name),
    entityId: null,
    graphics: path,
    status: "metadata-only",
  };
  if (!path) return { entity: null, record };
  const actions = await cachedActions(context, helper, path, actionCache);
  if (!actions) {
    record.status = "unsupported-missing-original-artwork";
    return { entity: null, record };
  }
  const x = Number(value(node, "x")),
    y = Number(value(node, "y"));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Nonfinite portal placement");
  }
  const hidden = value(node, "pt") === 10 || value(node, "pt") === 11;
  const entity = {
    id: `portal:${node.name}`,
    kind: "portal",
    order: Number(node.name),
    x,
    y,
    z: PORTAL_DEPTH,
    visible: !hidden,
    flip: false,
    opacity: 1,
    action: hidden ? "portalStart" : "default",
    actions,
  };
  record.entityId = entity.id;
  record.status = hidden ? "proximity-state-graphics" : "looping-graphics";
  if (value(node, "pt") === 11) {
    record.status = "unsupported-psh-continue-family";
  }
  return { entity, record };
}

/** Extract bounded original portal graphics into the map's existing region/atlas path.
 * All placements, including invisible/script/sentinel/special records, are accounted for.
 */
export async function extractPortals(context, map, mapId) {
  if (!/^\d{9}$/.test(String(mapId))) {
    throw new Error("Invalid portal map identity");
  }
  const nodes = Object.values(map.children.portal?.children ?? {});
  if (nodes.length > MAX_PORTALS) {
    throw new Error("Portal count exceeds extraction bounds");
  }
  const helper = context.image("Map", "MapHelper.img");
  const entities = [],
    records = [],
    actionCache = new Map();
  for (const node of nodes) {
    if (!/^\d+$/.test(node.name) || !Number.isSafeInteger(Number(node.name))) {
      throw new Error("Invalid original portal index");
    }
    const result = await extractOne(context, node, helper, actionCache);
    records.push(result.record);
    if (result.entity) entities.push(result.entity);
  }
  return {
    entities,
    presentation: {
      schemaVersion: 1,
      records,
      provenance:
        "Map.wz:MapHelper.img; original 0071165a,00712313,0071259d,00712827,00712d35,0071332c",
      timing: {
        defaultFrameMs: ORIGINAL_FRAME_DELAY_MS,
        evidence: "0043ea3e -> 0043f768",
      },
      mode: "offline-packaged-traversal-not-server-authorization",
    },
  };
}
