import { afterEach, expect, spyOn, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Network } from "../src/rendering/stream-network.js";
import { sha256 } from "../src/assets/resource-validation.js";
import {
  REGION_PACK_LIMITS,
  REGION_PACK_MAGIC,
  REGION_PACK_PREFIX,
  decodeRegionPackHeader,
  validateRegionPackHeader,
  validateRegionPackIndex,
} from "../src/assets/region-pack.js";
import { buildRegionPacks } from "../tools/region-packs.js";
import { RegionDownloadPlan } from "../src/online/region-download-plan.js";

const signal = new AbortController().signal;
const CATALOG_HASH = "c".repeat(64);
const previousLocation = globalThis.location;
let fetchMock;
afterEach(() => {
  fetchMock?.mockRestore();
  if (previousLocation === undefined) delete globalThis.location;
  else globalThis.location = previousLocation;
});

const encode = (value) => new TextEncoder().encode(JSON.stringify(value));

/** A real generated tree: one packaged map with scenery, a minimap, artwork and music. */
async function packagedFiles(publish) {
  const region = await publish(
    "regions",
    "json",
    encode({ schemaVersion: 2, id: "r0", entities: [] }),
  );
  const artwork = await publish("atlases", "png", new Uint8Array([1, 2, 3, 4]));
  const bundle = await publish(
    "bundles",
    "json",
    encode({
      schemaVersion: 1,
      id: "mini",
      metadata: {},
      atlases: {},
      textures: {},
      entities: [],
    }),
  );
  const bgm = await publish("audio", "mp3", new Uint8Array([5, 6, 7]));
  const worldmap = await publish(
    "bundles",
    "json",
    encode({
      schemaVersion: 1,
      id: "world",
      metadata: {
        worldMaps: {
          WorldMap: { parent: null, spots: [] },
          WorldMap010: {
            parent: "WorldMap",
            spots: [{ maps: [10000, 10001] }],
          },
        },
      },
      atlases: {},
      textures: {},
      entities: [],
    }),
  );
  const map = await publish(
    "maps",
    "json",
    encode(mapManifest(region, artwork, "000010000")),
  );
  const map2 = await publish(
    "maps",
    "json",
    encode(mapManifest(region, artwork, "000010001")),
  );
  return { region, artwork, bundle, bgm, worldmap, map, map2 };
}

/** Two manifests differ only by identity, so they share every other closure member. */
function mapManifest(region, artwork, id) {
  return {
    schemaVersion: 2,
    id,
    bounds: { left: 0, top: 0, right: 100, bottom: 100 },
    camera: { x: 0, y: 0 },
    atlases: { a: { ...artwork, width: 8, height: 8 } },
    textures: { t: { atlas: "a", x: 0, y: 0, width: 4, height: 4 } },
    regions: [
      {
        ...region,
        id: "r0",
        always: true,
        bounds: { left: 0, top: 0, right: 10, bottom: 10 },
        atlases: [],
      },
    ],
    actors: [],
    life: { templates: {} },
  };
}

async function fixture() {
  const generated = await mkdtemp(join(tmpdir(), "openms-region-packs-"));
  const state = await mkdtemp(join(tmpdir(), "openms-region-state-"));
  async function publish(directory, extension, bytes) {
    const hash = await sha256(bytes);
    await mkdir(join(generated, directory), { recursive: true });
    await writeFile(join(generated, directory, `${hash}.${extension}`), bytes);
    return {
      url: `/generated/${directory}/${hash}.${extension}`,
      sha256: hash,
      bytes: bytes.length,
    };
  }
  const files = await packagedFiles(publish);
  const catalog = {
    buildId: CATALOG_HASH,
    maps: {
      "000010000": { ...files.map, neighbors: [] },
      "000010001": { ...files.map2, neighbors: [] },
    },
    mapNames: { 10000: "Test Field", 10001: "Test Field II" },
    ui: {
      bundles: { WorldMap: files.worldmap },
      minimaps: {
        "000010000": { descriptor: files.bundle },
        "000010001": { descriptor: files.bundle },
      },
    },
    audiovisual: {
      maps: {
        "000010000": { bgm: files.bgm },
        "000010001": { bgm: files.bgm },
      },
      combat: { sounds: { Mob: {} } },
    },
  };
  const packs = await buildRegionPacks({
    generatedRoot: generated,
    statePath: join(state, "region-packs.json"),
    catalog,
  });
  const index = JSON.parse(
    await readFile(
      join(generated, packs.index.url.slice("/generated/".length)),
    ),
  );
  const container = new Uint8Array(
    await readFile(
      join(generated, index.packs["000010000"].url.slice("/generated/".length)),
    ),
  );
  return { generated, state, catalog, packs, index, container, files };
}

async function openNetwork(cached) {
  const network = new Network();
  await network.ready;
  network.cacheStatus = "persistent";
  network.cacheByteLimit = 4 * 1024 ** 3;
  network.cacheEntries = new Map();
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

function serve(generated) {
  globalThis.location = { origin: "http://localhost" };
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const path = new URL(url, location.origin).pathname;
    const file = Bun.file(join(generated, path.slice("/generated/".length)));
    if (!(await file.exists())) return new Response("missing", { status: 404 });
    return new Response(await file.arrayBuffer());
  });
}

async function drain(plan) {
  // Bounded: every batch admits at most two jobs and the frontier only grows on completion.
  for (let index = 0; index < 64 && plan.status === "downloading"; index++) {
    await plan.batch(signal, () => {});
  }
  return plan;
}

test("one container carries the manifest, its scenery and its minimap with per-member gzip", async () => {
  const { packs, index, container, files } = await fixture();
  expect(packs).toMatchObject({
    maps: 2,
    rebuilt: 2,
    reused: 0,
    skipped: 0,
    members: 6,
    containers: 1,
  });
  expect(packs.index.url).toMatch(/^\/generated\/packs\/[a-f0-9]{64}\.json$/);
  expect(index).toMatchObject({ schemaVersion: 1, catalog: CATALOG_HASH });
  expect(validateRegionPackIndex(index, CATALOG_HASH)).toBe(index);
  expect(() => validateRegionPackIndex(index, "d".repeat(64))).toThrow(
    "does not match the catalog",
  );

  const pack = index.packs["000010000"];
  expect(container.byteLength).toBe(pack.bytes);
  const { entries, offset } = decodeRegionPackHeader(container);
  expect(entries.map((entry) => entry.url)).toEqual([
    files.map.url,
    files.region.url,
    files.bundle.url,
  ]);
  expect(entries.map((entry) => entry.raw)).toEqual([
    files.map.bytes,
    files.region.bytes,
    files.bundle.bytes,
  ]);
  expect(entries.every((entry) => entry.packed > 0)).toBe(true);
  expect(offset + entries.reduce((sum, entry) => sum + entry.packed, 0)).toBe(
    container.byteLength,
  );
  expect(pack.unpackedBytes).toBe(
    files.map.bytes + files.region.bytes + files.bundle.bytes,
  );
  expect(() =>
    validateRegionPackHeader(entries, [
      {
        url: files.region.url,
        sha256: files.region.sha256,
        bytes: files.region.bytes,
      },
    ]),
  ).toThrow("closure mismatch");
  expect(REGION_PACK_PREFIX).toBe(12);
});

test("an unchanged map reuses its published blob without recompressing anything", async () => {
  const { generated, state, catalog, packs } = await fixture();
  const reused = await buildRegionPacks({
    generatedRoot: generated,
    statePath: join(state, "region-packs.json"),
    catalog,
  });
  expect(reused).toMatchObject({
    maps: 2,
    reused: 2,
    rebuilt: 0,
    containerReused: true,
  });
  expect(reused.index.url).toBe(packs.index.url);
});

test("one map costs a pack plus one shared asset container and caches every member", async () => {
  const { generated, catalog, index, files } = await fixture();
  serve(generated);
  const cached = new Map();
  const network = await openNetwork(cached);
  const plan = await drain(
    new RegionDownloadPlan(
      { name: "Region", maps: ["000010000"] },
      catalog,
      network,
      index,
    ),
  );
  const total =
    files.map.bytes +
    files.region.bytes +
    files.bundle.bytes +
    files.artwork.bytes +
    files.bgm.bytes;
  expect(plan.snapshot()).toMatchObject({
    status: "complete",
    files: 5,
    complete: 5,
    bytes: total,
    doneBytes: total,
    packed: 1,
    assetContainers: 1,
    packFallbacks: 0,
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(cached.size).toBe(5);
  expect(cached.has(`http://localhost${index.packs["000010000"].url}`)).toBe(
    false,
  );
  const stored = cached.get(`http://localhost${files.map.url}`);
  expect(stored.headers.get("x-maple-encoding")).toBe("gzip");
  expect(stored.headers.get("x-maple-raw")).toBe(String(files.map.bytes));
  // Ordinary loading reads the packed member back without another request.
  expect(new Uint8Array(await network.load(files.map, signal)).byteLength).toBe(
    files.map.bytes,
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("a shared asset container is fetched once for every map that reaches it", async () => {
  const { generated, catalog, index, files } = await fixture();
  serve(generated);
  const cached = new Map();
  const network = await openNetwork(cached);
  const plan = await drain(
    new RegionDownloadPlan(
      { name: "Region", maps: ["000010000", "000010001"] },
      catalog,
      network,
      index,
    ),
  );
  const total =
    files.map.bytes +
    files.map2.bytes +
    files.region.bytes +
    files.bundle.bytes +
    files.artwork.bytes +
    files.bgm.bytes;
  expect(plan.snapshot()).toMatchObject({
    status: "complete",
    files: 6,
    complete: 6,
    bytes: total,
    doneBytes: total,
    packed: 2,
    assetContainers: 1,
  });
  // Two map packs plus one container shared by both maps.
  expect(fetchMock).toHaveBeenCalledTimes(3);
  const stored = cached.get(`http://localhost${files.artwork.url}`);
  expect(stored.headers.get("x-maple-encoding")).toBe("identity");
  expect(stored.headers.get("x-maple-raw")).toBe(String(files.artwork.bytes));
});

test("a damaged container downgrades that map to per-file delivery and still completes", async () => {
  const { generated, catalog, index } = await fixture();
  serve(generated);
  await truncate(
    join(generated, index.packs["000010000"].url.slice("/generated/".length)),
    8,
  );
  const plan = await drain(
    new RegionDownloadPlan(
      { name: "Region", maps: ["000010000"] },
      catalog,
      await openNetwork(new Map()),
      index,
    ),
  );
  expect(plan.snapshot()).toMatchObject({
    status: "complete",
    files: 5,
    complete: 5,
    packed: 0,
    packFallbacks: 1,
  });
});

test("pack headers reject bad magic, oversized lengths and swapped members", async () => {
  const { container, files } = await fixture();
  expect(() => decodeRegionPackHeader(container.subarray(0, 4))).toThrow(
    "Truncated",
  );
  const magic = Uint8Array.from(container);
  magic[0] = 0;
  expect(() => decodeRegionPackHeader(magic)).toThrow("magic");
  const oversized = Uint8Array.from(container);
  new DataView(oversized.buffer).setUint32(
    REGION_PACK_MAGIC.length,
    REGION_PACK_LIMITS.headerBytes + 1,
  );
  expect(() => decodeRegionPackHeader(oversized)).toThrow("header length");
  const { entries } = decodeRegionPackHeader(container);
  expect(() =>
    validateRegionPackHeader(entries, [
      {
        url: files.map.url,
        sha256: files.bundle.sha256,
        bytes: files.map.bytes,
      },
      ...entries.slice(1),
    ]),
  ).toThrow("identity mismatch");
});

test("storage loss during a packed install never reports the closure as saved", async () => {
  const { generated, catalog, index } = await fixture();
  serve(generated);
  const network = await openNetwork(new Map());
  const store = network.store.bind(network);
  network.store = async (url, payload) => {
    await store(url, payload);
    network.cacheStatus = "read-only: quota";
  };
  const plan = await drain(
    new RegionDownloadPlan(
      { name: "Region", maps: ["000010000"] },
      catalog,
      network,
      index,
    ),
  );
  expect(plan.status).not.toBe("complete");
  expect(plan.complete).toBeLessThan(plan.discovered);
  expect(plan.packed).toBe(0);
});
