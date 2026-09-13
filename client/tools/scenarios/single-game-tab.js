import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { clickLabel, openConsoleSection } from "./native.js";

const TIMEOUT = 30000;

/** Real same-profile Chrome tabs; caller owns the server, fixture account and browser. */
export async function runSingleGameTab({
  browser,
  url,
  output,
  credentials,
  offlineBundle,
}) {
  await mkdir(output, { recursive: true });
  const report = { status: "running", timings: {}, checks: [], errors: [] };
  const context = await browser.createBrowserContext();
  try {
    report.identity = await onlineIdentity(url);
    const tabs = await Promise.all([
      createTab(context, report),
      createTab(context, report),
    ]);
    const { owner, blocked } = await measureStage(report.timings, "race", () =>
      race(tabs, url, report),
    );
    await blocked.page.screenshot({ path: join(output, "second-tab.png") });
    await retry(blocked, "blocked");
    await assertBlocked(blocked);
    await owner.page.reload({ waitUntil: "domcontentloaded" });
    await gateState(owner.page, "active");
    await measureStage(report.timings, "play-reconnect", () =>
      playAndReconnect(owner.page, credentials, report),
    );
    await blocked.page.bringToFront();
    await retry(blocked, "blocked");
    await assertBlocked(blocked);
    await measureStage(report.timings, "handoff-history-close", () =>
      handoff(owner, blocked, report),
    );
    await measureStage(report.timings, "profile-and-unavailable", () =>
      isolatedProfile(browser, url, report),
    );
    await verifyOwner(owner.page, report);
    await offlineAdmission(context, { url, offlineBundle }, report);
    const after = await onlineIdentity(url);
    assertion(
      after.sourceBuildId === report.identity.sourceBuildId,
      "Source changed during tab check",
    );
    assertion(report.errors.length === 0, "Unexpected browser errors", {
      actual: report.errors,
    });
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
  } finally {
    await context.close();
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}

async function createTab(context, report) {
  const page = await context.newPage();
  await page.setViewport({ width: 800, height: 600 });
  const tab = { page, apiRequests: 0 };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) tab.apiRequests++;
  });
  page.on("pageerror", (error) => {
    if (report.errors.length < 24) report.errors.push(error.message);
  });
  return tab;
}

async function gateState(page, state) {
  await page.waitForFunction(
    (value) => document.body.dataset.gameTab === value,
    { timeout: TIMEOUT },
    state,
  );
}

async function race(tabs, url, report) {
  await Promise.all(
    tabs.map((tab) => tab.page.goto(url, { waitUntil: "domcontentloaded" })),
  );
  await Promise.all(
    tabs.map((tab) =>
      tab.page.waitForFunction(
        () => ["active", "blocked"].includes(document.body.dataset.gameTab),
        { timeout: TIMEOUT },
      ),
    ),
  );
  const states = await Promise.all(
    tabs.map((tab) => tab.page.evaluate(() => document.body.dataset.gameTab)),
  );
  assertion(
    states.filter((state) => state === "active").length === 1,
    "Concurrent tabs acquired multiple game slots",
    { actual: states },
  );
  const owner = tabs[states.indexOf("active")];
  const blocked = tabs[states.indexOf("blocked")];
  await assertBlocked(blocked);
  report.checks.push(
    "simultaneous tabs admit exactly one; blocked tab starts no client or API requests",
  );
  return { owner, blocked };
}

async function assertBlocked(tab) {
  const state = await tab.page.evaluate(() => ({
    client: Boolean(window.maple || window.mapleOnline),
    inert: document.querySelector("main").inert,
    canvases: document.querySelectorAll("canvas").length,
  }));
  assertion(
    !state.client && state.inert && !state.canvases && tab.apiRequests === 0,
    "Blocked tab crossed the startup boundary",
    { actual: { ...state, apiRequests: tab.apiRequests } },
  );
}

async function retry(tab, state) {
  await tab.page.bringToFront();
  await Promise.all([
    tab.page.waitForNavigation({
      waitUntil: "domcontentloaded",
      timeout: TIMEOUT,
    }),
    tab.page.click("#game-tab-gate button"),
  ]);
  await gateState(tab.page, state);
}

async function loginReady(page) {
  await page.waitForFunction(() => window.maple?.snapshot().login?.artwork, {
    timeout: TIMEOUT,
  });
}

async function fieldReady(page) {
  await page.waitForFunction(
    () => {
      const state = window.maple?.snapshot();
      return state?.online.status === "active" && !state.loading;
    },
    { timeout: TIMEOUT },
  );
}

async function playAndReconnect(page, credentials, report) {
  await page.bringToFront();
  await loginReady(page);
  if (
    await page.$eval(
      "#console-toggle",
      (node) => node.getAttribute("aria-expanded") === "true",
    )
  ) {
    await page.click("#console-toggle");
  }
  await page.type('[name="name"]', credentials.account);
  await page.type('[name="password"]', credentials.password);
  await page.click(".online-login-submit");
  await page.waitForFunction(
    () => {
      const login = window.maple.snapshot().login;
      return login.stage === "characters" && !login.transition.active;
    },
    { timeout: TIMEOUT },
  );
  await page.click(".online-login-enter");
  await fieldReady(page);
  const epoch = await page.evaluate(
    () => window.mapleOnline.snapshot().connectionEpoch,
  );
  await page.click("#console-toggle");
  await openConsoleSection(page, "diagnostics");
  await clickLabel(page, "Reconnect session", "#state-testing-controls");
  await page.waitForFunction(
    (before) => window.mapleOnline.snapshot().connectionEpoch !== before,
    { timeout: TIMEOUT },
    epoch,
  );
  await fieldReady(page);
  report.playErrorLog = await page.$eval("#error", (node) =>
    node.value.slice(-32768),
  );
  assertion(!report.playErrorLog, "Game error during play/reconnect", {
    actual: report.playErrorLog,
  });
  report.checks.push(
    "owner reload, native login, play and reconnect retain the slot while another tab is foreground",
  );
}

async function handoff(owner, blocked, report) {
  await owner.page.goto("about:blank");
  await retry(blocked, "active");
  await loginReady(blocked.page);
  await owner.page.goBack({ waitUntil: "domcontentloaded", timeout: TIMEOUT });
  await gateState(owner.page, "blocked");
  // This tab previously played; use a fresh counter for its restored document.
  const client = await owner.page.evaluate(() =>
    Boolean(window.maple || window.mapleOnline),
  );
  assertion(!client, "Back navigation resumed a retired client");
  await blocked.page.close();
  await retry(owner, "active");
  report.checks.push(
    "navigation releases the slot; Back re-enters admission; closing the owner permits retry",
  );
}

async function isolatedProfile(browser, url, report) {
  const context = await browser.createBrowserContext();
  try {
    const independent = await createTab(context, report);
    await independent.page.goto(url, { waitUntil: "domcontentloaded" });
    await gateState(independent.page, "active");
    await independent.page.close();
    const unsupported = await createTab(context, report);
    // Fault injection at the browser capability boundary, never gameplay state.
    await unsupported.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "locks", { value: undefined });
    });
    await unsupported.page.goto(url, { waitUntil: "domcontentloaded" });
    await gateState(unsupported.page, "unavailable");
    await assertBlocked(unsupported);
    report.checks.push(
      "separate browser profiles remain independent; unavailable locks stop startup safely",
    );
  } finally {
    await context.close();
  }
}

async function verifyOwner(page, report) {
  await loginReady(page);
  report.runtime = await page.evaluate(() => ({
    sourceBuildId: window.maple.snapshot().sourceBuildId,
    errorLog: document.querySelector("#error").value.slice(-32768),
  }));
  assertion(
    report.runtime.sourceBuildId === report.identity.sourceBuildId,
    "Browser source identity mismatch",
  );
  assertion(!report.runtime.errorLog, "Game error during tab handoff", {
    actual: report.runtime.errorLog,
  });
}

/** Serve the compiled real offline entry in the owner's storage origin.
 * Only this page's shell/bundle delivery is intercepted; no game data is seeded. */
async function offlineAdmission(context, { url, offlineBundle }, report) {
  const file = Bun.file(offlineBundle);
  assertion(
    file.size > 0 && file.size <= 16 * 1024 * 1024,
    "Expected bounded offline browser bundle",
  );
  const bundle = await file.text();
  const html = await Bun.file(
    resolve(import.meta.dir, "../../index.html"),
  ).text();
  const tab = await createTab(context, report);
  const entry = new URL("/__single-tab-offline", url).href;
  await tab.page.setRequestInterception(true);
  tab.page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    const response =
      request.url() === entry
        ? request.respond({ status: 200, contentType: "text/html", body: html })
        : path === "/dist/main.js"
          ? request.respond({
              status: 200,
              contentType: "text/javascript",
              body: bundle,
            })
          : request.continue();
    response.catch((error) => {
      if (report.errors.length < 24) report.errors.push(error.message);
    });
  });
  await tab.page.goto(entry, { waitUntil: "domcontentloaded" });
  await gateState(tab.page, "blocked");
  await assertBlocked(tab);
  const databases = await tab.page.evaluate(() => indexedDB.databases());
  assertion(
    !databases.some((database) => database.name === "maple-offline-save"),
    "Blocked offline entry opened the save database",
  );
  report.offlineBundleHash = new Bun.CryptoHasher("sha256")
    .update(bundle)
    .digest("hex");
  report.checks.push(
    "real offline entry shares the lock and remains blocked before client, saves or API initialization",
  );
  await tab.page.close();
}
