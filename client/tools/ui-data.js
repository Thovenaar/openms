import { at, resolveNode, value } from "../src/assets/image.js";
import { extractItemSkillUI } from "./ui-item-data.js";
import { extractNpcPortraits, extractDialogArtwork } from "./ui-npc-data.js";
import { extractDropArtwork } from "./drop-data.js";
import { extractWorldMaps } from "./worldmap-data.js";
import { extractCashShop } from "./cash-shop-data.js";
import { extractMonsterBook } from "./monster-book-data.js";
import { extractAvatarCatalog } from "./avatar-catalog.js";
import { extractSkillMacroRules } from "./skill-macro-data.js";

const MAX_UI_NODES = 16000;
const MAX_UI_DEPTH = 64;
const MAX_UI_MAPS = 512;
const MAX_ITEM_NAME_NODES = 150000;
const MAX_ITEM_NAMES = 50000;
const BRANCHES = [
  "Item",
  "Equip",
  "Stat",
  "Skill",
  "SkillMacro",
  "Quest",
  "UserInfo",
  "Shop",
  "TradingRoom",
  "TemporaryStatView",
  "GameMenu",
  "ShortCut",
  "KeyConfig",
  "MiniMap",
  "UtilDlgEx",
  "Notice",
  "ToolTip",
  "GameOpt",
  "SysOpt",
  "UserList",
  "QuestAlarm",
  "PartySearch",
  "Family",
  "Title",
  "Messenger",
];
const BRANCH_EXTRAS = {
  TemporaryStatView: ["Skill/CoolTime"],
  Shop: ["PersonalShop/BtExit"],
  TradingRoom: ["Messenger/BtEnter", "FadeYesNo"],
  Family: ["FamilyTree"],
  UserInfo: ["MonsterBook/icon"],
  UserList: [
    { image: "GuildBBS.img", branch: "GuildBBS", path: "GuildBBS" },
    { image: "GuildMark.img", branch: "", path: "GuildMark" },
  ],
};

/** Each canvas is a static presentation entity. Delay=1 is a storage sentinel, never an original animation default. */
async function canvasRecord(context, node, path, order) {
  const originalDelay = value(node, "delay", null);
  const delay = originalDelay === null ? null : Number(originalDelay);
  if (delay !== null && (!Number.isFinite(delay) || delay < 0)) {
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

/** Load authored branch roots in order before the bounded depth-first canvas traversal. */
async function branchRoots(context, { imageName, branch, extras }) {
  const root = await context.image("UI", imageName);
  const start = branch ? at(root, branch) : root;
  const stack = [{ node: start, path: branch, depth: 0 }];
  const sources = [`UI.wz:${imageName}${branch ? `/${branch}` : ""}`];
  for (const extra of extras) {
    const input =
      typeof extra === "string"
        ? { image: imageName, branch: extra, path: extra }
        : extra;
    const extraRoot =
      input.image === imageName ? root : await context.image("UI", input.image);
    stack.push({
      node: input.branch ? at(extraRoot, input.branch) : extraRoot,
      path: input.path,
      depth: 0,
    });
    sources.push(
      `UI.wz:${input.image}${input.branch ? `/${input.branch}` : ""}`,
    );
  }
  if (branch === "MiniMap") {
    await addMinimapMarkers(context, stack);
  }
  return { stack, sources };
}

/** Iterative traversal retains alias paths and original anchors; bounded path depth detects UOL ancestor cycles. */
async function branchBundle(context, imageName, branch, extras = []) {
  const { stack, sources } = await branchRoots(context, {
    imageName,
    branch,
    extras,
  });
  const entities = [],
    assets = Object.create(null),
    aliases = Object.create(null);
  let visited = 0;
  while (stack.length) {
    if (++visited > MAX_UI_NODES) {
      throw new Error(`UI branch exceeds node budget: ${branch}`);
    }
    const item = stack.pop();
    if (item.depth > MAX_UI_DEPTH) {
      throw new Error(`UI branch exceeds depth budget: ${item.path}`);
    }
    if (item.node.type === "UOL") aliases[item.path] = item.node.value;
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
  return publishBranch(context, {
    imageName,
    branch,
    assets,
    aliases,
    entities,
    sources,
  });
}

async function addMinimapMarkers(context, stack) {
  const markers = await context.image("Map", "MapHelper.img");
  for (const name of ["user", "npc", "portal"]) {
    stack.push({
      node: at(markers, `minimap/${name}`),
      path: `MapHelper/minimap/${name}`,
      depth: 0,
    });
  }
}

function publishBranch(
  context,
  { imageName, branch, assets, aliases, entities, sources },
) {
  const metadata = {
    source: `UI.wz:${imageName}${branch ? `/${branch}` : ""}`,
    sources,
    assets,
    aliases,
    timing:
      "Static canvases; absent frame timing unsupported. Explicit authored delays retained in assets.",
  };
  if (branch === "MiniMap") {
    metadata.markerSource = "Map.wz:MapHelper.img/minimap";
  }
  if (imageName === "Basic.img" && branch === "Cursor") {
    metadata.states = cursorStates(assets);
  }
  return context.bundle({
    id: `ui:${imageName}:${branch || "root"}`,
    entities,
    metadata,
  });
}

/** Cursor state frames retain sparse numeric IDs and aliases; the UI owner supplies the animation clock. */
function cursorStates(assets) {
  const states = Object.create(null);
  for (const path of Object.keys(assets)) {
    const parts = path.split("/");
    const state = parts[1];
    if (!states[state]) states[state] = [];
    states[state].push(path);
  }
  for (const frames of Object.values(states)) {
    frames.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  }
  return states;
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

/** Full original item-name table; labels do not confer possession, use rules or instance statistics. */
async function itemLabels(context) {
  const state = {
    labels: Object.create(null),
    details: Object.create(null),
    visited: 0,
    items: 0,
  };
  for (const imageName of [
    "Eqp.img",
    "Consume.img",
    "Ins.img",
    "Etc.img",
    "Cash.img",
  ]) {
    const root = await context.image("String", imageName);
    collectItemLabels(root, state, imageName);
  }
  return state;
}

/** One image traversal shares cumulative limits across the complete original name table. */
function collectItemLabels(root, state, imageName) {
  const stack = [{ node: root, key: "", path: "", depth: 0 }];
  while (stack.length) {
    if (++state.visited > MAX_ITEM_NAME_NODES) {
      throw new Error("UI item-name node budget exceeded");
    }
    const entry = stack.pop();
    if (entry.depth > MAX_UI_DEPTH) {
      throw new Error("UI item-name depth exceeded");
    }
    const node = resolveNode(entry.node);
    if (/^\d{7,8}$/.test(entry.key) && node.children?.name) {
      recordItemLabel(
        state,
        entry.key,
        node,
        `String.wz:${imageName}/${entry.path}`,
      );
      continue;
    }
    for (const [key, child] of Object.entries(node.children || {})) {
      stack.push({
        node: child,
        key,
        path: entry.path ? `${entry.path}/${key}` : key,
        depth: entry.depth + 1,
      });
    }
  }
}

function recordItemLabel(state, key, node, source) {
  const id = Number(key),
    name = value(node, "name", null);
  if (typeof name !== "string" || name.length > 4096) {
    throw new Error(`Invalid original item name ${key}`);
  }
  if (++state.items > MAX_ITEM_NAMES) {
    throw new Error("UI item-name count exceeded");
  }
  if (state.labels[id] && state.labels[id] !== name) {
    throw new Error(`Conflicting item name ${id}`);
  }
  state.labels[id] = name;
  const description = value(node, "desc", "") ?? "";
  if (typeof description !== "string") {
    throw new Error(`Invalid original item description ${key}`);
  }
  state.details[id] = { name, description, source };
}

/** Original normal speech skin; layout and lifetime consumers are retained separately. */
async function speechBubbleBundle(context) {
  const image = await context.image("UI", "ChatBalloon.img");
  const color = value(at(image, "0"), "clr", null);
  if (!Number.isInteger(color)) {
    throw new Error("Original normal speech color is missing or invalid");
  }
  return {
    bundle: await branchBundle(context, "ChatBalloon.img", "0"),
    color,
  };
}

/** Original authored help labels and descriptions for status-bar controls. */
async function buttonHelp(context) {
  const image = await context.image("String", "ToolTipHelp.img");
  const help = Object.create(null);
  const buttons = at(image, "Game/Button");
  for (const [name, node] of Object.entries(buttons.children)) {
    help[name] = {
      title: value(node, "Title", name),
      description: value(node, "Desc", ""),
    };
  }
  return help;
}

/** Shared controls keep every authored state, including enabled0/1/2 and disabled scroll artwork. */
async function windowBundles(context) {
  const bundles = Object.create(null);
  bundles.StatusBar = await branchBundle(context, "StatusBar.img", "");
  bundles.Basic = await branchBundle(context, "Basic.img", "BtClose", [
    "BtCancel2",
    "BtClaim",
    "Tab2",
    "Tab3",
    "Tab4",
    "BtMin",
    "BtMax",
    "ComboBox2",
    "BtOK",
    "BtOK2",
    "BtYes",
    "BtNo",
    "ItemNo",
    "LevelNo",
    "BtClose2",
    "BtUP",
    "BtDown",
    "BtHide",
    "BtQGiveup",
    "BtMacro",
    "CheckBox",
    "VScr",
    "HScr",
    "VScr4",
    "HScr4",
    "Slider",
    "BtCancel",
  ]);
  bundles.Cursor = await branchBundle(context, "Basic.img", "Cursor");
  for (const branch of BRANCHES) {
    bundles[branch] = await branchBundle(
      context,
      "UIWindow.img",
      branch,
      BRANCH_EXTRAS[branch] ?? [],
    );
  }
  bundles.WorldMap = await extractWorldMaps(context, canvasRecord);
  bundles.MesoDrop = await branchBundle(context, "Basic.img", "Notice3", [
    "Notice4",
  ]);
  return bundles;
}

/** Native emblem choices are original numeric source IDs, not generated logos or colors. */
async function socialMetadata(context) {
  const root = await context.image("UI", "GuildMark.img");
  const backgrounds = Object.keys(at(root, "BackGround").children)
    .map(Number)
    .sort((a, b) => a - b);
  const logos = [],
    colors = new Set();
  for (const category of Object.values(at(root, "Mark").children)) {
    for (const [id, logo] of Object.entries(category.children)) {
      logos.push(Number(id));
      for (const color of Object.keys(resolveNode(logo).children)) {
        if (/^\d+$/.test(color)) colors.add(Number(color));
      }
    }
  }
  if (logos.length > MAX_UI_NODES || backgrounds.length > MAX_UI_NODES) {
    throw new Error("Guild emblem source bound");
  }
  return {
    emblems: {
      backgrounds,
      logos: logos.sort((a, b) => a - b),
      colors: [...colors].sort((a, b) => a - b),
      source: "UI.wz:GuildMark.img",
    },
  };
}
/** Check template and scalar-name coverage before separately reporting lazy artwork. */
function metadataCoverage(context, visuals, missing) {
  const dependencies = context.serverData.supportedDependencies;
  const names = context.quests.strings;
  for (const id of dependencies.itemIds) {
    if (!visuals.items[id]) {
      missing.push({
        kind: "item",
        id,
        reason:
          "Original inventory template is absent from Item.wz/Character.wz",
      });
    }
  }
  for (const [kind, ids, dictionary] of [
    ["npc-name", dependencies.npcIds, names.npc],
    ["mob-name", dependencies.mobIds, names.mob],
    ["map-name", dependencies.mapIds, context.mapNames],
    ["quest", dependencies.questIds, context.quests.records],
  ]) {
    for (const id of ids) {
      if (!dictionary[id]) {
        missing.push({
          kind,
          id,
          reason: "Required original metadata record is absent",
        });
      }
    }
  }
}

/** Report every admitted script's metadata requirements, independently of selected maps. */
function dependencyCoverage(context, visuals) {
  const dependencies = context.serverData.supportedDependencies;
  const missing = [];
  metadataCoverage(context, visuals, missing);
  for (const id of dependencies.npcIds) {
    const portrait = visuals.npcPortraits[id];
    if (!portrait || portrait.available === false) {
      missing.push({
        kind: "npc-portrait",
        id,
        reason: portrait?.reason ?? "Original NPC portrait is absent",
      });
    }
  }
  for (const path of dependencies.artworkPaths) {
    const artwork = visuals.dialogArtwork[path];
    if (!artwork || artwork.available === false) {
      missing.push({
        kind: "dialog-artwork",
        path,
        reason: artwork?.reason ?? "Original artwork is absent",
      });
    }
  }
  const packaged = new Set(context.mapIds.map(Number));
  return {
    required: Object.fromEntries(
      Object.entries(dependencies).map(([key, values]) => [key, values.length]),
    ),
    missing,
    unpackagedMaps: dependencies.mapIds.filter((id) => !packaged.has(id)),
    scope:
      "All supported numeric/SQL/named routes. Metadata-only map references do not imply a playable destination.",
  };
}

/** Selected maps retain independent demand-loaded minimap bundles. */
async function minimapBundles(context) {
  const minimaps = Object.create(null);
  if (!Array.isArray(context.mapIds) || context.mapIds.length > MAX_UI_MAPS) {
    throw new Error("UI extraction requires bounded selected map IDs");
  }
  for (const mapId of context.mapIds) {
    minimaps[mapId] = await minimapBundle(context, mapId);
  }
  return minimaps;
}

/** Static catalog metadata; artwork and avatar records remain independently demand-loaded. */
export async function extractGameUI(context) {
  const bundles = await windowBundles(context);
  bundles.FamilyTree = bundles.Family;
  bundles.PartyHP = bundles.UserList;
  const cashShop = await extractCashShop(context, canvasRecord);
  const monsterBook = await extractMonsterBook(context, canvasRecord);
  bundles.CashShop = cashShop.bundle;
  bundles.MonsterBook = monsterBook.bundle;
  const minimaps = await minimapBundles(context);
  const strings = await itemLabels(context);
  const templates = await extractItemSkillUI(
    { ...context, cashShop, monsterBook },
    strings.details,
    canvasRecord,
  );
  const npcPortraits = await extractNpcPortraits(context);
  const dialogArtwork = await extractDialogArtwork(context, canvasRecord);
  return {
    schemaVersion: 1,
    bundles,
    minimaps,
    npcPortraits,
    dialogArtwork,
    cashShop,
    monsterBook: monsterBook.monsterBook,
    avatar: await extractAvatarCatalog(context, templates.items),
    skillMacroRules: await extractSkillMacroRules(context),
    social: await socialMetadata(context),
    dropArtwork: await extractDropArtwork(context, canvasRecord),
    help: await buttonHelp(context),
    itemLabels: strings.labels,
    items: templates.items,
    skills: templates.skills,
    speechBubbles: await speechBubbleBundle(context),
    coverage: {
      ...templates.coverage,
      cashCommodities: Object.keys(cashShop.commodities).length,
      cashItems: cashShop.itemIds.length,
      monsterBookItemIds: monsterBook.itemIds,
      monsterBook: monsterBook.coverage,
      scriptMetadata: dependencyCoverage(context, {
        items: templates.items,
        npcPortraits,
        dialogArtwork,
      }),
      missingPortraits: Object.entries(npcPortraits)
        .filter(([, entry]) => entry.available === false)
        .map(([id, entry]) => ({ id: Number(id), ...entry })),
      missingDialogArtwork: Object.entries(dialogArtwork)
        .filter(([, entry]) => entry.available === false)
        .map(([path, entry]) => ({ path, ...entry })),
    },
    authority:
      "Original static artwork/metadata with recovered native consumers; mutable state is real local-profile authority, with explicitly labeled authorized Cosmic server-reference policy.",
    evidence: "docs/ingame-ui.md",
  };
}
