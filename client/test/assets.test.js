import { test, expect } from "bun:test";
import { deflateSync, constants } from "node:zlib";
import { decodeCanvas } from "../src/assets/canvas.js";
import { keyStream } from "../src/assets/crypto.js";
import { Reader } from "../src/assets/reader.js";
import { compact, wzString } from "../src/assets/strings.js";
import { resolveNode, parseImage } from "../src/assets/image.js";

// Synthetic bytes exercising recovered wire contracts, not claimed original asset fixtures.
function canvas(raw, width, height, format) {
  return {
    width,
    height,
    format,
    scale: 0,
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
  const decoded = decodeCanvas({
    ...canvas(Buffer.from([255, 255, 0, 0]), 3, 1, 513),
    scale: 1,
  });
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

function stringBytes(text) {
  const bytes = Buffer.from(text, "latin1");
  const key = keyStream(bytes.length);
  const output = Buffer.alloc(bytes.length + 2);
  output[0] = 0x73;
  output[1] = -bytes.length & 255;
  for (let i = 0; i < bytes.length; i++) {
    output[i + 2] = bytes[i] ^ key[i] ^ ((0xaa + i) & 255);
  }
  return output;
}
function objectProperty(name, payload, length = payload.length) {
  const prefix = Buffer.alloc(5);
  prefix[0] = 9;
  prefix.writeUInt32LE(length, 1);
  return Buffer.concat([stringBytes(name), prefix, payload]);
}
function propertyBytes(children) {
  return Buffer.concat([
    stringBytes("Property"),
    Buffer.from([0, 0, children.length]),
    ...children,
  ]);
}
function scalarProperty(name, number) {
  return Buffer.concat([stringBytes(name), Buffer.from([3, number])]);
}
test("nested Canvas properties resume metadata and the outer sibling at exact boundaries", () => {
  const pixels = canvas(Buffer.from([10, 20, 30, 40]), 1, 1, 2);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(pixels.data.length + 1);
  const payload = Buffer.concat([
    stringBytes("Canvas"),
    Buffer.from([0, 1, 0, 0, 1]),
    objectProperty("metadata", propertyBytes([scalarProperty("answer", 42)])),
    Buffer.from([1, 1, 2, 0, 0, 0, 0, 0]),
    size,
    Buffer.from([0]),
    pixels.data,
  ]);
  const bytes = propertyBytes([
    objectProperty("image", payload),
    scalarProperty("after", 7),
  ]);
  const reader = new Reader(bytes);
  const root = parseImage(reader);
  expect(root.children.image.children.metadata.children.answer.value).toBe(42);
  expect([...decodeCanvas(root.children.image).rgba]).toEqual([30, 20, 10, 40]);
  expect(root.children.after.value).toBe(7);
  expect(reader.pos).toBe(bytes.length);
  expect(reader.end).toBe(bytes.length);
});
test("nested object lengths cannot consume their parent's following bytes", () => {
  const inner = propertyBytes([scalarProperty("value", 12)]);
  const outer = propertyBytes([
    objectProperty("inner", inner, inner.length + 1),
  ]);
  const bytes = propertyBytes([
    objectProperty("outer", outer),
    scalarProperty("after", 55),
  ]);
  expect(() => parseImage(new Reader(bytes))).toThrow("Truncated input");
  const trailing = propertyBytes([
    objectProperty("inner", Buffer.concat([inner, Buffer.from([0])])),
  ]);
  expect(() => parseImage(new Reader(trailing))).toThrow("expected");
});
test("convex unprefixed objects retain index ordering and return to the enclosing property", () => {
  const convex = Buffer.concat([
    stringBytes("Shape2D#Convex2D"),
    Buffer.from([2]),
    stringBytes("Shape2D#Vector2D"),
    Buffer.from([3, 4]),
    stringBytes("Shape2D#Convex2D"),
    Buffer.from([1]),
    stringBytes("Shape2D#Vector2D"),
    Buffer.from([5, 6]),
  ]);
  const root = parseImage(
    new Reader(
      propertyBytes([
        objectProperty("shape", convex),
        scalarProperty("after", 11),
      ]),
    ),
  );
  expect(root.children.shape.children[0].value).toEqual({ x: 3, y: 4 });
  expect(root.children.shape.children[1].children[0].value).toEqual({
    x: 5,
    y: 6,
  });
  expect(root.children.after.value).toBe(11);
});
test("iterative object parsing retains the original maximum nesting depth", () => {
  let bytes = propertyBytes([]);
  for (let depth = 0; depth < 64; depth++) {
    bytes = propertyBytes([objectProperty("child", bytes)]);
  }
  let node = parseImage(new Reader(bytes));
  for (let depth = 0; depth < 64; depth++) node = node.children.child;
  expect(node.type).toBe("Property");
  expect(() =>
    parseImage(new Reader(propertyBytes([objectProperty("child", bytes)]))),
  ).toThrow("nesting");
});
test("Sound_DX8 custom format envelope ends before the next property", () => {
  const formatType = Buffer.alloc(16, 1);
  const payload = Buffer.concat([
    stringBytes("Sound_DX8"),
    Buffer.from([0, 3, 12, 34]),
    Buffer.alloc(16, 2),
    Buffer.alloc(16, 3),
    Buffer.from([4, 5]),
    formatType,
    Buffer.from([2, 0xaa, 0xbb, 0x11, 0x22, 0x33]),
  ]);
  const root = parseImage(
    new Reader(
      propertyBytes([
        objectProperty("sound", payload),
        scalarProperty("after", 27),
      ]),
    ),
  );
  expect(root.children.sound.value.formatType).toBe(formatType.toString("hex"));
  expect([...root.children.sound.value.formatData]).toEqual([0xaa, 0xbb]);
  expect([...root.children.sound.data]).toEqual([0x11, 0x22, 0x33]);
  expect(root.children.after.value).toBe(27);
});
test("IMG string references cannot seek before the buffer start", () => {
  expect(() =>
    parseImage(new Reader(Buffer.from([0x1b, 255, 255, 255, 255]))),
  ).toThrow("Truncated input");
});
