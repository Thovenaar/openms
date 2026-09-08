import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { WzArchive } from "../src/assets/wz.js";
import { parseImage, at, value, resolveNode } from "../src/assets/image.js";
import { decodeCanvas } from "../src/assets/canvas.js";
import { readPhysicsData } from "./physics-data.js";
import { extractHitboxReferences } from "./hitbox-data.js";
import { hash, resource, ATLAS_LIMIT, PADDING } from "./atlas.js";
import { packageMap, packageVisualBundle, REGION_SIZE } from "./packaging.js";
import { prepareCanvasTiles } from "./canvas-tiles.js";
import { extractGameUI } from "./ui-data.js";
import { extractPortals } from "./portal-data.js";
import { extractLife } from "./life-data.js";
import { extractAudiovisual } from "./audiovisual-data.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const source = resolve(
  option(
    "--assets",
    Bun.env.MAPLE_ASSETS ?? "/Users/k/Development/tensorfish/Maplestory-Client",
  ),
);
const selected = option(
  "--maps",
  option(
    "--map",
    "100000000,100000001,103040000,108000500,120000000,200090500,211040000,230000000",
  ),
).split(",");
if (
  !selected.length ||
  selected.length > 32 ||
  selected.some((id) => !/^\d{9}$/.test(id))
) {
  throw new Error("--maps requires at most 32 comma-separated nine-digit IDs");
}
const mapIds = [...new Set(selected)].sort();
const started = performance.now();
const output = resolve(root, "client/public/generated");
for (const directory of [
  "atlases",
  "regions",
  "maps",
  "references",
  "bundles",
  "audio",
]) {
  mkdirSync(resolve(output, directory), { recursive: true });
}
// This conversion process owns these caches; no runtime shares mutable data.
const archives = new Map(),
  images = new Map(),
  canvasIds = new WeakMap();
const inputImages = Object.create(null);
const textures = Object.create(null),
  formats = Object.create(null);
const state = {
  output,
  pixels: textures,
  textures: Object.create(null),
  atlases: Object.create(null),
  verifiedBytes: 0,
  entities: [],
  rgbaBytes: 0,
};
state.regions = Object.create(null);
state.tiledCanvases = Object.create(null);
const extractionContext = {
  image,
  part,
  frames,
  output,
  mapIds,
  bundle: (value) => packageVisualBundle(value, state),
};
/** @param {string} name */
function archive(name) {
  if (!archives.has(name)) {
    archives.set(name, new WzArchive(resolve(source, `${name}.wz`)));
  }
  return archives.get(name);
}
/** @param {string} name @param {string} path */
function image(name, path) {
  const key = `${name}.wz:${path}`;
  if (!images.has(key)) {
    const reader = archive(name).imageReader(path);
    inputImages[key] = {
      ...archive(name).entries.get(path),
      sha256: hash(reader.bytes),
      bytes: reader.bytes.length,
    };
    const node = parseImage(reader);
    node.source = key;
    images.set(key, node);
  }
  return images.get(key);
}
/** @param {import('../src/assets/image.js').WzNode} node */
function nodePath(node) {
  const parts = [];
  for (let depth = 0; node.parent && depth < 256; depth++) {
    parts.unshift(node.name);
    node = node.parent;
  }
  if (node.parent) throw new Error("Canvas ancestry exceeds 256 nodes");
  return `${node.source}/${parts.join("/")}`;
}
/** @param {import('../src/assets/image.js').WzNode} node */ async function texture(
  node,
) {
  node = resolveNode(node);
  if (canvasIds.has(node)) return canvasIds.get(node);
  const decoded = decodeCanvas(node);
  const id = createHash("sha256")
    .update(`${decoded.width}x${decoded.height}:`)
    .update(decoded.rgba)
    .digest("hex");
  if (!textures[id]) {
    textures[id] = {
      rgba: decoded.rgba,
      width: decoded.width,
      height: decoded.height,
      source: nodePath(node),
      format: decoded.format,
      scale: decoded.scale,
    };
    state.rgbaBytes += decoded.rgba.length;
    prepareCanvasTiles(state, id);
    const key = `${decoded.format}/${decoded.scale}`;
    formats[key] = (formats[key] ?? 0) + 1;
  }
  canvasIds.set(node, id);
  return id;
}
/** @param {import('../src/assets/image.js').WzNode} node @param {number} [x] @param {number} [y] @param {number} [z] */
async function part(node, x = 0, y = 0, z = 0) {
  node = resolveNode(node);
  const origin = value(node, "origin", { x: 0, y: 0 });
  return { texture: await texture(node), x: x - origin.x, y: y - origin.y, z };
}
/** @param {import('../src/assets/image.js').WzNode} node */
async function frames(node) {
  node = resolveNode(node);
  if (node.type === "Canvas") {
    return [{ delay: value(node, "delay", 120), parts: [await part(node)] }];
  }
  const result = [];
  let carriedAlpha = 255;
  for (const key of Object.keys(node.children)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b))) {
    const frame = at(node, key);
    if (frame.type !== "Canvas") {
      throw new Error(`Expected Canvas animation frame: ${nodePath(frame)}`);
    }
    const delay = value(frame, "delay", 120);
    if (delay <= 0) {
      throw new Error(`Nonpositive frame delay at ${nodePath(frame)}`);
    }
    const start = value(frame, "a0", -1),
      end = value(frame, "a1", -1);
    const a0 = start < 0 ? carriedAlpha : start,
      a1 = end < 0 ? a0 : end;
    result.push({
      delay,
      parts: [{ ...(await part(frame)), opacity: a0 / 255 }],
      alphaEnd: a1 / 255,
    });
    carriedAlpha = a1;
  }
  if (!result.length) throw new Error(`No canvas frames at ${nodePath(node)}`);
  return result;
}
/** Create one map entity from original placement and animation metadata. */
function mapEntity(id, placement, frameList, flip = false) {
  const entity = {
    id,
    kind: "map",
    ...placement,
    visible: true,
    opacity: 1,
    flip,
    action: "default",
    actions: { default: frameList },
  };
  state.entities.push(entity);
  return entity;
}
/** Iterative original foothold traversal; derived camera fallback remains explicitly unverified. */
function mapBounds(map) {
  const info = at(map, "info");
  const extents = {
    left: Infinity,
    top: Infinity,
    right: -Infinity,
    bottom: -Infinity,
  };
  const queue = [at(map, "foothold")];
  for (let i = 0; i < queue.length; i++) {
    if (queue.length > 100000) {
      throw new Error("Foothold traversal limit exceeded");
    }
    const node = queue[i];
    if (!node.children.x1) {
      queue.push(...Object.values(node.children));
      continue;
    }
    extents.left = Math.min(extents.left, value(node, "x1"), value(node, "x2"));
    extents.right = Math.max(
      extents.right,
      value(node, "x1"),
      value(node, "x2"),
    );
    extents.top = Math.min(extents.top, value(node, "y1"), value(node, "y2"));
    extents.bottom = Math.max(
      extents.bottom,
      value(node, "y1"),
      value(node, "y2"),
    );
  }
  const bounds = {
    left: value(info, "VRLeft", extents.left - 100),
    right: value(info, "VRRight", extents.right + 100),
    top: value(info, "VRTop", extents.top - 500),
    bottom: value(info, "VRBottom", extents.bottom + 100),
  };
  if (!Object.values(bounds).every(Number.isFinite)) {
    throw new Error("Map has no finite bounds/footholds");
  }
  return bounds;
}
/** Original layer object placements. */
async function objects(layer, l) {
  for (const [id, entry] of Object.entries(at(l, "obj").children)) {
    const path = `Obj/${value(entry, "oS")}.img`;
    const resource = at(
      image("Map", path),
      `${value(entry, "l0")}/${value(entry, "l1")}/${value(entry, "l2")}`,
    );
    mapEntity(
      `obj-${layer}-${id}`,
      {
        x: value(entry, "x"),
        y: value(entry, "y"),
        z: 2000 + layer * 30000 + value(entry, "z", 0),
      },
      await frames(resource),
      Boolean(value(entry, "f", 0)),
    );
  }
}
/** Original tile placements and zM ordering. */
async function tiles(layer, l) {
  const tileSet = value(at(l, "info"), "tS");
  for (const [id, entry] of Object.entries(at(l, "tile").children)) {
    const resource = at(
      image("Map", `Tile/${tileSet}.img`),
      `${value(entry, "u")}/${value(entry, "no")}`,
    );
    mapEntity(
      `tile-${layer}-${id}`,
      {
        x: value(entry, "x"),
        y: value(entry, "y"),
        z:
          19990 +
          layer * 30000 -
          value(entry, "zM", 0) * 10 +
          value(resource, "z", 0),
      },
      await frames(resource),
    );
  }
}
/** Background alpha and camera-relative tiling remain original metadata. */
async function backgrounds(map) {
  for (const [id, entry] of Object.entries(at(map, "back").children)) {
    const set = value(entry, "bS");
    if (!set) continue;
    const animated = Boolean(value(entry, "ani", 0));
    const resource = at(
      image("Map", `Back/${set}.img`),
      `${animated ? "ani" : "back"}/${value(entry, "no")}`,
    );
    const f = await frames(resource);
    const entity = mapEntity(
      `back-${id}`,
      {
        x: value(entry, "x", 0),
        y: value(entry, "y", 0),
        z: (value(entry, "front", 0) ? 272000 : -128000) + Number(id) * 1000,
      },
      f,
      Boolean(value(entry, "f", 0)),
    );
    entity.opacity = value(entry, "a", 255) / 255;
    entity.background = {
      type: value(entry, "type", 0),
      rx: value(entry, "rx", 0),
      ry: value(entry, "ry", 0),
      cx: value(entry, "cx", 0),
      cy: value(entry, "cy", 0),
    };
  }
}
/** Collect original equipment canvases for one body frame. */
function candidatesFor(equipment, action, index, bodyFrame) {
  const candidates = [];
  for (let e = 0; e < equipment.length; e++) {
    const item = equipment[e];
    let frame;
    if (e === 3) {
      if (!value(bodyFrame, "face", 0)) continue;
      frame = at(item, "default");
    } else {
      if (!item.children[action]) {
        throw new Error(`Missing equipment action ${item.source}/${action}`);
      }
      const a = at(item, action);
      if (!a.children[index]) {
        throw new Error(
          `Missing equipment frame ${item.source}/${action}/${index}`,
        );
      }
      frame = at(a, index);
    }
    for (const child of Object.values(frame.children)) {
      const c = resolveNode(child);
      if (c.type === "Canvas") candidates.push(c);
      else if (child.name === "hairShade" && c.children["0"]) {
        candidates.push(at(c, "0"));
      }
    }
  }
  return candidates;
}
/** Merge matching original avatar anchor names, retaining the first position. */
function addAnchors(anchors, canvas, p) {
  const maps = canvas.children.map;
  if (maps) {
    for (const [name, n] of Object.entries(at(canvas, "map").children)) {
      const v = resolveNode(n).value;
      if (!anchors[name]) anchors[name] = { x: p.x + v.x, y: p.y + v.y };
    }
  }
}
/** Match one canvas to an already placed original anchor. */
function anchorPosition(canvas, anchors) {
  if (!canvas.children.map) return undefined;
  for (const [name, n] of Object.entries(at(canvas, "map").children)) {
    if (!anchors[name]) continue;
    const v = resolveNode(n).value;
    return { x: anchors[name].x - v.x, y: anchors[name].y - v.y };
  }
  return undefined;
}
/** Bounded anchor resolution; an unconnected component is a conversion error. */
function placeCandidates(candidates, action, index) {
  const anchors = Object.create(null),
    positions = new Map();
  const body = candidates.find((c) => c.name === "body");
  if (!body) throw new Error(`Missing body canvas ${action}/${index}`);
  positions.set(body, { x: 0, y: 0 });
  addAnchors(anchors, body, { x: 0, y: 0 });
  let unresolved = candidates.filter((c) => c !== body);
  for (let pass = 0; unresolved.length && pass < candidates.length; pass++) {
    const next = [];
    for (const canvas of unresolved) {
      const position = anchorPosition(canvas, anchors);
      if (!position) {
        next.push(canvas);
        continue;
      }
      positions.set(canvas, position);
      addAnchors(anchors, canvas, position);
    }
    if (next.length === unresolved.length) {
      throw new Error(
        "Unconnected avatar anchors " + next.map(nodePath).join(", "),
      );
    }
    unresolved = next;
  }
  if (unresolved.length) throw new Error("Avatar anchor limit exceeded");
  return positions;
}
/** Compose one avatar frame without altering origin, anchor or depth data. */
async function avatarFrame(equipment, zmap, action, frameInfo) {
  const { index, count } = frameInfo;
  const bodyFrame = at(at(equipment[0], action), index);
  const candidates = candidatesFor(equipment, action, index, bodyFrame);
  const positions = placeCandidates(candidates, action, index);
  const parts = [];
  for (const canvas of candidates) {
    const position = positions.get(canvas);
    const z = value(canvas, "z");
    const rank = typeof z === "number" ? z : zmap.indexOf(z);
    if (rank === -1) throw new Error(`Unknown avatar z ${z}`);
    parts.push(await part(canvas, position.x, position.y, -rank));
  }
  const delay = value(bodyFrame, "delay", count === 1 ? 0 : undefined);
  if (!Number.isFinite(delay) || delay < 0 || (count > 1 && delay === 0)) {
    throw new Error(`Missing/invalid body delay ${action}/${index}`);
  }
  return { delay, parts };
}
/** All supported artwork actions from the original equipped character. */
async function avatar() {
  const zmap = Object.keys(image("Base", "zmap.img").children);
  const equipment = [
    "00002000.img",
    "00012000.img",
    "Hair/00030000.img",
    "Face/00020000.img",
    "Coat/01040002.img",
    "Pants/01060002.img",
    "Shoes/01072001.img",
  ].map((path) => image("Character", path));
  const actions = Object.create(null);
  for (const action of [
    "stand1",
    "walk1",
    "jump",
    "prone",
    "ladder",
    "rope",
    "sit",
  ]) {
    const bodyAction = at(equipment[0], action);
    const outputFrames = [];
    const indices = Object.keys(bodyAction.children)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    for (const index of indices) {
      outputFrames.push(
        await avatarFrame(equipment, zmap, action, {
          index,
          count: indices.length,
        }),
      );
    }
    actions[action] = outputFrames;
  }
  return { actions, equipment: equipment.map((node) => node.source) };
}
/** Extract a complete map's geometry and region-ready original artwork. */
async function extractMap(mapId, character) {
  state.entities = [];
  const mapPath = `Map/Map${mapId[0]}/${mapId}.img`;
  const map = image("Map", mapPath);
  const info = at(map, "info");
  if (info.children.link) {
    throw new Error(
      `Linked maps require explicit target extraction: ${value(info, "link")}`,
    );
  }
  for (let layer = 0; layer < 8; layer++) {
    const l = at(map, String(layer));
    await objects(layer, l);
    await tiles(layer, l);
  }
  await backgrounds(map);
  const portals = await extractPortals(extractionContext, map, mapId);
  const life = await extractLife(extractionContext, map, mapId);
  state.entities.push(...portals.entities, ...life.entities);
  const actions = character.actions;
  const portal = Object.values(at(map, "portal").children).find(
    (p) => value(p, "pn") === "sp",
  );
  if (!portal) throw new Error("Map has no spawn portal for demo placement");
  const x = value(portal, "x"),
    y = value(portal, "y") - 10; // 0094969a: original portal-entry feet offset.
  state.entities.push({
    id: "character",
    kind: "character",
    x,
    y,
    z: 239997, // 009b12a8 / 0092fd16: local user before first foothold, plane7/group0.
    visible: true,
    flip: false,
    opacity: 1,
    action: "stand1",
    actions,
  });
  for (let index = 0; index < state.entities.length; index++) {
    state.entities[index].order = index;
  }
  return {
    id: mapId,
    source: `Map.wz:${mapPath}`,
    bounds: mapBounds(map),
    camera: { x: x - 400, y: y - 360 },
    entities: state.entities,
    physics: readPhysicsData(map, image("Map", "Physics.img")),
    equipment: character.equipment,
    portalPresentation: portals.presentation,
    life: life.life,
    evidence: [
      "docs/asset-evidence.md",
      "docs/client-evidence.md",
      "docs/physics-options.md",
    ],
  };
}
/** Conversion diagnostics are not part of content identities. */
function conversionReport(buildId, reports) {
  return {
    schemaVersion: 2,
    buildId,
    inputDirectory: source,
    maps: reports,
    policy: {
      atlasLimit: ATLAS_LIMIT,
      padding: PADDING,
      regionSize: REGION_SIZE,
      maxMaps: 32,
    },
    counts: {
      textures: Object.keys(textures).length,
      atlases: Object.keys(state.atlases).length,
      images: images.size,
    },
    bytes: {
      originalRGBA: state.rgbaBytes,
      roundTripCompared: state.verifiedBytes,
      atlasPNG: Object.values(state.atlases).reduce(
        (sum, a) => sum + a.bytes,
        0,
      ),
    },
    pixelRoundTrip: {
      passed: true,
      method:
        "PNG IDAT independently inflated and each RGBA subrect row compared byte-for-byte",
    },
    formats,
    images: [...images.keys()],
    durationMs: performance.now() - started,
    limitations: [
      "Camera fallback derived from footholds; exact original fallback remains unverified.",
      "Map metadata retains active unsupported physics in physics.unsupported.",
      "Background effect IMG and NPC/mob artwork are not reconstructed.",
    ],
  };
}
/** Publish diagnostics after the content-addressed catalog has been committed. */
async function publishReport(catalog, reports) {
  const { buildId, maps, hitboxes } = catalog;
  const report = conversionReport(buildId, reports);
  report.inputs = inputImages;
  report.tiledCanvases = state.tiledCanvases;
  report.bytes.tileReconstructionCompared = Object.values(
    state.tiledCanvases,
  ).reduce((sum, item) => sum + item.comparedBytes, 0);
  report.counts.textures = Object.keys(state.textures).length;
  report.bytes.mapJSON = Object.values(maps).reduce(
    (sum, item) => sum + item.bytes,
    0,
  );
  report.bytes.hitboxReferencesJSON = hitboxes.bytes;
  report.bytes.catalogJSON = Buffer.byteLength(JSON.stringify(catalog));
  report.bytes.regionJSON = Object.values(state.regions).reduce(
    (sum, item) => sum + item.bytes,
    0,
  );
  report.bytes.atlasDecodedRGBA = Object.values(state.atlases).reduce(
    (sum, item) => sum + item.width * item.height * 4,
    0,
  );
  report.counts.regions = reports.reduce((sum, item) => sum + item.regions, 0);
  await Bun.write(
    resolve(root, "docs/extraction.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
}
/** Atomic catalog is the only mutable entry point. */
async function run() {
  const character = await avatar();
  const ui = await extractGameUI(extractionContext);
  const audiovisual = await extractAudiovisual(extractionContext, mapIds);
  const maps = Object.create(null),
    reports = [];
  for (const id of mapIds) {
    const scene = await extractMap(id, character);
    const result = await packageMap(scene, state);
    const neighbors = [
      ...new Set(
        scene.physics.portals.map((portal) =>
          String(portal.targetMap).padStart(9, "0"),
        ),
      ),
    ]
      .filter((target) => target !== id && mapIds.includes(target))
      .sort();
    maps[id] = { ...result.descriptor, neighbors };
    reports.push({
      id,
      entities: scene.entities.length,
      regions: result.manifest.regions.length,
      textures: Object.keys(result.manifest.textures).length,
      physics: scene.physics.map,
    });
  }
  const references = extractHitboxReferences(image);
  const hitboxes = await resource(
    output,
    "references",
    "json",
    Buffer.from(JSON.stringify(references)),
  );
  const buildId = hash(
    Buffer.from(JSON.stringify({ maps, hitboxes, ui, audiovisual })),
  );
  const catalog = {
    schemaVersion: 2,
    buildId,
    defaultMap: mapIds.includes("100000000") ? "100000000" : mapIds[0],
    maps,
    hitboxes,
    ui,
    audiovisual,
  };
  await Bun.write(resolve(output, "catalog.json.tmp"), JSON.stringify(catalog));
  renameSync(
    resolve(output, "catalog.json.tmp"),
    resolve(output, "catalog.json"),
  );
  await publishReport(catalog, reports);
}
try {
  await run();
} finally {
  for (const a of archives.values()) a.close();
}
