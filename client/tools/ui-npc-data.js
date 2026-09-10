import { at, resolveNode, value } from "../src/assets/image.js";
import { validNpcArtworkPath } from "../src/npc-script-markup.js";

const MAX_MAPS = 512;
const MAX_PLACEMENTS = 4096;
const MAX_NPCS = 8192;
const MAX_ARTWORK = 8192;
const MAX_QUESTS = 4096;
const ART_ARCHIVES = new Set([
  "UI",
  "Item",
  "Character",
  "Effect",
  "Map",
  "Mob",
  "Npc",
  "Skill",
  "Etc",
  "String",
  "Reactor",
]);

/** Original portraits close every script/journal dependency, even when its NPC is off-map. */
export async function extractNpcPortraits(context) {
  if (!Array.isArray(context.mapIds) || context.mapIds.length > MAX_MAPS) {
    throw new Error("NPC portraits require bounded selected maps");
  }
  const ids = new Set();
  for (const mapId of context.mapIds) {
    const map = await context.image("Map", `Map/Map${mapId[0]}/${mapId}.img`);
    const placements = Object.values(map.children.life?.children ?? {});
    if (placements.length > MAX_PLACEMENTS) {
      throw new Error("NPC placement limit exceeded");
    }
    for (const node of placements) {
      if (value(node, "type") !== "n") continue;
      const id = value(node, "id");
      if (!/^\d{1,7}$/.test(id)) {
        throw new Error("Invalid NPC portrait identity");
      }
      ids.add(String(Number(id)));
      if (ids.size > MAX_NPCS) throw new Error("NPC portrait limit exceeded");
    }
  }
  collectSpeakers(context, ids);
  const portraits = Object.create(null);
  for (const id of [...ids].sort((a, b) => Number(a) - Number(b))) {
    portraits[id] = await portraitBundle(context, id);
  }
  return portraits;
}

/** Consume canonical compiled dependency inventories rather than reparsing Say or scripts. */
function collectSpeakers(context, ids) {
  const lists = [context.serverData.supportedDependencies.npcIds];
  const records = Object.values(context.quests.records);
  if (records.length > MAX_QUESTS) {
    throw new Error("Quest portrait record limit");
  }
  for (const record of records) lists.push(record.dependencies.npcIds);
  for (const list of lists) {
    if (list.length > MAX_NPCS) {
      throw new Error("NPC portrait dependency limit");
    }
    for (const id of list) {
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("Invalid NPC portrait dependency");
      }
      ids.add(String(id));
    }
    if (ids.size > MAX_NPCS) throw new Error("NPC portrait limit exceeded");
  }
}

/** 009a677b loads info/default first; absent canvas uses the original NPC action loader. */
async function portraitBundle(context, id) {
  const sourcePath = `${id.padStart(7, "0")}.img`;
  if (!context.imageEntries("Npc").has(sourcePath)) {
    return {
      available: false,
      source: `Npc.wz:${sourcePath}`,
      reason: "Original NPC IMG is absent from archive index",
    };
  }
  const { node, source } = await portraitCanvas(
    context,
    `${id.padStart(7, "0")}.img`,
  );
  if (node?.type !== "Canvas") {
    return {
      available: false,
      source,
      reason: `Original NPC portrait source has no default canvas or stand frame: ${source}`,
    };
  }
  const asset = {
    id: "NpcPortrait",
    width: node.width,
    height: node.height,
    origin: value(node, "origin", { x: 0, y: 0 }),
    delay: null,
  };
  const entity = {
    id: "NpcPortrait",
    kind: "ui",
    order: 0,
    x: 0,
    y: 0,
    z: 0,
    visible: true,
    flip: false,
    opacity: 1,
    action: "default",
    actions: { default: [{ delay: 1, parts: [await context.part(node)] }] },
  };
  const descriptor = await context.bundle({
    id: `ui:npc-portrait:${id}`,
    entities: [entity],
    metadata: {
      source,
      assets: { NpcPortrait: asset },
      presentation:
        "Original default canvas or static stand frame; native action animation is not reconstructed.",
    },
  });
  return { available: true, descriptor };
}

async function portraitCanvas(context, imageName) {
  const original = await context.image("Npc", imageName);
  const info = at(original, "info");
  const authored = info.children.default;
  const node = authored ? resolveNode(authored) : null;
  if (node?.type === "Canvas") {
    return { node, source: `Npc.wz:${imageName}/info/default` };
  }
  const link = value(info, "link", null);
  if (link !== null && !/^\d{1,7}$/.test(link)) {
    throw new Error("Invalid NPC portrait link");
  }
  const artworkName =
    link === null ? imageName : `${String(link).padStart(7, "0")}.img`;
  if (!context.imageEntries("Npc").has(artworkName)) {
    return { node: null, source: `Npc.wz:${artworkName}` };
  }
  const root =
    link === null ? original : await context.image("Npc", artworkName);
  const stand = root.children.stand ? resolveNode(root.children.stand) : null;
  const frame = stand?.children["0"];
  return {
    node: frame ? resolveNode(frame) : null,
    source: `Npc.wz:${artworkName}/stand/0`,
  };
}

/** Resolve exact original #f/F paths without rewriting case, aliases or archive ownership. */
async function dialogueCanvas(context, path) {
  const match = /^([A-Za-z]+)\/([^?#]+?\.img)(?:\/([^?#]+))?$/.exec(path);
  if (!match || !ART_ARCHIVES.has(match[1]) || !validNpcArtworkPath(path)) {
    return {
      reason: "Original artwork token has no admitted archive/IMG path",
    };
  }
  const [, archive, image, childPath = ""] = match;
  const source = `${archive}.wz:${image}${childPath ? `/${childPath}` : ""}`;
  if (!context.imageEntries(archive).has(image)) {
    return {
      source,
      reason: "Original artwork IMG is absent from archive index",
    };
  }
  let node = await context.image(archive, image);
  for (const name of childPath ? childPath.split("/") : []) {
    node = resolveNode(node).children[name];
    if (!node) {
      return {
        source,
        reason: "Original artwork node is absent from the named IMG",
      };
    }
  }
  node = resolveNode(node);
  return node.type === "Canvas"
    ? { source, node }
    : { source, reason: `Original artwork node is ${node.type}, not a Canvas` };
}

/** One lazy descriptor per admitted exact path; missing original records remain explicit. */
export async function extractDialogArtwork(context, canvasRecord) {
  const requested = context.serverData.supportedDependencies.artworkPaths;
  if (!Array.isArray(requested) || requested.length > MAX_ARTWORK) {
    throw new Error("Dialog artwork dependency limit");
  }
  const paths = new Set(requested);
  const records = Object.values(context.quests.records);
  if (records.length > MAX_QUESTS) {
    throw new Error("Dialog artwork quest limit");
  }
  for (const record of records) {
    if (record.dependencies.artworkPaths.length > MAX_ARTWORK) {
      throw new Error("Quest artwork dependency limit");
    }
    for (const path of record.dependencies.artworkPaths) paths.add(path);
    if (paths.size > MAX_ARTWORK) {
      throw new Error("Dialog artwork closure limit");
    }
  }
  const artwork = Object.create(null);
  for (const path of [...paths].sort()) {
    const original = await dialogueCanvas(context, path);
    if (!original.node) {
      artwork[path] = {
        available: false,
        source: original.source ?? path,
        reason: original.reason,
      };
      continue;
    }
    const record = await canvasRecord(context, original.node, path, 0);
    const descriptor = await context.bundle({
      id: `ui:dialog-artwork:${path}`,
      entities: [record.entity],
      metadata: { source: original.source, assets: { [path]: record.asset } },
    });
    artwork[path] = {
      descriptor,
      path,
      width: record.asset.width,
      height: record.asset.height,
    };
  }
  return artwork;
}
