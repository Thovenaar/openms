import { expect, test } from "bun:test";
import { assetRegions } from "../src/online/asset-regions.js";
import { RegionDownloadPlan } from "../src/online/region-download-plan.js";
import { Gate } from "../src/rendering/stream-network.js";

const signal = new AbortController().signal;
const info = (name, bytes = 1) => ({
  url: `/generated/${name}`,
  sha256: "a".repeat(64),
  bytes,
});

test("regional membership includes Victoria interiors and child dungeons but excludes private maps", () => {
  const catalog = { maps: {}, mapNames: {} };
  for (const id of [
    100000000, 105000000, 108000500, 200000000, 200000001, 800000000,
  ]) {
    catalog.maps[id] = info(id);
  }
  catalog.maps[900000000] = {
    ...info("private"),
    url: "/api/v1/world-content/map",
  };
  const result = assetRegions(catalog, {
    worldMaps: {
      WorldMap: { parent: null, spots: [] },
      WorldMap010: { parent: "WorldMap", spots: [{ maps: [100000000] }] },
      WorldMap011: { parent: "WorldMap010", spots: [{ maps: [105000000] }] },
      WorldMap020: { parent: "WorldMap", spots: [{ maps: [200000000] }] },
    },
  });
  expect(result.groups.get(result.defaultRegion).maps).toEqual([
    "100000000",
    "105000000",
    "108000500",
  ]);
  expect(result.groups.get("WorldMap020").maps).toEqual([
    "200000000",
    "200000001",
  ]);
  expect(result.membership.has("900000000")).toBe(false);
  expect(result.groups.get("map:800000000").maps).toEqual(["800000000"]);
});

test("background jobs reserve two foreground slots and queued gameplay goes first", async () => {
  const gate = new Gate(4),
    running = [],
    waits = [];
  const run = (name, background) =>
    gate.run(
      async () => {
        running.push(name);
        const deferred = Promise.withResolvers();
        waits.push(deferred);
        await deferred.promise;
      },
      signal,
      background,
    );
  const jobs = [
    run("background1", true),
    run("background2", true),
    run("background3", true),
  ];
  expect(running).toEqual(["background1", "background2"]);
  jobs.push(run("map", false), run("speech", false), run("portal", false));
  expect(running).toEqual(["background1", "background2", "map", "speech"]);
  waits[0].resolve();
  await jobs[0];
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  expect(running.at(-1)).toBe("portal");
  for (const wait of waits) wait.resolve();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  waits.at(-1).resolve();
  await Promise.all(jobs);
  expect(gate.active).toBe(0);
  expect(gate.backgroundActive).toBe(0);
});

function planFixture() {
  const loaded = [];
  const network = {
    ready: Promise.resolve(),
    cacheStatus: "persistent",
    cacheByteLimit: 4 * 1024 ** 3,
    cacheBytes: 0,
    async load(resource, _signal, background) {
      loaded.push({ resource, background });
    },
  };
  const plan = new RegionDownloadPlan(
    { name: "Region", maps: [] },
    {},
    network,
  );
  plan.add(info("one.png", 7), "bytes", "Map — artwork");
  plan.add(info("one.png", 7), "bytes", "Other map — shared artwork");
  plan.add(info("two.png", 11), "bytes", "Map — monster artwork");
  return { plan, network, loaded };
}

test("regional download deduplicates shared artwork and completes only verified loads", async () => {
  const { plan, loaded } = planFixture();
  await plan.batch(signal, () => {});
  expect(loaded.map((row) => row.background)).toEqual([true, true]);
  expect(plan.snapshot()).toMatchObject({
    status: "complete",
    files: 2,
    complete: 2,
    bytes: 18,
    doneBytes: 18,
  });
});

test("regional prefetch stops explicitly for quota loss or failed transfers", async () => {
  for (const state of ["quota", "unavailable", "failed"]) {
    const { plan, network, loaded } = planFixture();
    if (state === "quota") network.cacheByteLimit = 100;
    if (state === "unavailable") network.cacheStatus = "read-only";
    if (state === "failed") {
      network.load = async () => {
        throw new Error("offline");
      };
    }
    await plan.batch(signal, () => {});
    expect(plan.status).toBe(
      {
        quota: "storage-full",
        unavailable: "cache-unavailable",
        failed: "failed",
      }[state],
    );
    expect(plan.complete).toBe(0);
    expect(loaded).toEqual([]);
  }
});

test("map prefetch includes every real scenery region and mob atlas without decoding images", async () => {
  const catalog = await Bun.file(
    new URL("../public/generated/catalog.json", import.meta.url),
  ).json();
  const network = {
    async json(info) {
      return Bun.file(new URL(`../public${info.url}`, import.meta.url)).json();
    },
  };
  const plan = new RegionDownloadPlan(
    { name: "Henesys", maps: ["100010000"] },
    catalog,
    network,
  );
  const map = await network.json(catalog.maps["100010000"]);
  await plan.load(plan.jobs[0], signal);
  for (const descriptor of [...map.regions, ...Object.values(map.atlases)]) {
    expect(plan.seen.has(descriptor.url)).toBe(true);
  }
  const mobs = Object.values(map.life.renderables).filter(
    (record) => record.entity.kind === "mob",
  );
  expect(mobs.length).toBeGreaterThan(0);
  for (const mob of mobs) {
    for (const hash of Object.values(mob.atlases)) {
      expect(plan.seen.has(map.atlases[hash].url)).toBe(true);
    }
  }
  for (const template of Object.values(map.life.templates)) {
    if (template.kind !== "mob") continue;
    const sounds =
      catalog.audiovisual.combat.sounds.Mob[Number(template.originalId)];
    for (const sound of Object.values(sounds ?? {})) {
      if (sound.available) {
        expect(plan.seen.has(sound.descriptor.url)).toBe(true);
      }
    }
  }
});

test("quota loss during the final batch cannot report a fully saved region", async () => {
  const { plan, network } = planFixture();
  network.load = async () => {
    network.cacheByteLimit = 100;
  };
  await plan.batch(signal, () => {});
  expect(plan.status).toBe("storage-full");
});
