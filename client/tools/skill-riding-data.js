import { at, value } from "../src/assets/image.js";
import { extractAvatarRecord, avatarMaps } from "./avatar-data.js";

const MAX_RIDING_RECORDS = 256;

/** Keep original saddle mount-id banks; possession alone cannot select an incompatible saddle. */
export async function extractSkillRiding(context) {
  const maps = avatarMaps(context);
  const mounts = Object.create(null);
  const saddles = Object.create(null);
  const paths = [...context.imageEntries("Character").keys()].filter((path) =>
    /^TamingMob\/019[013]\d{4}\.img$/.test(path),
  );
  if (paths.length > MAX_RIDING_RECORDS) {
    throw new Error("Original riding catalog bound exceeded");
  }
  for (const path of paths) {
    const id = Number(path.slice(10, -4));
    const node = context.image("Character", path);
    if (Math.trunc(id / 10000) === 191) {
      saddles[id] = await extractSaddle(context, { id, path, node }, maps);
    } else mounts[id] = await extractMount(context, { id, path, node }, maps);
  }
  const body = context.image("Character", "00002000.img");
  const riderAnchor = value(at(body, "sit/0/body/map"), "navel");
  return { mounts, saddles, riderAnchor };
}

async function extractMount(context, input, maps) {
  const record = await extractAvatarRecord(
    context,
    { id: input.id, path: input.path, kind: "equipment", riding: true },
    maps,
  );
  const templateId = value(at(input.node, "info"), "tamingMob", null);
  const template =
    templateId === null
      ? null
      : at(
          context.image(
            "TamingMob",
            `${String(templateId).padStart(4, "0")}.img`,
          ),
          "info",
        );
  return {
    source: record.source,
    templateId,
    riding: true,
    speed: template ? value(template, "speed", 100) : null,
    jump: template ? value(template, "jump", 100) : null,
    fs: template ? value(template, "fs", 1) : null,
    swim: template ? value(template, "swim", 100) : null,
    fatigue: template ? value(template, "fatigue", 0) : null,
    bundle: await ridingBundle(context, record, String(input.id)),
  };
}

async function extractSaddle(context, input, maps) {
  const result = Object.create(null);
  const banks = Object.keys(input.node.children).filter((key) =>
    /^\d+$/.test(key),
  );
  if (banks.length > MAX_RIDING_RECORDS) {
    throw new Error("Saddle bank bound exceeded");
  }
  for (const bank of banks) {
    const record = await extractAvatarRecord(
      context,
      { id: input.id, path: input.path, kind: "equipment", riding: true, bank },
      maps,
    );
    result[bank] = {
      source: `${record.source}/${bank}`,
      bundle: await ridingBundle(context, record, `${input.id}:${bank}`),
    };
  }
  return result;
}

async function ridingBundle(context, record, key) {
  const actions = Object.create(null);
  for (const [name, frames] of Object.entries(record.frames)) {
    actions[name] = frames.map((frame) => ({
      delay: frame.delay,
      parts: frame.parts.map((part) => ({
        texture: part.texture,
        x: part.x,
        y: part.y,
        z: part.z,
      })),
    }));
  }
  return context.bundle({
    id: `riding:${key}`,
    entities: [
      {
        id: `riding:${key}`,
        order: 0,
        kind: "effect",
        x: 0,
        y: 0,
        z: 0,
        visible: true,
        flip: false,
        opacity: 1,
        action: "stand1",
        actions,
      },
    ],
    metadata: { riding: record },
  });
}
