import { expect, test } from "bun:test";
import { OfflineDelivery } from "../src/delivery/offline-delivery.js";
import { Gate } from "../src/rendering/stream-network.js";

function owner(state) {
  const delivery = Object.create(OfflineDelivery.prototype);
  const ready = Promise.withResolvers();
  Object.assign(delivery, {
    state,
    ready: ready.promise,
    resolveReady: ready.resolve,
    listeners: new AbortController(),
    mapGate: new Gate(1),
    launchReady: false,
    busy: false,
    destroyed: false,
    loadingDecoration: { load() {} },
    async selectMap() {
      return { mapId: "101000000", resources: [] };
    },
    async request(type, releaseId, options) {
      if (type === "PREPARE_MAP") {
        return {
          ready: true,
          scope: "map",
          releaseId,
          mapId: options.mapId,
          preparationId: options.preparationId,
        };
      }
      return state;
    },
    async measureStorage() {},
    render() {},
  });
  return delivery;
}

function globals(values) {
  const originals = new Map();
  for (const [key, value] of Object.entries(values)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  return () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
}

test("online HTTP failure blocks an intact offline release; transport loss allows its verified pin", async () => {
  const release = { releaseId: "a".repeat(64), ready: true };
  const delivery = owner({
    active: release,
    pinned: release,
    pinnedReleaseId: release.releaseId,
  });
  let reachedServer = true;
  const restore = globals({
    sessionStorage: { removeItem() {} },
    fetch: async () => {
      if (reachedServer) return new Response("unavailable", { status: 503 });
      throw new TypeError("Network unreachable");
    },
  });
  try {
    await expect(delivery.prepareStartup()).rejects.toThrow("HTTP 503");
    expect(delivery.launchReady).toBe(false);
    reachedServer = false;
    await delivery.prepareStartup();
    expect(await delivery.ready).toEqual({
      releaseId: release.releaseId,
      mapId: "101000000",
      offline: true,
    });
    expect(delivery.launchReady).toBe(true);
  } finally {
    delivery.listeners.abort();
    restore();
  }
});

test("an interrupted response body allows the verified pin but malformed online JSON does not", async () => {
  const release = { releaseId: "d".repeat(64), ready: true };
  const delivery = owner({
    active: release,
    pinned: release,
    pinnedReleaseId: release.releaseId,
  });
  let interrupted = false;
  const restore = globals({
    sessionStorage: { removeItem() {} },
    fetch: async () => {
      if (!interrupted) return new Response("{");
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError("Connection lost during body"));
          },
        }),
      );
    },
  });
  try {
    await expect(delivery.prepareStartup()).rejects.toBeInstanceOf(SyntaxError);
    expect(delivery.launchReady).toBe(false);
    interrupted = true;
    await delivery.prepareStartup();
    expect(await delivery.ready).toEqual({
      releaseId: release.releaseId,
      mapId: "101000000",
      offline: true,
    });
    expect(delivery.launchReady).toBe(true);
  } finally {
    delivery.listeners.abort();
    restore();
  }
});

test("a repaired active release cannot start in a corrupt pinned tab and cannot cause a reload loop", async () => {
  const release = { releaseId: "b".repeat(64), ready: true };
  const delivery = owner({
    active: release,
    pinned: { ...release, ready: false },
    pinnedReleaseId: release.releaseId,
  });
  delivery.checkAvailable = async () => false;
  const stored = new Map();
  let reloads = 0;
  const restore = globals({
    sessionStorage: {
      getItem(key) {
        return stored.get(key) ?? null;
      },
      setItem(key, value) {
        stored.set(key, value);
      },
      removeItem(key) {
        stored.delete(key);
      },
    },
    window: {
      location: {
        reload() {
          reloads++;
        },
      },
    },
  });
  try {
    await delivery.prepareStartup();
    expect(delivery.launchReady).toBe(false);
    expect(reloads).toBe(1);
    await expect(delivery.prepareStartup()).rejects.toThrow(
      "could not control this tab",
    );
    expect(delivery.launchReady).toBe(false);
    expect(reloads).toBe(1);
  } finally {
    delivery.listeners.abort();
    restore();
  }
});

test("an intact shell cannot release startup before the saved map verifies", async () => {
  const release = { releaseId: "c".repeat(64), ready: true, scope: "shell" };
  const delivery = owner({
    active: release,
    pinned: release,
    pinnedReleaseId: release.releaseId,
  });
  delivery.checkAvailable = async () => false;
  const verification = Promise.withResolvers();
  const started = Promise.withResolvers();
  delivery.request = async (type) => {
    if (type === "PREPARE_MAP") {
      started.resolve();
      return verification.promise;
    }
    return delivery.state;
  };
  let playable = false;
  delivery.ready.then(() => {
    playable = true;
  });
  const startup = delivery.prepareStartup();
  await started.promise;
  expect(playable).toBe(false);
  verification.reject(new Error("Saved map resource SHA mismatch"));
  await expect(startup).rejects.toThrow("Saved map resource SHA mismatch");
  expect(delivery.launchReady).toBe(false);
  expect(playable).toBe(false);
  delivery.listeners.abort();
});
