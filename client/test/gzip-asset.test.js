import { afterEach, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { Network } from "../src/rendering/stream-network.js";
import { sha256 } from "../src/assets/resource-validation.js";
import {
  gzipCeiling,
  gzipVariantURL,
  inflateGzip,
} from "../src/rendering/gzip-asset.js";

const previousLocation = globalThis.location;
afterEach(() => {
  if (previousLocation === undefined) delete globalThis.location;
  else globalThis.location = previousLocation;
  globalThis.fetch = previousFetch;
});
const previousFetch = globalThis.fetch;

function jsonBytes(payload) {
  return new TextEncoder().encode(JSON.stringify(payload));
}

async function infoFor(bytes, url) {
  return { url, sha256: await sha256(bytes), bytes: bytes.length };
}

function memoryCache() {
  const entries = new Map();
  return {
    entries,
    async match(url) {
      return entries.get(url)?.clone();
    },
    async put(url, response) {
      entries.set(url, response);
    },
    async delete(url) {
      return entries.delete(url);
    },
  };
}

async function networkWith(cache) {
  globalThis.location = { origin: "http://localhost" };
  const network = new Network();
  await network.ready;
  network.cacheStatus = "persistent";
  network.cache = cache;
  return network;
}

test("only generated JSON has a compressed sibling, and it needs a native inflater", () => {
  expect(gzipVariantURL("/generated/maps/abc.json")).toBe(
    "/generated/maps/abc.json.gz",
  );
  expect(gzipVariantURL("/generated/atlases/abc.png")).toBeNull();
  expect(gzipVariantURL("/generated/audio/abc.mp3")).toBeNull();
  expect(gzipVariantURL("/generated/catalog.json")).toBe(
    "/generated/catalog.json.gz",
  );
  expect(gzipVariantURL("/api/v1/world-content/resources/abc")).toBeNull();
});

test("the compressed transfer bound still admits incompressible input", () => {
  expect(gzipCeiling(1)).toBeGreaterThan(1);
  const random = new Uint8Array(4096);
  for (let index = 0; index < random.length; index++) {
    random[index] = (index * 2654435761) % 256;
  }
  const compressed = gzipSync(random).byteLength;
  expect(compressed).toBeLessThanOrEqual(gzipCeiling(random.byteLength));
});

test("a compressed fetch stores the compact bytes and returns the verified raw payload", async () => {
  const bytes = jsonBytes({ schemaVersion: 2, id: "000010000" });
  const info = await infoFor(bytes, "/generated/maps/abcdef.json");
  const compressed = new Uint8Array(gzipSync(bytes));
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(new URL(url).pathname);
    return new Response(
      new URL(url).pathname.endsWith(".gz") ? compressed : bytes,
    );
  };
  const cache = memoryCache();
  const network = await networkWith(cache);

  const loaded = new Uint8Array(
    await network.load(info, new AbortController().signal),
  );

  // The caller receives raw bytes matching the catalog contract.
  expect(loaded).toEqual(bytes);
  expect(requested).toEqual([`${info.url}.gz`]);
  // The cache keeps the compact form and records the verification size separately.
  const stored = cache.entries.get(`http://localhost${info.url}`);
  expect(stored.headers.get("x-maple-encoding")).toBe("gzip");
  expect(stored.headers.get("x-maple-raw")).toBe(String(bytes.length));
  expect(new Uint8Array(await stored.clone().arrayBuffer())).toEqual(
    compressed,
  );
  expect(network.cacheEntries.get(`http://localhost${info.url}`)).toBe(
    compressed.length,
  );
});

test("a warm cache inflates without refetching and preserves the recorded disk cost", async () => {
  const bytes = jsonBytes({ schemaVersion: 2, id: "000010001" });
  const info = await infoFor(bytes, "/generated/maps/abcdef.json");
  const compressed = new Uint8Array(gzipSync(bytes));
  const cache = memoryCache();
  cache.entries.set(
    `http://localhost${info.url}`,
    new Response(compressed, {
      headers: {
        "content-length": String(compressed.length),
        "x-maple-encoding": "gzip",
        "x-maple-raw": String(bytes.length),
      },
    }),
  );
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    throw new Error("warm cache must not fetch");
  };
  const network = await networkWith(cache);
  network.cacheEntries = new Map([
    [`http://localhost${info.url}`, compressed.length],
  ]);

  const loaded = new Uint8Array(
    await network.load(info, new AbortController().signal),
  );

  expect(loaded).toEqual(bytes);
  expect(fetches).toBe(0);
  expect(network.hits).toBe(1);
  expect(network.downloadBytes).toBe(0);
  expect(network.cacheEntries.get(`http://localhost${info.url}`)).toBe(
    compressed.length,
  );
});

test("a missing compressed sibling falls back to the raw resource", async () => {
  const bytes = jsonBytes({ schemaVersion: 2, id: "000010002" });
  const info = await infoFor(bytes, "/generated/maps/abcdef.json");
  const requested = [];
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    requested.push(path);
    if (path.endsWith(".gz")) throw new Error("404");
    return new Response(bytes);
  };
  const cache = memoryCache();
  const network = await networkWith(cache);

  const loaded = new Uint8Array(
    await network.load(info, new AbortController().signal),
  );

  expect(loaded).toEqual(bytes);
  expect(requested).toEqual([`${info.url}.gz`, info.url]);
  const stored = cache.entries.get(`http://localhost${info.url}`);
  expect(stored.headers.get("x-maple-encoding")).toBe("identity");
  expect(network.cacheEntries.get(`http://localhost${info.url}`)).toBe(
    bytes.length,
  );
});

test("an unreadable compressed sibling rejects instead of silently serving other bytes", async () => {
  const bytes = jsonBytes({ schemaVersion: 2, id: "000010003" });
  const info = await infoFor(bytes, "/generated/maps/abcdef.json");
  const other = new Uint8Array(gzipSync(jsonBytes({ id: "other" })));
  globalThis.fetch = async (url) =>
    new URL(url).pathname.endsWith(".gz")
      ? new Response(other)
      : new Response(bytes);
  const cache = memoryCache();
  const network = await networkWith(cache);

  await expect(
    network.load(info, new AbortController().signal),
  ).rejects.toThrow("Asset byte mismatch");
  expect(cache.entries.size).toBe(0);
});

test("native inflate returns exactly the stored raw bytes", async () => {
  const bytes = jsonBytes({ schemaVersion: 2, regions: [1, 2, 3] });
  const restored = new Uint8Array(await inflateGzip(gzipSync(bytes)));
  expect(restored).toEqual(bytes);
});

test("cancellation before a compressed fetch resolves stays an abort", async () => {
  const bytes = jsonBytes({ id: "cancel" });
  const info = await infoFor(bytes, "/generated/maps/abcdef.json");
  const controller = new AbortController();
  globalThis.fetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
    });
  const network = await networkWith(memoryCache());
  const pending = network.load(info, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow();
});
