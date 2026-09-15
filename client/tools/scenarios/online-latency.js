import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { closeConsole } from "./online-ui-repairs.js";
import { clickLabel, focusCanvas, openConsoleSection } from "./native.js";

const DIALOG = '.maple-ui-panel[aria-label="UtilDlgEx"]';
const NATIVE = `${DIALOG} [aria-label="Native NPC dialogue"]`;
const TIMEOUT = 120000;

/** Native inputs and observed server state over a real delayed HTTP/WebSocket relay. */
export async function runOnlineLatency({
  browser,
  url,
  output,
  network,
  disconnect,
}) {
  await mkdir(output, { recursive: true });
  const report = {
    status: "running",
    timings: {},
    checks: [],
    errors: [],
    proseRequests: 0,
  };
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const holds = { paths: new Set(), request: null, started: null };
  page.setDefaultTimeout(TIMEOUT);
  try {
    await disablePersistentCache(page);
    report.identity = await measureStage(report.timings, "identity", () =>
      onlineIdentity(url, ["100000000", "104000000"]),
    );
    await page.setViewport({ width: 1280, height: 800 });
    await page.bringToFront();
    page.on("pageerror", (error) => {
      if (report.errors.length < 32) report.errors.push(error.message);
    });
    await intercept(page, holds, report);
    holds.paths.add(new URL(report.identity.maps["100000000"].url, url).href);
    await measureStage(report.timings, "login", () => login(page, url));
    const tools = { page, holds, report, network, disconnect, url };
    await measureStage(report.timings, "coldEntryAndReconnect", () =>
      coldEntry(tools),
    );
    await measureStage(report.timings, "walkingAndStall", () => walking(tools));
    await measureStage(report.timings, "dialogueAndColdTravel", () =>
      travel(tools),
    );
    await measureStage(report.timings, "reconnect", () => reconnect(page));
    await verify(page, url, network, report);
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = { message: error.message, stack: error.stack };
    report.observation = await observe(page).catch((error) => ({
      error: error.message,
    }));
    await page.screenshot({ path: join(output, "failure.png") });
  } finally {
    await measureStage(report.timings, "teardown", () => context.close());
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}
/** Exercise cold asset deadlines even when normal startup preloads these maps. */
async function disablePersistentCache(page) {
  await page.evaluateOnNewDocument(() => {
    globalThis.caches.open = async () => {
      throw new DOMException(
        "Latency fixture disables persistent cache",
        "SecurityError",
      );
    };
  });
}
async function verify(page, url, network, report) {
  assertion(
    (await observe(page)).meso === 1900,
    "Committed fare survives reconnect",
  );
  assertion(
    report.proseRequests === 0,
    "Ordinary dialogue made a second HTTP request",
  );
  assertion(report.errors.length === 0, "Browser errors", report.errors);
  assertion(
    (await onlineIdentity(url)).sourceBuildId === report.identity.sourceBuildId,
    "Source changed during check",
  );
  report.network = {
    roundTripMs: network.roundTripMs,
    httpRequests: network.httpRequests,
    frames: network.frames,
  };
}
async function intercept(page, holds, report) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/content/")) report.proseRequests++;
    if (holds.paths.delete(request.url())) {
      holds.request = request;
      holds.started?.resolve();
    } else {
      request.continue().catch((error) => {
        report.errors.push(error.message);
      });
    }
  });
}
async function login(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.maple?.snapshot().login?.artwork);
  await closeConsole(page);
  await page.type('[name="name"]', "latency");
  await page.type('[name="password"]', "password");
  await page.click(".online-login-submit");
  await page.waitForFunction(() => {
    const login = window.maple.snapshot().login;
    return login.stage === "characters" && !login.transition.active;
  });
}
export async function ready(page) {
  await page.waitForFunction(() => {
    const state = window.maple?.snapshot();
    return (
      state?.online.status === "active" &&
      !state.loading &&
      state.prediction.ready
    );
  });
}
export function observe(page) {
  return page.evaluate(() => {
    const state = window.maple.snapshot();
    const model = window.mapleOnline.observation();
    return {
      status: state.online.status,
      epoch: state.online.connectionEpoch,
      x: model?.self.entity.position.x,
      localX: state.simulation?.x,
      input: state.input,
      map: model?.field.mapId,
      meso: model?.inventory.mesos,
      error: state.lastError,
      timing: state.online.timing,
      prediction: state.prediction,
      loading: state.loading,
    };
  });
}
async function coldEntry({ page, holds, report, disconnect }) {
  holds.started = Promise.withResolvers();
  await page.click(".online-login-enter");
  await waitForHold(holds);
  const before = await observe(page);
  await Bun.sleep(20000);
  const waiting = await observe(page);
  assertion(
    waiting.epoch === before.epoch && waiting.status === "synchronizing",
    "A 20-second map load disconnected its socket",
    waiting,
  );
  report.checks.push(
    "Initial map download can exceed the connection deadline without disconnecting",
  );
  disconnect();
  await holds.request.continue();
  holds.request = null;
  await page.waitForFunction(
    () =>
      window.maple.snapshot().online.status === "disconnected" &&
      !document.querySelector(".online-login-enter").disabled,
  );
  await clickLabel(page, "OK", '.online-dialog[role="dialog"]');
  await page.click(".online-login-enter");
  await ready(page);
  const after = await observe(page);
  assertion(
    after.epoch !== before.epoch,
    "Entry did not resume on a fresh connection",
  );
  report.checks.push(
    "Disconnect during initial map loading resumes the same character without CHARACTER_BUSY",
  );
}
export async function walking({ page, network, report }) {
  await focusCanvas(page);
  const before = await observe(page);
  const serverBefore = network.lastMotion;
  assertion(serverBefore, "Entry did not publish a motion checkpoint");
  await page.keyboard.down("ArrowLeft");
  await Bun.sleep(1000);
  network.stall(1500);
  await Bun.sleep(3500);
  await page.keyboard.up("ArrowLeft");
  await Bun.sleep(750);
  const after = await observe(page);
  const serverAfter = network.lastMotion;
  report.movement = { before, after, serverBefore, serverAfter };
  assertion(
    after.epoch === before.epoch && after.status === "active",
    "Walking/stalled traffic disconnected",
    after,
  );
  assertion(
    Math.abs(serverAfter.motion.x - serverBefore.motion.x) > 10,
    "Server did not observe native movement",
    { before, after },
  );
  await page.keyboard.down("ArrowRight");
  await page.keyboard.press("Alt");
  await Bun.sleep(2500);
  await page.keyboard.up("ArrowRight");
  report.movement.recovered = await observe(page);
  report.checks.push(
    "Native walking survives 500ms RTT and a 1.5-second delivery stall with server-observed movement",
  );
}
async function cab(page) {
  const point = await page.evaluate(() => {
    const npc = window.mapleOnline
      .observation()
      .entities.find(
        (entity) => entity.kind === "npc" && entity.templateId === 1012000,
      );
    const point = window.mapleOnline.project(
      npc.position.x,
      npc.position.y - 20,
    );
    const rect = document
      .querySelector("#viewport canvas")
      .getBoundingClientRect();
    return { x: point.x + rect.left, y: point.y + rect.top };
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(
    (selector) =>
      document
        .querySelector(selector)
        ?.textContent.includes("Hello, I drive the Regular Cab."),
    {},
    NATIVE,
  );
}
async function travel({ page, holds, report, url }) {
  await cab(page);
  const started = performance.now();
  await clickLabel(page, "Next", NATIVE);
  await page.waitForSelector(`${NATIVE} [data-quest-choice="0"]`, {
    visible: true,
  });
  report.npcNextMs = performance.now() - started;
  await page.click(`${NATIVE} [data-quest-choice="0"]`);
  await page.waitForSelector(`${NATIVE} [aria-label="Yes"]`, { visible: true });
  holds.paths.add(new URL(report.identity.maps["104000000"].url, url).href);
  holds.started = Promise.withResolvers();
  await clickLabel(page, "Yes", NATIVE);
  await waitForHold(holds);
  const before = await observe(page);
  await Bun.sleep(20000);
  const waiting = await observe(page);
  assertion(
    waiting.epoch === before.epoch && waiting.meso === 2000,
    "Slow travel disconnected or charged before preparation",
    waiting,
  );
  await holds.request.continue();
  holds.request = null;
  await ready(page);
  const after = await observe(page);
  assertion(
    after.map === 104000000 && after.meso === 1900,
    "Cab travel did not commit once",
    after,
  );
  report.checks.push(
    "NPC pages arrive inline; 20-second destination loading completes and charges the fare once",
  );
}
export async function reconnect(page) {
  const before = await observe(page);
  if (await page.$eval("#gm-console", (node) => node.hidden)) {
    await page.click("#console-toggle");
  }
  await openConsoleSection(page, "diagnostics");
  await clickLabel(page, "Reconnect session", "#state-testing-controls");
  await page.waitForFunction(
    (epoch) => window.maple.snapshot().online.connectionEpoch !== epoch,
    {},
    before.epoch,
  );
  await ready(page);
  await closeConsole(page);
}

async function waitForHold(holds) {
  let timer;
  try {
    await Promise.race([
      holds.started.promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Expected map download did not start")),
          TIMEOUT,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
