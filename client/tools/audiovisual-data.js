import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { at, value, resolveNode } from "../src/assets/image.js";
import { resource } from "./atlas.js";

const MAX_SOUNDS = 512;
const MAX_EFFECT_FRAMES = 256;
const COMBAT_SOUND_NAMES = Object.freeze({
  Mob: /^(Damage|Die|Attack[1-8]|CharDam[12])$/,
  Weapon: /^Attack$/,
});
const BASIC_EFFECTS = [
  "Teleport",
  "LevelUp",
  "JobChanged",
  "QuestClear",
  "ItemLevelUp",
  "IncEXP",
  "Transform",
  "TransformOnLadder",
  "Flying",
  "Flying1",
];

/** Original backend state/GUID envelope is independent of WAVE channel/rate fields. */
function validateSoundEnvelope(envelope, source) {
  if (
    envelope.field30 <= 0 ||
    envelope.field30 > 600000 ||
    ![1, 2].includes(envelope.field34) ||
    envelope.sampleSize !== 0 ||
    envelope.formatFlags !== 1 ||
    envelope.majorType !== "83eb36e44f52ce119f530020af0ba770" ||
    envelope.subType !== "8beb36e44f52ce119f530020af0ba770" ||
    envelope.formatType !== "819f580556c3ce11bf0100aa0055595a"
  ) {
    throw new Error(`Invalid original sound envelope: ${source}`);
  }
}

/** Validate the original MPEG envelope, never transcode its payload. */
function soundFormat(node, source) {
  if (node?.type !== "Sound_DX8" || !node.data?.length) {
    throw new Error(`Missing sound ${source}`);
  }
  const envelope = node.value;
  validateSoundEnvelope(envelope, source);
  const data = envelope.formatData;
  if (
    data.length < 18 ||
    data.readUInt16LE(0) !== 0x55 ||
    data.length !== 18 + data.readUInt16LE(16)
  ) {
    throw new Error(`Unsupported original sound format: ${source}`);
  }
  const channels = data.readUInt16LE(2),
    sampleRate = data.readUInt32LE(4);
  if (channels < 1 || channels > 2 || sampleRate < 8000 || sampleRate > 96000) {
    throw new Error(`Invalid original sound envelope: ${source}`);
  }
  return {
    channels,
    sampleRate,
    encoding: 0x55,
    durationMs: envelope.field30,
    envelope: { ...envelope, formatData: data.toString("hex") },
  };
}

export async function publishSound(context, node, source) {
  return publishResolvedSound(context, resolveNode(node), source);
}

async function publishResolvedSound(context, node, source) {
  const format = soundFormat(node, source);
  return {
    ...(await resource(context.output, "audio", "mp3", node.data)),
    source,
    ...format,
  };
}

async function soundFamily(context, category) {
  const root = context.image("Sound", `${category}.img`);
  const names = Object.keys(root.children);
  if (names.length > MAX_SOUNDS) {
    throw new Error(`Sound family exceeds ${MAX_SOUNDS}`);
  }
  const result = {};
  for (const name of names) {
    result[name] = await publishSound(
      context,
      at(root, name),
      `Sound.wz:${category}.img/${name}`,
    );
  }
  return result;
}

/** Original generic layer timing; activation remains explicitly non-authoritative. */
async function effectFrames(context, node) {
  const names = Object.keys(node.children)
    .filter((name) => /^\d+$/.test(name))
    .sort((a, b) => Number(a) - Number(b));
  if (!names.length || names.length > MAX_EFFECT_FRAMES) {
    throw new Error("Effect frame count outside bounds");
  }
  const frames = [];
  let carried = 255;
  for (const name of names) {
    const canvas = at(node, name);
    const rawDelay = value(canvas, "delay", null);
    // Original 00439750 -> 0043e86f -> 0043ea3e -> 0043f768: 120 ms.
    const delay = rawDelay === null ? 120 : Number(rawDelay);
    if (!Number.isFinite(delay) || delay < 0 || delay > 60000) {
      throw new Error("Invalid effect delay");
    }
    const rawStart = Number(value(canvas, "a0", -1)),
      rawEnd = Number(value(canvas, "a1", -1));
    const start = rawStart < 0 ? carried : rawStart,
      end = rawEnd < 0 ? start : rawEnd;
    if (start > 255 || end > 255) throw new Error("Invalid effect alpha");
    frames.push({
      delay,
      parts: [{ ...(await context.part(canvas)), opacity: start / 255 }],
      alphaEnd: end / 255,
    });
    carried = end;
  }
  return { frames, supported: true };
}

async function publishEffect(context, imageName, name) {
  const source = `Effect.wz:${imageName}/${name}`;
  const extracted = await effectFrames(
    context,
    at(context.image("Effect", imageName), name),
  );
  const id = `effect:${imageName}/${name}`;
  const entity = {
    id,
    order: 0,
    kind: "effect",
    x: 0,
    y: 0,
    z: 0,
    visible: true,
    flip: false,
    opacity: 1,
    action: "play",
    actions: { play: extracted.frames },
  };
  const metadata = {
    source,
    timingSupported: extracted.supported,
    activation: "local-preview-only",
    durationMs: extracted.frames.reduce(
      (total, frame) => total + frame.delay,
      0,
    ),
  };
  const bundle = await context.bundle({ id, entities: [entity], metadata });
  return { bundle, ...metadata };
}

/** Exact digit canvases consumed by 00435444/00437d0f; no rasterized text substitute. */
async function combatDigits(context) {
  const actions = {};
  const root = context.image("Effect", "BasicEff.img");
  for (const family of [
    "NoRed0",
    "NoRed1",
    "NoBlue0",
    "NoBlue1",
    "NoViolet0",
    "NoViolet1",
    "NoCri0",
    "NoCri1",
  ]) {
    for (const [name, canvas] of Object.entries(at(root, family).children)) {
      actions[`${family}/${name}`] = [
        { delay: 1000, parts: [await context.part(canvas)] },
      ];
    }
  }
  return context.bundle({
    id: "combat-digits",
    entities: [
      {
        id: "combat-digits",
        kind: "effect",
        order: 0,
        x: 0,
        y: 0,
        z: 0,
        visible: true,
        flip: false,
        opacity: 1,
        action: "NoRed0/0",
        actions,
      },
    ],
    metadata: { source: "Effect.wz:BasicEff.img/No*", consumer: "00437d0f" },
  });
}

/** Publish only authored map mobs; absent sound nodes mean silence, never substitute audio. */
async function combatSounds(context, mapIds, weaponSfx) {
  const result = { Mob: {}, Weapon: {} };
  const ids = new Set();
  for (const mapId of mapIds) {
    const map = context.image("Map", `Map/Map${mapId[0]}/${mapId}.img`);
    const life = map.children.life;
    if (!life) continue;
    const records = Object.values(life.children);
    if (records.length > 4096) {
      throw new Error("Combat life sound budget exceeded");
    }
    for (const record of records) {
      if (value(record, "type", "") === "m") {
        ids.add(String(value(record, "id", "")).padStart(7, "0"));
      }
    }
  }
  const mobs = context.image("Sound", "Mob.img");
  for (const id of ids) {
    if (mobs.children[id]) {
      result.Mob[Number(id)] = await soundChildren(
        context,
        "Mob",
        id,
        at(mobs, id),
      );
    }
  }
  const weapons = context.image("Sound", "Weapon.img");
  const weapon = weapons.children[weaponSfx];
  if (weapon) {
    result.Weapon[weaponSfx] = await soundChildren(
      context,
      "Weapon",
      weaponSfx,
      weapon,
    );
  }
  return result;
}

async function soundChildren(context, category, id, root) {
  const result = {};
  const entries = Object.entries(resolveNode(root).children);
  if (entries.length > MAX_SOUNDS) {
    throw new Error("Combat sound family budget exceeded");
  }
  for (const [name, node] of entries) {
    if (!COMBAT_SOUND_NAMES[category].test(name)) continue;
    result[name] = await retainedCombatSound(
      context,
      node,
      `Sound.wz:${category}.img/${id}/${name}`,
    );
  }
  return result;
}

/** Preserve unresolved original aliases as explicit unavailable records, never repaired audio. */
async function retainedCombatSound(context, node, source) {
  let resolved;
  try {
    resolved = resolveNode(node);
  } catch (error) {
    return {
      available: false,
      source,
      alias: node.value,
      reason: error.message,
    };
  }
  return {
    available: true,
    descriptor: await publishResolvedSound(context, resolved, source),
  };
}

/** Immutable catalog metadata; audio and visual payloads remain separately demand-loaded. */
export async function extractAudiovisual(context, mapIds, weaponSfx) {
  if (!Array.isArray(mapIds) || mapIds.length > 512) {
    throw new Error("Invalid audiovisual map selection");
  }
  if (typeof weaponSfx !== "string" || weaponSfx.length > 128) {
    throw new Error("Invalid equipped weapon sound family");
  }
  mkdirSync(resolve(context.output, "audio"), { recursive: true });
  const index = { schemaVersion: 1, maps: {}, sounds: {}, effects: {} };
  const bgms = new Map();
  for (const mapId of mapIds) {
    if (!/^\d{9}$/.test(mapId)) throw new Error(`Invalid map id ${mapId}`);
    const map = context.image("Map", `Map/Map${mapId[0]}/${mapId}.img`);
    const info = at(map, "info");
    const bgm = value(info, "bgm", "");
    // Track names are original WZ child keys, not JavaScript identifiers.
    if (!/^[A-Za-z0-9_]+\/[^/\\]+$/.test(bgm)) {
      throw new Error(`Unsupported map BGM ${bgm}`);
    }
    const [image, name] = bgm.split("/");
    if (!bgms.has(bgm)) {
      bgms.set(
        bgm,
        await publishSound(
          context,
          at(context.image("Sound", `${image}.img`), name),
          `Sound.wz:${image}.img/${name}`,
        ),
      );
    }
    index.maps[mapId] = {
      bgm: bgms.get(bgm),
      effect: value(info, "effect", null),
    };
  }
  for (const category of ["UI", "Game"]) {
    index.sounds[category] = await soundFamily(context, category);
  }
  index.combat = {
    digits: await combatDigits(context),
    sounds: await combatSounds(context, mapIds, weaponSfx),
  };
  for (const name of BASIC_EFFECTS) {
    index.effects[name] = await publishEffect(context, "BasicEff.img", name);
  }
  for (const name of ["Bubbling", "Viewrange", "NpcSummon", "NpcReturn"]) {
    index.effects[name] = await publishEffect(context, "MapEff.img", name);
  }
  return index;
}
