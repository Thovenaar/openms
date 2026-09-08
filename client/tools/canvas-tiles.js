import { ATLAS_LIMIT, PADDING, hash } from "./atlas.js";

const TILE_SIZE = ATLAS_LIMIT - PADDING * 2;
const MAX_TILES = 128;
/** Copy a straight-alpha rectangle without browser canvas conversions. */
function copyTile(original, rect) {
  const rgba = Buffer.alloc(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    const start = ((rect.y + y) * original.width + rect.x) * 4;
    rgba.set(
      original.rgba.subarray(start, start + rect.width * 4),
      y * rect.width * 4,
    );
  }
  return rgba;
}
/** Verify reconstruction independently by placing every tile into a full-size buffer. */
function verifyReconstruction(original, tiles, pixels) {
  const reconstructed = Buffer.alloc(original.rgba.length);
  for (const tile of tiles) {
    const rgba = pixels[tile.texture].rgba;
    for (let y = 0; y < tile.height; y++) {
      const offset = ((tile.y + y) * original.width + tile.x) * 4;
      reconstructed.set(
        rgba.subarray(y * tile.width * 4, (y + 1) * tile.width * 4),
        offset,
      );
    }
  }
  if (!reconstructed.equals(original.rgba)) {
    throw new Error("Original canvas tile reconstruction mismatch");
  }
  return reconstructed.length;
}
/** Store general oversized-canvas decomposition while retaining its original pixel identity. */
export function prepareCanvasTiles(state, id) {
  const original = state.pixels[id];
  if (original.width <= TILE_SIZE && original.height <= TILE_SIZE) return;
  const count =
    Math.ceil(original.width / TILE_SIZE) *
    Math.ceil(original.height / TILE_SIZE);
  if (count > MAX_TILES) {
    throw new Error(`Canvas ${id} exceeds ${MAX_TILES} tile policy`);
  }
  const tiles = [];
  for (let y = 0; y < original.height; y += TILE_SIZE) {
    for (let x = 0; x < original.width; x += TILE_SIZE) {
      const rect = {
        x,
        y,
        width: Math.min(TILE_SIZE, original.width - x),
        height: Math.min(TILE_SIZE, original.height - y),
      };
      const rgba = copyTile(original, rect);
      const texture = hash(
        Buffer.concat([Buffer.from(`${rect.width}x${rect.height}:`), rgba]),
      );
      if (!state.pixels[texture]) {
        state.pixels[texture] = {
          ...original,
          width: rect.width,
          height: rect.height,
          rgba,
        };
      }
      tiles.push({ texture, ...rect });
    }
  }
  const comparedBytes = verifyReconstruction(original, tiles, state.pixels);
  state.tiledCanvases[id] = {
    width: original.width,
    height: original.height,
    source: original.source,
    format: original.format,
    scale: original.scale,
    comparedBytes,
    tiles,
  };
}
/** Keep source logical dimensions for repeat periods while splitting renderable parts. */
function expandFrame(frame, state) {
  const parts = [];
  const count = frame.parts.reduce(
    (sum, part) => sum + (state.tiledCanvases[part.texture]?.tiles.length ?? 1),
    0,
  );
  if (count > MAX_TILES) {
    throw new Error(
      `Frame exceeds ${MAX_TILES} renderable parts after canvas tiling`,
    );
  }
  for (const part of frame.parts) {
    const original = state.tiledCanvases[part.texture];
    if (!original) {
      parts.push(part);
      continue;
    }
    if (frame.parts.length === 1) {
      frame.sourceSize = { width: original.width, height: original.height };
    }
    for (const tile of original.tiles) {
      const dx = part.flip ? original.width - tile.x - tile.width : tile.x;
      parts.push({
        ...part,
        texture: tile.texture,
        x: part.x + dx,
        y: part.y + tile.y,
        sourceCanvas: part.texture,
        sourceRect: {
          x: tile.x,
          y: tile.y,
          width: tile.width,
          height: tile.height,
        },
      });
    }
  }
  frame.parts = parts;
}
/** Expand only references to oversized originals; previously expanded shared actions are stable. */
export function expandCanvasParts(entities, state) {
  for (const entity of entities) {
    for (const frames of Object.values(entity.actions)) {
      for (const frame of frames) expandFrame(frame, state);
    }
  }
}
