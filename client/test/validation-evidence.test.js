import { test, expect } from "bun:test";
import { deflateSync } from "node:zlib";
import { decodePNG, comparePixels } from "../tools/validation-png.js";
import { compose } from "../tools/browser-oracle.js";
import {
  installProbe,
  resetProbe,
  measureProbe,
} from "../tools/validation-metrics.js";

function chunk(type, data = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length);
  bytes.write(type, 4);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4);
  return bytes;
}
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const header = chunk(
  "IHDR",
  Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
);
const data = chunk("IDAT", deflateSync(Buffer.from([0, 7, 8, 9, 255])));
const end = chunk("IEND");
const png = (...chunks) => Buffer.concat([signature, ...chunks]);

test("pixel comparisons reject incomplete channels and invalid tolerances", () => {
  const surface = { width: 1, height: 1, pixels: new Uint8Array(4) };
  expect(() =>
    comparePixels(surface, { ...surface, pixels: new Uint8Array(0) }),
  ).toThrow();
  expect(() => comparePixels(surface, surface, NaN)).toThrow();
  expect(() => comparePixels(surface, surface, -1)).toThrow();
  expect(
    comparePixels(surface, { ...surface, pixels: Uint8Array.of(5, 0, 0, 0) }, 4)
      .outsideTolerance,
  ).toBe(1);
});

test("PNG evidence rejects CRC corruption, reordered chunks and unsupported transparency", () => {
  expect(Array.from(decodePNG(png(header, data, end)).pixels)).toEqual([
    7, 8, 9, 255,
  ]);
  const corrupt = Buffer.from(data);
  corrupt[corrupt.length - 1] ^= 1;
  expect(() => decodePNG(png(header, corrupt, end))).toThrow();
  expect(() => decodePNG(png(header, data, header, end))).toThrow();
  expect(() => decodePNG(png(data, header, end))).toThrow();
  expect(() =>
    decodePNG(png(header, data, chunk("tEXt"), data, end)),
  ).toThrow();
  expect(() => decodePNG(png(header, chunk("tRNS"), data, end))).toThrow();
  expect(() => decodePNG(png(header, data, end, end))).toThrow();
});

function oracleFixture(period = 0) {
  const entity = {
    id: "tile",
    visible: true,
    x: 0,
    y: 0,
    z: 0,
    order: 0,
    action: "stand",
    frame: 0,
    background: { type: 1, cx: period, cy: 0, rx: 0, ry: 0 },
    actions: {
      stand: [
        {
          parts: [
            { texture: "one", x: 0, y: 0, z: 0 },
            { texture: "two", x: 0, y: 0, z: 0 },
          ],
        },
      ],
    },
  };
  return {
    state: {
      currentMap: "map",
      regions: [],
      entities: [entity],
      camera: { x: 0, y: 0 },
    },
    manifest: {
      actors: [entity],
      regions: [],
      camera: { x: 0, y: 0 },
      textures: {
        one: { atlas: "a", x: 0, y: 0, width: 1, height: 1 },
        two: { atlas: "b", x: 0, y: 0, width: 1, height: 1 },
      },
      atlases: { a: { url: "/a" }, b: { url: "/b" } },
    },
  };
}

function oracleDocument() {
  return {
    createElement() {
      return {
        getContext() {
          return {
            fillRect() {},
            save() {},
            translate() {},
            restore() {},
            scale() {},
            drawImage() {},
          };
        },
        toDataURL() {
          return "unexpected-success";
        },
      };
    },
  };
}

test("oracle closes partially loaded bitmaps and rejects invalid repetition", async () => {
  const saved = {
    fetch: globalThis.fetch,
    createImageBitmap: globalThis.createImageBitmap,
    document: globalThis.document,
  };
  let closed = 0,
    failSecond = true;
  const fixture = oracleFixture(NaN);
  globalThis.fetch = async (url) => {
    if (url === "/generated/catalog.json") {
      return Response.json({ maps: { map: { url: "/manifest" } } });
    }
    if (url === "/manifest") return Response.json(fixture.manifest);
    return new Response("atlas", {
      status: url === "/b" && failSecond ? 404 : 200,
    });
  };
  globalThis.createImageBitmap = async () => ({
    width: 1,
    height: 1,
    close() {
      closed++;
    },
  });
  globalThis.document = oracleDocument();
  try {
    await expect(
      compose(fixture.state, { width: 2, height: 2 }),
    ).rejects.toThrow();
    expect(closed).toBe(1);
    failSecond = false;
    // JSON cannot preserve NaN; captured state restores the malformed authored period.
    await expect(
      compose(fixture.state, { width: 2, height: 2 }),
    ).rejects.toThrow();
    expect(closed).toBe(3);
    fixture.state.entities[0].background.cx = -1;
    await expect(
      compose(fixture.state, { width: 2, height: 2 }),
    ).rejects.toThrow();
    await expect(
      compose(fixture.state, { width: 0, height: 2 }),
    ).rejects.toThrow();
  } finally {
    Object.assign(globalThis, saved);
  }
});

function probeFixture() {
  const control = {
    scheduled: 0,
    observed: 0,
    disconnected: 0,
    cancelled: 0,
    deliver: undefined,
    stop: undefined,
  };
  const metrics = {
    frames: 10,
    sampleIndex: 0,
    frameCpuMs: [99, 2, 3],
    drawCpuMs: [99, 1, 2],
  };
  globalThis.window = {
    maple: { snapshot: () => ({ metrics }) },
    addEventListener(name, handler) {
      control.stop = handler;
    },
  };
  globalThis.requestAnimationFrame = () => ++control.scheduled;
  globalThis.cancelAnimationFrame = () => control.cancelled++;
  globalThis.PerformanceObserver = class {
    constructor(callback) {
      control.deliver = callback;
      control.observed++;
    }
    observe() {}
    disconnect() {
      control.disconnected++;
    }
  };
  return {
    control,
    metrics,
    page: { evaluate: async (callback) => callback() },
  };
}

test("probe owns one loop, excludes old tasks and reports only in-window runtime CPU", async () => {
  const saved = {
    window: globalThis.window,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    PerformanceObserver: globalThis.PerformanceObserver,
  };
  const { control, metrics, page } = probeFixture();
  try {
    installProbe();
    installProbe();
    expect(control.scheduled).toBe(1);
    expect(control.observed).toBe(1);
    await resetProbe(page);
    const started = window.__mapleProbe.started;
    control.deliver({
      getEntries: () => [
        { startTime: started - 1, duration: 80 },
        { startTime: started + 1, duration: 60 },
      ],
    });
    metrics.frames = 12;
    metrics.sampleIndex = 2;
    const result = await measureProbe(page);
    expect(result.longTasks).toEqual([{ start: started + 1, duration: 60 }]);
    expect(result.runtimeCPU.frameCpuMs).toEqual([2, 3]);
    expect(result.runtimeCPU.drawCpuMs).toEqual([1, 2]);
    control.stop();
    expect(control.cancelled).toBe(1);
    expect(control.disconnected).toBe(1);
    expect(window.__mapleProbe).toBeUndefined();
  } finally {
    Object.assign(globalThis, saved);
  }
});
