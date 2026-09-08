import { at, resolveNode, value } from "../src/assets/image.js";

const MAX_UI_NODES = 16000;
const MAX_UI_DEPTH = 64;
const BRANCHES = [
  "Item",
  "Equip",
  "Stat",
  "Skill",
  "GameMenu",
  "ShortCut",
  "KeyConfig",
  "MiniMap",
  "UtilDlgEx",
  "ToolTip",
  "GameOpt",
  "SysOpt",
];
const EQUIPMENT = [
  ["Coat", "01040002"],
  ["Pants", "01060002"],
  ["Shoes", "01072001"],
];

/** Each canvas is a static presentation entity. Delay=1 is a storage sentinel, never an original animation default. */
async function canvasRecord(context, node, path, order) {
  const originalDelay = value(node, "delay", null);
  const delay = originalDelay === null ? null : Number(originalDelay);
  if (delay !== null && (!Number.isFinite(delay) || delay <= 0)) {
    throw new Error(`Invalid UI delay: ${path}`);
  }
  const origin = value(node, "origin", { x: 0, y: 0 });
  const entity = {
    id: path,
    kind: "ui",
    order,
    x: 0,
    y: 0,
    z: order,
    visible: true,
    flip: false,
    opacity: 1,
    action: "default",
    actions: { default: [{ delay: 1, parts: [await context.part(node)] }] },
  };
  return {
    entity,
    asset: { id: path, width: node.width, height: node.height, origin, delay },
  };
}

/** Iterative traversal retains alias paths and original anchors; bounded path depth detects UOL ancestor cycles. */
async function branchBundle(context, imageName, branch, extras = []) {
  const root = await context.image("UI", imageName);
  const start = branch ? at(root, branch) : root;
  const stack = [{ node: start, path: branch, depth: 0 }];
  for (const extra of extras) {
    stack.push({ node: at(root, extra), path: extra, depth: 0 });
  }
  const entities = [],
    assets = Object.create(null);
  let visited = 0;
  while (stack.length) {
    if (++visited > MAX_UI_NODES) {
      throw new Error(`UI branch exceeds node budget: ${branch}`);
    }
    const item = stack.pop();
    if (item.depth > MAX_UI_DEPTH) {
      throw new Error(`UI branch exceeds depth budget: ${item.path}`);
    }
    const node = resolveNode(item.node);
    if (node.type === "Canvas") {
      const record = await canvasRecord(
        context,
        node,
        item.path,
        entities.length,
      );
      entities.push(record.entity);
      assets[item.path] = record.asset;
      continue;
    }
    for (const [name, child] of Object.entries(node.children)) {
      stack.push({
        node: child,
        path: item.path ? `${item.path}/${name}` : name,
        depth: item.depth + 1,
      });
    }
  }
  const metadata = {
    source: `UI.wz:${imageName}${branch ? `/${branch}` : ""}`,
    assets,
    timing:
      "Static canvases; absent frame timing unsupported. Explicit authored delays retained in assets.",
  };
  const descriptor = await context.bundle({
    id: `ui:${imageName}:${branch || "root"}`,
    entities,
    metadata,
  });
  return descriptor;
}

/** Static reconstruction avatar selection, not a server equipment inventory. */
async function equipmentBundle(context) {
  const strings = await context.image("String", "Eqp.img");
  const entities = [],
    equipment = [],
    assets = Object.create(null);
  for (const [category, id] of EQUIPMENT) {
    const image = await context.image("Character", `${category}/${id}.img`);
    const info = at(image, "info");
    const record = await canvasRecord(
      context,
      at(info, "icon"),
      `equipment:${id}`,
      entities.length,
    );
    entities.push(record.entity);
    assets[record.asset.id] = record.asset;
    const fields = Object.create(null);
    for (const [key, child] of Object.entries(info.children)) {
      if (
        /^(req|inc|tuc$|price$|cash$)/.test(key) &&
        ["number", "string"].includes(typeof child.value)
      ) {
        fields[key] = child.value;
      }
    }
    equipment.push({
      id,
      category,
      name: value(at(strings, `Eqp/${category}/${Number(id)}`), "name", id),
      asset: record.asset,
      fields,
    });
  }
  return context.bundle({
    id: "ui:reconstruction-equipment",
    entities,
    metadata: {
      equipment,
      assets,
      authority:
        "Exact static reconstruction avatar artwork selection; not live inventory or instance statistics.",
    },
  });
}

/** Original per-map minimap canvas and scalar coordinate metadata, independently demand-loaded. */
async function minimapBundle(context, mapId) {
  const path = `Map/Map${mapId[0]}/${mapId}.img`;
  const map = await context.image("Map", path);
  if (!map.children.miniMap) {
    return { available: false, reason: "Original map has no miniMap branch." };
  }
  const node = at(map, "miniMap");
  if (!node.children.canvas) {
    return { available: false, reason: "Original miniMap has no canvas." };
  }
  const record = await canvasRecord(
    context,
    at(node, "canvas"),
    "miniMap/canvas",
    0,
  );
  const properties = Object.create(null);
  for (const [key, child] of Object.entries(node.children)) {
    if (["number", "string"].includes(typeof child.value)) {
      properties[key] = child.value;
    }
  }
  const metadata = {
    source: `Map.wz:${path}/miniMap`,
    assets: { "miniMap/canvas": record.asset },
    properties,
  };
  const descriptor = await context.bundle({
    id: `ui:minimap:${mapId}`,
    entities: [record.entity],
    metadata,
  });
  return { available: true, descriptor };
}

/** Immutable catalog.ui schema v1. Bundles load only when the corresponding window is opened. */
export async function extractGameUI(context) {
  const bundles = Object.create(null);
  bundles.StatusBar = await branchBundle(context, "StatusBar.img", "");
  bundles.Basic = await branchBundle(context, "Basic.img", "BtClose", [
    "BtCancel2",
    "Tab2",
  ]);
  for (const branch of BRANCHES) {
    bundles[branch] = await branchBundle(context, "UIWindow.img", branch);
  }
  bundles.EquipmentPreview = await equipmentBundle(context);
  const minimaps = Object.create(null);
  if (!Array.isArray(context.mapIds) || context.mapIds.length > 32) {
    throw new Error("UI extraction requires bounded selected map IDs");
  }
  for (const mapId of context.mapIds) {
    minimaps[mapId] = await minimapBundle(context, mapId);
  }
  const helpImage = await context.image("String", "ToolTipHelp.img");
  const help = Object.create(null);
  const buttons = at(helpImage, "Game/Button");
  for (const [name, node] of Object.entries(buttons.children)) {
    help[name] = {
      title: value(node, "Title", name),
      description: value(node, "Desc", ""),
    };
  }
  return {
    schemaVersion: 1,
    bundles,
    minimaps,
    help,
    authority:
      "Original UI artwork and recovered local layout only; character values, inventory and dialogue require an unavailable server.",
    evidence: "docs/ingame-ui.md",
  };
}
