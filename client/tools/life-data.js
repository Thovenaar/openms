import { createHash } from "node:crypto";
import { at, resolveNode, value } from "../src/assets/image.js";

const MAX_PLACEMENTS = 4096;
const MAX_TEMPLATES = 512;
const MAX_ACTIONS = 128;
const MAX_FRAMES = 1024;
const MAX_METADATA = 32768;
const MAX_LINKS = 32;
// Extraction context owns this cache; no runtime/global residency is introduced.
const caches = new WeakMap();

/** Preserve authored optional scalar/vector fields without inventing defaults. */
function fields(node) {
  const result = Object.create(null);
  if (!node) return result;
  const entries = Object.entries(resolveNode(node).children);
  if (entries.length > MAX_METADATA) {
    throw new Error("Life metadata exceeds policy");
  }
  for (const [key, child] of entries) {
    const resolved = resolveNode(child);
    if (resolved.value !== undefined) result[key] = resolved.value;
  }
  return result;
}

/** Lossless nonpixel tree including unresolved UOL text, for extraction provenance. */
function metadata(root) {
  const rows = [];
  const queue = [{ node: root, path: "", depth: 0 }];
  for (let index = 0; index < queue.length; index++) {
    const { node, path, depth } = queue[index];
    if (depth > 64) throw new Error("Life metadata depth exceeds policy");
    const row = { path, type: node.type };
    if (node.value !== undefined) row.value = node.value;
    if (node.type === "Canvas") {
      row.width = node.width;
      row.height = node.height;
    }
    rows.push(row);
    for (const [key, child] of Object.entries(node.children)) {
      if (queue.length >= MAX_METADATA) {
        throw new Error("Life metadata exceeds policy");
      }
      queue.push({
        node: child,
        path: path ? `${path}/${key}` : key,
        depth: depth + 1,
      });
    }
  }
  return rows;
}

/** Original Mob links chain (0067cf06); NPC loader redirects artwork once (006dce02). */
function linkedImage(context, kind, id) {
  const archive = kind === "npc" ? "Npc" : "Mob";
  const original = context.image(archive, `${id}.img`);
  const chain = [
    { source: `${archive}.wz:${id}.img`, metadata: metadata(original) },
  ];
  const seen = new Set([id]);
  let node = original;
  for (let hop = 0; hop < MAX_LINKS; hop++) {
    const info = at(node, "info");
    const link = value(info, "link");
    if (link === undefined) return { original, node, chain };
    if (typeof link !== "string" || !/^\d{1,7}$/.test(link)) {
      throw new Error(`Unsupported life link ${archive}:${link}`);
    }
    const next = link.padStart(7, "0");
    if (seen.has(next)) throw new Error(`Cyclic life link ${archive}:${next}`);
    seen.add(next);
    node = context.image(archive, `${next}.img`);
    chain.push({
      source: `${archive}.wz:${next}.img`,
      metadata: metadata(node),
    });
    if (kind === "npc") return { original, node, chain };
  }
  throw new Error("Life link chain exceeds policy");
}

/** Strict WZ integer/string delay boundary; NPC absent delay is 180 ms at 0040de3a. */
function delayValue(raw, kind) {
  if (raw === undefined) return kind === "npc" ? 180 : null;
  if (
    typeof raw !== "number" &&
    !(typeof raw === "string" && /^\d+$/.test(raw))
  ) {
    throw new Error("Invalid life frame delay");
  }
  const ms = Number(raw);
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 60000) {
    throw new Error("Life frame delay exceeds policy");
  }
  return ms === 0 ? null : ms;
}

function bodyRectangle(frame) {
  const lt = value(frame, "lt"),
    rb = value(frame, "rb");
  if (lt === undefined && rb === undefined) return null;
  if (!lt || !rb || ![lt.x, lt.y, rb.x, rb.y].every(Number.isFinite)) {
    throw new Error("Incomplete life body rectangle");
  }
  if (lt.x > rb.x || lt.y > rb.y) {
    throw new Error("Inverted life body rectangle");
  }
  return { left: lt.x, top: lt.y, right: rb.x, bottom: rb.y };
}

/** Parts retain shared artwork hashes and original origins; timing never uses context.frames defaults. */
async function extractAction(context, node, kind) {
  const keys = Object.keys(node.children).filter((key) => /^\d+$/.test(key));
  keys.sort((a, b) => Number(a) - Number(b));
  if (!keys.length || keys.length > MAX_FRAMES) {
    throw new Error("Invalid life frame count");
  }
  const frames = [],
    geometry = [];
  let timingKnown = true;
  for (const key of keys) {
    const canvas = at(node, key);
    if (canvas.type !== "Canvas") {
      throw new Error(`Unsupported life frame ${key}`);
    }
    const raw = value(canvas, "delay");
    const delay = delayValue(raw, kind);
    if (delay === null) timingKnown = false;
    const origin = value(canvas, "origin");
    if (!origin || ![origin.x, origin.y].every(Number.isFinite)) {
      throw new Error("Life canvas lacks a valid original origin");
    }
    frames.push({ delay: delay ?? 0, parts: [await context.part(canvas)] });
    geometry.push({
      key,
      delayRaw: raw ?? null,
      delayMs: delay,
      origin,
      body: bodyRectangle(canvas),
      width: canvas.width,
      height: canvas.height,
    });
  }
  // The shared contract permits a zero-duration static frame, not timed zero-delay sequences.
  // Preserve every authored frame in metadata but expose only the untimed first-frame preview.
  if (!timingKnown) {
    frames.length = 1;
    frames[0].delay = 0;
  }
  return {
    frames,
    metadata: { timingKnown, properties: fields(node), frames: geometry },
  };
}

/** Original name/function lookup retains missing strings and flags separately from artwork links. */
async function extractTemplate(context, kind, id) {
  const linked = linkedImage(context, kind, id);
  const infoNode = at(kind === "mob" ? linked.node : linked.original, "info");
  const strings = context.image(
    "String",
    kind === "npc" ? "Npc.img" : "Mob.img",
  );
  const stringNode = strings.children[String(Number(id))];
  const stringsFields = fields(stringNode);
  const actions = Object.create(null),
    actionMetadata = Object.create(null);
  const branches = Object.entries(linked.node.children);
  if (branches.length > MAX_ACTIONS) {
    throw new Error("Life action count exceeds policy");
  }
  for (const [name, child] of branches) {
    if (name === "info") continue;
    const action = resolveNode(child);
    if (!action.children["0"]) continue;
    const extracted = await extractAction(context, action, kind);
    actions[name] = extracted.frames;
    actionMetadata[name] = extracted.metadata;
  }
  if (!actions.stand) {
    throw new Error(`Life template lacks stand artwork: ${kind}:${id}`);
  }
  const artworkHash = createHash("sha256")
    .update(JSON.stringify(actions))
    .digest("hex");
  return {
    actions,
    metadata: {
      key: `${kind}:${id}`,
      kind,
      originalId: id,
      artworkHash,
      name: stringsFields.name ?? null,
      function: stringsFields.func ?? null,
      info: fields(infoNode),
      sources: linked.chain,
      actions: actionMetadata,
      stringSource: `String.wz:${kind === "npc" ? "Npc" : "Mob"}.img/${Number(id)}`,
    },
  };
}

function placement(node, mapId) {
  const authored = fields(node);
  if (!/^(m|n)$/.test(authored.type) || !/^\d{1,7}$/.test(authored.id)) {
    throw new Error(`Invalid life template reference on ${mapId}`);
  }
  for (const key of ["x", "y", "fh", "cy", "rx0", "rx1"]) {
    if (
      !Number.isSafeInteger(authored[key]) ||
      Math.abs(authored[key]) > 1000000
    ) {
      throw new Error(`Invalid life ${key} on ${mapId}`);
    }
  }
  if (authored.rx0 > authored.rx1) {
    throw new Error("Inverted life authored range");
  }
  const kind = authored.type === "n" ? "npc" : "mob";
  return {
    id: `life:${node.name}`,
    template: `${kind}:${authored.id.padStart(7, "0")}`,
    kind,
    authored,
    source: `Map.wz:Map/Map${mapId[0]}/${mapId}.img/life/${node.name}`,
  };
}

/** Match original foothold drawing planes without making authored fh a live contact. */
function placementPlanes(map) {
  const planes = new Map();
  const root = map.children.foothold ? at(map, "foothold") : null;
  if (!root) return planes;
  for (const layer of Object.values(root.children)) {
    for (const group of Object.values(layer.children)) {
      for (const segment of Object.values(group.children)) {
        if (planes.size >= 65536) {
          throw new Error("Life foothold count exceeds policy");
        }
        const z = 29995 + (Number(layer.name) * 3000 - Number(group.name)) * 10;
        if (!Number.isSafeInteger(z)) {
          throw new Error("Invalid life foothold plane");
        }
        planes.set(Number(segment.name), z);
      }
    }
  }
  return planes;
}

/** World entities use the shared region/atlas contract, never a second life texture loader. */
function lifeEntity(record, template, planes) {
  return {
    id: record.id,
    kind: record.kind,
    order: 100000 + Number(record.id.slice(5)),
    x: record.authored.x,
    y: record.authored.y,
    z: planes.get(record.authored.fh) ?? 29995,
    visible: record.authored.hide !== 1,
    flip: record.authored.f === 0,
    opacity: 1,
    action: "stand",
    actions: template.actions,
  };
}

function lifeManifest(mapId, placements, templates) {
  return {
    schemaVersion: 1,
    mode: "metadata-preview",
    activationKnown: false,
    mapId,
    placements,
    templates,
    policies: {
      placementFacing:
        "preview mapping f=0 mirrors, f=1 retains artwork; placement-to-actor bit unproved",
      depth:
        "NPC 006d267d with authored foothold plane; mob plane and missing-fh fallback are preview policies",
      placementHide: "preview suppression only; live server activation unknown",
      actionSelection:
        "stand or explicit local preview; no automatic transitions",
      missingMobDelay: "unsupported; action frozen",
      missingNpcDelayMs: 180,
      regionReload: "preview action/time retained by LifeSystem",
    },
  };
}

/** Offline metadata inventory only; original actors originate in pool/network consumers. */
export async function extractLife(context, map, mapId) {
  if (!/^\d{9}$/.test(mapId)) throw new Error("Invalid life map id");
  if (!caches.has(context)) caches.set(context, new Map());
  const cache = caches.get(context);
  const entities = [],
    placements = [],
    templates = Object.create(null);
  const planes = placementPlanes(map);
  const children = map.children.life
    ? Object.values(at(map, "life").children)
    : [];
  if (children.length > MAX_PLACEMENTS) {
    throw new Error("Life placement count exceeds policy");
  }
  for (const child of children) {
    if (!/^\d+$/.test(child.name)) {
      throw new Error("Invalid authored life index");
    }
    const record = placement(child, mapId);
    if (!cache.has(record.template)) {
      if (cache.size >= MAX_TEMPLATES) {
        throw new Error("Life template count exceeds policy");
      }
      cache.set(
        record.template,
        await extractTemplate(
          context,
          record.kind,
          record.authored.id.padStart(7, "0"),
        ),
      );
    }
    const template = cache.get(record.template);
    templates[record.template] = template.metadata;
    placements.push(record);
    entities.push(lifeEntity(record, template, planes));
  }
  return { entities, life: lifeManifest(mapId, placements, templates) };
}
