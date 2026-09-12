import { at } from "../src/assets/image.js";
import { effectFrames } from "./audiovisual-data.js";

const MAX_PROGRAMS = 32;
const artworkCaches = new WeakMap();

/** 006d089a selects one TVmedia child and loops it; TVoff plays once above it. */
async function artwork(context) {
  if (artworkCaches.has(context)) return artworkCaches.get(context);
  const root = context.image("UI", "MapleTV.img");
  const programs = Object.keys(at(root, "TVmedia").children);
  if (!programs.length || programs.length > MAX_PROGRAMS) {
    throw new Error("MapleTV program count exceeds policy");
  }
  const actions = Object.create(null);
  for (let index = 0; index < programs.length; index++) {
    // Native 006d0f29 formats a uniformly selected integer, not an arbitrary key.
    if (programs[index] !== String(index)) {
      throw new Error("MapleTV program keys are not contiguous");
    }
    actions[programs[index]] = (
      await effectFrames(context, at(root, `TVmedia/${programs[index]}`))
    ).frames;
  }
  const off = (await effectFrames(context, at(root, "TVoff"))).frames;
  const result = { programs, actions, off };
  artworkCaches.set(context, result);
  return result;
}

/** Keep the actor anchor so shell and both screens share the same streaming cell. */
function screenEntity(actor, channel, actions, offset) {
  const translated = Object.create(null);
  for (const [name, frames] of Object.entries(actions)) {
    translated[name] = frames.map((frame) => ({
      ...frame,
      parts: frame.parts.map((part) => ({
        ...part,
        x: part.x + offset.x,
        y: part.y + offset.y,
      })),
    }));
  }
  return {
    ...actor,
    id: `${actor.id}:mapletv:${channel}`,
    kind: "effect",
    // Browser sibling ordering models the native layers attached above the shell.
    order: actor.order + 1,
    flip: false,
    action: Object.keys(translated)[0],
    actions: translated,
  };
}

export function screenCoordinate(info, key) {
  const authored = info[key];
  const coordinate =
    typeof authored === "string" && /^-?\d+$/.test(authored)
      ? Number(authored)
      : authored;
  if (!Number.isSafeInteger(coordinate)) {
    throw new Error(`Invalid MapleTV screen coordinate ${key}`);
  }
  return coordinate;
}

/** Only original NPC info/MapleTV enables local artwork; no broadcast is synthesized. */
export async function extractMapleTV(context, actor, info) {
  // Original 9270003/9270040 store adY as a decimal string, not an absent coordinate.
  const msgX = screenCoordinate(info, "MapleTVmsgX"),
    msgY = screenCoordinate(info, "MapleTVmsgY"),
    adX = screenCoordinate(info, "MapleTVadX"),
    adY = screenCoordinate(info, "MapleTVadY");
  const original = await artwork(context);
  // 006d0f86 adds180; 006d1494 adds90 before the literal canvas origin is applied.
  const media = screenEntity(actor, "media", original.actions, {
    x: adX,
    y: adY + 180,
  });
  const message = screenEntity(
    actor,
    "message",
    { TVoff: original.off },
    {
      x: msgX,
      y: msgY + 90,
    },
  );
  return {
    entities: [media, message],
    controller: {
      owner: actor.id,
      media: media.id,
      message: message.id,
      programs: original.programs,
      source: "UI.wz:MapleTV.img",
      broadcast: "unavailable: no received MapleTV message",
    },
  };
}
