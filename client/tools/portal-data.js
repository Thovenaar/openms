import { at, value, resolveNode } from "../src/assets/image.js";
import { portalRouteStatus } from "../src/portal-system.js";

const MAX_PLAYABLE_MAPS = 512;

function mapPortals(context, mapId) {
  const map = context.image("Map", `Map/Map${mapId[0]}/${mapId}.img`);
  const nodes = Object.values(map.children.portal?.children ?? {});
  if (nodes.length > MAX_PORTALS) {
    throw new Error("Portal closure record bound exceeded");
  }
  return nodes;
}

function routeFields(node) {
  return {
    id: Number(node.name),
    name: value(node, "pn"),
    type: value(node, "pt"),
    targetMap: value(node, "tm"),
    targetName: value(node, "tn"),
  };
}

function destinationStatus(context, portal, target) {
  const nodes = mapPortals(context, target);
  let matches = 0;
  for (const node of nodes) {
    if (value(node, "pn") === portal.targetName) matches++;
  }
  if (matches === 0) return "missing-named-destination";
  if (matches !== 1) return "ambiguous-named-destination";
  return null;
}

/** Bounded source-driven closure; unsupported scripts and malformed named routes stay explicit.
 * context.image owns decoding/cache and must fail on missing/corrupt original IMG dependencies.
 * @returns {{ids:string[],blocked:object[]}} */
export function collectPlayableMaps(context, seeds) {
  if (
    !Array.isArray(seeds) ||
    !seeds.length ||
    seeds.length > MAX_PLAYABLE_MAPS ||
    seeds.some((id) => typeof id !== "string" || !/^\d{9}$/.test(id))
  ) {
    throw new Error("Invalid playable-map seed set");
  }
  const ids = [...new Set(seeds)],
    seen = new Set(ids),
    blocked = [];
  for (let index = 0; index < ids.length; index++) {
    const source = ids[index];
    for (const node of mapPortals(context, source)) {
      const portal = routeFields(node);
      const raw = { script: value(node, "script", "") };
      let reason = portalRouteStatus(portal, raw);
      const target = Number.isInteger(portal.targetMap)
        ? String(portal.targetMap).padStart(9, "0")
        : null;
      if (!reason) reason = destinationStatus(context, portal, target);
      if (reason) {
        blocked.push({
          source,
          portalId: portal.id,
          name: portal.name,
          target,
          targetName: portal.targetName,
          reason,
        });
        continue;
      }
      if (seen.has(target)) continue;
      if (ids.length >= MAX_PLAYABLE_MAPS) {
        throw new Error(
          "Playable map closure exceeds 512 maps; select an explicit release",
        );
      }
      seen.add(target);
      ids.push(target);
    }
  }
  return { ids: ids.sort(), blocked };
}

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
    if (!Number.isSafeInteger(delay) || delay < 0) {
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
  // 0071332c deliberately uses ph Continue even for psh Start/Exit (type11).
  if (path.startsWith("portal/game/psh/")) {
    const continuePath = path.replace("/psh/", "/ph/");
    let continueResource = helper;
    for (const key of continuePath.split("/")) {
      continueResource = continueResource?.children[key];
    }
    if (!continueResource?.children.portalContinue) return null;
    actions.portalContinue = await portalFrames(
      context,
      at(continueResource, "portalContinue"),
    );
  }
  cache.set(path, actions);
  return actions;
}

/** No route metadata is duplicated here: portalId indexes physics.portals/$portalProperties. */
function activation(node) {
  const type = value(node, "pt");
  if (value(node, "script", "") !== "") return "server-script";
  if (type === 0) return "spawn";
  if (type === 6) return "special-field-loader";
  if (type === 9) return "automatic-server-script";
  if (type === 12 || type === 13) return "automatic-impact";
  if (type === 3) return "automatic-and-up";
  if (type === 10 || type === 11) return "hidden-up";
  if ([1, 2, 4, 5, 7, 8].includes(type)) return "ordinary-up";
  return "unknown-type";
}

async function extractOne(context, node, helper, actionCache) {
  const path = graphics(node);
  const record = {
    portalId: Number(node.name),
    entityId: null,
    graphics: path,
    status: "metadata-only",
    activation: activation(node),
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
