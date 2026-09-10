import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { at, value } from "../src/assets/image.js";
import { parseSql, MAX_SQL_BYTES } from "./sql-data.js";
import { serverReferenceRoot } from "./server-data.js";

const MAX_MAPS = 512;
const MAX_LIFE = 65536;
const MAX_MOB_ROWS = 256;
const MAX_ITEMS = 5000;
const DROP_TABLE = "src/main/resources/db/data/152-drop-data.sql";
// Client00506e62 InsertCanvas delays (ms): docs/ghidra-drop-motion/drop-native-helpers.txt.
const MESO_FRAME_DELAYS = Object.freeze([
  Object.freeze([80, 80, 80, 80]),
  Object.freeze([80, 80, 80, 80]),
  Object.freeze([200, 200, 200, 200]),
  Object.freeze([4000, 120, 120, 120]),
]);

function selectedMobs(context) {
  if (!Array.isArray(context.mapIds) || context.mapIds.length > MAX_MAPS) {
    throw new Error("Drop map closure exceeds limit");
  }
  const mobs = Object.create(null);
  for (const id of context.mapIds) {
    const map = context.image("Map", `Map/Map${id[0]}/${id}.img`);
    if (!map.children.life) continue;
    const life = Object.values(at(map, "life").children);
    if (life.length > MAX_LIFE) throw new Error("Drop map life limit");
    for (const node of life) {
      if (value(node, "type", null) !== "m") continue;
      const mobId = Number(value(node, "id", null));
      if (!Number.isSafeInteger(mobId) || mobId <= 0) {
        throw new Error("Invalid drop mob ID");
      }
      mobs[mobId] ??= { rows: [], maps: [] };
      if (!mobs[mobId].maps.includes(id)) mobs[mobId].maps.push(id);
    }
  }
  return mobs;
}

/** Uses the shared SQL reader; only the six authored drop columns are accepted. */
export function parseDropRows(text) {
  const parsed = parseSql(text);
  if (parsed.unsupported.length || parsed.schemas.length) {
    throw new Error("Unsupported statement in Cosmic drop SQL");
  }
  const columns = [
    "dropperid",
    "itemid",
    "minimum_quantity",
    "maximum_quantity",
    "questid",
    "chance",
  ];
  const rows = [];
  for (const insert of parsed.inserts) {
    if (
      insert.table !== "drop_data" ||
      insert.columns.length !== columns.length
    ) {
      throw new Error("Unexpected Cosmic drop table or columns");
    }
    const indices = columns.map((column) => insert.columns.indexOf(column));
    if (indices.includes(-1)) throw new Error("Missing Cosmic drop column");
    for (const values of insert.rows) {
      const row = indices.map((index) => values[index]);
      if (!row.every((number) => Number.isSafeInteger(number) && number >= 0)) {
        throw new Error("Invalid Cosmic drop integer");
      }
      rows.push(row);
    }
  }
  if (!rows.length) throw new Error("No six-column Cosmic drop rows found");
  return rows;
}

/** Cosmic is an authorized SERVER reference, never original Nexon drop authority. */
export async function extractDropData(context, options = {}) {
  const serverRoot = serverReferenceRoot(options.serverRoot);
  const file = Bun.file(resolve(serverRoot, DROP_TABLE));
  if (file.size > MAX_SQL_BYTES) {
    throw new Error("Cosmic drop SQL exceeds byte limit");
  }
  const text = await file.text();
  const mobs = selectedMobs(context);
  const rows = parseDropRows(text);
  const itemIds = new Set();
  for (let index = 0; index < rows.length; index++) {
    const [mobId, itemId, minimum, maximum, questId, chance] = rows[index];
    const mob = mobs[mobId];
    if (!mob) continue;
    if (mob.rows.length >= MAX_MOB_ROWS) {
      throw new Error(`Drop row limit: ${mobId}`);
    }
    const reason = rowReason(itemId, minimum, maximum);
    mob.rows.push({
      itemId,
      minimum,
      maximum,
      questId,
      chance,
      sourceRow: index + 1,
      status: reason ? "unavailable" : "supported",
      reason,
    });
    if (itemId && !reason) itemIds.add(itemId);
  }
  if (itemIds.size > MAX_ITEMS) {
    throw new Error("Drop item closure exceeds limit");
  }
  return {
    schemaVersion: 1,
    mobs,
    itemIds: [...itemIds].sort((a, b) => a - b),
    provenance: {
      authority: "Cosmic-server-reference/local-offline-policy",
      source: DROP_TABLE,
      sha256: createHash("sha256").update(text).digest("hex"),
      parsedRows: rows.length,
      rate: "1x; floor(random*999999) < chance",
      quantity:
        "Cosmic maximum-exclusive range; equal endpoints are fixed local policy",
      equipment:
        "original base templates; no Cosmic randomized instance statistics",
      quests:
        "questid requires active durable quest; no party/party-quest/world-event gates",
      scope:
        "All per-mob SQL rows for authored mob placements in the selected map closure. Global drops are not enabled.",
    },
  };
}

function rowReason(itemId, minimum, maximum) {
  if (minimum < 1 || maximum < minimum) {
    return "Invalid or empty quantity range";
  }
  if (itemId && (itemId < 1000000 || itemId > 5999999)) {
    return "Item category cannot be represented by the inventory catalog";
  }
  return null;
}

/** Missing original templates remain addressable unavailable rows, never invented artwork. */
export function finalizeDropData(data, items) {
  let supported = 0;
  const unavailable = [];
  for (const [mobId, mob] of Object.entries(data.mobs)) {
    for (const row of mob.rows) {
      if (
        row.status === "supported" &&
        row.itemId &&
        !items[row.itemId]?.descriptor
      ) {
        row.status = "unavailable";
        row.reason =
          "No original item metadata/artwork in the extracted catalog";
      }
      if (row.status === "supported") supported++;
      else unavailable.push({ mobId: Number(mobId), ...row });
    }
  }
  data.coverage = { supportedRows: supported, unavailableRows: unavailable };
  return data;
}

/** Currency uses the same immutable canvas/atlas bundles as inventory icons. */
export async function extractDropArtwork(context, canvasRecord) {
  const root = context.image("Item", "Special/0900.img");
  const assets = Object.create(null),
    entities = [],
    variants = [];
  for (let variant = 0; variant < 4; variant++) {
    const frames = [];
    for (let frame = 0; frame < 4; frame++) {
      const source = `0900000${variant}/iconRaw/${frame}`;
      const node = at(root, source);
      if (node.type !== "Canvas") {
        throw new Error(`Missing original currency canvas ${source}`);
      }
      const path = `drop/meso/${variant}/${frame}`;
      const record = await canvasRecord(context, node, path, entities.length);
      record.asset.delay = MESO_FRAME_DELAYS[variant][frame];
      entities.push(record.entity);
      assets[path] = record.asset;
      frames.push({ path, delay: record.asset.delay });
    }
    variants.push(frames);
  }
  return {
    variants,
    descriptor: await context.bundle({
      id: "drop:currency",
      entities,
      metadata: { source: "Item.wz:Special/0900.img", assets },
    }),
  };
}
