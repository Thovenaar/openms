import { expect, test } from "bun:test";
import { OnlineLoading } from "../src/online/loading.js";

function presentation() {
  return Object.assign(Object.create(OnlineLoading.prototype), {
    owners: new Set(),
    maps: new Set(),
    destroyed: false,
    overlay: { hidden: true },
    indicator: { hidden: true },
    status: {},
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
