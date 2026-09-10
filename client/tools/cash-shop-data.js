import { at, resolveNode, value } from "../src/assets/image.js";
import { publishSound } from "./audiovisual-data.js";
import { readPhysicsData } from "./physics-data.js";

const MAX_COMMODITIES = 20000;
const MAX_PACKAGES = 4096;
const MAX_PACKAGE_ITEMS = 96;
const MAX_SOURCE_NODES = 200000;
const MAX_SOURCE_DEPTH = 64;

/** Lossless metadata, not decoded pixel payloads; source aliases remain explicit. */
function sourceTree(root) {
  const holder = {};
  const queue = [{ node: root, parent: holder, key: "root", depth: 0 }];
  for (let index = 0; index < queue.length; index++) {
    const { node, parent, key, depth } = queue[index];
    if (depth > MAX_SOURCE_DEPTH) throw new Error("Cash metadata depth limit");
    if (node.value !== undefined) {
      parent[key] =
        node.type === "UOL"
          ? { $wzType: "UOL", target: node.value }
          : structuredClone(node.value);
      continue;
    }
    const record = {};
    if (node.type !== "Property") record.$wzType = node.type;
    if (node.type === "Canvas") {
      record.width = node.width;
      record.height = node.height;
      record.format = node.format;
      record.scale = node.scale;
    }
    parent[key] = record;
    for (const [name, child] of Object.entries(node.children)) {
      if (queue.length >= MAX_SOURCE_NODES) {
        throw new Error("Cash metadata node limit");
      }
      queue.push({ node: child, parent: record, key: name, depth: depth + 1 });
    }
  }
  return holder.root;
}

/** Every original canvas/state is published through the shared content-addressed bundle owner. */
async function cashArtwork(context, canvasRecord, root) {
  const stack = [{ node: root, path: "", depth: 0 }];
  const assets = {},
    aliases = {},
    entities = [];
  let visited = 0;
  while (stack.length) {
    if (++visited > MAX_SOURCE_NODES) {
      throw new Error("Cash artwork node limit");
    }
    const entry = stack.pop();
    if (entry.depth > MAX_SOURCE_DEPTH) {
      throw new Error("Cash artwork depth limit");
    }
    if (entry.node.type === "UOL") aliases[entry.path] = entry.node.value;
    const node = resolveNode(entry.node);
    if (node.type === "Canvas") {
      const record = await canvasRecord(
        context,
        node,
        entry.path,
        entities.length,
      );
      assets[entry.path] = record.asset;
      entities.push(record.entity);
      continue;
    }
    for (const [key, child] of Object.entries(node.children)) {
      stack.push({
        node: child,
        path: entry.path ? `${entry.path}/${key}` : key,
        depth: entry.depth + 1,
      });
    }
  }
  return context.bundle({
    id: "ui:CashShop.img:root",
    entities,
    metadata: {
      source: "UI.wz:CashShop.img",
      assets,
      aliases,
      properties: sourceTree(root),
    },
  });
}

function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > 2147483647) {
    throw new Error(`Invalid original cash ${name}`);
  }
  return value;
}

function commodities(root) {
  const nodes = Object.entries(root.children);
  if (nodes.length > MAX_COMMODITIES) throw new Error("Cash commodity bound");
  const result = {},
    itemIds = new Set();
  for (const [key, node] of nodes) {
    const raw = sourceTree(node);
    const sn = integer(raw.SN, "SN", 1);
    const itemId = integer(raw.ItemId, "ItemId", 1);
    if (result[sn]) throw new Error(`Duplicate original commodity SN ${sn}`);
    result[sn] = {
      sn,
      itemId,
      count: integer(raw.Count ?? 1, "Count", 1),
      price: integer(raw.Price ?? 0, "Price"),
      period: integer(raw.Period ?? 1, "Period"),
      priority: integer(raw.Priority ?? 0, "Priority"),
      gender: raw.Gender ?? -1,
      onSale: raw.OnSale === 1,
      category: Math.floor(sn / 10000000),
      subcategory: Math.floor(sn / 100000) % 100,
      source: `Etc.wz:Commodity.img/${key}`,
      raw,
    };
    if (itemId >= 1000000 && itemId < 6000000) itemIds.add(itemId);
  }
  return { records: result, itemIds };
}

function packages(root, offers) {
  const nodes = Object.entries(root.children);
  if (nodes.length > MAX_PACKAGES) throw new Error("Cash package bound");
  const result = {};
  for (const [key, node] of nodes) {
    const snNode = at(node, "SN");
    const entries = Object.values(snNode.children);
    if (!entries.length || entries.length > MAX_PACKAGE_ITEMS) {
      throw new Error(`Invalid cash package ${key}`);
    }
    const sns = entries.map((entry) =>
      integer(Number(entry.value), "package SN", 1),
    );
    const missing = sns.filter((sn) => !offers[sn]);
    result[key] = {
      itemId: integer(Number(key), "package item ID", 1),
      sns,
      source: `Etc.wz:CashPackage.img/${key}`,
      raw: sourceTree(node),
      missing,
    };
  }
  return result;
}

/** Resolve authored terrain placements in layer order before decoding their frames. */
async function previewTerrain(context, root) {
  const records = [];
  for (let layer = 0; layer < 8; layer++) {
    const branch = at(root, String(layer));
    const tileSet = value(at(branch, "info"), "tS", "");
    for (const [id, node] of Object.entries(at(branch, "tile").children)) {
      const image = await context.image("Map", `Tile/${tileSet}.img`);
      const path = `${value(node, "u", "")}/${value(node, "no", 0)}`;
      const canvas = at(image, path);
      const placement = sourceTree(node);
      records.push({
        node: canvas,
        id: `tile:${layer}:${id}`,
        placement,
        layer,
        z:
          19990 +
          layer * 30000 -
          (placement.zM ?? 0) * 10 +
          value(canvas, "z", 0),
      });
    }
    for (const [id, node] of Object.entries(at(branch, "obj").children)) {
      const image = await context.image(
        "Map",
        `Obj/${value(node, "oS", "")}.img`,
      );
      const path = `${value(node, "l0", "")}/${value(node, "l1", "")}/${value(node, "l2", "")}`;
      const placement = sourceTree(node);
      records.push({
        node: at(image, path),
        id: `obj:${layer}:${id}`,
        placement,
        layer,
        z: 2000 + layer * 30000 + (placement.z ?? 0),
      });
    }
    if (records.length > 4096) throw new Error("Cash preview terrain bound");
  }
  return records;
}

/** Keep authored preview terrain separate from the live playable field. */
async function previewArtwork(context, root) {
  const records = await previewTerrain(context, root);
  const entities = [];
  for (const record of records) {
    entities.push({
      id: record.id,
      kind: "cash-preview",
      order: entities.length,
      x: record.placement.x,
      y: record.placement.y,
      z: record.z,
      visible: true,
      flip: record.placement.f === 1,
      opacity: 1,
      action: "default",
      actions: { default: await context.frames(record.node) },
      placement: record.placement,
    });
  }
  return context.bundle({
    id: "ui:CashShopPreview.img:terrain",
    entities,
    metadata: {
      source: "UI.wz:CashShopPreview.img",
      properties: sourceTree(root),
    },
  });
}

/** Special package/account-service icons are not inventory templates and have their own WZ names. */
async function specialItems(context, canvasRecord, offers) {
  const wanted = new Set(
    Object.values(offers)
      .filter((offer) => offer.itemId >= 6000000)
      .map((offer) => offer.itemId),
  );
  const result = {};
  for (const path of ["Special/0910.img", "Special/0911.img"]) {
    const root = await context.image("Item", path);
    for (const [key, node] of Object.entries(root.children)) {
      const id = Number(key);
      if (!wanted.has(id)) continue;
      const icon = resolveNode(at(node, "icon"));
      const iconPath = `cash-special/${id}/icon`;
      const record = await canvasRecord(context, icon, iconPath, 0);
      result[id] = {
        id,
        name: value(node, "name", ""),
        description: "",
        info: {},
        iconPath,
        source: `Item.wz:${path}/${key}`,
        raw: sourceTree(node),
        descriptor: await context.bundle({
          id: `ui:cash-special:${id}`,
          entities: [record.entity],
          metadata: {
            assets: { [iconPath]: record.asset },
            source: `Item.wz:${path}/${key}`,
          },
        }),
      };
    }
  }
  return result;
}

/** Preserve authored category order and the full original metadata beside display fields. */
function categoryRecords(root) {
  return Object.entries(root.children).map(([key, node]) => ({
    category: Number(value(node, "Category", -1)),
    subcategory: Number(value(node, "CategorySub", -1)),
    name: value(node, "Name", ""),
    source: `Etc.wz:Category.img/${key}`,
    raw: sourceTree(node),
  }));
}

/** Original catalog is immutable offer data; no balance, item or sale-state grants. */
export async function extractCashShop(context, canvasRecord) {
  const commodityRoot = await context.image("Etc", "Commodity.img");
  const packageRoot = await context.image("Etc", "CashPackage.img");
  const ui = await context.image("UI", "CashShop.img");
  const preview = await context.image("UI", "CashShopPreview.img");
  const help = await context.image("String", "ToolTipHelp.img");
  const categoryRoot = await context.image("Etc", "Category.img");
  const sounds = await context.image("Sound", "BgmUI.img");
  const offers = commodities(commodityRoot);
  return {
    schemaVersion: 1,
    bundle: await cashArtwork(context, canvasRecord, ui),
    commodities: offers.records,
    packages: packages(packageRoot, offers.records),
    itemIds: [...offers.itemIds].sort((a, b) => a - b),
    specialItems: await specialItems(context, canvasRecord, offers.records),
    categories: categoryRecords(categoryRoot),
    preview: {
      bundle: await previewArtwork(context, preview),
      metadata: sourceTree(preview),
      physics: readPhysicsData(
        preview,
        await context.image("Map", "Physics.img"),
      ),
    },
    help: sourceTree(at(help, "Shop/Button")),
    bgm: await publishSound(
      context,
      at(sounds, "ShopBgm"),
      "Sound.wz:BgmUI.img/ShopBgm",
    ),
    sources: [
      "Etc.wz:Commodity.img",
      "Etc.wz:Category.img",
      "Etc.wz:CashPackage.img",
      "UI.wz:CashShop.img",
      "UI.wz:CashShopPreview.img",
      "Map.wz:Physics.img",
      "Item.wz:Special/0910.img",
      "Item.wz:Special/0911.img",
      "String.wz:ToolTipHelp.img/Shop/Button",
      "Sound.wz:BgmUI.img/ShopBgm",
    ],
    evidence: {
      native: [
        "00468f3e",
        "0047ff89",
        "004b6b3b",
        "004ba623",
        "004bc3e4",
        "007e2717",
        "007e47ef",
      ],
      server:
        "Cosmic CashShop.java and CashOperationHandler.java; SERVER-reference commerce, not original client authority",
      defaults:
        "Absent Count=1, Price=0, Period=1 follow Cosmic CashItemFactory; raw fields are retained unchanged.",
    },
  };
}
