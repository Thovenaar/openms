import { at, value, resolveNode } from "../src/assets/image.js";
import { skillVisuals } from "./skill-data.js";
import { extractSkillRiding } from "./skill-riding-data.js";

const MORPHS = [1000, 1001, 1002, 1003, 1100, 1101, 1103];
const MAX_ACTIONS = 128;

/** Original Morph.wz templates, independent of the equipped Character artwork. */
async function extractForm(context, id) {
  const image = `${String(id).padStart(4, "0")}.img`;
  const root = context.image("Morph", image);
  const actions = Object.create(null);
  const entries = Object.entries(root.children);
  if (entries.length > MAX_ACTIONS) {
    throw new Error("Morph action bound exceeded");
  }
  for (const [name, child] of entries) {
    if (name === "info") continue;
    const node = resolveNode(child);
    if (!node.children?.["0"]) continue;
    actions[name] = await context.frames(node);
  }
  const info = at(root, "info");
  const entity = {
    id: `morph:${id}`,
    order: 0,
    kind: "effect",
    x: 0,
    y: 0,
    z: 0,
    visible: true,
    flip: false,
    opacity: 1,
    action: "stand",
    actions,
  };
  return {
    source: `Morph.wz:${image}`,
    speed: value(info, "speed", 100),
    jump: value(info, "jump", 100),
    fs: value(info, "fs", 1),
    swim: value(info, "swim", 100),
    hide: value(info, "hide", 0),
    superman: value(info, "superman", 0),
    bundle: await context.bundle({
      id: entity.id,
      entities: [entity],
      metadata: { source: `Morph.wz:${image}` },
    }),
  };
}

/** Called once by ui-data. Every returned bundle is a delivery/validation root. */
export async function extractSkillWorld(context) {
  const forms = Object.create(null);
  for (const id of MORPHS) forms[id] = await extractForm(context, id);
  const root = context.image("Effect", "BasicEff.img");
  const effects = Object.create(null);
  for (const path of ["Teleport", "Flying", "Flying1", "SoulRush"]) {
    const sequences = await skillVisuals(context, {
      id: `world:${path}`,
      node: at(root, path),
      source: `Effect.wz:BasicEff.img/${path}`,
    });
    effects[path] = sequences[""];
  }
  return {
    forms,
    effects,
    maps: extractDoorMaps(context),
    riding: await extractSkillRiding(context),
  };
}

function extractDoorMaps(context) {
  if (context.mapIds.length > 4096) throw new Error("Door map bound exceeded");
  const maps = Object.create(null);
  for (const mapId of context.mapIds) {
    const id = String(mapId).padStart(9, "0");
    const root = context.image("Map", `Map/Map${id[0]}/${id}.img`);
    const info = at(root, "info");
    const doors = [];
    const portals = Object.entries(at(root, "portal").children);
    if (portals.length > 4096) throw new Error("Door portal bound exceeded");
    for (const [key, portal] of portals) {
      if (value(portal, "pt") !== 6) continue;
      doors.push({
        id: Number(key),
        name: value(portal, "pn"),
        x: value(portal, "x"),
        y: value(portal, "y"),
      });
    }
    doors.sort((a, b) => a.id - b.id);
    maps[id] = {
      returnMap: String(value(info, "returnMap")).padStart(9, "0"),
      fieldLimit: value(info, "fieldLimit", 0),
      doors,
    };
  }
  return maps;
}
