import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { participant } from "./online-ui-repairs.js";
import { login } from "./online-recycling-scrolls.js";
import {
  equipmentWindows,
  equipCycle,
} from "./online-character-corrections.js";
import { clickLabel } from "./native.js";

/** Delay only genuine asset transport; native inputs still own every gameplay outcome. */
export async function runLoadingReactorAudio({
  browser,
  url,
  output,
  fixtures,
}) {
  await mkdir(output, { recursive: true });
  const report = {
    status: "running",
    checks: [],
    results: [],
    errors: [],
    audio: [],
    timings: {},
  };
  const contexts = [],
    pages = [];
  try {
    report.identity = await onlineIdentity(url);
    for (const fixture of fixtures) {
      const page = await participant(browser, contexts, pages, report);
      await checkFixture(page, fixture, { url, output, report });
    }
    assertion(report.errors.length === 0, "Browser errors", report.errors);
    assertion(
      (await onlineIdentity(url)).sourceBuildId ===
        report.identity.sourceBuildId,
      "Source changed during validation",
    );
    report.checks.push(
      "Cold map preparation shows fullscreen loading; warm map re-entry never does",
      "Uncached reactor audio shows the corner spinner while field movement stays available",
    );
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
    for (const [index, page] of pages.entries()) {
      await page.screenshot({ path: join(output, `failure-${index}.png`) });
      report.errors.push(await page.$eval("#error", (node) => node.value));
    }
  } finally {
    for (const context of contexts) await context.close();
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}

async function checkFixture(page, fixture, { url, output, report }) {
  await watchLoading(page);
  const downloads = await intercept(page);
  await measureStage(report.timings, `${fixture.name}-entry`, () =>
    coldEntry(page, downloads, { fixture, url, output }),
  );
  await verifyServing(page, report);
  await measureStage(report.timings, `${fixture.name}-audio`, () =>
    reactorSound(page, downloads, { fixture, output, report }),
  );
  if (fixture.name === "boxaudio") await cachedEquipment(page, report);
  await measureStage(report.timings, `${fixture.name}-cached-entry`, () =>
    login(page, url, fixture.name),
  );
  await verifyServing(page, report);
  assertion(
    await page.evaluate(() => window.loadingEvidence.flashes === 0),
    "Cached map entry showed fullscreen loading",
  );
  assertion(
    !(await page.$eval("#error", (node) => node.value)),
    "Game error journal is not empty",
  );
}

async function verifyServing(page, report) {
  const identity = await page.evaluate(() => {
    const state = window.maple.snapshot();
    return { sourceBuildId: state.sourceBuildId, assetBuildId: state.buildId };
  });
  assertion(
    identity.sourceBuildId === report.identity.sourceBuildId &&
      identity.assetBuildId === report.identity.assetBuildId,
    "Served identity mismatch",
    identity,
  );
}

function watchLoading(page) {
  return page.evaluateOnNewDocument(() => {
    window.loadingEvidence = { flashes: 0 };
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.target.id === "delivery-startup" &&
          mutation.attributeName === "hidden" &&
          mutation.oldValue !== null &&
          !mutation.target.hidden
        ) {
          window.loadingEvidence.flashes++;
        }
      }
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
      attributeOldValue: true,
    });
  });
}

async function intercept(page) {
  const gate = { path: null, request: null, failure: null };
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (gate.path && request.url().endsWith(gate.path) && !gate.request) {
      gate.request = request;
    } else {
      request.continue().catch((error) => {
        if (!page.isClosed()) gate.failure = error;
      });
    }
  });
  return gate;
}

async function held(gate) {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (gate.failure) throw gate.failure;
    if (gate.request) return;
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  throw new Error(`Expected asset download did not arrive: ${gate.path}`);
}

async function release(gate) {
  const request = gate.request;
  gate.path = null;
  gate.request = null;
  await request.continue();
}

async function coldEntry(page, gate, { fixture, url, output }) {
  gate.path = fixture.map.url;
  const entering = login(page, url, fixture.name);
  entering.catch((error) => {
    gate.failure = error;
  });
  await held(gate);
  await page.waitForSelector("#delivery-startup", { visible: true });
  await page.screenshot({ path: join(output, `${fixture.name}-cold-map.png`) });
  await release(gate);
  await entering;
  await page.waitForSelector("#asset-loading", { hidden: true });
}

async function reactorSound(page, gate, { fixture, output, report }) {
  gate.path = fixture.sound.url;
  await page.keyboard.press("Control", { delay: 100 });
  await held(gate);
  await page.waitForFunction(
    (id) =>
      window.mapleOnline
        .observation()
        .entities.some(
          (row) =>
            row.reactor?.placementId === id && row.reactor.generation >= 1,
        ),
    {},
    fixture.placementId,
  );
  await page.waitForSelector("#asset-loading", { visible: true });
  assertion(
    await page.$eval("#delivery-startup", (node) => node.hidden),
    "Background audio covered the loaded map",
  );
  await cornerGeometry(page, fixture.name, output);
  await moveDuringDownload(page);
  // Wait until the weapon/UI voices finish; release the reactor MP3 into a silent mixer.
  await page.waitForFunction(() => window.maple.snapshot().audio.voices <= 1);
  await new Promise((resolve) => {
    setTimeout(resolve, 1200);
  });
  const capture = captureOutput(page);
  await release(gate);
  const { encoded, ...pcm } = await capture;
  await Bun.write(
    join(output, `${fixture.name}-stereo-f32.pcm`),
    Buffer.from(encoded, "base64"),
  );
  const sound = await page.evaluate(
    () => window.maple.snapshot().audio.lastSound,
  );
  assertion(
    sound?.sha256 === fixture.sound.sha256,
    "Reactor did not start its assigned original source",
    sound,
  );
  assertion(
    pcm.audible && pcm.rms > 0,
    "Isolated reactor output is silent",
    pcm,
  );
  report.audio.push({
    reactor: fixture.name,
    assignment: fixture.sound.assignment,
    source: sound.source,
    pcm,
  });
  await page.waitForSelector("#asset-loading", { hidden: true });
}

function captureOutput(page) {
  return page.evaluate(async () => {
    const result = await window.maple.captureAudio(2);
    const bytes = new Uint8Array(result.pcm);
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      chunks.push(
        String.fromCharCode(...bytes.subarray(offset, offset + 8192)),
      );
    }
    return {
      audible: result.audible,
      rms: result.rms,
      peak: result.peak,
      sha256: result.sha256,
      frames: result.frames,
      sampleRate: result.sampleRate,
      channels: result.channels,
      representation: result.representation,
      encoded: btoa(chunks.join("")),
    };
  });
}

async function moveDuringDownload(page) {
  const before = await page.evaluate(
    () => window.maple.snapshot().simulation.x,
  );
  await page.keyboard.down("ArrowRight");
  try {
    await page.waitForFunction(
      (x) => window.maple.snapshot().simulation.x > x + 3,
      {},
      before,
    );
  } finally {
    await page.keyboard.up("ArrowRight");
  }
}

async function cornerGeometry(page, name, output) {
  for (const viewport of [
    { width: 800, height: 600 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewport(viewport);
    const box = await page.$eval("#asset-loading", (node) => {
      const rect = node.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        pointer: getComputedStyle(node).pointerEvents,
      };
    });
    assertion(
      box.width === 20 &&
        box.height === 20 &&
        box.x > viewport.width - 40 &&
        box.y > viewport.height - 120 &&
        box.pointer === "none",
      "Loading indicator escaped the corner",
      box,
    );
    await page.screenshot({
      path: join(output, `${name}-spinner-${viewport.width}.png`),
    });
  }
}

async function cachedEquipment(page, report) {
  await equipmentWindows(page);
  const before = await page.evaluate(() => window.loadingEvidence.flashes);
  await equipCycle(page, report);
  const after = await page.evaluate(() => window.loadingEvidence.flashes);
  assertion(after === before, "Cached equipment covered the field");
  await clickLabel(page, "Close Item");
  await clickLabel(page, "Close Equip");
}
