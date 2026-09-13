import { createHash } from "node:crypto";
import { requireContent } from "./validation.js";
import { canonical } from "./digest.js";

/** Uploaded sheets remain exact PNG bytes; frames use explicit, unscaled atlas rectangles. */
export function imageAppearance(appearance, image) {
  const textures = Object.create(null),
    actions = Object.create(null);
  for (const [name, frames] of Object.entries(appearance.actions)) {
    actions[name] = frames.map((frame) => imageFrame(frame, image, textures));
  }
  return {
    entity: {
      id: "appearance",
      kind: "map",
      x: 0,
      y: 0,
      z: 0,
      order: 0,
      visible: true,
      flip: false,
      opacity: 1,
      action: Object.keys(actions)[0],
      actions,
    },
    textures,
    atlases: {
      [image.id]: {
        url: `/api/v1/custom-content/images/${image.id}`,
        sha256: image.id,
        bytes: image.bytes.byteLength,
        width: image.width,
        height: image.height,
      },
    },
  };
}

function imageFrame(frame, image, textures) {
  requireContent(
    frame.x + frame.width <= image.width &&
      frame.y + frame.height <= image.height,
    "Sprite frame extends outside uploaded image",
  );
  const id = frameIdentity(frame, image);
  textures[id] = {
    atlas: image.id,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    source: `upload:${image.id}`,
  };
  return {
    delay: frame.delay,
    parts: [{ texture: id, x: 0 - frame.originX, y: 0 - frame.originY, z: 0 }],
  };
}

function frameIdentity(frame, image) {
  requireContent(
    image.pixels instanceof Uint8Array &&
      image.pixels.length === image.width * image.height * 4,
    "Decoded image pixels are required",
  );
  const hash = createHash("sha256").update(`${frame.width}x${frame.height}:`);
  for (let y = frame.y; y < frame.y + frame.height; y++) {
    const offset = (y * image.width + frame.x) * 4;
    hash.update(image.pixels.subarray(offset, offset + frame.width * 4));
  }
  return hash.digest("hex");
}

export function mergeVisual(target, visual) {
  // Equal pixel hashes can legitimately occupy different original/uploaded atlases.
  for (const [id, texture] of Object.entries(visual.textures)) {
    const previous = target.textures[id];
    if (previous) {
      requireContent(
        previous.width === texture.width && previous.height === texture.height,
        "Conflicting texture dimensions",
      );
    } else target.textures[id] = structuredClone(texture);
  }
  mergeDictionary(target.atlases, visual.atlases);
}

function mergeDictionary(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (target[key]) {
      requireContent(
        canonical(target[key]) === canonical(value),
        "Conflicting immutable visual resource",
      );
    } else target[key] = structuredClone(value);
  }
}
