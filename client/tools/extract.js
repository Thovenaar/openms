import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { WzArchive } from "../src/assets/wz.js";
import { parseImage, at, value, resolveNode } from "../src/assets/image.js";
import { decodeCanvas } from "../src/assets/canvas.js";
import { encodePNG } from "../src/assets/png.js";

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
const mapId = option("--map", "100000000");
if (!/^\d{9}$/.test(mapId))
  throw new Error("--map must be a nine-digit original map ID");
const started = performance.now();
const output = resolve(root, "client/public/generated");
mkdirSync(resolve(output, "textures"), { recursive: true });
const archives = new Map(),
  images = new Map(),
  canvasIds = new WeakMap();
const textures = Object.create(null),
  formats = Object.create(null),
  entities = [],
  observations = [];
let textureBytes = 0;
/** @param {string} name */
function archive(name) {
  if (!archives.has(name))
    archives.set(name, new WzArchive(resolve(source, `${name}.wz`)));
  return archives.get(name);
}
/** @param {string} name @param {string} path */
function image(name, path) {
  const key = `${name}.wz:${path}`;
  if (!images.has(key)) {
    const node = parseImage(archive(name).imageReader(path));
    node.source = key;
    images.set(key, node);
  }
  return images.get(key);
}
/** @param {import('../src/assets/image.js').WzNode} node */
function nodePath(node) {
  const parts = [];
  while (node.parent) {
    parts.unshift(node.name);
    node = node.parent;
  }
  return `${node.source}/${parts.join("/")}`;
}
/** @param {import('../src/assets/image.js').WzNode} node */
async function texture(node) {
  node = resolveNode(node);
  if (canvasIds.has(node)) return canvasIds.get(node);
  const decoded = decodeCanvas(node);
  const id = createHash("sha256")
    .update(`${decoded.width}x${decoded.height}:`)
    .update(decoded.rgba)
    .digest("hex");
  if (!textures[id]) {
    const png = encodePNG(decoded.width, decoded.height, decoded.rgba);
    await Bun.write(resolve(output, "textures", `${id}.png`), png);
    textures[id] = {
      url: `/generated/textures/${id}.png`,
      width: decoded.width,
      height: decoded.height,
      source: nodePath(node),
      format: decoded.format,
      scale: decoded.scale,
    };
    textureBytes += decoded.rgba.length;
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
  if (node.type === "Canvas")
    return [{ delay: value(node, "delay", 120), parts: [await part(node)] }];
  const result = [];
  let carriedAlpha = 255;
  for (const key of Object.keys(node.children)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b))) {
    const frame = at(node, key);
    if (frame.type !== "Canvas")
      throw new Error(`Expected Canvas animation frame: ${nodePath(frame)}`);
    const delay = value(frame, "delay", 120);
    if (delay <= 0)
      throw new Error(`Nonpositive frame delay at ${nodePath(frame)}`);
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
/** @param {string} id @param {number} x @param {number} y @param {number} z @param {any[]} frameList @param {boolean} [flip] */
function mapEntity(id, x, y, z, frameList, flip = false) {
  const entity = {
    id,
    kind: "map",
    x,
    y,
    z,
    visible: true,
    opacity: 1,
    flip,
    action: "default",
    actions: { default: frameList },
  };
  entities.push(entity);
  return entity;
}

try {
  const mapPath = `Map/Map${mapId[0]}/${mapId}.img`;
  const map = image("Map", mapPath);
  const info = at(map, "info");
  if (info.children.link)
    throw new Error(
      `Linked maps require explicit target extraction: ${value(info, "link")}`,
    );
  const mapBounds = {
    left: Infinity,
    top: Infinity,
    right: -Infinity,
    bottom: -Infinity,
  };
  function include(x, y) {
    mapBounds.left = Math.min(mapBounds.left, x);
    mapBounds.right = Math.max(mapBounds.right, x);
    mapBounds.top = Math.min(mapBounds.top, y);
    mapBounds.bottom = Math.max(mapBounds.bottom, y);
  }
  function footholds(node) {
    if (node.children.x1) {
      include(value(node, "x1"), value(node, "y1"));
      include(value(node, "x2"), value(node, "y2"));
    } else for (const child of Object.values(node.children)) footholds(child);
  }
  footholds(at(map, "foothold"));
  const bounds = {
    left: value(info, "VRLeft", mapBounds.left - 100),
    right: value(info, "VRRight", mapBounds.right + 100),
    top: value(info, "VRTop", mapBounds.top - 500),
    bottom: value(info, "VRBottom", mapBounds.bottom + 100),
  };
  if (!Object.values(bounds).every(Number.isFinite))
    throw new Error("Map has no finite bounds/footholds");
  for (let layer = 0; layer < 8; layer++) {
    const l = at(map, String(layer));
    const tileSet = value(at(l, "info"), "tS");
    for (const [id, entry] of Object.entries(at(l, "obj").children)) {
      const path = `Obj/${value(entry, "oS")}.img`;
      const resource = at(
        image("Map", path),
        `${value(entry, "l0")}/${value(entry, "l1")}/${value(entry, "l2")}`,
      );
      mapEntity(
        `obj-${layer}-${id}`,
        value(entry, "x"),
        value(entry, "y"),
        2000 + layer * 30000 + value(entry, "z", 0),
        await frames(resource),
        Boolean(value(entry, "f", 0)),
      );
    }
    for (const [id, entry] of Object.entries(at(l, "tile").children)) {
      const resource = at(
        image("Map", `Tile/${tileSet}.img`),
        `${value(entry, "u")}/${value(entry, "no")}`,
      );
      mapEntity(
        `tile-${layer}-${id}`,
        value(entry, "x"),
        value(entry, "y"),
        19990 +
          layer * 30000 -
          value(entry, "zM", 0) * 10 +
          value(resource, "z", 0),
        await frames(resource),
      );
    }
  }
  // Retain original background data; camera-relative tiling is handled by the renderer.
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
      value(entry, "x", 0),
      value(entry, "y", 0),
      (value(entry, "front", 0) ? 272000 : -128000) + Number(id) * 1000,
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
      const bodyFrame = at(bodyAction, index);
      const candidates = [];
      for (let e = 0; e < equipment.length; e++) {
        const item = equipment[e];
        let frame;
        if (e === 3) {
          if (!value(bodyFrame, "face", 0)) continue;
          frame = at(item, "default");
        } else {
          if (!item.children[action])
            throw new Error(
              `Missing equipment action ${item.source}/${action}`,
            );
          const a = at(item, action);
          if (!a.children[index])
            throw new Error(
              `Missing equipment frame ${item.source}/${action}/${index}`,
            );
          frame = at(a, index);
        }
        for (const child of Object.values(frame.children)) {
          const c = resolveNode(child);
          if (c.type === "Canvas") candidates.push(c);
          else if (child.name === "hairShade" && c.children["0"])
            candidates.push(at(c, "0"));
        }
      }
      const anchors = Object.create(null),
        positions = new Map();
      const body = candidates.find((c) => c.name === "body");
      if (!body) throw new Error(`Missing body canvas ${action}/${index}`);
      positions.set(body, { x: 0, y: 0 });
      const addAnchors = (canvas, p) => {
        const maps = canvas.children.map;
        if (maps)
          for (const [name, n] of Object.entries(at(canvas, "map").children)) {
            const v = resolveNode(n).value;
            if (!anchors[name]) anchors[name] = { x: p.x + v.x, y: p.y + v.y };
          }
      };
      addAnchors(body, { x: 0, y: 0 });
      let unresolved = candidates.filter((c) => c !== body);
      while (unresolved.length) {
        const next = [];
        for (const canvas of unresolved) {
          let position;
          if (canvas.children.map)
            for (const [name, n] of Object.entries(
              at(canvas, "map").children,
            )) {
              if (anchors[name]) {
                const v = resolveNode(n).value;
                position = {
                  x: anchors[name].x - v.x,
                  y: anchors[name].y - v.y,
                };
                break;
              }
            }
          if (!position) {
            next.push(canvas);
            continue;
          }
          positions.set(canvas, position);
          addAnchors(canvas, position);
        }
        if (next.length === unresolved.length)
          throw new Error(
            `Unconnected avatar anchors ${next.map(nodePath).join(", ")}`,
          );
        unresolved = next;
      }
      const parts = [];
      for (const canvas of candidates) {
        const position = positions.get(canvas);
        const z = value(canvas, "z");
        const rank = typeof z === "number" ? z : zmap.indexOf(z);
        if (rank === -1) throw new Error(`Unknown avatar z ${z}`);
        parts.push(await part(canvas, position.x, position.y, -rank));
      }
      const delay = value(
        bodyFrame,
        "delay",
        indices.length === 1 ? 0 : undefined,
      );
      if (
        !Number.isFinite(delay) ||
        delay < 0 ||
        (indices.length > 1 && delay === 0)
      )
        throw new Error(`Missing/invalid body delay ${action}/${index}`);
      outputFrames.push({ delay, parts });
    }
    actions[action] = outputFrames;
  }
  const portal = Object.values(at(map, "portal").children).find(
    (p) => value(p, "pn") === "sp",
  );
  if (!portal) throw new Error("Map has no spawn portal for demo placement");
  const x = value(portal, "x"),
    y = value(portal, "y");
  entities.push({
    id: "character",
    kind: "character",
    x,
    y,
    z: 50000,
    visible: true,
    flip: false,
    opacity: 1,
    action: "stand1",
    actions,
  });
  const scene = {
    id: mapId,
    source: `Map.wz:${mapPath}`,
    bounds,
    camera: { x: x - 400, y: y - 360 },
    textures,
    entities,
    evidence: ["docs/asset-evidence.md", "docs/client-evidence.md"],
    equipment: equipment.map((n) => n.source),
  };
  await Bun.write(resolve(output, "scene.json.tmp"), JSON.stringify(scene));
  renameSync(resolve(output, "scene.json.tmp"), resolve(output, "scene.json"));
  const report = {
    map: scene.source,
    inputDirectory: source,
    version: 83,
    versionHash: archive("Map").hash,
    entities: entities.length,
    textures: Object.keys(textures).length,
    rgbaBytes: textureBytes,
    formats,
    images: [...images.keys()],
    archiveEntries: Object.fromEntries(
      [...archives].map(([k, a]) => [k, a.entries.size]),
    ),
    durationMs: performance.now() - started,
    memory: process.memoryUsage(),
    observations: [...new Set(observations)],
    limitations: [
      "Gameplay, NPC/mob simulation, portals and audio intentionally not implemented; map visual resources and composed avatar are the demo scope.",
      "Camera bounds derived from footholds when VR fields absent; exact original fallback formula pending evidence.",
    ],
  };
  await Bun.write(
    resolve(root, "docs/extraction.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({ ...report, images: report.images.length }, null, 2),
  );
} finally {
  for (const a of archives.values()) a.close();
}
