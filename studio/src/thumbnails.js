const atlasImages = new Map();
const MAX_ATLASES = 512;
const PADDING = 6;
const MAX_SCALE = 3;

function atlasImage(url) {
  if (!atlasImages.has(url)) {
    if (atlasImages.size >= MAX_ATLASES) atlasImages.clear();
    atlasImages.set(
      url,
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Artwork failed to load"));
        image.src = url;
      }),
    );
  }
  return atlasImages.get(url);
}

/** Mobs stand by default; items and other bundles use their single action. */
function firstFrame(actions) {
  const frames = actions.stand ?? actions.default ?? Object.values(actions)[0];
  return frames?.[0] ?? null;
}

function drawableParts(visual) {
  const frame = firstFrame(visual.entity.actions);
  return (frame?.parts ?? []).filter((part) => {
    const texture = visual.textures[part.texture];
    return texture && visual.atlases[texture.atlas];
  });
}

function boundsOf(visual, parts) {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const part of parts) {
    const texture = visual.textures[part.texture];
    left = Math.min(left, part.x);
    top = Math.min(top, part.y);
    right = Math.max(right, part.x + texture.width);
    bottom = Math.max(bottom, part.y + texture.height);
  }
  return { left, top, right, bottom };
}

function paint({ canvas, visual, parts, images, size }) {
  const box = boundsOf(visual, parts);
  const width = Math.max(1, box.right - box.left);
  const height = Math.max(1, box.bottom - box.top);
  const scale = Math.min(
    (size - PADDING * 2) / width,
    (size - PADDING * 2) / height,
    MAX_SCALE,
  );
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
  const offsetX = (size - width * scale) / 2;
  const offsetY = (size - height * scale) / 2;
  parts.forEach((part, index) => {
    const texture = visual.textures[part.texture];
    context.drawImage(
      images[index],
      texture.x,
      texture.y,
      texture.width,
      texture.height,
      offsetX + (part.x - box.left) * scale,
      offsetY + (part.y - box.top) * scale,
      texture.width * scale,
      texture.height * scale,
    );
  });
}

/** Compose the first visible frame into a square canvas using only atlas source rectangles. */
export async function thumbnail(visual, size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  if (!visual?.entity?.actions) return canvas;
  const parts = drawableParts(visual);
  if (!parts.length) return canvas;
  const images = await Promise.all(
    parts.map((part) =>
      atlasImage(visual.atlases[visual.textures[part.texture].atlas].url),
    ),
  );
  paint({ canvas, visual, parts, images, size });
  return canvas;
}

/** Item and NPC bundles expose the same entity/texture shape as a resolved mob. */
export function bundleVisual(bundle, suffix = "/icon") {
  const entities = bundle?.entities ?? [];
  const entity =
    entities.find((row) => row.id.endsWith(suffix)) ?? entities[0] ?? null;
  if (!entity) return null;
  return { entity, textures: bundle.textures, atlases: bundle.atlases };
}
