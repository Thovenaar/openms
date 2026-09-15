import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { Network } from "../src/rendering/stream-network.js";
import { LIMITS } from "../src/rendering/stream-validation.js";
import {
  StartupPreload,
  STARTUP_PRELOAD_LIMITS,
} from "../src/online/startup-preload.js";

let fetchMock;
const previousLocation = globalThis.location;
afterEach(() => {
  fetchMock?.mockRestore();
  if (previousLocation === undefined) delete globalThis.location;
  else globalThis.location = previousLocation;
});

function descriptor(id, bytes = 1) {
  return { url: `/generated/${id}`, sha256: "a".repeat(64), bytes };
}

function asset(payload, suffix) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    info: {
      url: `/generated/${sha256}.${suffix}`,
      sha256,
      bytes: bytes.length,
    },
    bytes,
  };
}

function fixture() {
  const atlas = asset([1, 2, 3], "png");
  const atlases = { a: { ...atlas.info, width: 2, height: 2 } };
  const region = asset(
    { schemaVersion: 2, id: "region", entities: [] },
    "json",
  );
  const bounds = { left: 0, top: 0, right: 10, bottom: 10 };
  const map = asset(
    {
      schemaVersion: 2,
      id: "000010000",
      bounds,
      camera: { x: 0, y: 0 },
      atlases,
      textures: {},
      actors: [],
      regions: [
        { ...region.info, id: "region", always: true, bounds, atlases: ["a"] },
      ],
    },
    "json",
  );
  const bundle = asset(
    {
      schemaVersion: 1,
      id: "ui",
      metadata: {},
      atlases,
      textures: {},
      entities: [],
    },
    "json",
  );
  return { atlas, region, map, bundle };
}

async function networkFixture(assets) {
  globalThis.location = { origin: "http://localhost" };
  const cached = new Map();
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const entry = assets.find(
      (entry) => new URL(url).pathname === entry.info.url,
    );
    if (!entry) throw new Error(`Unexpected download: ${url}`);
    return new Response(entry.bytes);
  });
  const network = new Network();
  await network.ready;
  network.cacheStatus = "persistent";
  network.cache = {
    async match(url) {
      return cached.get(url)?.clone();
    },
    async put(url, response) {
      cached.set(url, response);
    },
    async delete(url) {
      return cached.delete(url);
    },
  };
  return network;
}

test("common manifests, shared atlases and map regions are verified once and reused on a warm startup", async () => {
  const data = fixture();
  const network = await networkFixture(Object.values(data));
  const signal = new AbortController().signal;
  for (let run = 0; run < 2; run++) {
    const plan = new StartupPreload(network);
    plan.add(data.map.info, "map");
    plan.add(data.bundle.info, "bundle");
    plan.add(data.bundle.info, "bundle");
    const result = await plan.run(signal);
    expect(result).toMatchObject({ status: "complete", files: 4, complete: 4 });
    expect(network.cacheEntries.size).toBe(4);
  }
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(network.hits).toBe(4);
  expect(network.gate.active).toBe(0);
  expect(network.gate.queue).toHaveLength(0);
});

test("a corrupt payload fails startup and does not enter the verified cache", async () => {
  const data = fixture();
  const network = await networkFixture([data.atlas]);
  const plan = new StartupPreload(network);
  plan.add({ ...data.atlas.info, sha256: "b".repeat(64) });
  await expect(plan.run(new AbortController().signal)).rejects.toThrow(
    "Asset hash mismatch",
  );
  expect(network.cacheEntries.size).toBe(0);
});

test("preload cache hits survive new downloads when the persistent cache is full", async () => {
  const common = asset("common", "png"),
    fresh = asset("fresh", "png");
  const network = await networkFixture([common, fresh]);
  const signal = new AbortController().signal;
  await network.load(common.info, signal);
  for (let id = 0; id < LIMITS.cacheEntries - 1; id++) {
    await network.store(
      `http://localhost/generated/old-${id}`,
      new ArrayBuffer(1),
    );
  }
  const plan = new StartupPreload(network);
  plan.add(common.info);
  await plan.run(signal);
  await network.load(fresh.info, signal);
  await network.load(common.info, signal);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(network.cacheEntries.size).toBe(LIMITS.cacheEntries);
  expect(network.cacheEntries.has("http://localhost/generated/old-0")).toBe(
    false,
  );
  expect(network.cacheEntries.has(`http://localhost${common.info.url}`)).toBe(
    true,
  );
});

test("byte and file limits fail before admitting excess resources; identity conflicts fail explicitly", () => {
  const plan = new StartupPreload({});
  plan.add(descriptor("a", STARTUP_PRELOAD_LIMITS.bytes / 2));
  plan.add(descriptor("b", STARTUP_PRELOAD_LIMITS.bytes / 2));
  expect(() => plan.add(descriptor("c"))).toThrow("preload budget");
  expect(() => plan.add(descriptor("a", 1))).toThrow("identity");
  const files = new StartupPreload({});
  for (let id = 0; id < STARTUP_PRELOAD_LIMITS.files; id++) {
    files.add(descriptor(id));
  }
  expect(() => files.add(descriptor("overflow"))).toThrow("preload budget");
  files.add({
    ...descriptor("private"),
    url: `/api/v1/world-content/resources/${"a".repeat(64)}`,
  });
  expect(files.jobs).toHaveLength(STARTUP_PRELOAD_LIMITS.files);
});

function blockedNetwork() {
  const state = { active: 0, started: 0, peak: 0 };
  return {
    cacheStatus: "persistent",
    state,
    load(info, signal) {
      signal.throwIfAborted();
      state.started++;
      state.active++;
      state.peak = Math.max(state.peak, state.active);
      return new Promise((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            state.active--;
            reject(signal.reason);
          },
          { once: true },
        );
      });
    },
  };
}

test("cancellation retires four in-flight requests without admitting the queued remainder", async () => {
  const network = blockedNetwork();
  const plan = new StartupPreload(network);
  for (let id = 0; id < 10; id++) plan.add(descriptor(id));
  const controller = new AbortController();
  const run = plan.run(controller.signal);
  await Promise.resolve();
  controller.abort(new DOMException("Leaving startup", "AbortError"));
  await expect(run).rejects.toThrow("Leaving startup");
  expect(network.state).toEqual({ active: 0, started: 4, peak: 4 });
});

test("a failed sibling aborts the batch and preserves the original failure", async () => {
  const network = blockedNetwork();
  const blocked = network.load;
  network.load = function (info, signal) {
    if (info.url.endsWith("2")) throw new Error("Broken asset");
    return blocked(info, signal);
  };
  const plan = new StartupPreload(network);
  for (let id = 0; id < 10; id++) plan.add(descriptor(id));
  await expect(plan.run(new AbortController().signal)).rejects.toThrow(
    "Broken asset",
  );
  expect(network.state.active).toBe(0);
  expect(network.state.started).toBe(3);
});

test("unavailable storage skips speculative downloads and quota loss stops the next batch", async () => {
  const network = blockedNetwork();
  network.cacheStatus = "unavailable: disabled";
  const plan = new StartupPreload(network);
  for (let id = 0; id < 10; id++) plan.add(descriptor(id));
  const signal = new AbortController().signal;
  expect(await plan.run(signal)).toMatchObject({
    status: "cache-unavailable",
    complete: 0,
  });
  expect(network.state.started).toBe(0);
  network.cacheStatus = "persistent";
  network.load = async () => {
    network.cacheStatus = "unavailable: quota";
  };
  expect(await plan.run(signal)).toMatchObject({
    status: "cache-unavailable",
    complete: 4,
  });
});

test("a small storage quota skips the preload before downloading an unretainable working set", async () => {
  for (const catalogBytes of [0, 34 * 1024 * 1024]) {
    const network = blockedNetwork();
    network.catalogBytes = catalogBytes;
    network.cacheByteLimit = STARTUP_PRELOAD_LIMITS.bytes + catalogBytes - 1;
    const plan = new StartupPreload(network);
    plan.add(descriptor("a"));
    expect(await plan.run(new AbortController().signal)).toMatchObject({
      status: "insufficient-cache",
      complete: 0,
    });
    expect(network.state.started).toBe(0);
  }
});
