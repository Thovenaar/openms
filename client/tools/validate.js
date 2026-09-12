import puppeteer from "puppeteer-core";
import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  installProbe,
  resetProbe,
  measureProbe,
  throttleNetwork,
} from "./validation-metrics.js";
import { decodePNG, comparePixels } from "./validation-png.js";
import { compareRefreshRates } from "./physics-reference.js";
import { waitForNativeReady } from "./native-scenario-runner.js";
import {
  focusCanvas,
  openConsoleSection,
  seededProfile,
} from "./scenarios/native.js";
import { prepareFixture, seedFixture } from "./native-fixtures.js";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:3100" },
    chrome: {
      type: "string",
      default: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
    duration: { type: "string", default: "15" },
    maps: { type: "string" },
    output: { type: "string", default: "docs/physics-validation" },
    headed: { type: "boolean", default: false },
  },
});
const duration = Number(values.duration);
if (!Number.isFinite(duration) || duration <= 0 || duration > 120) {
  throw new Error("--duration must be 0–120 seconds, exclusive of zero");
}
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const report = {
  schemaVersion: 2,
  startedAt: new Date().toISOString(),
  status: "running",
  scope:
    "Input-driven browser behavior, streamed rendering, decoded pixels and fixed-step consistency; not original Windows parity",
  originalReference: {
    available: false,
    request: "docs/windows-reference-captures.md",
  },
  checks: [],
  captures: [],
  errors: [],
  transitions: [],
  refreshComparisons: [],
};
const delay = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
let browser;
let page;

function check(name, pass, details = {}) {
  report.checks.push({ name, pass: Boolean(pass), ...details });
}
const snapshot = () => page.evaluate(() => window.maple.snapshot());

async function hold(key, milliseconds) {
  await page.keyboard.down(key);
  try {
    await delay(milliseconds);
  } finally {
    await page.keyboard.up(key);
  }
}
function compactState(state) {
  return {
    sourceBuildId: state.sourceBuildId,
    buildId: state.buildId,
    currentMap: state.currentMap,
    simulation: state.simulation,
    presentation: state.presentation,
    camera: state.camera,
    input: state.input,
    regions: state.regions,
    pendingLoads: state.pendingLoads,
    streaming: state.streaming,
    residentSprites: state.residentSprites,
    lastError: state.lastError,
    entities: state.entities,
    metrics: state.metrics,
  };
}
/** Compare WebGL pixels, not CSS decorations such as native keyboard focus rings. */
async function captureCanvas(file, oracle) {
  if (oracle) {
    const capture = await page.evaluate(() => window.maple.agent.capture());
    const bytes = Buffer.from(capture.dataUrl.split(",")[1], "base64");
    await Bun.write(join(output, file), bytes);
    return bytes;
  }
  const canvas = await page.$("#scene-canvas");
  if (!canvas) throw new Error("WebGL surface missing");
  try {
    return await canvas.screenshot({ path: join(output, file) });
  } finally {
    await canvas.dispose();
  }
}

/** The atlas oracle covers world sprites, not UI text/nameplate composition. */
async function capture(label, oracle = false) {
  await page.evaluate(() => window.maple.pause(true));
  const previous = (await snapshot()).presentationVisible;
  if (oracle) {
    await page.evaluate(() => window.maple.setPresentationVisible(false));
  }
  try {
    const file = `${label}.png`;
    const actual = decodePNG(await captureCanvas(file, oracle));
    const state = await snapshot();
    report.captures.push({
      file,
      scope: oracle ? "world-artwork-backbuffer" : "visible-canvas-element",
      state: compactState(state),
    });
    if (oracle) await compareOracle(state, actual, label);
    return state;
  } finally {
    if (oracle) {
      await page.evaluate(
        (visible) => window.maple.setPresentationVisible(visible),
        previous,
      );
    }
  }
}
async function compareOracle(state, actual, label) {
  const dataUrl = await page.evaluate(
    async (state, size) => {
      const { compose } = await import("/dist/browser-oracle.js");
      return compose(state, size);
    },
    state,
    { width: actual.width, height: actual.height },
  );
  const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
  const file = `${label}-oracle.png`;
  await Bun.write(join(output, file), bytes);
  const difference = comparePixels(actual, decodePNG(bytes), 4);
  check(
    `Independent atlas-region compositing ${label}`,
    difference.outsideTolerance === 0,
    { expected: file, ...difference },
  );
}
async function environment() {
  return page.evaluate(() => {
    const canvas = document.querySelector("#scene-canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight },
      renderer: extension
        ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      webglVersion: gl.getParameter(gl.VERSION),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    };
  });
}
async function coldLoad() {
  const start = performance.now();
  await page.goto(values.url, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  // Two first-control discoveries may each transfer the bounded 16-MiB manifest.
  await waitForNativeReady(page, 300000);
  report.coldLoad = {
    readyMs: performance.now() - start,
    measurement: await measureProbe(page),
    state: compactState(await snapshot()),
  };
  report.environment = await environment();
  check(
    "Original Henesys loads without runtime error",
    report.coldLoad.state.currentMap === "100000000" &&
      !report.coldLoad.state.lastError,
  );
}
async function movement() {
  await focusCanvas(page);
  await delay(700);
  const before = await snapshot();
  await hold("ArrowRight", 600);
  await delay(300);
  const after = await snapshot();
  check(
    "Real keyboard moves character right",
    after.simulation.x > before.simulation.x,
    { before: before.simulation, after: after.simulation },
  );
  await page.keyboard.down("Alt");
  await delay(90);
  const rising = await snapshot();
  await page.keyboard.up("Alt");
  check(
    "Original Alt binding produces upward jump",
    rising.simulation.vy < 0 && rising.simulation.y < after.simulation.y,
    { rising: rising.simulation },
  );
  await delay(900);
  const landed = await snapshot();
  check(
    "Jump returns to an attached foothold",
    landed.simulation.state === "ground" && landed.simulation.footholdId !== 0,
    { landed: landed.simulation },
  );
  const actor = landed.entities.find((entity) => entity.id === "character");
  check(
    "Visible actor agrees with interpolated physics presentation",
    actor.x === landed.presentation.x && actor.y === landed.presentation.y,
  );
  await capture("henesys-after-keyboard", true);
}
async function livePerformance() {
  await page.evaluate(() => window.maple.pause(false));
  await focusCanvas(page);
  await resetProbe(page);
  await hold("ArrowRight", duration * 1000);
  report.live = {
    measurement: await measureProbe(page),
    state: compactState(await snapshot()),
  };
  report.performance = {
    status: "measured-not-graded",
    acceptanceThreshold: null,
    reason:
      "No original-runtime or approved browser smoothness threshold is available",
    measurementComplete:
      report.live.measurement.overflow === 0 &&
      report.live.measurement.longTaskOverflow === 0 &&
      report.live.measurement.frames.samples > 0 &&
      report.live.measurement.runtimeCPU.frame.samples > 0,
  };
}
/** Refine the bounded map list, then operate its actual native select. */
async function chooseMap(id) {
  await openConsoleSection(page, "world");
  await page.click("#map-search", { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type("#map-search", id);
  await page.waitForFunction(
    (id) => {
      const select = document.querySelector("#map");
      return select.options.length === 1 && select.options[0].value === id;
    },
    { timeout: 30000 },
    id,
  );
  await page.click("#map");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
}

async function transition(id) {
  await page.evaluate(() => window.maple.pause(false));
  const before = await snapshot();
  await chooseMap(id);
  const selected = await snapshot();
  check(
    `Map ${id} selection waits for explicit Go`,
    selected.currentMap === before.currentMap && !selected.loading,
  );
  await resetProbe(page);
  const start = performance.now();
  await page.click("#map-go");
  const pending = await snapshot();
  if (pending.loading) {
    check(
      `Current map retained during ${id} load`,
      pending.currentMap === before.currentMap,
    );
  }
  await page.waitForFunction(
    (id) => {
      const state = window.maple.snapshot();
      return state.currentMap === id && !state.loading;
    },
    { timeout: 120000 },
    id,
  );
  const elapsedMs = performance.now() - start;
  const after = await snapshot();
  report.transitions.push({
    from: before.currentMap,
    to: id,
    elapsedMs,
    measurement: await measureProbe(page),
    state: compactState(after),
  });
  check(
    `Map ${id} transition publishes a prepared field`,
    after.currentMap === id &&
      after.field.gameplay?.prepared &&
      after.fieldTransition.phase === "idle",
  );
  await focusCanvas(page);
  await hold("ArrowRight", 300);
  await hold("Alt", 80);
  await delay(350);
  const captured = await capture(`map-${id}`, true);
  check(
    `Real keyboard moves right after ${id} commit`,
    captured.simulation.x > after.simulation.x,
    { beforeX: after.simulation.x, afterX: captured.simulation.x },
  );
}
async function geometryPreviews() {
  await openConsoleSection(page, "world");
  const closed = await page.$eval(
    "#debug",
    (element) => !element.closest("details").open,
  );
  if (closed) {
    await page.click("#console-world details:has(#debug) > summary");
  }
  await page.click("#debug");
  await page.waitForFunction(
    () => !document.querySelector("#hitbox-reference").disabled,
    { timeout: 120000 },
  );
  const profiles = await page.$$eval("#hitbox-reference option", (options) =>
    options.map((option) => option.value).filter(Boolean),
  );
  for (const id of profiles) {
    await page.select("#hitbox-reference", id);
    const state = await snapshot();
    check(
      `Original geometry preview selectable ${id}`,
      state.hitboxReference?.id === id &&
        state.hitboxReference.activationKnown === false,
    );
  }
  await capture("original-geometry-overlay");
  await page.select("#hitbox-reference", "");
  await page.click("#debug");
  await openConsoleSection(page, "world");
}
/** Preserve URL/status diagnostics rather than parsing HTTP errors as evidence. */
async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Validation HTTP ${response.status}: ${url}`);
  }
  return response.json();
}

async function deterministicPhysics() {
  const catalog = await fetchJSON(`${values.url}/generated/catalog.json`);
  const events = [
    { atMs: 600, key: "right", down: true },
    { atMs: 1200, key: "jump", down: true },
    { atMs: 1230, key: "jump", down: false },
    { atMs: 1800, key: "right", down: false },
  ];
  for (const descriptor of Object.values(catalog.maps)) {
    const manifest = await fetchJSON(new URL(descriptor.url, values.url));
    const actor = manifest.actors.find((entity) => entity.kind === "character");
    const comparison = compareRefreshRates(manifest.physics, {
      durationMs: 3000,
      spawn: { x: actor.x, y: actor.y },
      events,
    });
    report.refreshComparisons.push({ map: manifest.id, ...comparison });
    check(
      `Final physics state and per-step jump extremum at 60/120/144/240Hz ${manifest.id}`,
      comparison.pass,
      { differences: comparison.differences },
    );
  }
}
function selectedBrowserMaps(available) {
  if (!values.maps) return available;
  const selected = values.maps.split(",");
  if (selected.length === 0 || selected.length > available.length) {
    throw new Error("--maps requires a bounded list of packaged map IDs");
  }
  const unique = new Set(selected);
  for (const id of selected) {
    if (!available.includes(id)) {
      throw new Error(`Unpackaged validation map ${id}`);
    }
  }
  if (unique.size !== selected.length) {
    throw new Error("Duplicate validation maps");
  }
  return selected;
}

/** Durable test setup only; hostile maps must not turn a world tour into a death replay. */
async function seedWorldFixture() {
  const catalog = await fetchJSON(`${values.url}/generated/catalog.json`);
  const descriptor = catalog.maps["100000000"];
  const manifest = await fetchJSON(new URL(descriptor.url, values.url));
  const spawn = manifest.physics.portals.find((portal) => portal.name === "sp");
  if (!spawn) throw new Error("Henesys lacks its authored spawn portal");
  const profile = seededProfile(catalog, {
    mapId: manifest.id,
    x: spawn.x,
    y: spawn.y - 10,
    facing: 1,
  });
  profile.hp = 30000;
  profile.maxHP = 30000;
  profile.baseMaxHP = 30000;
  const fixture = prepareFixture(
    {
      profile,
      provenance: {
        kind: "seeded-not-earned",
        source: descriptor,
        scope:
          "World rendering and mobility, not combat or progression. HP/base/max 30000 are explicit setup; ordinary damage and movement remain enabled.",
      },
    },
    catalog,
  );
  await Bun.write(
    join(output, "fixture.json"),
    JSON.stringify(fixture, null, 2),
  );
  await seedFixture(page, values.url, fixture);
  report.fixture = { file: "fixture.json", provenance: fixture.provenance };
}

async function run() {
  browser = await puppeteer.launch({
    executablePath: values.chrome,
    headless: !values.headed,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await seedWorldFixture();
  page.on("pageerror", (error) => report.errors.push(String(error)));
  await page.evaluateOnNewDocument(installProbe);
  const throttle = await throttleNetwork(page);
  report.network = {
    ...throttle.conditions,
    httpCacheDisabled: true,
    persistentCacheInitiallyEmpty: true,
    scope:
      "Page-target emulation; service-worker-originated fetches are not throttled",
  };
  await coldLoad();
  await movement();
  await livePerformance();
  const available = (await snapshot()).maps;
  const maps = selectedBrowserMaps(available);
  report.browserMapCoverage = {
    selected: maps,
    packagedCount: available.length,
  };
  for (const id of maps) if (id !== "100000000") await transition(id);
  await transition("100000000");
  await geometryPreviews();
  await deterministicPhysics();
  check("No unhandled browser exceptions", report.errors.length === 0, {
    errors: report.errors,
  });
  report.status = report.checks.every((item) => item.pass)
    ? "browser-checks-pass"
    : "failed";
  report.correctnessStatus = report.status;
}
try {
  await run();
} catch (error) {
  report.status = "failed";
  report.errors.push(error.stack ?? String(error));
  if (page) {
    await page
      .screenshot({ path: join(output, "failure-page.png") })
      .catch((captureError) => report.errors.push(String(captureError)));
  }
} finally {
  report.finishedAt = new Date().toISOString();
  await Bun.write(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
}
console.log(
  JSON.stringify(
    {
      status: report.status,
      checks: report.checks.length,
      failures: report.checks.filter((item) => !item.pass),
      errors: report.errors,
      report: join(output, "report.json"),
    },
    null,
    2,
  ),
);
if (report.status !== "browser-checks-pass") process.exitCode = 1;
