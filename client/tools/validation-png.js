import { inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };
const MAX_PIXELS = 16777216;

/** Screenshot formats only; bounded output prevents inflated payload surprises. */
function inspectPNG(input) {
  const bytes = Buffer.from(input);
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error("Not PNG");
  const info = { width: 0, height: 0, color: -1, channels: 0, chunks: [] };
  let offset = 8;
  for (let count = 0; count < 100000 && offset + 12 <= bytes.length; count++) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (offset + length + 12 > bytes.length) {
      throw new Error("Truncated PNG chunk");
    }
    const data = bytes.subarray(offset + 8, offset + length + 8);
    if (type === "IHDR") readHeader(info, data);
    if (type === "IDAT") info.chunks.push(data);
    offset += length + 12;
    if (type === "IEND") {
      if (!info.channels || !info.chunks.length) {
        throw new Error("Missing PNG image data");
      }
      return info;
    }
  }
  throw new Error("Missing PNG end or chunk bound exceeded");
}

/** @param {object} info @param {Buffer} data */
function readHeader(info, data) {
  if (data.length !== 13) throw new Error("Invalid PNG header length");
  info.width = data.readUInt32BE(0);
  info.height = data.readUInt32BE(4);
  info.color = data[9];
  info.channels = CHANNELS[info.color];
  if (!info.width || !info.height || info.width * info.height > MAX_PIXELS) {
    throw new Error("Screenshot pixel limit exceeded");
  }
  if (
    data[8] !== 8 ||
    !info.channels ||
    data[10] !== 0 ||
    data[11] !== 0 ||
    data[12] !== 0
  ) {
    throw new Error("Unsupported screenshot PNG format");
  }
}

/** @param {number} filter @param {number} a @param {number} b @param {number} c */
function predictor(filter, a, b, c) {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return a;
    case 2:
      return b;
    case 3:
      return Math.floor((a + b) / 2);
    case 4: {
      const value = a + b - c;
      const pa = Math.abs(value - a),
        pb = Math.abs(value - b),
        pc = Math.abs(value - c);
      if (pa <= pb && pa <= pc) return a;
      return pb <= pc ? b : c;
    }
    default:
      throw new Error("Invalid PNG filter");
  }
}

/** @param {object} info */
function reconstructRows(info) {
  const stride = info.width * info.channels;
  const expected = info.height * (stride + 1);
  const raw = inflateSync(Buffer.concat(info.chunks), {
    maxOutputLength: expected,
  });
  if (raw.length !== expected) throw new Error("Unexpected PNG scanline size");
  const decoded = new Uint8Array(info.height * stride);
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const a = x >= info.channels ? decoded[index - info.channels] : 0;
      const b = y > 0 ? decoded[index - stride] : 0;
      const c =
        y > 0 && x >= info.channels
          ? decoded[index - stride - info.channels]
          : 0;
      decoded[index] =
        (raw[y * (stride + 1) + x + 1] +
          predictor(raw[y * (stride + 1)], a, b, c)) &
        255;
    }
  }
  return decoded;
}

/** Decode actual Chrome PNG bytes independently of production atlas encoding. */
export function decodePNG(input) {
  const info = inspectPNG(input);
  const decoded = reconstructRows(info);
  const pixels = new Uint8Array(info.width * info.height * 4);
  const gray = info.color === 0 || info.color === 4;
  for (let index = 0; index < info.width * info.height; index++) {
    const source = index * info.channels;
    const destination = index * 4;
    pixels[destination] = decoded[source];
    pixels[destination + 1] = decoded[source + (gray ? 0 : 1)];
    pixels[destination + 2] = decoded[source + (gray ? 0 : 2)];
    pixels[destination + 3] = info.color === 4 ? decoded[source + 1] : 255;
    if (info.color === 6) pixels[destination + 3] = decoded[source + 3];
  }
  return { width: info.width, height: info.height, pixels };
}

/** Compare decoded pixels, never encoded PNG size. */
export function comparePixels(actual, expected, tolerance = 0) {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error("Pixel comparison dimensions differ");
  }
  let changed = 0,
    outsideTolerance = 0,
    maximumChannelError = 0,
    sum = 0;
  for (let index = 0; index < actual.pixels.length; index += 4) {
    let error = 0;
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(
        actual.pixels[index + channel] - expected.pixels[index + channel],
      );
      error = Math.max(error, delta);
      sum += delta;
    }
    if (error > 0) changed++;
    if (error > tolerance) outsideTolerance++;
    maximumChannelError = Math.max(maximumChannelError, error);
  }
  return {
    pixels: actual.width * actual.height,
    changed,
    outsideTolerance,
    maximumChannelError,
    meanAbsoluteChannelError: sum / actual.pixels.length,
    tolerance,
  };
}
