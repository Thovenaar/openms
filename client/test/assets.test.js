import { test, expect } from "bun:test";
import { deflateSync, constants } from "node:zlib";
import { decodeCanvas } from "../src/assets/canvas.js";
import { keyStream } from "../src/assets/crypto.js";
import { Reader } from "../src/assets/reader.js";
import { compact, wzString } from "../src/assets/strings.js";
import { resolveNode, parseImage } from "../src/assets/image.js";

// Synthetic bytes exercising recovered wire contracts, not claimed original asset fixtures.
function canvas(raw, width, height, format, scale = 0) {
  return {
    width,
    height,
    format,
    scale,
    data: deflateSync(raw, { finishFlush: constants.Z_SYNC_FLUSH }),
  };
}
test("sync-flushed canvas requires complete pixels and preserves straight alpha", () => {
  const input = canvas(Buffer.from([0x0f, 0x8f, 0xf0, 0xf0]), 2, 1, 1);
  expect([...decodeCanvas(input).rgba]).toEqual([
    255, 0, 255, 136, 0, 255, 0, 255,
  ]);
  expect(() => decodeCanvas({ ...input, width: 3 })).toThrow("inflated length");
  expect(() =>
    decodeCanvas({ ...input, data: input.data.subarray(0, -5) }),
  ).toThrow();
});
test("encrypted canvas chunks restart the original keystream independently", () => {
  const input = canvas(
    Buffer.from([20, 40, 60, 80, 90, 110, 130, 150]),
    2,
    1,
    2,
  );
  const chunks = [input.data.subarray(0, 7), input.data.subarray(7)];
  const data = Buffer.concat(
    chunks.map((chunk) => {
      const result = Buffer.alloc(chunk.length + 4);
      result.writeUInt32LE(chunk.length);
      const key = keyStream(chunk.length);
      for (let i = 0; i < chunk.length; i++) result[4 + i] = chunk[i] ^ key[i];
      return result;
    }),
  );
  expect([...decodeCanvas({ ...input, data }).rgba]).toEqual([
    60, 40, 20, 80, 130, 110, 90, 150,
  ]);
});
test("RGB565 software conversion and scale are separate recovered fields", () => {
  const decoded = decodeCanvas(
    canvas(Buffer.from([255, 255, 0, 0]), 3, 1, 513, 1),
  );
  expect([...decoded.rgba]).toEqual([
    248, 255, 255, 255, 248, 255, 255, 255, 0, 0, 0, 255,
  ]);
});
test("DXT3 alpha indices and clipped edge blocks decode without transparency mode", () => {
  const raw = Buffer.alloc(16);
  raw[0] = 0xf0;
  raw.writeUInt16LE(0xf800, 8);
  raw.writeUInt16LE(0x001f, 10);
  raw.writeUInt32LE(4, 12); // Pixel0 red alpha0, pixel1 blue alpha255.
  expect([...decodeCanvas(canvas(raw, 2, 1, 1026)).rgba]).toEqual([
    255, 0, 0, 0, 0, 0, 255, 255,
  ]);
});
test("compact signed values and original encrypted filename decode exactly", () => {
  const r = new Reader(Buffer.from([0xff, 0x80, 0x00, 0x01, 0x00, 0x00]));
  expect(compact(r)).toBe(-1);
  expect(compact(r)).toBe(256);
  expect(
    wzString(new Reader(Buffer.from("f40c35a339d4655d11daacdcb3", "hex"))),
  ).toBe("00002000.img");
  expect(() =>
    wzString(new Reader(Buffer.from([0x80, 0, 0x20, 0, 0]))),
  ).toThrow("length");
});
test("UOL cycles and truncated object payloads fail instead of hanging or skipping", () => {
  const root = { type: "Property", name: "", parent: null, children: {} };
  root.children.a = {
    type: "UOL",
    name: "a",
    parent: root,
    children: {},
    value: "b",
  };
  root.children.b = {
    type: "UOL",
    name: "b",
    parent: root,
    children: {},
    value: "a",
  };
  expect(() => resolveNode(root.children.a)).toThrow("Cyclic UOL");
  expect(() => parseImage(new Reader(Buffer.from([0x73, 0x80])))).toThrow(
    "Truncated input",
  );
});
