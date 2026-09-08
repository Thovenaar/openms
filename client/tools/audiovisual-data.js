import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { at, value, resolveNode } from "../src/assets/image.js";
import { resource } from "./atlas.js";

const MAX_SOUNDS = 512;
const MAX_EFFECT_FRAMES = 256;
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

async function publishSound(context, node, source) {
  node = resolveNode(node);
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
    if (!Number.isFinite(delay) || delay <= 0 || delay > 60000) {
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

/** Immutable catalog metadata; audio and visual payloads remain separately demand-loaded. */
export async function extractAudiovisual(context, mapIds) {
  if (!Array.isArray(mapIds) || mapIds.length > 32) {
    throw new Error("Invalid audiovisual map selection");
  }
  mkdirSync(resolve(context.output, "audio"), { recursive: true });
  const index = { schemaVersion: 1, maps: {}, sounds: {}, effects: {} };
  const bgms = new Map();
  for (const mapId of mapIds) {
    if (!/^\d{9}$/.test(mapId)) throw new Error(`Invalid map id ${mapId}`);
    const map = context.image("Map", `Map/Map${mapId[0]}/${mapId}.img`);
    const info = at(map, "info");
    const bgm = value(info, "bgm", "");
    if (!/^[A-Za-z0-9_]+\/[A-Za-z0-9_]+$/.test(bgm)) {
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
  for (const name of BASIC_EFFECTS) {
    index.effects[name] = await publishEffect(context, "BasicEff.img", name);
  }
  for (const name of ["Bubbling", "Viewrange", "NpcSummon", "NpcReturn"]) {
    index.effects[name] = await publishEffect(context, "MapEff.img", name);
  }
  return index;
}
