import { at, resolveNode, value } from "../src/assets/image.js";

const MAX_IMAGES = 50000;
const MAX_ITEMS = 5000;
const MAX_QUESTS = 4096;
const MAX_STAGES = 2;
const MAX_STAGE_ITEMS = 8192;
const MAX_ROOTS = 100000;
const MAX_METADATA_NODES = 65536;
const MAX_METADATA_DEPTH = 64;
const MAX_SKILLS = 256;
// Exact current artwork templates, not inventory grants (ui-data.js's former preview).
const EQUIPMENT_IDS = [1040002, 1060002, 1072001, 1302000];
// Original beginner book and existing combat/hitbox inspection references.
const SKILL_SELECTION = [
  { image: "000.img", keys: null },
  { image: "500.img", keys: ["5001003"] },
  { image: "310.img", keys: ["3101005"] },
];
const ICONS = ["icon", "iconMouseOver", "iconDisabled"];

/** Consume the already-admitted checks/rewards, not dialogue tokens or a second quest parser. */
function requiredItems(quests) {
  const records = Object.values(quests.records);
  if (records.length > MAX_QUESTS) {
    throw new Error("UI quest closure exceeds policy");
  }
  const ids = new Set(EQUIPMENT_IDS);
  let supportedQuests = 0;
  for (const record of records) {
    if (!record.supported) continue;
    supportedQuests++;
    if (record.stages.length > MAX_STAGES) {
      throw new Error("UI quest stage limit");
    }
    for (const stage of record.stages) {
      collectStageItems(ids, stage.check.items);
      collectStageItems(ids, stage.act.items);
    }
  }
  return { ids: [...ids].sort((a, b) => a - b), supportedQuests };
}

function collectStageItems(ids, items) {
  if (items.length > MAX_STAGE_ITEMS) throw new Error("UI quest item limit");
  for (const item of items) {
    if (!Number.isSafeInteger(item.id) || item.id <= 0) {
      throw new Error(`Invalid quest item ID ${item.id}`);
    }
    ids.add(item.id);
    if (ids.size > MAX_ITEMS) throw new Error("UI item closure exceeds policy");
  }
}

/** Directory names come from the original archive index, never ID-prefix path arithmetic. */
function imagePaths(context, archive) {
  const entries = context.imageEntries(archive);
  if (!(entries instanceof Map) || entries.size > MAX_IMAGES) {
    throw new Error(`Invalid UI original image index: ${archive}`);
  }
  return [...entries.keys()].filter((path) => path.endsWith(".img")).sort();
}

function addSource(sources, wanted, id, entry) {
  if (!wanted.has(id)) return;
  if (sources.has(id)) throw new Error(`Ambiguous original item source ${id}`);
  sources.set(id, entry);
}

/** Only selected records are decoded into visual bundles; image discovery reads metadata. */
async function itemSources(context, ids) {
  const wanted = new Set(ids),
    sources = new Map();
  for (const path of imagePaths(context, "Character")) {
    const key = path.split("/").at(-1).slice(0, -4);
    if (!/^\d{8}$/.test(key)) continue;
    addSource(sources, wanted, Number(key), {
      archive: "Character",
      path,
      key: "",
      category: path.split("/")[0],
    });
  }
  let roots = 0;
  for (const path of imagePaths(context, "Item")) {
    const image = await context.image("Item", path);
    const entries = Object.keys(image.children);
    roots += entries.length;
    if (roots > MAX_ROOTS) throw new Error("UI item source root limit");
    for (const key of entries) {
      if (!/^\d{7,8}$/.test(key)) continue;
      addSource(sources, wanted, Number(key), {
        archive: "Item",
        path,
        key,
        category: path.split("/")[0],
      });
    }
  }
  return sources;
}

/** Plain properties/scalars remain directly consumable; non-property nodes retain explicit type markers. */
function metadataValue(node) {
  if (node.type === "UOL") return { $wzType: "UOL", target: node.value };
  if (node.value !== undefined) {
    if (typeof node.value === "number" && !Number.isFinite(node.value)) {
      throw new Error(`Non-finite original UI metadata ${node.name}`);
    }
    return node.value && typeof node.value === "object"
      ? { ...node.value }
      : node.value;
  }
  const result = Object.create(null);
  if (node.type !== "Property") {
    result.$wzType = node.type;
    if (node.type === "Canvas") {
      result.width = node.width;
      result.height = node.height;
      result.format = node.format;
      result.scale = node.scale;
    }
  }
  return result;
}

/** Preserve every nested effect/restriction, including aliases and empty/unknown node kinds; no pixel payloads. */
function metadataTree(root) {
  if (!root) return Object.create(null);
  const holder = Object.create(null);
  const queue = [{ node: root, parent: holder, key: "root", depth: 0 }];
  for (let index = 0; index < queue.length; index++) {
    const entry = queue[index];
    if (entry.depth > MAX_METADATA_DEPTH) {
      throw new Error("UI metadata depth limit");
    }
    const node = entry.node;
    const target = metadataValue(node);
    entry.parent[entry.key] = target;
    const children =
      node.type === "UOL"
        ? [["resolved", resolveNode(node)]]
        : Object.entries(node.children);
    for (const [key, child] of children) {
      if (queue.length >= MAX_METADATA_NODES) {
        throw new Error("UI metadata node limit");
      }
      queue.push({ node: child, parent: target, key, depth: entry.depth + 1 });
    }
  }
  return holder.root;
}

/** Reuse the existing UI canvas origin/part/texture pipeline and one independently loadable bundle per ID. */
async function iconBundle(context, input) {
  const entities = [],
    assets = Object.create(null);
  for (const key of input.icons) {
    const child = input.node.children[key];
    if (!child) continue;
    const node = resolveNode(child);
    if (node.type !== "Canvas") {
      throw new Error(`Invalid original icon ${input.source}/${key}`);
    }
    const path = `${input.kind}/${input.id}/${key}`;
    const record = await context.canvasRecord(
      context,
      node,
      path,
      entities.length,
    );
    entities.push(record.entity);
    assets[path] = record.asset;
  }
  if (!assets[`${input.kind}/${input.id}/icon`]) {
    throw new Error(`Missing original icon ${input.source}`);
  }
  return context.bundle({
    id: `ui:${input.kind}:${input.id}`,
    entities,
    metadata: { source: input.source, assets },
  });
}

/** The extra properties object retains top-level effects outside info/spec, never an implicit usability flag. */
async function itemRecord(context, id, entry, strings) {
  const root = await context.image(entry.archive, entry.path);
  const node = at(root, entry.key);
  const source = `${entry.archive}.wz:${entry.path}${entry.key ? `/${entry.key}` : ""}`;
  const info = at(node, "info");
  const properties = Object.create(null);
  // Character actions are artwork, not item effect metadata. All Item branches are retained.
  if (entry.archive === "Item") {
    for (const [key, child] of Object.entries(node.children)) {
      if (key !== "info" && key !== "spec") {
        properties[key] = metadataTree(child);
      }
    }
  }
  const descriptor = await iconBundle(context, {
    kind: "item",
    id,
    node: info,
    source,
    icons: ["icon", "iconRaw"],
  });
  return {
    id,
    category: entry.category,
    name: strings.name,
    description: strings.description,
    source,
    info: metadataTree(info),
    spec: metadataTree(node.children.spec),
    properties,
    iconPath: `item/${id}/icon`,
    iconRawPath: info.children.iconRaw ? `item/${id}/iconRaw` : null,
    descriptor,
  };
}

/** Full original strings include per-level hN descriptions, not just a display label. */
async function skillRecord(context, input, strings) {
  const { key, image, node } = input;
  const id = Number(key),
    source = `Skill.wz:${image}/skill/${key}`;
  const text = strings.children[key];
  if (!text) throw new Error(`Missing original skill strings ${key}`);
  const properties = Object.create(null);
  for (const [name, child] of Object.entries(node.children)) {
    if (name !== "level" && !ICONS.includes(name)) {
      properties[name] = metadataTree(child);
    }
  }
  const descriptor = await iconBundle(context, {
    kind: "skill",
    id,
    node,
    source,
    icons: ICONS,
  });
  return {
    id,
    category: image === "000.img" ? "beginner" : "reference",
    name: value(text, "name", ""),
    description: value(text, "desc", ""),
    source,
    strings: metadataTree(text),
    level: metadataTree(node.children.level),
    properties,
    iconPath: `skill/${id}/icon`,
    iconMouseOverPath: node.children.iconMouseOver
      ? `skill/${id}/iconMouseOver`
      : null,
    iconDisabledPath: node.children.iconDisabled
      ? `skill/${id}/iconDisabled`
      : null,
    descriptor,
  };
}

async function skillRecords(context) {
  const paths = new Set(imagePaths(context, "Skill"));
  const strings = await context.image("String", "Skill.img");
  const records = Object.create(null);
  let count = 0;
  for (const selection of SKILL_SELECTION) {
    if (!paths.has(selection.image)) {
      throw new Error(`Missing selected skill image ${selection.image}`);
    }
    const root = at(await context.image("Skill", selection.image), "skill");
    const keys = selection.keys ?? Object.keys(root.children);
    if (keys.length + count > MAX_SKILLS) {
      throw new Error("UI skill selection limit");
    }
    for (const key of keys) {
      if (!/^\d+$/.test(key) || !Number.isSafeInteger(Number(key))) {
        throw new Error(`Invalid skill ID ${key}`);
      }
      if (records[Number(key)]) throw new Error(`Duplicate skill ID ${key}`);
      records[Number(key)] = await skillRecord(
        context,
        {
          key,
          image: selection.image,
          node: at(root, key),
        },
        strings,
      );
      count++;
    }
  }
  return records;
}

/** Catalog membership describes original templates only; ownership and skill ranks remain profile authorities. */
export async function extractItemSkillUI(context, strings, canvasRecord) {
  const assets = { ...context, canvasRecord };
  const closure = requiredItems(context.quests);
  const sources = await itemSources(context, closure.ids);
  const items = Object.create(null),
    missing = [];
  for (const id of closure.ids) {
    const source = sources.get(id);
    if (!source) {
      missing.push({
        id,
        reason: "No original item/character source in archive index",
      });
      continue;
    }
    if (!strings[id]) throw new Error(`Missing original item strings ${id}`);
    items[id] = await itemRecord(assets, id, source, strings[id]);
  }
  const skills = await skillRecords(assets);
  return {
    items,
    skills,
    coverage: {
      supportedQuests: closure.supportedQuests,
      requestedItemIds: closure.ids,
      extractedItemIds: Object.keys(items).map(Number),
      missingItems: missing,
      equipmentTemplateIds: EQUIPMENT_IDS,
      skillIds: Object.keys(skills).map(Number),
      scope:
        "Supported quest stage checks/rewards plus current equipment templates; original beginner book and selected combat/hitbox references. No ownership or learned-state grants.",
    },
  };
}
