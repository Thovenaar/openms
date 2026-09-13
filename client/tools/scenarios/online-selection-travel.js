import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, measureStage } from "../native-evidence.js";
import { clickLabel, focusCanvas, openConsoleSection } from "./native.js";
import { onlineIdentity } from "./online-lifecycle.js";

const DESTINATION = "100010000";
const REJECTED_MAP = "100000000";
const TIMEOUT = 30000;
const MAX_EVENTS = 32;
// Original packet travel is gated for 500 ms, including tutorial responses.
const TRAVEL_RECOVERY_MS = 600;

/** Borrow a browser, own an isolated context and use a dedicated four-character developer fixture.
 * Covers only selection artwork, rejected/committed inspection travel and reconnect. */
export async function runOnlineSelectionTravel(options) {
  const { browser, url, output } = options;
  await mkdir(output, { recursive: true });
  const report = {
    status: "running",
    timings: {},
    transitions: [],
    checks: [],
  };
  report.identity = await measureStage(report.timings, "identity", () =>
    onlineIdentity(url, [DESTINATION, REJECTED_MAP]),
  );
  const context = await measureStage(report.timings, "browserAcquisition", () =>
    browser.createBrowserContext(),
  );
  const page = await context.newPage();
  const tools = { ...options, report, page };
  const wire = await recordTransitions(page, report);
  try {
    await measureStage(report.timings, "selection", () => selection(tools));
    await measureStage(report.timings, "travel", () => travel(tools));
    const finalIdentity = await onlineIdentity(url);
    assertion(
      finalIdentity.sourceBuildId === report.identity.sourceBuildId,
      "Source changed during replay",
    );
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = { message: error.message, stack: error.stack };
    report.observation = await observe(page);
    await page.screenshot({ path: join(output, "failure.png") });
  } finally {
    await wire.detach();
    await measureStage(report.timings, "teardown", async () => {
      try {
        await logout(page);
      } catch (error) {
        report.status = "fail";
        report.teardownError = error.message;
      } finally {
        await context.close();
      }
    });
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}

async function recordTransitions(page, report) {
  const wire = await page.createCDPSession();
  await wire.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await wire.send("Network.enable");
  wire.on("Network.webSocketFrameReceived", ({ response }) => {
    const message = JSON.parse(response.payloadData);
    if (!["transition", "closing"].includes(message.type)) return;
    assertion(
      report.transitions.length < MAX_EVENTS,
      "Transition evidence bound",
    );
    report.transitions.push({
      type: message.type,
      phase: message.phase,
      code: message.code,
    });
  });
  return wire;
}

async function observe(page) {
  return page.evaluate(() => {
    const state = window.maple.snapshot();
    return {
      sourceBuildId: state.sourceBuildId,
      login: state.login,
      online: state.online,
      mapId: state.currentMap,
      position: state.presentation,
      input: state.input,
      pendingWindows: state.ui?.pending,
      activeElement: document.activeElement?.tagName,
      error: state.lastError,
      errorLog: document.querySelector("#error")?.value.slice(0, 10000),
    };
  });
}

async function selection(tools) {
  const { page, account, password, report, url } = tools;
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
  await page.waitForFunction(() => window.maple?.snapshot().login?.artwork, {
    timeout: TIMEOUT,
  });
  await page.type('.online-login [name="name"]', account);
  await page.type('.online-login [name="password"]', password);
  await page.click(".online-login-submit");
  await page.waitForFunction(
    () => {
      const login = window.maple.snapshot().login;
      return (
        login.stage === "characters" &&
        login.portraits === 3 &&
        !login.transition.active
      );
    },
    { timeout: TIMEOUT },
  );
  report.before = await observe(page);
  assertion(
    report.before.sourceBuildId === report.identity.sourceBuildId,
    "Stale served source",
  );
  assertion(
    report.before.login.characters === 4,
    "Dedicated four-character fixture required",
  );
  await inspectSelection(tools);
}

async function inspectSelection(tools) {
  const { page, report, output } = tools;
  await clickLabel(page, "Pause animation", "#login-inspection");
  await page.click(".online-login-card:nth-child(2)");
  const before = await portraitPixels(page);
  for (let tick = 0; tick < 6; tick++) {
    await clickLabel(page, "Step 30 ms", "#login-inspection");
  }
  const after = await portraitPixels(page);
  assertion(
    before[1] !== after[1],
    "Selected avatar did not animate after 180 ms",
  );
  report.checks.push("Selected avatar renders changing original walk frames");
  report.layout = await selectionLayout(page);
  assertion(
    report.layout.portraits.every(
      (p, i) => p.x === 280 + i * 125 && p.y === 370,
    ),
    "Portrait feet differ from original anchors",
  );
  assertion(
    report.layout.info.x === 310 && report.layout.info.y === 160,
    "Information panel does not track selected slot",
  );
  await page.screenshot({ path: join(output, "selection.png") });
  await page.click(".online-login-next");
  await page.waitForFunction(
    () => window.maple.snapshot().login.portraits === 1,
    { timeout: TIMEOUT },
  );
  await page.setViewport({ width: 800, height: 600 });
  await page.click("#console-toggle");
  await page.screenshot({ path: join(output, "selection-800x600.png") });
  report.checks.push(
    "Fourth character is reachable; empty slots and layout captured at 800×600",
  );
  await page.setViewport({ width: 1280, height: 800 });
  await page.click("#console-toggle");
  await page.click(".online-login-previous");
  await clickLabel(page, "Resume animation", "#login-inspection");
  await page.click(".online-login-enter");
  await ready(page);
}

function portraitPixels(page) {
  return page.$$eval(".online-login-portrait canvas", (canvases) =>
    canvases.map((canvas) => canvas.toDataURL()),
  );
}

function selectionLayout(page) {
  return page.evaluate(() => {
    const root = document
      .querySelector(".online-login-window")
      .getBoundingClientRect();
    const info = document
      .querySelector(".online-login-character-detail")
      .getBoundingClientRect();
    return {
      info: { x: info.x - root.x, y: info.y - root.y },
      portraits: [...document.querySelectorAll(".online-login-portrait")].map(
        (node) => {
          const rect = node.getBoundingClientRect();
          return {
            x: rect.x + rect.width / 2 - root.x,
            y: rect.bottom - root.y,
          };
        },
      ),
    };
  });
}

async function ready(page, mapId = null) {
  await page.waitForFunction(
    (id) => {
      const state = window.maple.snapshot();
      return (
        state.online.status === "active" &&
        !state.loading &&
        state.ui?.ready &&
        state.ui.pending.length === 0 &&
        (id === null || state.currentMap === id)
      );
    },
    { timeout: TIMEOUT },
    mapId,
  );
}

async function requestMap(page, mapId) {
  await new Promise((resolve) => {
    setTimeout(resolve, TRAVEL_RECOVERY_MS);
  });
  await openConsoleSection(page, "world");
  if (!(await page.$eval("#map-selection", (node) => node.open))) {
    await page.click("#map-selection summary");
  }
  await page.select("#map", mapId);
  const button = await page.$("#map-go");
  await button.scrollIntoView();
  await page.waitForFunction(
    () => !document.querySelector("#map-go").disabled,
    { timeout: TIMEOUT },
  );
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/development"),
    { timeout: TIMEOUT },
  );
  await button.click({ delay: 50 });
  await button.dispose();
  const reply = await response;
  assertion(reply.ok(), `Development HTTP ${reply.status()}`);
  return reply.json();
}

async function rejectedTravel(tools) {
  const { page, report, url } = tools;
  const before = await observe(page);
  const rejectedUrl = new URL(report.identity.maps[REJECTED_MAP].url, url).href;
  const pending = [];
  const intercept = (request) => {
    const work =
      request.url() === rejectedUrl
        ? request.respond({
            status: 404,
            body: "Deliberate destination-load failure",
          })
        : request.continue();
    assertion(pending.length < 512, "Intercepted request bound");
    pending.push(work);
  };
  await page.setRequestInterception(true);
  page.on("request", intercept);
  try {
    report.rejected = await requestMap(page, REJECTED_MAP);
    assertion(
      report.rejected.status === "rejected",
      "Injected failure unexpectedly committed",
    );
    await ready(page, before.mapId);
    const after = await observe(page);
    assertion(
      after.online.connectionEpoch === before.online.connectionEpoch,
      "Rejected transfer disconnected the player",
    );
    report.checks.push(
      "Failed destination load restores the source map on the same connection",
    );
  } finally {
    page.off("request", intercept);
    await Promise.all(pending);
    await page.setRequestInterception(false);
  }
}

async function travel(tools) {
  const { page, report, output } = tools;
  await rejectedTravel(tools);
  const before = await observe(page);
  report.receipt = await requestMap(page, DESTINATION);
  assertion(
    report.receipt.status === "committed",
    "Inspection travel did not commit",
  );
  await ready(page, DESTINATION);
  report.arrival = await observe(page);
  assertion(
    report.arrival.online.connectionEpoch === before.online.connectionEpoch,
    "Committed transfer disconnected the player",
  );
  await moveAfterArrival(tools);
  await page.screenshot({ path: join(output, "arrival.png") });
  await openConsoleSection(page, "diagnostics");
  await clickLabel(page, "Reconnect session", "#state-testing-controls");
  await page.waitForFunction(
    (epoch) => window.maple.snapshot().online.connectionEpoch !== epoch,
    { timeout: TIMEOUT },
    before.online.connectionEpoch,
  );
  await ready(page, DESTINATION);
  report.reconnected = await observe(page);
  assertion(
    report.reconnected.online.characterId === before.online.characterId,
    "Reconnect changed character",
  );
  assertion(
    !report.transitions.some((entry) => entry.type === "closing"),
    "Authority closed the connection",
  );
  report.checks.push(
    "Map travel commits, movement resumes, and reconnect restores the destination",
  );
}

async function moveAfterArrival({ page, report }) {
  await page.waitForFunction(
    () => window.maple.snapshot().simulation?.state === "ground",
    { timeout: TIMEOUT },
  );
  await focusCanvas(page);
  await page.waitForFunction(
    () => document.activeElement === document.querySelector("#viewport canvas"),
    { timeout: TIMEOUT },
  );
  await page.keyboard.down("ArrowRight");
  try {
    await page.waitForFunction(
      (x) => window.maple.snapshot().presentation.x > x + 5,
      { timeout: TIMEOUT },
      report.arrival.position.x,
    );
    report.moved = await observe(page);
  } finally {
    await page.keyboard.up("ArrowRight");
  }
}

/** Retire only the supplied fixture session; shared browser/server owners remain alive. */
async function logout(page) {
  await page.evaluate(async () => {
    const config = await (await fetch("/api/v1/config")).json();
    const response = await fetch("/api/v1/session", {
      method: "DELETE",
      headers: { "x-csrf-token": config.csrfToken },
    });
    if (!response.ok && response.status !== 401) {
      throw new Error(`Fixture logout HTTP ${response.status}`);
    }
  });
}
