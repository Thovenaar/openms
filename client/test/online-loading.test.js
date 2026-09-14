import { expect, test } from "bun:test";
import {
  OnlineLoading,
  STARTUP_ASSET_FAILURE_MESSAGE,
} from "../src/online/loading.js";
import { prepareLoginStartup } from "../src/online/login-startup.js";

function presentation() {
  return Object.assign(Object.create(OnlineLoading.prototype), {
    owners: new Set(),
    maps: new Set(),
    destroyed: false,
    failure: null,
    overlay: { hidden: true },
    indicator: { hidden: true },
    status: {},
  });
}

/** The startup fallback needs the DOM attributes and teardown hooks the real node has. */
function startupPresentation({ artLoaded = false } = {}) {
  const overlay = {
    hidden: true,
    dataset: {},
    labels: {},
    setAttribute(name, value) {
      this.labels[name] = value;
    },
    remove() {},
  };
  return Object.assign(Object.create(OnlineLoading.prototype), {
    owners: new Set(),
    maps: new Set(),
    destroyed: false,
    failure: null,
    overlay,
    indicator: { hidden: true, remove() {} },
    status: { textContent: "" },
    decoration: { image: { hidden: !artLoaded } },
  });
}

test("resident and background work never cover the map; overlapping tokens settle independently", () => {
  const loading = presentation();
  const download = loading.begin("download", "/map");
  const decode = loading.begin();
  expect(loading.overlay.hidden).toBe(true);
  expect(loading.indicator.hidden).toBe(false);
  loading.end(download);
  expect(loading.indicator.hidden).toBe(false);
  loading.end(decode);
  expect(loading.indicator.hidden).toBe(true);
});

test("a cached map needs no fullscreen loader; only its new downloads admit the overlay", () => {
  const loading = presentation();
  const background = loading.begin("download", "/map");
  const cached = loading.beginMap({ url: "/map" });
  const unrelated = loading.begin("download", "/unrelated-sound");
  loading.end(unrelated);
  expect(loading.overlay.hidden).toBe(true);
  loading.endMap(cached);
  loading.end(background);
  const map = loading.beginMap({ url: "/map" });
  const fetch = loading.begin("download", "/map");
  expect(loading.overlay.hidden).toBe(false);
  expect(loading.indicator.hidden).toBe(true);
  loading.end(fetch);
  expect(loading.overlay.hidden).toBe(false);
  loading.endMap(map);
  expect(loading.overlay.hidden).toBe(true);
  expect(loading.indicator.hidden).toBe(true);
});

test("failed or superseded map work releases only its own overlay", () => {
  const loading = presentation();
  const old = loading.beginMap({ url: "/map" });
  const first = loading.begin("download", "/map");
  const current = loading.beginMap({ url: "/map" });
  const next = loading.begin("download", "/map");
  loading.endMap(old);
  loading.end(first);
  expect(loading.overlay.hidden).toBe(false);
  loading.endMap(current);
  expect(loading.overlay.hidden).toBe(true);
  expect(loading.indicator.hidden).toBe(false);
  loading.end(next);
  expect(loading.indicator.hidden).toBe(true);
});

test("only destination manifest, region and atlas downloads can cover map preparation", () => {
  const loading = presentation();
  const map = loading.beginMap({ url: "/map" });
  loading.includeMap(map, {
    regions: [{ url: "/region" }],
    atlases: { a: { url: "/atlas" } },
  });
  const audio = loading.begin("download", "https://game.example/audio");
  expect(loading.overlay.hidden).toBe(true);
  const atlas = loading.begin("download", "https://game.example/atlas");
  expect(loading.overlay.hidden).toBe(false);
  loading.endMap(map);
  loading.end(atlas);
  expect(loading.indicator.hidden).toBe(false);
  loading.end(audio);
  expect(loading.indicator.hidden).toBe(true);
});

test("a failing login resource load shows the loading surface with its status", async () => {
  const loading = startupPresentation();
  const failures = [];
  const ready = await prepareLoginStartup({
    prepare: async () => {
      throw new Error("The original Login artwork bundle is missing");
    },
    loading,
    onFailure: (error) => failures.push(error),
  });
  expect(ready).toBe(false);
  expect(failures).toHaveLength(1);
  expect(loading.overlay.hidden).toBe(false);
  expect(loading.indicator.hidden).toBe(true);
  expect(loading.status.textContent).toBe(STARTUP_ASSET_FAILURE_MESSAGE);
  expect(loading.overlay.dataset.state).toBe("error");
  expect(loading.overlay.labels["aria-label"]).toBe("Game files unavailable");
  // The mushroom never decoded, so the readable message stands alone.
  expect(loading.overlay.dataset.art).toBe("missing");
  expect(loading.snapshot()).toEqual({
    visible: true,
    failure: STARTUP_ASSET_FAILURE_MESSAGE,
    art: "missing",
  });
});

test("a successful login resource load leaves the loading surface untouched", async () => {
  const loading = startupPresentation();
  const ready = await prepareLoginStartup({
    prepare: async () => {},
    loading,
    onFailure: () => {
      throw new Error("A successful preparation must not report a failure");
    },
  });
  expect(ready).toBe(true);
  expect(loading.overlay.hidden).toBe(true);
  expect(loading.snapshot()).toEqual({
    visible: false,
    failure: null,
    art: null,
  });
});

test("cancelled login preparation never takes over the loading surface", async () => {
  const loading = startupPresentation();
  await expect(
    prepareLoginStartup({
      prepare: async () => {
        throw new DOMException("Cancelled", "AbortError");
      },
      loading,
      onFailure: () => {
        throw new Error("Cancellation is not a startup failure");
      },
    }),
  ).rejects.toThrow("Cancelled");
  expect(loading.overlay.hidden).toBe(true);
  expect(loading.failure).toBe(null);
});

test("decoded mushroom art is reported alongside the failure message", () => {
  const loading = startupPresentation({ artLoaded: true });
  loading.failStartup("Sign in assets unavailable.");
  expect(loading.overlay.dataset.art).toBe("shown");
  expect(loading.status.textContent).toBe("Sign in assets unavailable.");
  expect(loading.snapshot()).toEqual({
    visible: true,
    failure: "Sign in assets unavailable.",
    art: "shown",
  });
});

test("map work released after a startup failure cannot replace its message", () => {
  const loading = startupPresentation();
  loading.failStartup();
  const map = loading.beginMap({ url: "/map" });
  const download = loading.begin("download", "/map");
  loading.end(download);
  loading.endMap(map);
  expect(loading.overlay.hidden).toBe(false);
  expect(loading.indicator.hidden).toBe(true);
  expect(loading.status.textContent).toBe(STARTUP_ASSET_FAILURE_MESSAGE);
  expect(loading.failure).toBe(STARTUP_ASSET_FAILURE_MESSAGE);
});

test("destroy retires the fallback surface and ignores later failures", () => {
  const loading = startupPresentation();
  loading.failStartup();
  loading.destroy();
  expect(loading.destroyed).toBe(true);
  loading.failStartup("later");
  expect(loading.failure).toBe(STARTUP_ASSET_FAILURE_MESSAGE);
  expect(loading.status.textContent).toBe(STARTUP_ASSET_FAILURE_MESSAGE);
});
