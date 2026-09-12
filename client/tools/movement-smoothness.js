import puppeteer from "puppeteer-core";
import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { statistics } from "./validation-metrics.js";
import { clickLabel, focusCanvas, TIMEOUT } from "./scenarios/native.js";

const DEFAULT_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** Bounds page-side sampler memory; ~6 minutes at 60 Hz, never silently truncated. */
const SAMPLE_CAPACITY = 24000;
/** Velocity ramp-up, input lead and release frames are excluded from the steady window. */
const LEAD_MS = 400;
const TAIL_MS = 200;
/** Presentation movement at or below this per frame counts as a held-frame stall. */
const STALL_PX = 0.02;
/** Authoritative movement within this trailing window gates stall/jerk inclusion. */
const KERNEL_GATE_MS = 100;
const KERNEL_GATE_PX = 2;
/** A character lease can outlive an abruptly closed browser until its heartbeat times out. */
const ENTER_ATTEMPTS = 16;
const ENTER_RETRY_MS = 2500;
const MAX_SECONDS = 30;

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "offline" },
    url: { type: "string" },
    account: { type: "string" },
    password: { type: "string" },
    chrome: { type: "string", default: DEFAULT_CHROME },
    output: { type: "string" },
    seconds: { type: "string", default: "4" },
    key: { type: "string", default: "ArrowRight" },
    headed: { type: "boolean", default: false },
  },
});
if (!["offline", "online"].includes(values.mode)) {
  throw new Error("--mode must be offline or online");
}
const seconds = Number(values.seconds);
if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_SECONDS) {
  throw new Error(`--seconds must be 0–${MAX_SECONDS}, exclusive of zero`);
}
const url =
  values.url ?? `http://127.0.0.1:${values.mode === "online" ? 3102 : 3100}`;
if (values.mode === "online" && (!values.account || !values.password)) {
  throw new Error("--account and --password are required in online mode");
}
const output = resolve(
  values.output ?? join("artifacts", "movement-smoothness", values.mode),
);
await mkdir(output, { recursive: true });

const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  status: "running",
  scope:
    "Presented local-player movement smoothness in a real browser; not original Windows parity and not a frame-rate claim",
  mode: values.mode,
  url,
  key: values.key,
  holdMs: seconds * 1000,
  checks: [],
  errors: [],
};
let browser = null;
let page = null;

function check(name, pass, details = {}) {
  report.checks.push({ name, pass: Boolean(pass), ...details });
}

/** Real rAF cadence and presented pose; no synthetic stepping and no rendering shortcut. */
function startSampling(capacity) {
  const sampler = {
    capacity,
    count: 0,
    overflow: 0,
    running: true,
    handle: 0,
    time: new Float64Array(capacity),
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    cameraX: new Float64Array(capacity),
    cameraY: new Float64Array(capacity),
    kernelX: new Float64Array(capacity),
    kernelY: new Float64Array(capacity),
    kernelPreviousX: new Float64Array(capacity),
    predictedTick: new Float64Array(capacity),
    arrivalTick: new Float64Array(capacity),
    serverTick: new Float64Array(capacity),
    sampleMs: new Float64Array(capacity),
  };
  window.__mapleMotion = sampler;
  function frame(now) {
    if (!sampler.running) return;
    if (sampler.count < sampler.capacity) {
      const index = sampler.count;
      const start = performance.now();
      const state = window.maple.snapshot();
      sampler.sampleMs[index] = performance.now() - start;
      sampler.time[index] = now;
      sampler.x[index] = state.presentation.x;
      sampler.y[index] = state.presentation.y;
      sampler.cameraX[index] = state.camera.x;
      sampler.cameraY[index] = state.camera.y;
      const simulation = state.simulation;
      sampler.kernelX[index] = simulation ? simulation.x : 0;
      sampler.kernelY[index] = simulation ? simulation.y : 0;
      sampler.kernelPreviousX[index] = simulation ? simulation.previousX : 0;
      const prediction = state.prediction;
      sampler.predictedTick[index] = prediction ? prediction.predictedTick : 0;
      sampler.arrivalTick[index] = prediction ? prediction.arrivalTick : 0;
      sampler.serverTick[index] = prediction ? prediction.serverTick : 0;
      sampler.count++;
    } else sampler.overflow++;
    sampler.handle = requestAnimationFrame(frame);
  }
  sampler.handle = requestAnimationFrame(frame);
}

function stopSampling() {
  const sampler = window.__mapleMotion;
  sampler.running = false;
  cancelAnimationFrame(sampler.handle);
  const copy = (array) => Array.from(array.subarray(0, sampler.count));
  const result = {
    count: sampler.count,
    overflow: sampler.overflow,
    time: copy(sampler.time),
    x: copy(sampler.x),
    y: copy(sampler.y),
    cameraX: copy(sampler.cameraX),
    cameraY: copy(sampler.cameraY),
    kernelX: copy(sampler.kernelX),
    kernelY: copy(sampler.kernelY),
    kernelPreviousX: copy(sampler.kernelPreviousX),
    predictedTick: copy(sampler.predictedTick),
    arrivalTick: copy(sampler.arrivalTick),
    serverTick: copy(sampler.serverTick),
    sampleMs: copy(sampler.sampleMs),
  };
  delete window.__mapleMotion;
  return result;
}

const delay = (milliseconds) =>
  new Promise((done) => {
    setTimeout(done, milliseconds);
  });

async function signIn(target, { account, password }) {
  await target.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
  await target.waitForSelector('.online-login [name="name"]', {
    visible: true,
    timeout: TIMEOUT,
  });
  await target.type('.online-login [name="name"]', account);
  await target.type('.online-login [name="password"]', password);
  await target.click(".online-login-submit");
  await target.waitForFunction(
    () => {
      const stage = document.querySelector(
        '.online-login[data-stage="characters"] .online-login-characters',
      );
      const enter = stage?.querySelector(".online-login-enter");
      return Boolean(
        stage?.querySelector(".online-login-card") &&
        enter &&
        !enter.disabled &&
        stage.querySelectorAll(".online-login-dot").length > 0,
      );
    },
    { timeout: TIMEOUT },
  );
  await enterWorld(target);
}

/** A character can still hold its writer lease after the previous browser closed. */
async function enterWorld(target) {
  for (let attempt = 0; attempt < ENTER_ATTEMPTS; attempt++) {
    if (await target.evaluate(ready, true)) return;
    const characters = await target.evaluate(() =>
      Boolean(
        document.querySelector(
          '.online-login[data-stage="characters"] .online-login-characters',
        ),
      ),
    );
    if (characters) {
      await target.click(".online-login-dot");
      await clickLabel(target, "Enter the world", ".online-login");
    }
    await delay(ENTER_RETRY_MS);
  }
  throw new Error("Entering the world did not reach an active session");
}

/** A field install can throw from snapshot(); a readiness probe must report
 * "not ready" instead of failing its wait or reaching the client's error reporter. */
function ready(online) {
  try {
    const state = window.maple?.snapshot();
    if (!state?.currentMap || state.loading || state.pendingLoads !== 0) {
      return false;
    }
    return online ? state.online?.status === "active" : true;
  } catch {
    return false;
  }
}

async function offlineReady(target) {
  await target.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
  await target.waitForFunction(ready, { timeout: 300000 }, false);
}

async function showField(target) {
  const consoleHidden = await target.$eval(
    "#gm-console",
    (node) => node.hidden,
  );
  if (!consoleHidden) await target.click("#console-toggle");
  await target.waitForFunction(
    () => document.querySelector("#gm-console").hidden,
    { timeout: TIMEOUT },
  );
  await focusCanvas(target);
}

/** Deltas of one axis over the steady window; stalls and jerk are what a player sees. */
function axisMetrics(time, values, from, to) {
  const deltas = [];
  const intervals = [];
  for (let index = from; index < to; index++) {
    const dt = time[index + 1] - time[index];
    deltas.push(values[index + 1] - values[index]);
    intervals.push(dt);
  }
  const distance = deltas.reduce((sum, value) => sum + Math.abs(value), 0);
  const elapsed = intervals.reduce((sum, value) => sum + value, 0);
  let jerk = 0;
  let stalls = 0;
  for (let index = 0; index < deltas.length; index++) {
    if (Math.abs(deltas[index]) <= STALL_PX) stalls++;
    if (index > 0) jerk += Math.abs(deltas[index] - deltas[index - 1]);
  }
  const mean = deltas.length ? distance / deltas.length : 0;
  return {
    metrics: {
      frames: deltas.length,
      pixels: distance,
      meanPxPerFrame: mean,
      pixelsPerSecond: elapsed > 0 ? distance / (elapsed / 1000) : null,
      stallRatio: deltas.length ? stalls / deltas.length : null,
      jerkRatio: mean > 0 ? jerk / (deltas.length - 1) / mean : null,
      intervals: statistics(intervals),
      deltas: statistics(deltas.map(Math.abs)),
    },
    deltas,
  };
}

function windowBounds(samples, downAt, upAt) {
  const from = samples.time.findIndex((value) => value >= downAt + LEAD_MS);
  if (from < 0 || from >= samples.time.length - 1) {
    throw new Error("No sampled frame inside the held-key window");
  }
  let to = samples.time.length - 2;
  while (to > from && samples.time[to + 1] > upAt - TAIL_MS) to--;
  if (to <= from) throw new Error("Held-key window is shorter than the lead");
  return { from, to };
}

/** Presented faults only while the authoritative kernel moved; a blocked character
 * (terrain, foothold edge, deceleration after release) is not a presentation stall.
 * The same gate selects frames for both series, so the raw-kernel comparison is exact. */
function motionMetrics(samples, from, to, series) {
  const deltas = [];
  const intervals = [];
  let stalls = 0;
  let jerk = 0;
  let distance = 0;
  let elapsed = 0;
  let previous = null;
  for (let index = from + 1; index <= to; index++) {
    const start = samples.time[index] - KERNEL_GATE_MS;
    let back = index - 1;
    while (back > 0 && samples.time[back] > start) back--;
    const kernelDistance = Math.hypot(
      samples.kernelX[index] - samples.kernelX[back],
      samples.kernelY[index] - samples.kernelY[back],
    );
    if (!(kernelDistance > KERNEL_GATE_PX)) continue;
    const delta = Math.hypot(
      series.x[index] - series.x[index - 1],
      series.y[index] - series.y[index - 1],
    );
    const interval = samples.time[index] - samples.time[index - 1];
    if (Math.abs(delta) <= STALL_PX) stalls++;
    if (previous !== null) jerk += Math.abs(delta - previous);
    previous = delta;
    deltas.push(delta);
    intervals.push(interval);
    distance += Math.abs(delta);
    elapsed += interval;
  }
  const mean = deltas.length ? distance / deltas.length : 0;
  return {
    frames: deltas.length,
    pixels: distance,
    meanPxPerFrame: mean,
    pixelsPerSecond: elapsed > 0 ? distance / (elapsed / 1000) : null,
    stallRatio: deltas.length ? stalls / deltas.length : null,
    jerkRatio:
      mean > 0 && deltas.length > 1 ? jerk / (deltas.length - 1) / mean : null,
    deltas: statistics(deltas.map(Math.abs)),
    intervals: statistics(intervals),
  };
}

function analyze(samples, downAt, upAt) {
  const { from, to } = windowBounds(samples, downAt, upAt);
  const horizontal = axisMetrics(samples.time, samples.x, from, to);
  const vertical = axisMetrics(samples.time, samples.y, from, to);
  const camera = axisMetrics(samples.time, samples.cameraX, from, to);
  return {
    window: {
      fromIndex: from,
      toIndex: to,
      fromMs: samples.time[from],
      toMs: samples.time[to],
    },
    scope: `Frames whose kernel advanced more than ${KERNEL_GATE_PX}px within ${KERNEL_GATE_MS}ms; blocked or decelerating frames are excluded`,
    motion: motionMetrics(samples, from, to, { x: samples.x, y: samples.y }),
    rawKernelMotion: motionMetrics(samples, from, to, {
      x: samples.kernelX,
      y: samples.kernelY,
    }),
    horizontal: horizontal.metrics,
    vertical: vertical.metrics,
    camera: camera.metrics,
    deltas: horizontal.deltas,
    sampleMs: statistics(samples.sampleMs),
    sampledFrames: samples.count,
    samplerOverflow: samples.overflow,
  };
}

async function identity(target, mode) {
  return target.evaluate((clientMode) => {
    const state = window.maple.snapshot();
    const base = {
      sourceBuildId: state.sourceBuildId,
      buildId: state.buildId,
      currentMap: state.currentMap,
      lastError: state.lastError,
      presentation: { ...state.presentation },
    };
    if (clientMode !== "online") return base;
    const online = window.mapleOnline.snapshot();
    return {
      ...base,
      online: {
        status: online.status,
        roundTripMs: online.roundTripMs,
        oneWayMs: online.oneWayMs,
        tickOffsetMs: online.tickOffsetMs,
        serverTick: online.serverTick,
        inputSeq: online.inputSeq,
        ackInputSeq: online.ackInputSeq,
        prediction: { ...online.prediction },
      },
    };
  }, mode);
}

/** Real keyboard hold over the presented frames; nothing is stepped by the tool. */
async function captureHold() {
  report.stage = "sampling";
  await delay(500);
  await page.evaluate(startSampling, SAMPLE_CAPACITY);
  const downAt = await page.evaluate(() => performance.now());
  await page.keyboard.down(values.key);
  await delay(seconds * 1000);
  await page.keyboard.up(values.key);
  const upAt = await page.evaluate(() => performance.now());
  const samples = await page.evaluate(stopSampling);
  if (samples.count < 8) throw new Error("Insufficient presented frames");
  return { samples, downAt, upAt };
}

function verify(analysis) {
  check(
    "Held real keyboard movement advanced the authoritative kernel",
    analysis.motion.pixels > 0 && analysis.motion.frames > 0,
    {
      presentedPixels: analysis.motion.pixels,
      movingFrames: analysis.motion.frames,
    },
  );
  check(
    "No presented frame exceeds the rAF sampler capacity",
    analysis.samplerOverflow === 0,
    { overflow: analysis.samplerOverflow },
  );
  if (values.mode === "online") {
    check(
      "Prediction reported no resync overflow during the measured window",
      report.after.online.prediction.overflows ===
        report.before.online.prediction.overflows,
      {
        before: report.before.online.prediction,
        after: report.after.online.prediction,
      },
    );
  }
  report.status = report.checks.every((item) => item.pass)
    ? "measured"
    : "failed";
}

function retainFrames(samples) {
  report.frames = samples.time.map((time, index) => ({
    t: Number(time.toFixed(3)),
    x: Number(samples.x[index].toFixed(4)),
    y: Number(samples.y[index].toFixed(4)),
    cameraX: samples.cameraX[index],
    cameraY: samples.cameraY[index],
    kernelX: samples.kernelX[index],
    kernelY: samples.kernelY[index],
    kernelPreviousX: samples.kernelPreviousX[index],
    predictedTick: samples.predictedTick[index],
    arrivalTick: samples.arrivalTick[index],
    serverTick: samples.serverTick[index],
  }));
}

async function measure() {
  if (values.mode === "online") {
    report.stage = "signIn";
    await signIn(page, values);
  } else {
    report.stage = "offlineReady";
    await offlineReady(page);
  }
  report.stage = "showField";
  await showField(page);
  report.stage = "identity";
  report.before = await identity(page, values.mode);
  report.environment = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
    hardwareConcurrency: navigator.hardwareConcurrency,
  }));
  const { samples, downAt, upAt } = await captureHold();
  report.stage = "analysis";
  report.after = await identity(page, values.mode);
  report.analysis = analyze(samples, downAt, upAt);
  retainFrames(samples);
  verify(report.analysis);
}

function summary() {
  const analysis = report.analysis;
  if (!analysis) {
    return {
      status: report.status,
      mode: report.mode,
      failure: report.failure ?? null,
      checks: report.checks.filter((item) => !item.pass),
      report: join(output, "report.json"),
    };
  }
  return {
    status: report.status,
    mode: report.mode,
    map: report.after?.currentMap ?? null,
    frames: analysis.sampledFrames,
    movingFrames: analysis.motion.frames,
    presentedPixelsPerSecond: analysis.motion.pixelsPerSecond,
    stallRatio: analysis.motion.stallRatio,
    jerkRatio: analysis.motion.jerkRatio,
    deltaP50: analysis.motion.deltas.p50,
    deltaP95: analysis.motion.deltas.p95,
    intervalP50: analysis.motion.intervals.p50,
    rawKernel: {
      stallRatio: analysis.rawKernelMotion.stallRatio,
      jerkRatio: analysis.rawKernelMotion.jerkRatio,
    },
    probeMsP50: analysis.sampleMs.p50,
    camera: {
      movingStallRatio: analysis.camera.stallRatio,
      movingJerkRatio: analysis.camera.jerkRatio,
    },
    prediction: report.after?.online?.prediction ?? null,
    errors: report.errors,
    checks: report.checks.filter((item) => !item.pass),
    report: join(output, "report.json"),
    framesFile: join(output, "frames.json"),
  };
}

try {
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
  page.on("pageerror", (error) => report.errors.push(String(error)));
  await measure();
} catch (error) {
  report.status = "failed";
  report.failure = {
    stage: report.stage ?? null,
    name: error.name,
    message: String(error.message ?? error),
  };
  if (page) {
    await page
      .screenshot({ path: join(output, "failure-page.png") })
      .catch(() => undefined);
  }
} finally {
  report.finishedAt = new Date().toISOString();
  if (report.frames) {
    await Bun.write(
      join(output, "frames.json"),
      JSON.stringify(report.frames) + "\n",
    );
    delete report.frames;
  }
  await Bun.write(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
}
console.log(
  JSON.stringify(
    report.status === "failed"
      ? { ...summary(), failure: report.failure }
      : summary(),
    null,
    2,
  ),
);
if (report.status === "failed") process.exitCode = 1;
