import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { participant, closeConsole, ready } from "./online-ui-repairs.js";
import { clickLabel } from "./native.js";

const DIALOG = '.maple-ui-panel[aria-label="UtilDlgEx"]';

/** Native login/NPC/jump input, with read-only geometry, wire and output PCM evidence. */
export async function runOnlineEntryRepairs({ browser, url, output }) {
  await mkdir(output, { recursive: true });
  const report = {
    status: "running",
    timings: {},
    checks: [],
    results: [],
    errors: [],
  };
  const contexts = [],
    pages = [];
  try {
    report.identity = await onlineIdentity(url);
    const page = await participant(browser, contexts, pages, report);
    await measureStage(report.timings, "login", () =>
      signIn(page, url, "entry"),
    );
    await measureStage(report.timings, "selection", () =>
      selection(page, output, report),
    );
    await page.click(".online-login-enter");
    await ready(page);
    await measureStage(report.timings, "empty-npc", () =>
      emptyNpc(page, report),
    );
    await measureStage(report.timings, "jump-audio", () =>
      jumpAudio(page, report),
    );
    await measureStage(report.timings, "air-attack", () =>
      airAttack(page, report),
    );
    const other = await participant(browser, contexts, pages, report);
    await signIn(other, url, "unavailable");
    await other.click(".online-login-enter");
    await ready(other);
    await measureStage(report.timings, "unavailable-npc", () =>
      unavailableNpc(other, output, report),
    );
    await verifyBrowser(pages, url, report);
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
    for (const [index, page] of pages.entries()) {
      await page.screenshot({ path: join(output, `failure-${index}.png`) });
      report.errors.push(await page.$eval("#error", (node) => node.value));
    }
  } finally {
    await measureStage(report.timings, "teardown", async () => {
      for (const context of contexts) await context.close();
    });
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}

async function verifyBrowser(pages, url, report) {
  for (const current of pages) {
    assertion(
      !(await current.$eval("#error", (node) => node.value)),
      "Game error journal is not empty",
    );
  }
  assertion(
    report.errors.length === 0,
    "Unexpected browser errors",
    report.errors,
  );
  assertion(
    (await onlineIdentity(url)).sourceBuildId === report.identity.sourceBuildId,
    "Source changed during replay",
  );
}

async function signIn(page, url, account) {
  await page.goto(url);
  await page.bringToFront();
  await page.waitForFunction(() => window.maple?.snapshot().login?.artwork);
  await closeConsole(page);
  await page.type('[name="name"]', account);
  await page.type('[name="password"]', "password");
  await traceTransition(page);
  await page.click(".online-login-submit");
  await stage(page, "characters");
}

function stage(page, expected) {
  return page.waitForFunction(
    (name) => {
      const login = window.maple.snapshot().login;
      return login.stage === name && !login.transition.active;
    },
    {},
    expected,
  );
}

function traceTransition(page) {
  return page.evaluate(() => {
    const started = performance.now();
    window.entryTransitionFrames = [];
    const sample = () => {
      const login = window.maple.snapshot().login;
      if (login.transition.active) {
        window.entryTransitionFrames.push({
          camera: login.camera,
          transition: login.transition,
        });
      }
      if (performance.now() - started < 2000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function selection(page, output, report) {
  report.transition = await page.evaluate(() => window.entryTransitionFrames);
  assertion(
    report.transition.length > 1 &&
      report.transition.every((frame) => frame.camera.y === -1508),
    "Login traversed an intermediate world camera",
  );
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 800, height: 600 },
  ]) {
    await page.setViewport(viewport);
    for (const slot of [0, 1, 2]) {
      await (await page.$$(".online-login-card"))[slot].click();
      await page.waitForFunction(
        (index) => {
          const light = window.maple.snapshot().login.spotlight;
          return light.beam.x === 280 + 125 * index && light.beam.frame === 4;
        },
        {},
        slot,
      );
      await page.screenshot({
        path: join(output, `selection-${viewport.width}-${slot}.png`),
      });
    }
  }
  await page.click(".online-login-new");
  await stage(page, "create");
  await page.screenshot({ path: join(output, "creation.png") });
  await page.click(".online-login-back");
  await stage(page, "characters");
  await (await page.$$(".online-login-card"))[0].click();
  await page.setViewport({ width: 1280, height: 800 });
  report.checks.push(
    "Direct account-to-selection scroll; three spotlight slots at 1280×800 and 800×600; creation/back navigation",
  );
}

async function clickNpc(page, id) {
  const point = await page.evaluate((templateId) => {
    const npc = window.mapleOnline
      .observation()
      .entities.find(
        (entry) => entry.kind === "npc" && entry.templateId === templateId,
      );
    const projected = window.mapleOnline.project(
      npc.position.x,
      npc.position.y - 20,
    );
    const bounds = document
      .querySelector("#viewport canvas")
      .getBoundingClientRect();
    return { x: bounds.left + projected.x, y: bounds.top + projected.y };
  }, id);
  await page.mouse.click(point.x, point.y);
}

async function emptyNpc(page, report) {
  const before = report.results.length;
  await clickNpc(page, 1010100);
  await page.waitForFunction(() => !window.maple.snapshot().loading);
  // A bounded native frame wait gives the asynchronous receipt observer time to run.
  await page.waitForFunction(
    () => !window.maple.snapshot().ui?.pending?.length,
  );
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        setTimeout(resolve, 250);
      }),
  );
  assertion(
    report.results
      .slice(before)
      .some((result) => result.status === "committed"),
    "Empty NPC click had no successful receipt",
    report.results.slice(before),
  );
  assertion(
    !(await page.$(DIALOG)),
    "Empty NPC opened a fabricated conversation",
  );
  report.checks.push(
    "Rina without available quests is a successful no-op, not CONTENT_MISMATCH",
  );
}

function capture(page, seconds) {
  return page.evaluate(async (duration) => {
    const metrics = await window.maple.captureAudio(duration);
    return {
      frames: metrics.frames,
      sampleRate: metrics.sampleRate,
      audible: metrics.audible,
      rms: metrics.rms,
      peak: metrics.peak,
      sha256: metrics.sha256,
    };
  }, seconds);
}

async function jumpAudio(page, report) {
  await page.waitForFunction(() => {
    const audio = window.maple.snapshot().audio;
    return (
      audio.state === "running" && audio.pending === 0 && audio.voices <= 1
    );
  });
  report.audioSettings = await page.evaluate(
    () => window.maple.snapshot().audio.settings,
  );
  report.silent = await capture(page, 0.3);
  const sound = capture(page, 1);
  await page.keyboard.down("Alt");
  await page.waitForFunction(() => window.maple.snapshot().simulation.vy < 0);
  await page.keyboard.up("Alt");
  report.jumpAudio = await sound;
  assertion(
    !report.silent.audible && report.jumpAudio.audible,
    "Jump failed to produce isolated SE output",
    { silent: report.silent, jump: report.jumpAudio },
  );
  await page.waitForFunction(
    () => window.maple.snapshot().simulation.state === "ground",
  );
  report.checks.push(
    "A server-accepted native jump produces audible PCM with BGM muted",
  );
}

async function airAttack(page, report) {
  const trace = page.evaluate(
    () =>
      new Promise((resolve) => {
        const frames = [],
          started = performance.now();
        const sample = () => {
          const state = window.maple.snapshot();
          frames.push({
            simulation: state.simulation,
            presentation: state.presentation,
          });
          if (performance.now() - started < 1400) requestAnimationFrame(sample);
          else resolve(frames);
        };
        requestAnimationFrame(sample);
      }),
  );
  await page.keyboard.down("Alt");
  await page.waitForFunction(
    () => window.maple.snapshot().simulation.vy < -150,
  );
  await page.keyboard.up("Alt");
  // Held attack is sampled by the server's 30ms clock, not by a keypress edge.
  await page.keyboard.press("ControlLeft", { delay: 120 });
  const frames = await trace;
  const locked = frames.filter(
    ({ simulation }) => simulation.movementLocked && simulation.state === "air",
  );
  assertion(locked.length > 2, "No authoritative midair attack observed");
  const drift = locked.map(({ simulation: sim, presentation: pose }) =>
    Math.max(
      0,
      Math.min(sim.y, sim.previousY) - pose.y,
      pose.y - Math.max(sim.y, sim.previousY),
    ),
  );
  assertion(
    drift.every((value) => value <= 1),
    "Attack switched away from continuous predicted motion",
    drift,
  );
  report.airAttack = {
    frames: frames.length,
    lockedFrames: locked.length,
    maximumDrift: Math.max(...drift),
  };
  report.checks.push(
    "Native jump-then-attack keeps presentation inside current predicted motion through the server action lock",
  );
}

async function unavailableNpc(page, output, report) {
  await clickNpc(page, 9209000);
  await page.waitForSelector(`${DIALOG} [aria-label="Native NPC dialogue"]`, {
    visible: true,
  });
  assertion(
    (await page.$eval(DIALOG, (node) => node.textContent)).includes(
      "Service unavailable",
    ),
    "Missing service availability notice",
  );
  await page.screenshot({ path: join(output, "unavailable-service.png") });
  await clickLabel(page, "Close dialogue", DIALOG);
  await page.waitForSelector(DIALOG, { hidden: true });
  report.checks.push(
    "Abdula's unavailable service is explained and End Chat closes it without CONTENT_MISMATCH",
  );
}
