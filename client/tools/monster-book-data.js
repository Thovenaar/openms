import { deflateSync } from "node:zlib";
import { decodeCanvas } from "../src/assets/canvas.js";
import { at, resolveNode, value } from "../src/assets/image.js";
import { monsterBookPortrait } from "./monster-book-portraits.js";

const MAX_CARDS = 4096;
const MAX_NODES = 16000;
const MAX_DEPTH = 32;
const MAX_DETAILS = 512;
const MAX_TEXT = 32768;

function entries(node, limit = MAX_DETAILS) {
  const result = Object.entries(node?.children ?? {});
  if (result.length > limit) {
    throw new Error("Monster Book source exceeds its node limit");
  }
  return result;
}

function text(node, name) {
  if (!node) return null;
  const result = value(node, name, null);
  if (
    result !== null &&
    (typeof result !== "string" || result.length > MAX_TEXT)
  ) {
    throw new Error(`Invalid Monster Book text ${name}`);
  }
  return result;
}

/** Preserve numeric authored order, including absent versus authored-empty lists. */
function identifiers(node, name) {
  if (!node) return null;
  const rows = entries(node).sort((a, b) => Number(a[0]) - Number(b[0]));
  return rows.map(([key, child]) => {
    const id = Number(resolveNode(child).value);
    if (!/^\d+$/.test(key) || !Number.isSafeInteger(id) || id < 0) {
      throw new Error(`Invalid Monster Book ${name}/${key}`);
    }
    return id;
  });
}

/** Original effect restrictions remain data, not an invented unconditional card buff. */
function scalarTree(root) {
  const result = Object.create(null);
  const stack = [{ node: root, target: result, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const row = stack.pop();
    if (++count > MAX_NODES || row.depth > MAX_DEPTH) {
      throw new Error("Monster card metadata exceeds limit");
    }
    for (const [key, child] of entries(row.node)) {
      const node = resolveNode(child);
      if (node.value !== undefined) row.target[key] = node.value;
      else {
        const next = Object.create(null);
        row.target[key] = next;
        stack.push({ node, target: next, depth: row.depth + 1 });
      }
    }
  }
  return result;
}

function mapStrings(root) {
  const result = Object.create(null),
    queue = [root];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index],
      name = node.children.mapName?.value;
    if (/^\d+$/.test(node.name) && typeof name === "string") {
      result[Number(node.name)] = {
        name: text(node, "mapName"),
        streetName: text(node, "streetName"),
      };
    }
    for (const [, child] of entries(node, MAX_NODES)) {
      if (queue.length >= MAX_NODES) {
        throw new Error("Original Monster Book location lookup exceeds limit");
      }
      if (Object.keys(child.children).length) queue.push(child);
    }
  }
  return result;
}

async function canvases(context, state, root, canvasRecord) {
  const stack = [{ node: root, path: "MonsterBook", depth: 0 }];
  let count = 0;
  while (stack.length) {
    const row = stack.pop();
    if (++count > MAX_NODES || row.depth > MAX_DEPTH) {
      throw new Error("Monster Book artwork exceeds limit");
    }
    const node = resolveNode(row.node);
    if (row.node.type === "UOL") state.aliases[row.path] = row.node.value;
    if (node.type === "Canvas") {
      const record = await canvasRecord(
        context,
        node,
        row.path,
        state.entities.length,
      );
      state.entities.push(record.entity);
      state.assets[row.path] = record.asset;
      continue;
    }
    for (const [name, child] of entries(node, MAX_NODES)) {
      stack.push({
        node: child,
        path: `${row.path}/${name}`,
        depth: row.depth + 1,
      });
    }
  }
}

/** Native0098dc4a converts ARGB4444 nibbles with37R+53G+10B, retaining alpha.
 * Derived pixels are packaged once, not a per-draw GPU filter or mutated original WZ input.
 */
function unownedCardCanvas(node) {
  if (node.format !== 1) return node;
  const decoded = decodeCanvas(node);
  const pixels = Buffer.alloc(decoded.width * decoded.height * 2);
  for (let index = 0; index < decoded.rgba.length; index += 4) {
    const r = decoded.rgba[index] / 17,
      g = decoded.rgba[index + 1] / 17;
    const b = decoded.rgba[index + 2] / 17,
      a = decoded.rgba[index + 3] / 17;
    const gray = Math.floor((r * 37 + g * 53 + b * 10) / 100);
    pixels.writeUInt16LE(
      (a << 12) | (gray << 8) | (gray << 4) | gray,
      index / 2,
    );
  }
  return { ...node, scale: 0, data: deflateSync(pixels) };
}

/** Validate original card identity before decoding any dependent artwork. */
function cardIdentity(key, node) {
  const itemId = Number(key),
    info = at(node, "info");
  const mobId = value(info, "mob", null);
  const category = Math.floor(itemId / 1000) - 2380;
  if (
    !/^0238\d{4}$/.test(key) ||
    category < 0 ||
    category > 8 ||
    !Number.isInteger(mobId) ||
    mobId <= 0 ||
    value(info, "monsterBook", null) !== 1 ||
    value(at(node, "spec"), "consumeOnPickup", null) !== 1
  ) {
    throw new Error(`Invalid original Monster Book card ${key}`);
  }
  return { itemId, info, mobId, category };
}

/** Package the authored card and its recovered unowned transform in entity order. */
async function cardIcons(context, { info, itemId, canvasRecord }, state) {
  const iconPath = `MonsterBook/cards/${itemId}`;
  const canvas = resolveNode(at(info, "iconRaw"));
  const raw = await canvasRecord(
    context,
    canvas,
    iconPath,
    state.entities.length,
  );
  state.entities.push(raw.entity);
  state.assets[iconPath] = raw.asset;
  const unownedIconPath = `${iconPath}/unowned`;
  const gray = await canvasRecord(
    context,
    unownedCardCanvas(canvas),
    unownedIconPath,
    state.entities.length,
  );
  state.entities.push(gray.entity);
  state.assets[unownedIconPath] = {
    ...gray.asset,
    transform: "0098dc4a ARGB4444 grayscale",
  };
  return { iconPath, unownedIconPath };
}

async function cardRecord(context, source, strings, state) {
  const { key, node, canvasRecord } = source;
  const { itemId, info, mobId, category } = cardIdentity(key, node);
  const detail = strings.book.children[String(mobId)];
  const name = text(strings.mobs.children[String(mobId)], "name");
  const { iconPath, unownedIconPath } = await cardIcons(
    context,
    { info, itemId, canvasRecord },
    state,
  );
  const mob = await context.image(
    "Mob",
    `${String(mobId).padStart(7, "0")}.img`,
  );
  const maps = identifiers(detail?.children.map, "map");
  const locations =
    maps?.map((mapId) => ({
      mapId,
      source: `String.wz:Map.img map ${mapId}`,
      name: strings.maps[mapId]?.name ?? null,
      streetName: strings.maps[mapId]?.streetName ?? null,
    })) ?? null;
  return {
    itemId,
    mobId,
    category,
    name,
    iconPath,
    unownedIconPath,
    consumeOnPickup: true,
    source: `Item.wz:Consume/0238.img/${key}`,
    detailSource: detail ? `String.wz:MonsterBook.img/${mobId}` : null,
    episode: text(detail, "episode"),
    maps,
    locations,
    rewards: identifiers(detail?.children.reward, "reward"),
    info: scalarTree(mob.children.info),
    spec: scalarTree(node.children.spec),
    portrait: await monsterBookPortrait(context, mob, mobId),
  };
}

function extractionCoverage(cards, categories) {
  const missingSources = [];
  let timedCards = 0;
  for (const card of Object.values(cards)) {
    for (const field of ["name", "episode", "maps", "rewards"]) {
      if (card[field] === null) {
        missingSources.push({
          itemId: card.itemId,
          mobId: card.mobId,
          field,
          source: card.detailSource ?? card.source,
        });
      }
    }
    for (const location of card.locations ?? []) {
      for (const field of ["name", "streetName"]) {
        if (location[field] === null) {
          missingSources.push({
            itemId: card.itemId,
            mobId: card.mobId,
            mapId: location.mapId,
            field: `location.${field}`,
            source: location.source,
          });
        }
      }
    }
    if (!card.portrait.available) {
      missingSources.push({
        itemId: card.itemId,
        mobId: card.mobId,
        field: "portrait",
        reason: card.portrait.reason,
      });
    }
    if (card.spec.time !== undefined) timedCards++;
  }
  return {
    cards: Object.keys(cards).length,
    categories: categories.map((category) => category.cardIds.length),
    timedCards,
    missingSources,
    clientEvidence: "Original EXE/WZ only; no encounter-derived collection.",
  };
}

/** Read every original card in numeric order and accumulate its item/mob closure. */
async function cardRegistry(context, source, strings, { state, canvasRecord }) {
  const cards = Object.create(null),
    itemIds = new Set(),
    mobIds = new Set();
  const categories = Array.from({ length: 9 }, (_, id) => ({
    id,
    cardIds: [],
    minimumLevel: null,
    maximumLevel: null,
  }));
  const rows = entries(source, MAX_CARDS).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  for (const [key, node] of rows) {
    const card = await cardRecord(
      context,
      { key, node, canvasRecord },
      strings,
      state,
    );
    cards[card.itemId] = card;
    categories[card.category].cardIds.push(card.itemId);
    const level = card.info.level,
      category = categories[card.category];
    if (Number.isInteger(level)) {
      category.minimumLevel = Math.min(category.minimumLevel ?? level, level);
      category.maximumLevel = Math.max(category.maximumLevel ?? level, level);
    }
    itemIds.add(card.itemId);
    mobIds.add(card.mobId);
    for (const id of card.rewards ?? []) if (id > 0) itemIds.add(id);
  }
  return { cards, categories, itemIds, mobIds };
}

/** Complete original card-to-mob registry; never derives collection from encounters or SQL drops.
 * Main merges monsterBook into catalog.ui, replaces bundles.MonsterBook and adds itemIds to
 * the single original item dependency closure. Mob portraits are independently demand-loaded.
 */
export async function extractMonsterBook(context, canvasRecord) {
  const state = {
    entities: [],
    assets: Object.create(null),
    aliases: Object.create(null),
  };
  const ui = await context.image("UI", "UIWindow.img");
  await canvases(context, state, at(ui, "MonsterBook"), canvasRecord);
  const source = await context.image("Item", "Consume/0238.img");
  const strings = {
    book: await context.image("String", "MonsterBook.img"),
    mobs: await context.image("String", "Mob.img"),
    maps: mapStrings(await context.image("String", "Map.img")),
  };
  const { cards, categories, itemIds, mobIds } = await cardRegistry(
    context,
    source,
    strings,
    { state, canvasRecord },
  );
  const monsterBook = {
    cards,
    categories,
    countCap: 5,
    cardsPerPage: 25,
    source:
      "Item.wz:Consume/0238.img;String.wz:MonsterBook.img;String.wz:Mob.img;String.wz:Map.img;Mob.wz",
    categorySource:
      "Original card item ID / 1000 - 2380; observed level extrema, not inferred admission ranges.",
    unlockCounts: { basic: 1, vitals: 2, episode: 3, rewards: 4, locations: 5 },
    evidence: [
      "00684e95",
      "00863717",
      "008637a8",
      "00866b2d",
      "008677cc",
      "00866ba0",
    ],
  };
  const bundle = await context.bundle({
    id: "ui:MonsterBook:original",
    entities: state.entities,
    metadata: {
      source:
        "UI.wz:UIWindow.img/MonsterBook;Item.wz:Consume/0238.img/*/info/iconRaw",
      assets: state.assets,
      aliases: state.aliases,
    },
  });
  return {
    bundle,
    monsterBook,
    coverage: extractionCoverage(cards, categories),
    itemIds: [...itemIds].sort((a, b) => a - b),
    mobIds: [...mobIds].sort((a, b) => a - b),
  };
}
