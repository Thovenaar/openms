import { at, parseImage, resolveNode, value } from "../src/assets/image.js";
import { WzArchive } from "../src/assets/wz.js";
import { resolve } from "node:path";

// Complete Map.wz:WorldMap directory inventory, measured from the original v83 archive.
const MAP_NAMES = [
  "WorldMap",
  "WorldMap000",
  "WorldMap010",
  "WorldMap011",
  "WorldMap012",
  "WorldMap013",
  "WorldMap020",
  "WorldMap021",
  "WorldMap030",
  "WorldMap031",
  "WorldMap040",
  "WorldMap050",
  "WorldMap051",
  "WorldMap060",
  "WorldMap070",
  "WorldMap080",
  "WorldMap090",
  "WorldMap100",
  "WorldMap140",
  "WorldMap141",
  "WorldMap142",
];
const MAX_NODES = 16000;
const MAX_DEPTH = 32;
const MAX_SPOTS = 256;
const MAX_FIELDS = 512;
const MAX_LINKS = 64;

function children(node, limit, label) {
  const entries = Object.entries(node?.children || {});
  if (entries.length > limit) {
    throw new Error(`World map ${label} exceeds ${limit}`);
  }
  return entries;
}

/** Keep exact authored spots, string/int mapNo values, parent links and descriptions. */
export function readWorldMap(root, name) {
  const spots = [];
  for (const [id, node] of children(
    root.children.MapList,
    MAX_SPOTS,
    "spots",
  )) {
    const spot = value(node, "spot", null);
    const type = value(node, "type", null);
    if (
      !spot ||
      !Number.isFinite(spot.x) ||
      !Number.isFinite(spot.y) ||
      !Number.isInteger(type)
    ) {
      throw new Error(`Invalid original world map spot ${name}/${id}`);
    }
    const maps = children(node.children.mapNo, MAX_FIELDS, "mapNo").map(
      ([, field]) => Number(field.value),
    );
    if (maps.some((id) => !Number.isSafeInteger(id) || id < 0)) {
      throw new Error(`Invalid world map field ${name}/${id}`);
    }
    spots.push({
      id,
      x: spot.x,
      y: spot.y,
      type,
      maps,
      title: value(node, "title", ""),
      description: value(node, "desc", ""),
    });
  }
  const links = children(root.children.MapLink, MAX_LINKS, "links").map(
    ([id, node]) => ({
      id,
      target: value(at(node, "link"), "linkMap", null),
      title: value(node, "toolTip", ""),
      path: `${name}/MapLink/${id}/link/linkImg`,
    }),
  );
  return {
    name,
    parent: value(root.children.info, "parentMap", null),
    spots,
    links,
  };
}

async function canvases(context, state, { root, prefix }, canvasRecord) {
  const stack = [{ node: root, path: prefix, depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const entry = stack.pop();
    if (++visited > MAX_NODES || entry.depth > MAX_DEPTH) {
      throw new Error("World map canvas traversal limit exceeded");
    }
    const node = resolveNode(entry.node);
    if (node.type === "Canvas") {
      const record = await canvasRecord(
        context,
        node,
        entry.path,
        state.entities.length,
      );
      state.entities.push(record.entity);
      state.assets[entry.path] = record.asset;
      continue;
    }
    for (const [name, child] of children(node, MAX_NODES, "canvas children")) {
      stack.push({
        node: child,
        path: `${entry.path}/${name}`,
        depth: entry.depth + 1,
      });
    }
  }
}

/** One lazy UI-owned bundle; original art, not an invented minimap or external image loader. */
export async function extractWorldMaps(context, canvasRecord) {
  const state = { entities: [], assets: Object.create(null) };
  const worldMaps = Object.create(null);
  const ui = await context.image("UI", "UIWindow.img");
  await canvases(
    context,
    state,
    { root: at(ui, "WorldMap"), prefix: "WorldMapUI" },
    canvasRecord,
  );
  const helper = await context.image("Map", "MapHelper.img");
  await canvases(
    context,
    state,
    { root: at(helper, "worldMap"), prefix: "WorldMapHelper" },
    canvasRecord,
  );
  for (const name of MAP_NAMES) {
    const root = await context.image("Map", `WorldMap/${name}.img`);
    worldMaps[name] = readWorldMap(root, name);
    await canvases(context, state, { root, prefix: name }, canvasRecord);
  }
  for (const map of Object.values(worldMaps)) {
    map.parentAvailable = !map.parent || Boolean(worldMaps[map.parent]);
    for (const link of map.links) {
      if (!worldMaps[link.target] || !state.assets[link.path]) {
        throw new Error(`Unresolved world map link ${map.name}/${link.id}`);
      }
    }
  }
  return context.bundle({
    id: "ui:WorldMap:original",
    entities: state.entities,
    metadata: {
      source:
        "Map.wz:WorldMap/*.img;MapHelper.img/worldMap;UI.wz:UIWindow.img/WorldMap",
      assets: state.assets,
      worldMaps,
      authority:
        "Original artwork, authored mapNo nodes, spots and parent/linkMap navigation. No teleport authority.",
    },
  });
}

/** Focused source audit: no atlases, generated asset writes or full extraction. */
export function inspectWorldMaps(source) {
  const archive = new WzArchive(resolve(source, "Map.wz"));
  try {
    const paths = [...archive.entries.keys()].filter(
      (path) => path.startsWith("WorldMap/") && path.endsWith(".img"),
    );
    if (paths.length > 32) {
      throw new Error("Original world map inventory exceeds audit bound");
    }
    const maps = paths.map((path) =>
      readWorldMap(parseImage(archive.imageReader(path)), path.slice(9, -4)),
    );
    const names = new Set(maps.map((map) => map.name));
    if (
      names.size !== MAP_NAMES.length ||
      MAP_NAMES.some((name) => !names.has(name))
    ) {
      throw new Error(
        "World map source inventory changed; review extraction coverage",
      );
    }
    return {
      source: archive.path,
      maps: maps.map((map) => ({
        name: map.name,
        spots: map.spots.length,
        links: map.links.length,
        parent: map.parent,
      })),
      spots: maps.reduce((count, map) => count + map.spots.length, 0),
      unresolvedParents: maps
        .filter((map) => map.parent && !names.has(map.parent))
        .map((map) => ({ name: map.name, parent: map.parent })),
      unresolvedLinks: maps.flatMap((map) =>
        map.links
          .filter((link) => !names.has(link.target))
          .map((link) => ({ name: map.name, target: link.target })),
      ),
    };
  } finally {
    archive.close();
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    throw new Error(
      "Usage: bun client/tools/worldmap-data.js <original-asset-directory>",
    );
  }
  console.log(JSON.stringify(inspectWorldMaps(args[0]), null, 2));
}
