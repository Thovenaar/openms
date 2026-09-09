import { createHash } from "node:crypto";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { encodePNG } from "../src/assets/png.js";

export const ATLAS_LIMIT = 2048;
export const PADDING = 1;
/** Content identity includes every byte, including transparent RGB. */
export function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
/** Each writer owns its staging directory; rename exposes only complete bytes. */
export async function publishFile(path, bytes) {
  const directory = await mkdtemp(`${path}.tmp-`);
  const temporary = join(directory, "content");
  try {
    await Bun.write(temporary, bytes);
    await rename(temporary, path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
/** Publish immutable resources before the catalog is committed. */
export async function resource(output, directory, extension, bytes) {
  const sha256 = hash(bytes);
  const name = `${directory}/${sha256}.${extension}`;
  const path = resolve(output, name);
  const existing = Bun.file(path);
  if (await existing.exists()) {
    const stored = Buffer.from(await existing.arrayBuffer());
    if (stored.length === bytes.length && hash(stored) === sha256) {
      return { url: `/generated/${name}`, sha256, bytes: bytes.length };
    }
  }
  await publishFile(path, bytes);
  return { url: `/generated/${name}`, sha256, bytes: bytes.length };
}
/** Independent PNG scanline reader: validates the actual encoded payload. */
function readPixels(png, width, height) {
  const chunks = [];
  let offset = 8;
  for (let count = 0; offset < png.length && count < 100000; count++) {
    const size = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (offset + size + 12 > png.length) throw new Error("Truncated atlas PNG");
    if (type === "IDAT") {
      chunks.push(png.subarray(offset + 8, offset + 8 + size));
    }
    offset += size + 12;
  }
  if (offset !== png.length) throw new Error("PNG chunk limit exceeded");
  const rows = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  if (rows.length !== height * (stride + 1)) {
    throw new Error("PNG dimensions changed");
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    if (rows[y * (stride + 1)] !== 0) {
      throw new Error("Unsupported PNG verification filter");
    }
    rgba.set(
      rows.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      y * stride,
    );
  }
  return rgba;
}
/** Shelf layout: stable texture identities determine placement, not traversal timing. */
function layout(ids, pixels) {
  const pages = [];
  let page = { entries: [], x: 0, y: 0, row: 0, width: 0, height: 0 };
  for (const id of ids) {
    const item = pixels[id];
    const w = item.width + PADDING * 2,
      h = item.height + PADDING * 2;
    if (w > ATLAS_LIMIT || h > ATLAS_LIMIT) {
      throw new Error(
        `Canvas ${id} exceeds ${ATLAS_LIMIT - 2} pixel atlas interior`,
      );
    }
    if (page.x + w > ATLAS_LIMIT) {
      page.x = 0;
      page.y += page.row;
      page.row = 0;
    }
    if (page.y + h > ATLAS_LIMIT) {
      pages.push(page);
      page = { entries: [], x: 0, y: 0, row: 0, width: 0, height: 0 };
    }
    page.entries.push({ id, x: page.x + PADDING, y: page.y + PADDING });
    page.width = Math.max(page.width, page.x + w);
    page.height = Math.max(page.height, page.y + h);
    page.x += w;
    page.row = Math.max(page.row, h);
  }
  if (page.entries.length) pages.push(page);
  return pages;
}
/** Compare each original row with PNG-decoded atlas subrect, without canvas premultiplication. */
function verify(page, decoded, pixels) {
  let compared = 0;
  for (const entry of page.entries) {
    const item = pixels[entry.id];
    for (let y = 0; y < item.height; y++) {
      const offset = ((entry.y + y) * page.width + entry.x) * 4;
      const row = decoded.subarray(offset, offset + item.width * 4);
      const original = item.rgba.subarray(
        y * item.width * 4,
        (y + 1) * item.width * 4,
      );
      if (!row.equals(original)) {
        throw new Error(`Pixel round-trip mismatch: ${entry.id} row ${y}`);
      }
      compared += row.length;
    }
  }
  return compared;
}
/** One region-sized batch; shared textures reuse the previously published atlas. */
export async function packageAtlases(state, ids) {
  const missing = [...ids].filter((id) => !state.textures[id]).sort();
  const pages = layout(missing, state.pixels);
  for (const page of pages) {
    const rgba = Buffer.alloc(page.width * page.height * 4);
    for (const entry of page.entries) {
      const item = state.pixels[entry.id];
      for (let y = 0; y < item.height; y++) {
        rgba.set(
          item.rgba.subarray(y * item.width * 4, (y + 1) * item.width * 4),
          ((entry.y + y) * page.width + entry.x) * 4,
        );
      }
    }
    const png = encodePNG(page.width, page.height, rgba);
    state.verifiedBytes += verify(
      page,
      readPixels(png, page.width, page.height),
      state.pixels,
    );
    const descriptor = await resource(state.output, "atlases", "png", png);
    state.atlases[descriptor.sha256] = {
      ...descriptor,
      width: page.width,
      height: page.height,
    };
    for (const entry of page.entries) {
      const item = state.pixels[entry.id];
      state.textures[entry.id] = {
        atlas: descriptor.sha256,
        x: entry.x,
        y: entry.y,
        width: item.width,
        height: item.height,
        source: item.source,
        format: item.format,
        scale: item.scale,
      };
    }
  }
  return [...new Set([...ids].map((id) => state.textures[id].atlas))].sort();
}
