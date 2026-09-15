import { afterEach, expect, spyOn, test } from "bun:test";
import { Network } from "../src/rendering/stream-network.js";
import { sha256 } from "../src/assets/resource-validation.js";
import {
  validateStartupPack,
  STARTUP_PACK_LIMITS,
} from "../src/assets/startup-pack.js";
import { prepareStartupPack } from "../src/online/startup-pack.js";

const signal = new AbortController().signal;
const previousLocation = globalThis.location;
let fetchMock;
afterEach(() => {
  fetchMock?.mockRestore();
  if (previousLocation === undefined) delete globalThis.location;
  else globalThis.location = previousLocation;
});

async function fixture() {
  const entries = [];
  for (let index = 0; index < 7; index++) {
    const bytes = new TextEncoder().encode(JSON.stringify({ index }));
    const hash = await sha256(bytes);
    entries.push({
      bytes,
      info: {
        url: index ? `/generated/ui/${hash}.json` : "/generated/catalog.json",
        sha256: hash,
        bytes: bytes.length,
      },
    });
  }
  // The pack stores raw members, while extraction also publishes a compressed sibling.
  for (const entry of entries) {
    entry.gzip = new Uint8Array(Bun.gzipSync(entry.bytes));
  }
  const unpacked = await new Blob(
    entries.map((entry) => entry.bytes),
  ).arrayBuffer();
  const encoded = Bun.gzipSync(unpacked);
  const hash = await sha256(encoded);
  const pack = {
    version: 1,
    url: `/generated/startup/${hash}.bin`,
    sha256: hash,
    bytes: encoded.length,
    unpackedBytes: unpacked.byteLength,
    members: entries.map((entry) => entry.info),
  };
  const state = {
    pack,
    encoded,
    entries,
    catalogHash: entries[0].info.sha256,
    cached: new Map(),
  };
  globalThis.location = { origin: "http://localhost" };
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const path = new URL(url, location.origin).pathname;
    if (path === pack.url) return new Response(state.encoded);
    if (path.endsWith(".gz")) {
      const compressed = entries.find(
        (entry) => `${entry.info.url}.gz` === path,
      );
      if (!compressed) throw new Error(`Unexpected download: ${path}`);
      return new Response(compressed.gzip);
    }
    const bytes = entries.find((entry) => entry.info.url === path)?.bytes;
    if (!bytes) throw new Error(`Unexpected download: ${path}`);
    return new Response(bytes);
  });
  state.network = await openNetwork(state.cached);
  return state;
}

async function openNetwork(cached, rows = []) {
  const network = new Network();
  await network.ready;
  network.cacheStatus = "persistent";
  network.cacheEntries = new Map(rows);
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

async function prepare(state, requestSignal = signal) {
  return prepareStartupPack(
    state.network,
    state.pack,
    state.catalogHash,
    requestSignal,
  );
}

test("one cold transfer installs individually verified members; a reopened cache downloads nothing", async () => {
  const state = await fixture();
  expect(await prepare(state)).toMatchObject({
    status: "downloaded",
    files: 7,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(state.cached.size).toBe(7);
  expect(state.cached.has(`http://localhost${state.pack.url}`)).toBe(false);
  state.network = await openNetwork(state.cached, state.network.cacheEntries);
  expect(await prepare(state)).toMatchObject({
    status: "retained",
    missing: 0,
  });
  expect(await state.network.catalog(signal, state.catalogHash)).toEqual({
    index: 0,
  });
  for (const entry of state.entries.slice(1)) {
    expect(
      new Uint8Array(await state.network.load(entry.info, signal)),
    ).toEqual(entry.bytes);
  }
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(state.network.hits).toBe(7);
  expect(state.network.downloadBytes).toBe(0);
});

test("a small cache gap refetches the compressed member, preserving the rest", async () => {
  const state = await fixture();
  await prepare(state);
  const entry = state.entries[2];
  const info = entry.info;
  await state.network.invalidate(`http://localhost${info.url}`);
  expect(await prepare(state)).toMatchObject({
    status: "individual",
    missing: 1,
  });
  fetchMock.mockClear();
  expect(new Uint8Array(await state.network.load(info, signal))).toEqual(
    entry.bytes,
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe(`http://localhost${info.url}.gz`);
  expect(state.cached.size).toBe(7);
  const stored = state.cached.get(`http://localhost${info.url}`);
  expect(stored.headers.get("x-maple-encoding")).toBe("gzip");
  expect(stored.headers.get("x-maple-raw")).toBe(String(entry.bytes.length));
  expect(new Uint8Array(await stored.clone().arrayBuffer())).toEqual(
    entry.gzip,
  );
});

test("storage refusal and low quota skip the bulk transfer; a stale build fails before transfer", async () => {
  const state = await fixture();
  state.network.cacheStatus = "unavailable";
  expect(await prepare(state)).toEqual({ status: "cache-unavailable" });
  state.network.cacheStatus = "persistent";
  state.network.cacheByteLimit = state.pack.unpackedBytes - 1;
  expect(await prepare(state)).toEqual({ status: "insufficient-cache" });
  state.catalogHash = "b".repeat(64);
  await expect(prepare(state)).rejects.toThrow("does not match the server");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("archive corruption and a mismatched final member cannot mutate the cache", async () => {
  const state = await fixture();
  state.encoded[10] ^= 1;
  await expect(prepare(state)).rejects.toThrow("SHA-256 mismatch");
  expect(state.cached.size).toBe(0);
  state.encoded[10] ^= 1;
  state.pack.members.at(-1).sha256 = "b".repeat(64);
  await expect(prepare(state)).rejects.toThrow("SHA-256 mismatch");
  expect(state.cached.size).toBe(0);
});

test("expanded bytes cannot exceed the index, and truncation is explicit", async () => {
  const state = await fixture();
  state.pack.members.at(-1).bytes--;
  state.pack.unpackedBytes--;
  await expect(prepare(state)).rejects.toThrow("Response exceeds byte bound");
  expect(state.cached.size).toBe(0);
  state.pack.members.at(-1).bytes += 2;
  state.pack.unpackedBytes += 2;
  await expect(prepare(state)).rejects.toThrow("Truncated startup pack");
  expect(state.cached.size).toBe(0);
});

test("pack boundaries reject private paths, duplicates, traversal and oversized totals", async () => {
  const { pack, catalogHash } = await fixture();
  for (const url of [
    "/api/v1/private",
    "/generated/../private",
    pack.members[0].url,
  ]) {
    const changed = structuredClone(pack);
    changed.members[1].url = url;
    expect(() => validateStartupPack(changed, catalogHash)).toThrow();
  }
  expect(() =>
    validateStartupPack(
      { ...pack, bytes: STARTUP_PACK_LIMITS.bytes + 1 },
      catalogHash,
    ),
  ).toThrow();
  expect(() =>
    validateStartupPack({ ...pack, unpackedBytes: 0 }, catalogHash),
  ).toThrow();
});

test("cancellation releases the fetch gate without writing any members", async () => {
  const state = await fixture();
  const controller = new AbortController();
  fetchMock.mockImplementation(async () => {
    controller.abort(new DOMException("Leaving startup", "AbortError"));
    return new Response(state.encoded);
  });
  await expect(prepare(state, controller.signal)).rejects.toThrow(
    "Leaving startup",
  );
  expect(state.cached.size).toBe(0);
  expect(state.network.gate.active).toBe(0);
});

test("quota loss mid-install returns a fallback status with only verified files retained", async () => {
  const state = await fixture();
  const store = state.network.store.bind(state.network);
  state.network.store = async (url, bytes) => {
    await store(url, bytes);
    state.network.cacheStatus = "read-only: quota";
  };
  expect(await prepare(state)).toMatchObject({ status: "storage-lost" });
  expect(state.cached.size).toBe(1);
});
