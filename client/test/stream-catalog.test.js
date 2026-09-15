import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { Network } from "../src/rendering/stream-network.js";

const CATALOG = "http://localhost/generated/catalog.json";
const previousLocation = globalThis.location;
let fetchMock;
afterEach(() => {
  fetchMock?.mockRestore();
  if (previousLocation === undefined) delete globalThis.location;
  else globalThis.location = previousLocation;
});

function catalog(version) {
  const bytes = new TextEncoder().encode(JSON.stringify({ version }));
  return {
    bytes,
    hash: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function fixture(entries = new Map()) {
  globalThis.location = { origin: "http://localhost" };
  const network = new Network();
  await network.ready;
  network.cacheStatus = "persistent";
  network.cache = {
    async match(url) {
      return entries.has(url) ? new Response(entries.get(url)) : undefined;
    },
    async put(url, response) {
      entries.set(url, await response.arrayBuffer());
    },
    async delete(url) {
      return entries.delete(url);
    },
  };
  for (const [url, bytes] of entries) network.remember(url, bytes.byteLength);
  return { network, entries, signal: new AbortController().signal };
}

test("refresh verifies the saved catalog against the fresh server hash without downloading", async () => {
  const original = catalog(1);
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(original.bytes),
  );
  const first = await fixture();
  expect(await first.network.catalog(first.signal, original.hash)).toEqual({
    version: 1,
  });
  const refresh = await fixture(first.entries);
  expect(await refresh.network.catalog(refresh.signal, original.hash)).toEqual({
    version: 1,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(refresh.network.hits).toBe(1);
  expect(refresh.network.downloadBytes).toBe(0);
  expect(refresh.network.catalogBytes).toBe(original.bytes.byteLength);
});

test("a changed server hash replaces only the catalog and keeps unrelated assets", async () => {
  const original = catalog(1),
    update = catalog(2);
  const kept = "http://localhost/generated/atlas.png";
  const entries = new Map([
    [CATALOG, original.bytes],
    [kept, Uint8Array.of(7)],
  ]);
  const { network, signal } = await fixture(entries);
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(update.bytes),
  );
  expect(await network.catalog(signal, update.hash)).toEqual({ version: 2 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(new Uint8Array(entries.get(CATALOG))).toEqual(update.bytes);
  expect(entries.get(kept)).toEqual(Uint8Array.of(7));
  expect(network.cacheBytes).toBe(update.bytes.byteLength + 1);
});

test("corrupt catalog bytes are replaced once; a mismatched server response is rejected", async () => {
  const correct = catalog(1),
    wrong = catalog(2);
  const { network, entries, signal } = await fixture(
    new Map([[CATALOG, wrong.bytes]]),
  );
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(correct.bytes),
  );
  expect(await network.catalog(signal, correct.hash)).toEqual({ version: 1 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  entries.set(CATALOG, wrong.bytes);
  fetchMock.mockImplementation(async () => new Response(wrong.bytes));
  await expect(network.catalog(signal, correct.hash)).rejects.toThrow(
    "Server catalog identity mismatch",
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(entries.has(CATALOG)).toBe(false);
  expect(network.gate.active).toBe(0);
});

test("unavailable cache still verifies downloaded catalogs and invalid hashes admit no request", async () => {
  const original = catalog(1);
  const { network, signal } = await fixture();
  network.cache = null;
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(original.bytes),
  );
  await expect(network.catalog(signal, "invalid")).rejects.toThrow(
    "Invalid server catalog hash",
  );
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await network.catalog(signal, original.hash)).toEqual({ version: 1 });
  expect(network.downloadBytes).toBe(original.bytes.byteLength);
});

test("cancelled catalog checks do not evict retained files or download replacements", async () => {
  const original = catalog(1);
  const { network, entries } = await fixture(
    new Map([[CATALOG, original.bytes]]),
  );
  fetchMock = spyOn(globalThis, "fetch");
  const controller = new AbortController();
  controller.abort();
  await expect(
    network.catalog(controller.signal, original.hash),
  ).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(entries.has(CATALOG)).toBe(true);
});
