import { at, resolveNode, value } from "../src/assets/image.js";

const MAX_MAPS = 512;
const MAX_PLACEMENTS = 4096;
const MAX_NPCS = 8192;
const MAX_SAY_NODES = 200000;

/** Selected-map NPC identities, never scene placement artwork or invented portrait data. */
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
  await collectSpeakers(context, ids);
  const portraits = Object.create(null);
  for (const id of ids) portraits[id] = await portraitBundle(context, id);
  return portraits;
}

/** Original Say/npc overrides remain available even when the speaker is off-map. */
async function collectSpeakers(context, ids) {
  const stack = [await context.image("Quest", "Say.img")];
  for (let count = 0; stack.length; count++) {
    if (count >= MAX_SAY_NODES) {
      throw new Error("Quest speaker traversal exceeds policy");
    }
    const node = stack.pop();
    for (const [key, child] of Object.entries(node.children ?? {})) {
      if (key === "npc" && child.value > 0) {
        if (!Number.isSafeInteger(child.value) || child.value > 9999999) {
          throw new Error("Invalid quest portrait speaker");
        }
        ids.add(String(child.value));
        if (ids.size > MAX_NPCS) throw new Error("NPC portrait limit exceeded");
      }
      if (child.children) stack.push(child);
    }
  }
}

/** 009a677b loads info/default first; absent canvas uses the original NPC action loader. */
async function portraitBundle(context, id) {
  const { node, source } = await portraitCanvas(
    context,
    `${id.padStart(7, "0")}.img`,
  );
  if (node?.type !== "Canvas") {
    return {
      available: false,
      reason: "Original NPC has no default portrait or stand frame.",
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
  const root =
    link === null ? original : await context.image("Npc", artworkName);
  const stand = root.children.stand ? resolveNode(root.children.stand) : null;
  const frame = stand?.children["0"];
  return {
    node: frame ? resolveNode(frame) : null,
    source: `Npc.wz:${artworkName}/stand/0`,
  };
}
