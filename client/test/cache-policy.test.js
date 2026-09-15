import { expect, test } from "bun:test";
import {
  cacheBudget,
  estimateCacheBudget,
  requestCachePersistence,
  CACHE_POLICY,
} from "../src/rendering/cache-policy.js";
import { LIMITS } from "../src/rendering/stream-validation.js";
import { ResourceCache } from "../src/rendering/resource-cache.js";

const MiB = 1024 * 1024;

test("disk budget targets 1 GiB, leaves quota headroom and protects other origin data", () => {
  expect(
    cacheBudget({ quota: 10 * 1024 * MiB, usage: 300 * MiB }, 200 * MiB),
  ).toBe(1024 * MiB);
  expect(cacheBudget({ quota: 500 * MiB, usage: 250 * MiB }, 100 * MiB)).toBe(
    250 * MiB,
  );
  expect(cacheBudget({ quota: 100 * MiB, usage: 90 * MiB }, 0)).toBe(0);
  expect(LIMITS.cpuBytes).toBe(192 * MiB);
  expect(LIMITS.gpuBytes).toBe(192 * MiB);
});

test("unavailable or invalid quota estimates retain a conservative disk budget", async () => {
  for (const estimate of [
    undefined,
    {},
    { quota: 0, usage: 0 },
    { quota: Infinity, usage: 1 },
    { quota: 500, usage: -1 },
  ]) {
    expect(cacheBudget(estimate, 0)).toBe(CACHE_POLICY.fallbackBytes);
  }
  expect(await estimateCacheBudget({}, 0)).toMatchObject({
    status: "unsupported",
    bytes: 192 * MiB,
  });
  const storage = {
    estimate: async () => {
      throw new Error("denied");
    },
  };
  expect(await estimateCacheBudget(storage, 0)).toMatchObject({
    status: "unavailable: denied",
    bytes: 192 * MiB,
  });
});

test("persistence denial and pending permission are explicit without blocking cache work", async () => {
  const statuses = [],
    permission = Promise.withResolvers();
  const run = requestCachePersistence(
    {
      persisted: async () => false,
      persist: () => permission.promise,
    },
    (status) => statuses.push(status),
  );
  await Promise.resolve();
  expect(statuses).toEqual(["checking", "requested"]);
  permission.resolve(false);
  await run;
  expect(statuses.at(-1)).toBe("best-effort");
  let requests = 0;
  await requestCachePersistence(
    {
      persisted: async () => true,
      persist: async () => {
        requests++;
      },
    },
    (status) => statuses.push(status),
  );
  expect(requests).toBe(0);
  expect(statuses.at(-1)).toBe("granted");
});

function cacheFixture() {
  const operations = [];
  const owner = Object.assign(Object.create(ResourceCache.prototype), {
    cacheBytes: 0,
    cacheEntries: new Map(),
    cacheStatus: "persistent",
    cacheIndex: null,
    cacheByteLimit: 1024,
    cacheSkipped: 0,
    cacheQuotaRecoveries: 0,
    cache: {
      async put(url) {
        operations.push(["put", url]);
      },
      async delete(url) {
        operations.push(["delete", url]);
      },
    },
  });
  return { owner, operations };
}

test("cache mutations record intent before payloads and commit metadata before returning", async () => {
  const { owner, operations } = cacheFixture();
  owner.cacheIndex = {
    async begin(url) {
      operations.push(["begin", url]);
    },
    async finish(url, bytes) {
      operations.push(["finish", url, bytes]);
    },
  };
  await owner.store("a", new ArrayBuffer(4));
  expect(operations).toEqual([
    ["begin", "a"],
    ["put", "a"],
    ["finish", "a", 4],
  ]);
  expect(owner.cacheBytes).toBe(4);
  operations.length = 0;
  await owner.invalidate("a");
  expect(operations).toEqual([
    ["begin", "a"],
    ["delete", "a"],
    ["finish", "a", null],
  ]);
  expect(owner.cacheBytes).toBe(0);
});

test("quota failure shrinks the budget, evicts oldest files and retries once", async () => {
  const { owner, operations } = cacheFixture();
  for (let id = 0; id < 4; id++) owner.remember(String(id), 200);
  let attempts = 0;
  owner.cache.put = async () => {
    if (++attempts === 1) throw new DOMException("full", "QuotaExceededError");
  };
  await owner.store("new", new ArrayBuffer(100));
  expect(attempts).toBe(2);
  expect(owner.cacheQuotaRecoveries).toBe(1);
  expect(owner.cacheByteLimit).toBe(600);
  expect(operations).toEqual([
    ["delete", "0"],
    ["delete", "1"],
  ]);
  expect(owner.cacheBytes).toBe(500);
  expect(owner.cacheStatus).toBe("persistent");
});

test("continued quota refusal preserves read access and stops subsequent writes", async () => {
  const { owner } = cacheFixture();
  for (let id = 0; id < 4; id++) owner.remember(String(id), 200);
  let attempts = 0;
  owner.cache.put = async () => {
    attempts++;
    throw new DOMException("full", "QuotaExceededError");
  };
  await owner.store("new", new ArrayBuffer(100));
  expect(owner.cacheStatus).toBe("read-only: full");
  expect(owner.cache).not.toBeNull();
  await owner.store("again", new ArrayBuffer(1));
  expect(attempts).toBe(2);
});

test("an oversized file skips cache storage without evicting useful cached assets", async () => {
  const { owner, operations } = cacheFixture();
  owner.remember("kept", 200);
  await owner.store("too-big", new ArrayBuffer(1025));
  expect(owner.cacheSkipped).toBe(1);
  expect(owner.cacheBytes).toBe(200);
  expect(operations).toHaveLength(0);
});

test("the disk cache retains more than 192 MiB and evicts at its new 1 GiB ceiling", async () => {
  const { owner, operations } = cacheFixture();
  owner.cacheByteLimit = LIMITS.cacheBytes;
  // Logical stored sizes exercise admission without allocating a gigabyte in the test runner.
  for (let id = 0; id < 8; id++) owner.remember(String(id), 32 * MiB);
  await owner.store("new", new ArrayBuffer(1));
  expect(owner.cacheBytes).toBe(256 * MiB + 1);
  expect(operations).toEqual([["put", "new"]]);
  for (let id = 8; id < 32; id++) owner.remember(String(id), 32 * MiB);
  await owner.store("last", new ArrayBuffer(1));
  expect(owner.cacheBytes).toBe(992 * MiB + 2);
  expect(owner.cacheEntries.has("0")).toBe(false);
});

test("a failed corruption eviction disables cache without poisoning the shared write queue", async () => {
  const { owner } = cacheFixture();
  owner.cacheIndex = {
    begin: async () => {
      throw new Error("index unavailable");
    },
    close() {},
  };
  await owner.invalidate("corrupt");
  expect(owner.cache).toBeNull();
  expect(owner.cacheStatus).toBe("unavailable: index unavailable");
});
