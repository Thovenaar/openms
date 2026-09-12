import { focusCanvas, mapManifest, seededProfile, settled } from "./native.js";

const MAP = "100000000";

async function fixture({ catalog, loadJSON }) {
  const manifest = await mapManifest(catalog, loadJSON, MAP);
  const departure = manifest.physics.portals.find(
    (portal) => portal.name === "hp01",
  );
  const arrival = manifest.physics.portals.find(
    (portal) => portal.name === "hp01_1",
  );
  if (!departure || !arrival || departure.targetName !== arrival.name) {
    throw new Error("Original Henesys hp01 teleport pair is unavailable");
  }
  return {
    profile: seededProfile(catalog, {
      mapId: MAP,
      x: departure.x,
      y: departure.y,
      facing: 1,
    }),
    departure,
    arrival,
    provenance: {
      kind: "seeded-not-earned",
      recipe: 1,
      source: "Map.wz:Map/Map1/100000000.img/portal/26,27",
      policy:
        "Detached profile at authored hp01; only real Up activates relocation. No camera, animation, portal or loading state is seeded.",
    },
  };
}

/** Runs in the browser; observes each presented canvas without changing gameplay. */
function observeTeleport(arrivalX) {
  const canvas = document.querySelector("#scene-canvas");
  const sample = document.createElement("canvas");
  sample.width = 160;
  sample.height = 100;
  const context = sample.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  const frames = [];
  const captures = [];
  let committedAt = -1;
  return new Promise((resolve, reject) => {
    function observe() {
      try {
        const state = window.maple.snapshot();
        // Exclude native bottom HUD: evidence concerns the world/backdrop, not UI pixels.
        context.drawImage(canvas, 0, 0, sample.width, sample.height / 0.65);
        const pixels = context.getImageData(0, 0, 160, 100).data;
        const words = new DataView(pixels.buffer, pixels.byteOffset);
        let artwork = 0;
        for (let index = 0; index < words.byteLength; index += 4) {
          const rgba = words.getUint32(index);
          // RGBA bytes: renderer clear #101820ff, black #000000ff, or transparent.
          artwork +=
            (rgba !== 0x101820ff) &
            (rgba !== 0x000000ff) &
            ((rgba & 0xff) !== 0);
        }
        const committed = Math.abs(state.simulation.x - arrivalX) < 100;
        if (committed && committedAt < 0) committedAt = frames.length;
        if (
          (frames.length % 30 === 0 || committedAt === frames.length) &&
          captures.length < 14
        ) {
          captures.push({
            frame: frames.length,
            png: sample.toDataURL("image/png"),
          });
        }
        frames.push({
          cameraX: state.camera.x,
          playerX: state.simulation.x,
          cameraTime: state.cameraFilter.committedTime,
          artworkPixels: artwork,
          pendingLoads: state.pendingLoads,
          sprites: state.residentSprites,
          fade: state.fieldTransition.opacity,
          error: state.lastError,
        });
        if (
          frames.length >= 360 ||
          (committedAt >= 0 && frames.length - committedAt >= 120)
        ) {
          resolve({ frames, captures, committedAt });
        } else requestAnimationFrame(observe);
      } catch (error) {
        reject(error);
      }
    }
    requestAnimationFrame(observe);
  });
}

async function run(context) {
  const { page, checkpoint, assert, inputs } = context;
  await settled(page, MAP);
  await focusCanvas(page);
  await page.waitForFunction(
    () => Boolean(window.maple.snapshot().simulation.footholdId),
  );
  await checkpoint("before-hp01-native-up");
  const observation = page.evaluate(observeTeleport, inputs.fixture.arrival.x);
  await page.keyboard.press("ArrowUp", { delay: 120 });
  const evidence = await observation;
  assert(
    evidence.committedAt >= 0,
    "Real Up commits the authored same-map teleport",
  );
  assert(
    evidence.frames.every((frame) => frame.artworkPixels > 1600),
    "Every sampled presented frame retains world artwork, not a clear/black backdrop",
    { actual: evidence.frames },
  );
  assert(
    evidence.frames.every((frame) => frame.fade === 0),
    "Same-map travel never hides readiness behind a fade",
  );
  const start = evidence.frames[0].cameraX;
  assert(
    evidence.frames.some(
      (frame) =>
        frame.playerX > 5700 &&
        frame.cameraX > start + 50 &&
        frame.cameraX < 5200,
    ),
    "Arrival preserves intermediate smooth camera history rather than snapping",
  );
  assert(
    evidence.frames.every((frame) => frame.sprites <= 65536),
    "The camera sweep retains the bounded scene sprite budget",
  );
  await settled(page, MAP);
  await checkpoint("after-hp01_1-filtered-arrival");
  return { provenance: inputs.fixture.provenance, ...evidence };
}

export default {
  name: "same-map-teleport",
  recipe: 1,
  mapIds: [MAP],
  dependencies: [
    "client/tools/scenarios/{native,same-map-teleport}.js",
    "client/src/main.js",
    "client/src/rendering/**/*.js",
    "client/src/world/portal-system.js",
    "client/src/physics/**/*.js",
  ],
  fixture,
  run,
};
