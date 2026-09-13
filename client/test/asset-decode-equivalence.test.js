import { test, expect } from "bun:test";
import { deflateSync } from "node:zlib";
import { decodeCanvas } from "../src/assets/canvas.js";
import { WzArchive } from "../src/assets/wz.js";
import { Reader } from "../src/assets/reader.js";

function decode(raw, format, width, height) {
  return scaledDecode(raw, { width, height, scale: 0, format });
}

function scaledDecode(raw, { width, height, scale, format }) {
  return decodeCanvas({ width, height, scale, format, data: deflateSync(raw) })
    .rgba;
}

test("all 16-bit packed values retain exact RGBA, including transparent RGB and asymmetric red", () => {
  const raw = Buffer.alloc(65536 * 2);
  const expected4444 = Buffer.alloc(65536 * 4);
  const expected565 = Buffer.alloc(65536 * 4);
  for (let pixel = 0; pixel < 65536; pixel++) {
    raw.writeUInt16LE(pixel, pixel * 2);
    const alpha = Math.floor(pixel / 4096);
    const red = Math.floor(pixel / 256) % 16;
    const green = Math.floor(pixel / 16) % 16;
    const blue = pixel % 16;
    expected4444.set([red * 17, green * 17, blue * 17, alpha * 17], pixel * 4);
    const g = Math.floor(pixel / 32) % 64,
      b = pixel % 32;
    expected565.set(
      [
        Math.floor(pixel / 2048) * 8,
        g * 4 + Math.floor(g / 16),
        b * 8 + Math.floor(b / 4),
        255,
      ],
      pixel * 4,
    );
  }
  expect(decode(raw, 1, 256, 256)).toEqual(expected4444);
  expect(decode(raw, 513, 256, 256)).toEqual(expected565);
});

test("unscaled BGRA and odd-size scaled edges agree for every channel value", () => {
  const raw = Buffer.alloc(256 * 4);
  const expected = Buffer.alloc(raw.length);
  for (let index = 0; index < 256; index++) {
    raw.set([index, 255 - index, index ^ 170, index ^ 85], index * 4);
    expected.set([index ^ 170, 255 - index, index, index ^ 85], index * 4);
  }
  expect(decode(raw, 2, 16, 16)).toEqual(expected);
  for (const format of [1, 2, 513]) {
    const pixels = raw.subarray(0, format === 2 ? 16 : 8);
    const small = decode(pixels, format, 2, 2);
    const scaled = scaledDecode(pixels, {
      format,
      width: 3,
      height: 3,
      scale: 1,
    });
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const source = (Math.floor(y / 2) * 2 + Math.floor(x / 2)) * 4;
        const target = (y * 3 + x) * 4;
        expect(scaled.subarray(target, target + 4)).toEqual(
          small.subarray(source, source + 4),
        );
      }
    }
  }
});

/** Exercise the actual archive boundary without depending on installed original assets. */
function readImage(bytes, checksum) {
  const archive = {
    path: "synthetic.wz",
    reader: new Reader(bytes),
    entries: new Map([
      ["image.img", { offset: 0, size: bytes.length, checksum, type: 4 }],
    ]),
  };
  return WzArchive.prototype.imageReader.call(archive, "image.img");
}

test("archive checksum preserves signed overflow and rejects corrupt bytes", () => {
  for (const length of [0, 1, 257, 65537, 9 * 1024 * 1024]) {
    const raw = Buffer.alloc(length, 255);
    const checksum = (length * 255) | 0;
    const read = readImage(raw, checksum);
    expect(read.bytes).toEqual(raw);
    expect(() => readImage(raw, checksum ^ 1)).toThrow("Checksum mismatch");
    if (length) {
      raw[0] = 0;
      expect(read.bytes[0]).toBe(255);
    }
  }
});
