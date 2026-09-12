import { resolve } from "node:path";
import { WzArchive } from "../src/assets/wz.js";
import { at, parseImage, resolveNode, value } from "../src/assets/image.js";
import { decodeCanvas } from "../src/assets/canvas.js";

const MAX_MAPS = 16;
const MAX_PLACEMENTS = 4096;
const MAX_FRAMES = 1024;
const MAX_FOOTHOLDS = 65536;

/** Original-WZ geometry probe; no output assets, placement correction or runtime state. */
function canvases(node) {
  node = resolveNode(node);
  if (node.type === "Canvas") return [node];
  const keys = Object.keys(node.children).filter((key) => /^\d+$/.test(key));
  if (keys.length > MAX_FRAMES) throw new Error("Origin frame limit exceeded");
  return keys
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => resolveNode(node.children[key]));
}

/** Bottommost nontransparent pixel is evidence, never a replacement for canvas origin. */
function frameRecord(node) {
  const origin = value(node, "origin", { x: 0, y: 0 });
  const pixels = decodeCanvas(node);
  let opaqueBottom = null;
  for (let y = pixels.height - 1; y >= 0 && opaqueBottom === null; y--) {
    for (let x = 0; x < pixels.width; x++) {
      if (pixels.rgba[(y * pixels.width + x) * 4 + 3]) {
        opaqueBottom = y + 1 - origin.y;
        break;
      }
    }
  }
  return {
    frame: node.name,
    width: node.width,
    height: node.height,
    origin,
    canvasBottom: node.height - origin.y,
    opaqueBottom,
    delay: value(node, "delay", null),
  };
}

function footholds(map) {
  const result = new Map();
  for (const layer of Object.values(at(map, "foothold").children)) {
    for (const group of Object.values(layer.children)) {
      for (const node of Object.values(group.children)) {
        if (result.size >= MAX_FOOTHOLDS) {
          throw new Error("Origin foothold limit exceeded");
        }
        result.set(Number(node.name), {
          layer: Number(layer.name),
          group: Number(group.name),
          x1: value(node, "x1"),
          y1: value(node, "y1"),
          x2: value(node, "x2"),
          y2: value(node, "y2"),
        });
      }
    }
  }
  return result;
}

function npcRecords(map, images) {
  const planes = footholds(map);
  const placements = Object.entries(at(map, "life").children);
  if (placements.length > MAX_PLACEMENTS) {
    throw new Error("Origin placement limit exceeded");
  }
  const records = [];
  for (const [index, node] of placements) {
    if (value(node, "type") !== "n") continue;
    const id = String(value(node, "id")).padStart(7, "0");
    let image = images.read("Npc", `${id}.img`);
    const link = value(at(image, "info"), "link");
    if (link !== undefined) {
      image = images.read("Npc", `${String(link).padStart(7, "0")}.img`);
    }
    const x = value(node, "x"),
      y = value(node, "y"),
      fh = value(node, "fh");
    const segment = planes.get(fh);
    const groundY =
      segment && segment.x2 > segment.x1 && x >= segment.x1 && x <= segment.x2
        ? segment.y1 +
          ((x - segment.x1) * (segment.y2 - segment.y1)) /
            (segment.x2 - segment.x1)
        : null;
    const stand = image.children.stand;
    records.push({
      index,
      id,
      x,
      y,
      cy: value(node, "cy", null),
      fh,
      segment: segment ?? null,
      authoredGroundGap: groundY === null ? null : groundY - y,
      frames: stand ? canvases(stand).map(frameRecord) : [],
    });
  }
  return records;
}

function backgroundRecords(map, images) {
  const entries = Object.entries(at(map, "back").children);
  if (entries.length > MAX_PLACEMENTS) {
    throw new Error("Origin background limit exceeded");
  }
  const records = [];
  for (const [index, node] of entries) {
    const set = value(node, "bS");
    if (!set) continue;
    const path = `${value(node, "ani", 0) ? "ani" : "back"}/${value(node, "no")}`;
    const image = images.read("Map", `Back/${set}.img`);
    records.push({
      index,
      source: `Map.wz:Back/${set}.img/${path}`,
      x: value(node, "x", 0),
      y: value(node, "y", 0),
      front: value(node, "front", 0),
      type: value(node, "type", 0),
      rx: value(node, "rx", 0),
      ry: value(node, "ry", 0),
      cx: value(node, "cx", 0),
      cy: value(node, "cy", 0),
      flip: value(node, "f", 0),
      z: (value(node, "front", 0) ? 272000 : -128000) + Number(index) * 1000,
      frames: canvases(at(image, path)).map(frameRecord),
    });
  }
  return records;
}

/** Cache parsed original IMGs only for this bounded inspector invocation. */
class Images {
  constructor(source) {
    this.archives = new Map(
      ["Map", "Npc"].map((name) => [
        name,
        new WzArchive(resolve(source, `${name}.wz`)),
      ]),
    );
    this.cache = new Map();
  }
  read(archive, path) {
    const key = `${archive}:${path}`;
    if (!this.cache.has(key)) {
      this.cache.set(
        key,
        parseImage(this.archives.get(archive).imageReader(path)),
      );
    }
    return this.cache.get(key);
  }
  close() {
    for (const archive of this.archives.values()) archive.close();
  }
}

/** Usage: bun tools/openms.js audit origins SOURCE MAP_ID[,MAP_ID...] OUTPUT.json */
async function main(args) {
  const [source, ids, output] = args;
  if (!source || !ids || !output || !/^\d{9}(,\d{9})*$/.test(ids)) {
    throw new Error("Expected SOURCE MAP_IDS OUTPUT.json");
  }
  const maps = ids.split(",");
  if (maps.length > MAX_MAPS) throw new Error("Origin map limit exceeded");
  const images = new Images(source);
  const report = [];
  try {
    for (const id of maps) {
      const map = images.read("Map", `Map/Map${id[0]}/${id}.img`);
      report.push({
        map: id,
        npcs: npcRecords(map, images),
        backgrounds: backgroundRecords(map, images),
      });
    }
  } finally {
    images.close();
  }
  await Bun.write(output, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      report.map((map) => ({
        map: map.map,
        npcs: map.npcs.length,
        backgrounds: map.backgrounds.length,
        aboveGround: map.npcs.filter((npc) => npc.authoredGroundGap > 1).length,
      })),
    ),
  );
}

if (import.meta.main) await main(Bun.argv.slice(2));
