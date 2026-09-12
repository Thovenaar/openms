import { focusCanvas, mapManifest, seededProfile, settled } from "./native.js";

const MAP = "100000000";

async function fixture({ catalog, loadJSON }) {
  const manifest = await mapManifest(catalog, loadJSON, MAP);
  const arrival = manifest.physics.portals.find((portal) => portal.id === 5);
  if (!arrival || arrival.type !== 0 || arrival.targetMap !== 999999999) {
    throw new Error("Original Henesys spawn portal5 is unavailable");
  }
  return {
    profile: seededProfile(catalog, {
      mapId: MAP,
      x: arrival.x + 35,
      y: arrival.y,
      facing: -1,
    }),
    arrival,
    provenance: {
      kind: "seeded-not-earned",
      recipe: 1,
      source: "Map.wz:Map/Map1/100000000.img/portal/5",
      policy:
        "Detached durable XY35pixels beside original portal5, not a spawn override. Startup and native Reload must resolve the original nearest arrival.",
    },
  };
}

async function run({ page, checkpoint, snapshot, assert, inputs }) {
  await settled(page, MAP);
  const initial = await snapshot();
  const arrival = inputs.fixture.arrival;
  assert(
    Math.abs(initial.simulation.x - arrival.x) < 1,
    "Durable startup chooses nearest original spawn rather than saved arbitrary XY",
    { actual: initial.simulation, expected: arrival },
  );
  assert(initial.simulation.facing === -1, "Reload preserves saved facing");
  await checkpoint("nearest-spawn-after-durable-startup");
  await focusCanvas(page);
  await page.keyboard.down("ArrowRight");
  try {
    await page.waitForFunction(
      (x) => window.maple.snapshot().simulation.x > x + 20,
      { timeout: 5000 },
      arrival.x,
    );
  } finally {
    await page.keyboard.up("ArrowRight");
  }
  const before = await snapshot();
  await checkpoint("walked-away-before-native-reload");
  await page.click("#reload");
  await page.evaluate(() => window.maple.ready);
  await settled(page, MAP);
  const after = await snapshot();
  assert(
    before.simulation.x > arrival.x + 20 &&
      Math.abs(after.simulation.x - arrival.x) < 1,
    "Native Reload returns walked saved XY to the nearest authored spawn",
    { actual: after.simulation, before: before.simulation, expected: arrival },
  );
  await checkpoint("nearest-spawn-after-native-reload");
  return {
    provenance: inputs.fixture.provenance,
    initial: initial.simulation,
    before: before.simulation,
    after: after.simulation,
    arrival,
  };
}

export default {
  name: "reload-spawn",
  recipe: 1,
  mapIds: [MAP],
  dependencies: [
    "client/tools/scenarios/{native,reload-spawn}.js",
    "client/src/main.js",
    "client/src/world/field-arrival.js",
    "client/src/profile/**/*.js",
  ],
  fixture,
  run,
};
