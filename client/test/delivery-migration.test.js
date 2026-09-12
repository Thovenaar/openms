import { expect, test } from "bun:test";
import { SHELL_URLS, releaseId, sha256 } from "../public/offline-manifest.js";

const ORIGIN = "https://maple.test";
const META = "/__maple-offline/";

function fixtureAudiovisual(assetInfo) {
  return {
    effects: {
      Teleport: { bundle: assetInfo },
      LevelUp: { bundle: assetInfo },
      QuestClear: { bundle: assetInfo },
    },
    sounds: {
      Game: {
        LevelUp: assetInfo,
        QuestClear: assetInfo,
        Tombstone: assetInfo,
        DropItem: assetInfo,
        PickUpItem: assetInfo,
      },
    },
  };
}

async function openUpgradeShell(service, cacheStorage, old, latest) {
  await seed(cacheStorage, old);
  await command(
    service,
    "PREPARE_RELEASE",
    {
      releaseId: latest.manifest.releaseId,
    },
    "old-tab",
  );
  expect(await (await request(service, "/", true)).text()).toBe(
    "latest:/index.html",
  );
  expect(await (await request(service, "/dist/main.js")).text()).toBe(
    "latest:/dist/main.js",
  );
  expect(
    await (await request(service, "/dist/main.js", false, "old-tab")).text(),
  ).toBe("old:/dist/main.js");
}

async function fixture(version, largeNeighbor = false) {
  const files = new Map();
  const resources = [];
  const asset = new TextEncoder().encode(JSON.stringify({ version }));
  const hash = await sha256(asset);
  const assetInfo = {
    url: `/generated/bundles/${hash}.json`,
    sha256: hash,
    bytes: asset.length,
  };
  files.set(assetInfo.url, asset);
  const neighbor = largeNeighbor
    ? {
        url: `/generated/textures/${"b".repeat(64)}.png`,
        sha256: "b".repeat(64),
        bytes: 8 * 1024 * 1024,
      }
    : await generatedAsset(files, `${version}:neighbor`, "png");
  const scene = await generatedAsset(files, {
    id: "100000000",
    asset: assetInfo,
  });
  const nextScene = await generatedAsset(files, {
    id: "100000001",
    texture: neighbor,
  });
  const catalog = JSON.stringify({
    buildId: "a".repeat(64),
    maps: { 100000000: scene, 100000001: nextScene },
    audiovisual: fixtureAudiovisual(assetInfo),
  });
  for (const url of [...SHELL_URLS, "/generated/catalog.json"]) {
    const bytes = new TextEncoder().encode(
      url.endsWith("catalog.json") ? catalog : `${version}:${url}`,
    );
    const digest = await sha256(bytes);
    const source = `/generated/releases/blobs/${digest}.bin`;
    resources.push({ url, sha256: digest, bytes: bytes.length, source });
    files.set(source, bytes);
  }
  for (const info of [assetInfo, scene, nextScene, neighbor]) {
    resources.push({ ...info, source: info.url });
  }
  const manifest = {
    schemaVersion: 1,
    buildId: "a".repeat(64),
    resources,
    totalBytes: resources.reduce((bytes, info) => bytes + info.bytes, 0),
    maps: [
      { id: "100000000", name: "Fixture map" },
      { id: "100000001", name: "Neighbor map" },
    ],
    unavailableMaps: [],
  };
  manifest.releaseId = await releaseId(manifest);
  return { manifest, files, assetInfo, scene, nextScene, neighbor };
}

async function generatedAsset(files, value, extension = "json") {
  const bytes = new TextEncoder().encode(
    extension === "json" ? JSON.stringify(value) : value,
  );
  const digest = await sha256(bytes);
  const info = {
    url: `/generated/bundles/${digest}.${extension}`,
    sha256: digest,
    bytes: bytes.length,
  };
  files.set(info.url, bytes);
  return info;
}

function storage() {
  const stores = new Map();
  const reads = [];
  return {
    reads,
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async match(url) {
          const key = new URL(url.url ?? url, ORIGIN).href;
          reads.push(new URL(key).pathname);
          return entries.get(key)?.clone();
        },
        async put(url, response) {
          entries.set(new URL(url.url ?? url, ORIGIN).href, response.clone());
        },
        async delete(url) {
          return entries.delete(new URL(url.url ?? url, ORIGIN).href);
        },
        async keys() {
          return [...entries.keys()].map((url) => new Request(url));
        },
      };
    },
  };
}

async function seed(cacheStorage, release) {
  const cacheName = `maple-offline-release-v1-${release.manifest.releaseId}-old`;
  const cache = await cacheStorage.open(cacheName);
  await cache.put(META + "manifest", Response.json(release.manifest));
  await cache.put(
    META + "complete",
    Response.json({ releaseId: release.manifest.releaseId }),
  );
  for (const info of release.manifest.resources) {
    await cache.put(info.url, new Response(release.files.get(info.source)));
  }
  const meta = await cacheStorage.open("maple-offline-meta-v1");
  const pointer = { cacheName, releaseId: release.manifest.releaseId };
  await meta.put(META + "active", Response.json(pointer));
  await meta.put(META + "client-old-tab", Response.json(pointer));
}

function request(service, path, navigation = false, clientId = "new-tab") {
  let result;
  service.fetch({
    request: {
      url: ORIGIN + path,
      method: "GET",
      mode: navigation ? "navigate" : "cors",
      signal: new AbortController().signal,
    },
    clientId,
    resultingClientId: navigation ? clientId : "",
    respondWith(promise) {
      result = promise;
    },
  });
  return result;
}

function environment(cacheStorage, latest) {
  return {
    self: {
      location: { origin: ORIGIN },
      clients: {
        async matchAll() {
          return [];
        },
        async get(id) {
          return { id };
        },
      },
      addEventListener() {},
    },
    caches: cacheStorage,
    navigator: { storage: {} },
    fetch: async (url) => {
      if (
        url === "/generated/release.json" ||
        url === `/generated/releases/${latest.manifest.releaseId}.json`
      ) {
        return Response.json(latest.manifest);
      }
      const bytes = latest.files.get(url);
      return bytes
        ? new Response(bytes)
        : new Response("missing", { status: 404 });
    },
  };
}

test("an old installation navigates into the verified current shell, then completes the same partial release", async () => {
  const old = await fixture("old");
  const latest = await fixture("latest");
  await withWorker(latest, async ({ service, cacheStorage }) => {
    await openUpgradeShell(service, cacheStorage, old, latest);
    const meta = await cacheStorage.open("maple-offline-meta-v1");
    const partial = await (await meta.match(META + "partial")).json();
    const partialCache = await cacheStorage.open(partial.cacheName);
    expect(await partialCache.match(META + "complete")).toBeUndefined();
    expect((await (await meta.match(META + "active")).json()).releaseId).toBe(
      old.manifest.releaseId,
    );
    expect(await (await request(service, latest.assetInfo.url)).json()).toEqual(
      { version: "latest" },
    );
    expect((await request(service, old.assetInfo.url)).status).toBe(503);
    const prepared = await command(service, "PREPARE_MAP", {
      releaseId: latest.manifest.releaseId,
      mapId: "100000000",
      offline: false,
      resources: [latest.assetInfo],
      preparationId: crypto.randomUUID(),
    });
    expect((await (await meta.match(META + "active")).json()).releaseId).toBe(
      old.manifest.releaseId,
    );
    await command(service, "COMMIT_MAP", {
      releaseId: latest.manifest.releaseId,
      mapId: prepared.mapId,
      preparationId: prepared.preparationId,
    });
    await command(
      service,
      "PREPARE_MAP",
      {
        releaseId: old.manifest.releaseId,
        mapId: "100000000",
        offline: true,
        resources: [old.assetInfo],
        preparationId: crypto.randomUUID(),
      },
      "old-tab",
    );
    expect((await (await meta.match(META + "active")).json()).releaseId).toBe(
      latest.manifest.releaseId,
    );
    await service.download(latest.manifest.releaseId, null);
    await service.activate(latest.manifest.releaseId, null);
    expect(await (await request(service, latest.assetInfo.url)).json()).toEqual(
      { version: "latest" },
    );
  });
});

test("a latest shell staged by the previous worker becomes the offline map launch", async () => {
  const old = await fixture("legacy-active");
  const latest = await fixture("legacy-partial");
  await withWorker(
    latest,
    async ({ service, cacheStorage, network, OfflineService }) => {
      await seed(cacheStorage, old);
      await request(service, "/", true);
      const meta = await cacheStorage.open("maple-offline-meta-v1");
      const partial = await (await meta.match(META + "partial")).json();
      const cache = await cacheStorage.open(partial.cacheName);
      await cache.delete(META + "predecessor");
      await command(service, "PREPARE_RELEASE", {
        releaseId: latest.manifest.releaseId,
      });
      const prepared = await command(service, "PREPARE_MAP", {
        releaseId: latest.manifest.releaseId,
        mapId: "100000000",
        offline: false,
        resources: [latest.assetInfo],
        preparationId: crypto.randomUUID(),
      });
      await command(service, "COMMIT_MAP", {
        releaseId: latest.manifest.releaseId,
        mapId: prepared.mapId,
        preparationId: prepared.preparationId,
      });
      network.online = false;
      expect(
        await (await request(new OfflineService(), "/", true)).text(),
      ).toBe("legacy-partial:/index.html");
    },
  );
});

async function withWorker(latest, run, quota = Infinity) {
  const cacheStorage = storage();
  const network = { online: true, fetched: [] };
  const replacements = environment(cacheStorage, latest);
  const fetch = replacements.fetch;
  replacements.fetch = async (url) => {
    network.fetched.push(url);
    if (!network.online) throw new TypeError("Network unreachable");
    return fetch(url);
  };
  replacements.navigator.storage.estimate = async () => ({ quota, usage: 0 });
  const saved = new Map();
  for (const [key, value] of Object.entries(replacements)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  try {
    const { OfflineService } = await import("../public/service-worker.js");
    await run({
      service: new OfflineService(),
      OfflineService,
      cacheStorage,
      network,
    });
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

async function command(service, type, data = {}, clientId = "new-tab") {
  let reply;
  await service.dispatch({
    data: { ...data, type },
    source: { id: clientId },
    ports: [
      {
        postMessage(message) {
          if (message.type === "RESULT" || message.type === "ERROR") {
            reply = message;
          }
        },
        close() {},
      },
    ],
  });
  if (reply.type === "ERROR") throw new Error(reply.error);
  return reply.result;
}

test("startup admits only the current map under quota smaller than the unavailable neighbor", async () => {
  const latest = await fixture("sparse", true);
  await withWorker(
    latest,
    async ({ service, cacheStorage, network }) => {
      const releaseId = latest.manifest.releaseId;
      await command(service, "PREPARE_RELEASE", { releaseId });
      const unbound = await command(service, "OFFLINE_STATUS");
      expect(unbound.pinnedReleaseId).toBeNull();
      expect(unbound.partial).toMatchObject({
        scope: "shell",
        ready: true,
        complete: false,
      });
      expect((await request(service, "/", true)).status).toBe(200);
      const map = await command(service, "PREPARE_MAP", {
        releaseId,
        mapId: "100000000",
        offline: false,
        resources: [latest.assetInfo],
        preparationId: crypto.randomUUID(),
      });
      await command(service, "COMMIT_MAP", {
        releaseId,
        mapId: map.mapId,
        preparationId: map.preparationId,
      });
      expect(map).toMatchObject({
        scope: "map",
        ready: true,
        releaseId,
        mapId: "100000000",
      });
      expect(map.totalBytes).toBeLessThan(2 * 1024 * 1024);
      expect(map.completedBytes).toBe(map.totalBytes);
      expect(latest.manifest.totalBytes).toBeGreaterThan(2 * 1024 * 1024);
      expect(network.fetched).not.toContain(latest.nextScene.url);
      expect(network.fetched).not.toContain(latest.neighbor.url);
      cacheStorage.reads.length = 0;
      const status = await command(service, "OFFLINE_STATUS");
      expect(status.active).toMatchObject({
        releaseId,
        scope: "shell",
        ready: true,
        complete: false,
      });
      expect(status.partial).toBeNull();
      expect(cacheStorage.reads).not.toContain(latest.scene.url);
      expect(cacheStorage.reads).not.toContain(latest.assetInfo.url);
      expect(cacheStorage.reads).not.toContain(latest.nextScene.url);
    },
    2 * 1024 * 1024,
  );
});

test("map readiness survives worker restart while missing or corrupt offline maps fail explicitly", async () => {
  const latest = await fixture("restart");
  await withWorker(
    latest,
    async ({ service, OfflineService, cacheStorage, network }) => {
      const releaseId = latest.manifest.releaseId;
      const map = {
        releaseId,
        mapId: "100000000",
        offline: false,
        resources: [latest.assetInfo],
        preparationId: crypto.randomUUID(),
      };
      await request(service, "/", true);
      await command(service, "PREPARE_MAP", map);
      await command(service, "COMMIT_MAP", {
        releaseId,
        mapId: map.mapId,
        preparationId: map.preparationId,
      });
      network.online = false;
      network.fetched.length = 0;
      const restarted = new OfflineService();
      expect(
        await command(restarted, "PREPARE_MAP", { ...map, offline: true }),
      ).toMatchObject({ ready: true, scope: "map" });
      await expect(
        command(restarted, "PREPARE_MAP", {
          ...map,
          mapId: "100000001",
          offline: true,
          preparationId: crypto.randomUUID(),
        }),
      ).rejects.toThrow("missing or corrupt offline");
      const meta = await cacheStorage.open("maple-offline-meta-v1");
      const active = await (await meta.match(META + "active")).json();
      const cache = await cacheStorage.open(active.cacheName);
      const damaged = latest.files.get(latest.assetInfo.url).slice();
      damaged[0] ^= 1;
      await cache.put(latest.assetInfo.url, new Response(damaged));
      await expect(
        command(restarted, "PREPARE_MAP", { ...map, offline: true }),
      ).rejects.toThrow("missing or corrupt offline");
      await cache.delete(latest.assetInfo.url);
      await expect(
        command(restarted, "PREPARE_MAP", { ...map, offline: true }),
      ).rejects.toThrow("missing or corrupt offline");
      expect(network.fetched).toEqual([]);
      network.online = true;
      expect(
        await command(restarted, "PREPARE_MAP", { ...map, mapId: "100000001" }),
      ).toMatchObject({ ready: true, mapId: "100000001", releaseId });
      network.online = false;
      expect(
        (await request(new OfflineService(), latest.neighbor.url)).status,
      ).toBe(200);
    },
  );
});

test("map hash failures publish neither readiness nor corrupt demand-fetched bytes", async () => {
  const latest = await fixture("integrity");
  await withWorker(
    latest,
    async ({ service, cacheStorage, network, OfflineService }) => {
      const releaseId = latest.manifest.releaseId;
      await request(service, "/", true);
      const original = latest.files.get(latest.assetInfo.url);
      const damaged = original.slice();
      damaged[0] ^= 1;
      latest.files.set(latest.assetInfo.url, damaged);
      const map = {
        releaseId,
        mapId: "100000000",
        offline: false,
        resources: [latest.assetInfo],
        preparationId: crypto.randomUUID(),
      };
      await expect(command(service, "PREPARE_MAP", map)).rejects.toThrow(
        "SHA-256 mismatch",
      );
      const meta = await cacheStorage.open("maple-offline-meta-v1");
      const partial = await (await meta.match(META + "partial")).json();
      const cache = await cacheStorage.open(partial.cacheName);
      expect(await meta.match(META + "active")).toBeUndefined();
      expect(await cache.match(latest.assetInfo.url)).toBeUndefined();
      expect((await request(service, latest.assetInfo.url)).status).toBe(503);
      expect(await cache.match(latest.assetInfo.url)).toBeUndefined();
      latest.files.set(latest.assetInfo.url, original);
      expect(await command(service, "PREPARE_MAP", map)).toMatchObject({
        ready: true,
      });
      await command(service, "COMMIT_MAP", {
        releaseId,
        mapId: map.mapId,
        preparationId: map.preparationId,
      });
      network.online = false;
      expect(
        await (
          await request(new OfflineService(), latest.assetInfo.url)
        ).json(),
      ).toEqual({ version: "integrity" });
    },
  );
});

test("cancelling a partial shell retains the live tab's sparse cache and immutable pin", async () => {
  const latest = await fixture("cancel");
  await withWorker(
    latest,
    async ({ service, OfflineService, cacheStorage, network }) => {
      await request(service, "/", true);
      expect(await command(service, "CANCEL_DOWNLOAD")).toEqual({
        cancelled: true,
      });
      network.online = false;
      const restarted = new OfflineService();
      expect(await (await request(restarted, "/dist/main.js")).text()).toBe(
        "cancel:/dist/main.js",
      );
      expect((await command(restarted, "OFFLINE_STATUS")).pinnedReleaseId).toBe(
        latest.manifest.releaseId,
      );
      const meta = await cacheStorage.open("maple-offline-meta-v1");
      expect(await meta.match(META + "partial")).toBeUndefined();
      network.online = true;
      expect(
        await command(restarted, "PREPARE_MAP", {
          releaseId: latest.manifest.releaseId,
          mapId: "100000000",
          offline: false,
          resources: [latest.assetInfo],
          preparationId: crypto.randomUUID(),
        }),
      ).toMatchObject({ ready: true });
    },
  );
});

test("cancelling an in-flight complete install cannot delete its live sparse release", async () => {
  const latest = await fixture("interrupt");
  await withWorker(latest, async ({ service, OfflineService }) => {
    await request(service, "/", true);
    const entered = Promise.withResolvers();
    const resume = Promise.withResolvers();
    const fetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (url === latest.assetInfo.url) {
        entered.resolve();
        await resume.promise;
      }
      return fetch(url, options);
    };
    const downloading = command(service, "DOWNLOAD_RELEASE", {
      releaseId: latest.manifest.releaseId,
    });
    try {
      await entered.promise;
      expect(await command(service, "CANCEL_DOWNLOAD")).toEqual({
        cancelled: true,
      });
    } finally {
      resume.resolve();
    }
    expect(await downloading).toMatchObject({ cancelled: true, ready: false });
    expect(
      await (await request(new OfflineService(), "/dist/main.js")).text(),
    ).toBe("interrupt:/dist/main.js");
  });
});
