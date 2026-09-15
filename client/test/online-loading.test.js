import { expect, test } from "bun:test";
import {
  OnlineLoading,
  STARTUP_ASSET_FAILURE_MESSAGE,
  formatBytes,
} from "../src/online/loading.js";
import { prepareLoginStartup } from "../src/online/login-startup.js";

/** Minimal DOM stand-in for the nodes the loading presentation writes to. */
function node() {
  return {
    hidden: true,
    dataset: {},
    style: {},
    textContent: "",
    labels: {},
    setAttribute(name, value) {
      this.labels[name] = value;
    },
    removeAttribute(name) {
      delete this.labels[name];
    },
    remove() {},
  };
}

function presentation() {
  return Object.assign(Object.create(OnlineLoading.prototype), {
    owners: new Set(),
    maps: new Set(),
    destroyed: false,
    failure: null,
    startup: false,
    expected: new Map(),
    finished: new Set(),
    live: null,
    shown: 0,
    overlay: node(),
    indicator: node(),
    status: node(),
    progress: node(),
    fill: node(),
    count: node(),
    hint: node(),
    decoration: { image: { hidden: true } },
  });
}

/** The startup fallback needs the DOM attributes and teardown hooks the real node has. */
function startupPresentation({ artLoaded = false } = {}) {
  const loading = presentation();
  loading.decoration = { image: { hidden: !artLoaded } };
  return loading;
}

const percent = (loading) => Number(loading.progress.labels["aria-valuenow"]);

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

test("login startup owns a Windows 95 page until its artwork is ready", () => {
  const loading = startupPresentation();
  loading.beginStartup();
  expect(loading.overlay.hidden).toBe(false);
  expect(loading.indicator.hidden).toBe(true);
  expect(loading.overlay.dataset.state).toBe("startup");
  // No declared resource yet, so the bar reports motion without a percentage.
  expect(loading.progress.dataset.indeterminate).toBe("true");
  expect(loading.progress.labels["aria-valuenow"]).toBeUndefined();
  expect(loading.status.textContent).toBe("Downloading game files…");
  loading.ready();
  expect(loading.overlay.hidden).toBe(true);
  expect(loading.startup).toBe(false);
});

test("declared descriptor bytes drive a determinate startup bar and counters", () => {
  const loading = startupPresentation();
  loading.beginStartup();
  loading.plan([
    { url: "/generated/bundles/a.json", bytes: 102400 },
    { url: "/generated/atlases/b.png", bytes: 307200 },
  ]);
  expect(loading.progress.dataset.indeterminate).toBe("false");
  expect(percent(loading)).toBe(0);
  expect(loading.count.textContent).toBe("0 of 2 files · 0 KB of 400 KB");
  const owner = loading.begin(
    "resource",
    "https://game.example/generated/bundles/a.json",
    102400,
  );
  expect(loading.status.textContent).toBe("Downloading game files…");
  loading.end(owner);
  expect(percent(loading)).toBe(25);
  expect(loading.count.textContent).toBe("1 of 2 files · 100 KB of 400 KB");
  expect(loading.progress.labels["aria-valuetext"]).toBeUndefined();
});

test("a resource without a declared size reports bytes without inventing a percentage", () => {
  const loading = startupPresentation();
  loading.beginStartup();
  loading.plan([{ url: "/generated/catalog.json" }]);
  loading.stream("https://game.example/generated/catalog.json", 512 * 1024);
  expect(loading.progress.dataset.indeterminate).toBe("true");
  expect(loading.progress.labels["aria-valuenow"]).toBeUndefined();
  expect(loading.count.textContent).toBe("512 KB downloaded");
  expect(loading.status.textContent).toBe("Downloading game files…");
});

test("live bytes advance a planned resource inside its declared length", () => {
  const loading = startupPresentation();
  loading.beginStartup();
  loading.plan([{ url: "/generated/atlases/a.png", bytes: 1048576 }]);
  loading.stream("https://game.example/generated/atlases/a.png", 524288);
  expect(percent(loading)).toBe(50);
  // A compressed wire length can exceed the decoded frontier; it never inflates it.
  loading.stream("https://game.example/generated/atlases/a.png", 4 * 1048576);
  expect(percent(loading)).toBe(99);
});

test("a validated bundle manifest extends the startup frontier only while it owns the page", () => {
  const loading = startupPresentation();
  loading.beginStartup();
  loading.includeManifest({
    regions: [{ url: "/generated/regions/r.json", bytes: 10 }],
    atlases: { a: { url: "/generated/atlases/a.png", bytes: 90 } },
  });
  expect(loading.snapshot().files).toBe(2);
  loading.ready();
  loading.includeManifest({
    atlases: { b: { url: "/generated/atlases/b.png", bytes: 90 } },
  });
  expect(loading.snapshot().files).toBe(2);
});

test("field preparation keeps the resident mushroom presentation", () => {
  const loading = startupPresentation();
  loading.beginStartup();
  const map = loading.beginMap({
    url: "/generated/maps/m.json",
    bytes: 40,
  });
  expect(loading.startup).toBe(false);
  expect(loading.overlay.dataset.state).toBe("map");
  const download = loading.begin(
    "download",
    "https://game.example/generated/maps/m.json",
    40,
  );
  expect(loading.overlay.hidden).toBe(false);
  expect(loading.status.textContent).toBe("Loading map assets…");
  loading.end(download);
  loading.endMap(map);
  expect(loading.overlay.hidden).toBe(true);
});

test("startup work before its declared plan reports bytes without a total", () => {
  const loading = startupPresentation();
  loading.beginStartup();
  const owner = loading.begin(
    "resource",
    "https://game.example/generated/catalog.json",
    4096,
  );
  expect(loading.progress.dataset.indeterminate).toBe("true");
  expect(loading.count.textContent).toBe("");
  loading.end(owner);
  expect(loading.progress.dataset.indeterminate).toBe("true");
  expect(loading.snapshot().files).toBe(0);
});

test("an unplanned resource joins the frontier once a plan exists", () => {
  const loading = startupPresentation();
  loading.beginStartup();
  loading.plan([{ url: "/generated/bundles/a.json", bytes: 102400 }]);
  const owner = loading.begin(
    "resource",
    "https://game.example/generated/atlases/x.png",
    51200,
  );
  expect(loading.snapshot().files).toBe(2);
  loading.end(owner);
  expect(loading.snapshot().complete).toBe(1);
});

test("startup progress never runs backwards when the frontier grows", () => {
  const loading = startupPresentation();
  loading.beginStartup();
  loading.plan([{ url: "/generated/bundles/a.json", bytes: 102400 }]);
  const owner = loading.begin(
    "resource",
    "https://game.example/generated/bundles/a.json",
    102400,
  );
  loading.end(owner);
  expect(percent(loading)).toBe(99);
  loading.includeManifest({
    atlases: { b: { url: "/generated/atlases/b.png", bytes: 921600 } },
  });
  expect(percent(loading)).toBe(99);
  expect(loading.count.textContent).toBe("1 of 2 files · 100 KB of 1000 KB");
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
  expect(loading.progress.hidden).toBe(true);
  expect(loading.snapshot()).toEqual({
    visible: true,
    failure: STARTUP_ASSET_FAILURE_MESSAGE,
    art: "missing",
    startup: false,
    files: 0,
    complete: 0,
    plannedBytes: 0,
    downloadedBytes: 0,
    percent: 0,
    current: null,
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
    startup: false,
    files: 0,
    complete: 0,
    plannedBytes: 0,
    downloadedBytes: 0,
    percent: 0,
    current: null,
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
  expect(loading.count.hidden).toBe(true);
  expect(loading.hint.hidden).toBe(true);
  expect(loading.snapshot()).toEqual({
    visible: true,
    failure: "Sign in assets unavailable.",
    art: "shown",
    startup: false,
    files: 0,
    complete: 0,
    plannedBytes: 0,
    downloadedBytes: 0,
    percent: 0,
    current: null,
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

test("download byte labels stay bounded", () => {
  expect(formatBytes(0)).toBe("0 KB");
  expect(formatBytes(2048)).toBe("2 KB");
  expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
});
