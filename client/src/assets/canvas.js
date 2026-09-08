import { inflateSync, constants } from "node:zlib";
import { keyStream } from "./crypto.js";
import { Reader } from "./reader.js";

/** @param {Buffer} payload @returns {Buffer} */
function compressedBytes(payload) {
  // ZLZ accepts a normal zlib stream or length-prefixed, independently encrypted chunks.
  if (
    payload.length >= 2 &&
    (payload[0] & 15) === 8 &&
    ((payload[0] << 8) + payload[1]) % 31 === 0
  )
    return payload;
  const reader = new Reader(payload);
  const chunks = [];
  while (reader.pos < reader.end) {
    const size = reader.u32();
    if (size <= 0) throw new Error("Invalid encrypted canvas chunk length");
    const input = reader.take(size);
    const key = keyStream(size);
    const output = Buffer.alloc(size);
    for (let i = 0; i < size; i++) output[i] = input[i] ^ key[i];
    chunks.push(output);
  }
  return Buffer.concat(chunks);
}
/** Decode original Canvas pixels to straight-alpha RGBA.
 * @param {import('./image.js').WzNode} canvas
 * @returns {{width:number,height:number,rgba:Buffer,format:number,scale:number}}
 */
export function decodeCanvas(canvas) {
  const { width, height, format, scale } = canvas;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 65535 ||
    height > 65535 ||
    width * height > 32 * 1024 * 1024
  )
    throw new Error(`Unsafe Canvas dimensions ${width}x${height}`);
  const factor = 2 ** scale;
  const storedWidth = Math.ceil(width / factor),
    storedHeight = Math.ceil(height / factor);
  if (![1, 2, 513, 1026].includes(format))
    throw new Error(`Unsupported Canvas pixel format ${format}`);
  const pixelBytes = format === 2 ? 4 : 2;
  const expected =
    format === 1026
      ? Math.ceil(storedWidth / 4) * Math.ceil(storedHeight / 4) * 16
      : storedWidth * storedHeight * pixelBytes;
  const compressed = compressedBytes(canvas.data);
  // Original streams finish a sync-flushed segment (00 00 ff ff), not necessarily a zlib end trailer.
  // Full decompressed length is mandatory; malformed/truncated segments are never silently accepted.
  const syncFlushed =
    compressed.length >= 4 &&
    compressed.subarray(-4).equals(Buffer.from([0, 0, 255, 255]));
  const raw = inflateSync(compressed, {
    maxOutputLength: expected,
    finishFlush: syncFlushed ? constants.Z_SYNC_FLUSH : constants.Z_FINISH,
  });
  if (raw.length !== expected)
    throw new Error(`Canvas inflated length ${raw.length} != ${expected}`);
  const rgba = Buffer.alloc(width * height * 4);
  if (format === 1026) {
    // Gr2D_DX8.dll FUN_50404869 maps 0x402 to D3DFMT_DXT3.
    const blocksX = Math.ceil(storedWidth / 4);
    const colors = new Uint8Array(12);
    for (let by = 0; by < Math.ceil(storedHeight / 4); by++)
      for (let bx = 0; bx < blocksX; bx++) {
        const block = (by * blocksX + bx) * 16;
        for (let c = 0; c < 2; c++) {
          const p = raw.readUInt16LE(block + 8 + c * 2);
          colors[c * 3] = Math.round(((p >>> 11) * 255) / 31);
          colors[c * 3 + 1] = Math.round((((p >>> 5) & 63) * 255) / 63);
          colors[c * 3 + 2] = Math.round(((p & 31) * 255) / 31);
        }
        for (let c = 0; c < 3; c++) {
          colors[6 + c] = Math.floor((2 * colors[c] + colors[3 + c]) / 3);
          colors[9 + c] = Math.floor((colors[c] + 2 * colors[3 + c]) / 3);
        }
        const indices = raw.readUInt32LE(block + 12);
        for (let p = 0; p < 16; p++) {
          const sx = bx * 4 + (p % 4),
            sy = by * 4 + Math.floor(p / 4);
          const color = ((indices >>> (p * 2)) & 3) * 3;
          const alpha =
            ((raw[block + Math.floor(p / 2)] >>> ((p & 1) * 4)) & 15) * 17;
          for (
            let y = sy * factor;
            y < Math.min(height, (sy + 1) * factor);
            y++
          )
            for (
              let x = sx * factor;
              x < Math.min(width, (sx + 1) * factor);
              x++
            ) {
              const out = (y * width + x) * 4;
              rgba[out] = colors[color];
              rgba[out + 1] = colors[color + 1];
              rgba[out + 2] = colors[color + 2];
              rgba[out + 3] = alpha;
            }
        }
      }
    return { width, height, rgba, format, scale };
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const source =
        (Math.floor(y / factor) * storedWidth + Math.floor(x / factor)) *
        pixelBytes;
      const out = (y * width + x) * 4;
      if (format === 2) {
        rgba[out] = raw[source + 2];
        rgba[out + 1] = raw[source + 1];
        rgba[out + 2] = raw[source];
        rgba[out + 3] = raw[source + 3];
      } else {
        const p = raw.readUInt16LE(source);
        if (format === 1) {
          rgba[out] = ((p >>> 8) & 15) * 17;
          rgba[out + 1] = ((p >>> 4) & 15) * 17;
          rgba[out + 2] = (p & 15) * 17;
          rgba[out + 3] = (p >>> 12) * 17;
        } else {
          const r = p >>> 11,
            g = (p >>> 5) & 63,
            b = p & 31;
          rgba[out] = r << 3;
          rgba[out + 1] = (g << 2) | (g >>> 4);
          rgba[out + 2] = (b << 3) | (b >>> 2);
          rgba[out + 3] = 255;
        }
      }
    }
  return { width, height, rgba, format, scale };
}
