import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { measureStage, assertion } from "../native-evidence.js";
import { sourceIdentity } from "../browser-build.js";
import {
  clickLabel,
  focusCanvas,
  openConsoleSection,
  openWindow,
  TIMEOUT,
} from "./native.js";
import { CONSOLE_SECTIONS } from "../../src/development/inspection-theme.js";
import {
  PHYSICAL_CODES,
  keyIndexForCode,
  bindingAction,
} from "../../src/input/keymap.js";

const CATALOG = fileURLToPath(
  new URL("../../public/generated/catalog.json", import.meta.url),
);
const MAX_LOGS = 80;
const HASH = /^[a-f0-9]{64}$/;

function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Existing Puppeteer Browser only; creates/closes its own context, never launches Chromium. */
export async function runOnlinePresentation({
  browser,
  url,
  output,
  account,
  password,
}) {
  const destination = presentationDestination({
    browser,
    url,
    account,
    password,
  });
  const session = await createPresentationSession(output, destination, {
    account,
    password,
  });
  const { directory, report } = session;
  let failure = null;
  try {
    await exercisePresentation(browser, session, { url, account, password });
  } catch (error) {
    failure = error;
    report.status = "fail";
    report.failure = {
      name: error.name,
      message: safeText(error.message, { account, password }),
    };
    await failureCapture(session);
  } finally {
    try {
      await finishSession(session);
    } catch (error) {
      report.status = "fail";
      report.teardownError = session.redact(error.message);
      failure ??= error;
    }
    await writeFile(
      join(directory, "online-presentation.json"),
      JSON.stringify(report, null, 2),
    );
  }
  if (failure) {
    throw new Error(session.redact(failure.message), {
      cause: { name: failure.name },
    });
  }
  return report;
}

async function createPresentationSession(
  output,
  destination,
  { account, password },
) {
  const directory = resolve(output);
  await mkdir(directory, { recursive: true });
  const report = {
    status: "running",
    timings: {},
    checks: [],
    captures: [],
    errors: [],
    failedRequests: [],
    droppedLogs: 0,
  };
  const session = {
    page: null,
    context: null,
    directory,
    report,
    origin: destination.origin,
    redact: (value) => safeText(value, { account, password }),
  };
  return session;
}

function presentationDestination({ browser, url, account, password }) {
  assertion(
    browser && typeof browser.createBrowserContext === "function",
    "Puppeteer Browser required",
  );
  assertion(
    typeof account === "string" &&
      account.length > 0 &&
      typeof password === "string" &&
      password.length > 0,
    "Real account credentials required",
  );
  const destination = new URL(url);
  assertion(
    ["http:", "https:"].includes(destination.protocol),
    "HTTP(S) client URL required",
  );
  return destination;
}

async function exercisePresentation(browser, session, credentials) {
  const { report } = session;
  const { url, account, password } = credentials;
  session.identity = await measureStage(
    report.timings,
    "workspaceIdentityMs",
    workspaceIdentity,
  );
  report.workspace = session.identity;
  await measureStage(report.timings, "contextMs", () =>
    prepareContext(browser, session),
  );
  await measureStage(report.timings, "loginMs", () =>
    login(session, { url, account, password }),
  );
  await measureStage(report.timings, "identityMs", () =>
    checkIdentity(session),
  );
  await measureStage(report.timings, "movementMs", () => movement(session));
  await measureStage(report.timings, "windowsMs", () => windows(session));
  await measureStage(report.timings, "inspectionMs", () => inspection(session));
  await measureStage(report.timings, "viewportMs", () =>
    smallViewport(session),
  );
  await measureStage(report.timings, "finalChecksMs", () =>
    finalChecks(session),
  );
  report.status = "pass";
}

async function workspaceIdentity() {
  const bytes = await readFile(CATALOG);
  return {
    catalogSha256: sha(bytes),
    assetBuildId: JSON.parse(bytes).buildId,
    sourceIdentity: await sourceIdentity(),
  };
}

function safeText(value, secrets = {}) {
  let text = String(value ?? "").slice(0, 2000);
  for (const secret of [secrets.account, secrets.password]) {
    if (secret) text = text.split(secret).join("[redacted]");
  }
  return text;
}

function retain(report, key, value) {
  if (report[key].length < MAX_LOGS) report[key].push(value);
  else report.droppedLogs++;
}

async function prepareContext(browser, session) {
  session.context = await browser.createBrowserContext();
  const page = (session.page = await session.context.newPage());
  page.setDefaultTimeout(TIMEOUT);
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  page.on("pageerror", (error) =>
    retain(session.report, "errors", {
      name: error.name,
      message: session.redact(error.message),
    }),
  );
  page.on("requestfailed", (request) =>
    recordRequest(session, request, "network failure"),
  );
  page.on("response", (response) => {
    if (response.status() >= 400) {
      recordRequest(session, response.request(), `HTTP ${response.status()}`);
    }
  });
  await page.evaluateOnNewDocument(installAuthorityProbes);
}

/** Observe real calls and preserve the receiver, arguments, return value and thrown errors. */
function installAuthorityProbes() {
  const counts = {
    indexedDBOpen: 0,
    indexedDBDelete: 0,
    serviceWorkerRegister: 0,
  };
  Object.defineProperty(window, "__onlinePresentationAuthority", {
    value: counts,
  });
  const open = IDBFactory.prototype.open;
  const remove = IDBFactory.prototype.deleteDatabase;
  IDBFactory.prototype.open = function (...args) {
    counts.indexedDBOpen++;
    return Reflect.apply(open, this, args);
  };
  IDBFactory.prototype.deleteDatabase = function (...args) {
    counts.indexedDBDelete++;
    return Reflect.apply(remove, this, args);
  };
  if (typeof ServiceWorkerContainer !== "undefined") {
    const register = ServiceWorkerContainer.prototype.register;
    ServiceWorkerContainer.prototype.register = function (...args) {
      counts.serviceWorkerRegister++;
      return Reflect.apply(register, this, args);
    };
  }
}

function recordRequest(session, request, reason) {
  if (session.closing) return;
  const url = new URL(request.url());
  if (url.origin !== session.origin) return;
  retain(session.report, "failedRequests", {
    path: url.pathname,
    method: request.method(),
    reason,
  });
}

async function capture(session, name) {
  const path = join(session.directory, `${name}.png`);
  await session.page.screenshot({ path, fullPage: true });
  session.report.captures.push({ name, path });
}

async function login(session, credentials) {
  const page = session.page;
  await page.goto(credentials.url, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT,
  });
  await page.waitForSelector(".online-login .maple95-window", {
    visible: true,
  });
  await page.waitForSelector('.online-login [name="name"]', { visible: true });
  await capture(session, "login-win95");
  await page.type('.online-login [name="name"]', credentials.account);
  await page.type('.online-login [name="password"]', credentials.password);
  await page.click(".online-login-submit");
  await page.waitForFunction(
    () => {
      const stage = document.querySelector(
        '.online-login[data-stage="characters"] .online-login-characters',
      );
      const card = stage?.querySelector(".online-login-card");
      const enter = stage?.querySelector(".online-login-enter");
      return (
        card &&
        card.getBoundingClientRect().width > 0 &&
        enter &&
        !enter.disabled &&
        stage.querySelectorAll(".online-login-dot").length > 0
      );
    },
    { timeout: TIMEOUT },
  );
  await page.click(".online-login-dot");
  await capture(session, "login-character-spotlight");
  await clickLabel(page, "Enter the world", ".online-login");
  await ready(page);
  session.report.checks.push(
    "Win95 sign-in submitted through hashcash-gated account flow; server-owned spotlight character selected by mouse and entered",
  );
  await capture(session, "field-native-hud");
}

async function ready(page) {
  await page.waitForFunction(
    () => {
      const state = window.maple?.snapshot();
      if (state?.lastError) throw new Error("Online client reported an error");
      return (
        state?.online?.status === "active" &&
        !state.loading &&
        state.currentMap &&
        state.pendingLoads === 0 &&
        state.ui?.ready &&
        state.ui.pending.length === 0
      );
    },
    { timeout: TIMEOUT },
  );
}

async function checkIdentity(session) {
  const observed = await session.page.evaluate(async () => {
    const response = await fetch("/api/v1/config", {
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error("Server configuration unavailable");
    const config = await response.json();
    const catalogResponse = await fetch("/generated/catalog.json", {
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    if (!catalogResponse.ok) throw new Error("Served catalog unavailable");
    const bytes = await catalogResponse.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const catalogSha256 = Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    return {
      sourceBuildId: window.maple.snapshot().sourceBuildId,
      assetBuildId: config.assetBuildId,
      rulesHash: config.rulesHash,
      catalogHash: config.catalogHash,
      catalogSha256,
    };
  });
  for (const value of Object.values(observed)) {
    assertion(HASH.test(value), "Published identity must be SHA-256");
  }
  assertion(
    observed.catalogSha256 === session.identity.catalogSha256,
    "Served catalog must match workspace bytes",
  );
  assertion(
    observed.catalogHash === session.identity.catalogSha256,
    "Compiled server catalog identity must match workspace",
  );
  assertion(
    observed.assetBuildId === session.identity.assetBuildId,
    "Compiled server asset identity must match workspace catalog",
  );
  session.report.identity = observed;
  session.report.checks.push(
    "Server config, browser source ID and served/workspace catalog SHA-256 recorded and asset/catalog identities matched",
  );
}

function authoritativeState() {
  const model = window.mapleOnline.observation();
  const transport = window.mapleOnline.snapshot();
  return {
    position: model.self.entity.position,
    foothold: model.self.entity.foothold,
    inputSeq: transport.inputSeq,
    ackInputSeq: model.ackInputSeq,
    fieldEpoch: model.fieldEpoch,
    serverTick: model.serverTick,
    snapshotId: model.snapshotId,
  };
}

async function sidebar(page, visible) {
  const shown = await page.$eval("#gm-console", (node) => !node.hidden);
  if (shown !== visible) await page.click("#console-toggle");
  await page.waitForFunction(
    (expected) => document.querySelector("#gm-console").hidden !== expected,
    {},
    visible,
  );
}

async function movement(session) {
  const page = session.page;
  await sidebar(page, false);
  await focusCanvas(page);
  const before = await page.evaluate(authoritativeState);
  try {
    await page.keyboard.down("ArrowRight");
    await page.waitForFunction(
      (start) => {
        const model = window.mapleOnline.observation();
        return (
          model.fieldEpoch === start.fieldEpoch &&
          model.ackInputSeq >= start.inputSeq + 4 &&
          Math.abs(model.self.entity.position.x - start.position.x) > 2
        );
      },
      { timeout: TIMEOUT },
      before,
    );
  } finally {
    await page.keyboard.up("ArrowRight");
  }
  const moved = await page.evaluate(authoritativeState);
  await page.waitForFunction(
    () => window.mapleOnline.observation().self.entity.foothold !== null,
    { timeout: TIMEOUT },
  );
  const ground = await page.evaluate(authoritativeState);
  try {
    await page.keyboard.down("AltLeft");
    await page.waitForFunction(
      (start) => {
        const model = window.mapleOnline.observation();
        return (
          model.ackInputSeq > start.inputSeq &&
          model.self.entity.position.y < start.position.y - 1
        );
      },
      { timeout: TIMEOUT },
      ground,
    );
    session.report.jump = await page.evaluate(authoritativeState);
  } finally {
    await page.keyboard.up("AltLeft");
  }
  await ready(page);
  session.report.movement = { before, moved, ground };
  session.report.checks.push(
    "Held ArrowRight changed authoritative X with acknowledged input; real Alt jump changed authoritative Y",
  );
  await capture(session, "field-after-native-input");
}

async function windows(session) {
  const page = session.page;
  for (const name of ["Item", "Stat", "Quest", "KeyConfig"]) {
    await focusCanvas(page);
    const bindings = await page.evaluate(
      () => window.maple.snapshot().ui.keyBindings.active.keys,
    );
    const code = PHYSICAL_CODES.find(
      (value) => bindingAction(bindings[keyIndexForCode(value)]) === name,
    );
    assertion(code, `Server character needs a physical binding for ${name}`);
    await openWindow(page, code, name);
    await ready(page);
    await capture(session, `native-${name.toLowerCase()}`);
    await clickLabel(
      page,
      name === "Quest" ? "Close quest journal" : `Close ${name}`,
    );
    await page.waitForFunction(
      (windowName) => !window.maple.snapshot().ui.windows.includes(windowName),
      { timeout: TIMEOUT },
      name,
    );
  }
  session.report.checks.push(
    "Item, Stat, Quest and KeyConfig opened by actual configured keys, captured, and closed by native mouse buttons; no settings saved",
  );
}

async function revealControl(page, selector) {
  const input = await page.$(selector);
  assertion(input, `Inspection control ${selector} must exist`);
  try {
    const open = await input.evaluate((node) => node.closest("details").open);
    if (open) return;
    const summary = await input.evaluateHandle((node) =>
      node.closest("details").querySelector("summary"),
    );
    try {
      await summary.asElement().click();
    } finally {
      await summary.dispose();
    }
  } finally {
    await input.dispose();
  }
}

async function inspection(session) {
  const page = session.page;
  await sidebar(page, true);
  for (const section of CONSOLE_SECTIONS) {
    await openConsoleSection(page, section);
  }
  await openConsoleSection(page, "world");
  await revealControl(page, "#debug");
  await page.click("#debug");
  await page.waitForFunction(
    () =>
      window.maple.snapshot().debug ===
      document.querySelector("#debug").checked,
  );
  await revealControl(page, "#follow");
  const follow = await page.$eval("#follow", (node) => node.checked);
  await page.click("#follow");
  await page.waitForFunction(
    (previous) => window.maple.snapshot().follow !== previous,
    {},
    follow,
  );
  await page.click("#follow");
  await capture(session, "inspection-geometry");
  await openConsoleSection(page, "diagnostics");
  const before = await page.evaluate(authoritativeState);
  await clickLabel(
    page,
    "Request authoritative resync",
    "#console-diagnostics",
  );
  await page.waitForFunction(
    (snapshotId) => {
      const model = window.mapleOnline.observation();
      return (
        window.mapleOnline.snapshot().status === "active" &&
        model.snapshotId !== snapshotId
      );
    },
    { timeout: TIMEOUT },
    before.snapshotId,
  );
  await ready(page);
  const after = await page.evaluate(authoritativeState);
  assertion(
    after.inputSeq >= before.inputSeq,
    "Resync must preserve input sequence continuity",
  );
  session.report.resync = { before, after };
  await capture(session, "inspection-state-testing");
  session.report.checks.push(
    "All six inspection sections, geometry toggle, follow off/on, State & Testing resync and active sequence continuity exercised",
  );
}

async function smallViewport(session) {
  const page = session.page;
  await sidebar(page, false);
  await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
  await ready(page);
  await page.waitForFunction(
    () =>
      window.innerWidth === 800 &&
      document.querySelector("#viewport canvas").getBoundingClientRect()
        .width <= 800,
  );
  const bounds = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  assertion(
    bounds.scrollWidth <= 800 && bounds.bodyWidth <= 800,
    "800x600 active field must not overflow horizontally",
    { actual: bounds },
  );
  session.report.viewport = bounds;
  await capture(session, "field-800x600");
  await sidebar(page, true);
  await sidebar(page, false);
  session.report.checks.push(
    "Sidebar hidden/shown through real clicks; active field resized to 800x600 without horizontal document overflow",
  );
}

async function finalChecks(session) {
  await ready(session.page);
  const probes = await session.page.evaluate(() => ({
    ...window.__onlinePresentationAuthority,
  }));
  assertion(
    Object.values(probes).every((count) => count === 0),
    "Online graph must never open/delete IndexedDB or register a service worker",
    { actual: probes },
  );
  session.report.authorityProbes = probes;
  assertion(
    session.report.errors.length === 0 &&
      session.report.failedRequests.length === 0 &&
      session.report.droppedLogs === 0,
    "No page errors, failed same-origin requests or log overflow permitted",
  );
  session.report.checks.push(
    "Zero observed IndexedDB open/delete and SW registrations; bounded error/request logs empty",
  );
}

async function finishSession(session) {
  try {
    if (session.identity) {
      const after = await measureStage(
        session.report.timings,
        "finalWorkspaceIdentityMs",
        workspaceIdentity,
      );
      session.report.workspaceAfter = after;
      assertion(
        after.catalogSha256 === session.identity.catalogSha256,
        "Immutable world catalog must remain byte-identical",
      );
      assertion(
        after.sourceIdentity === session.identity.sourceIdentity,
        "Workspace source must not change during scenario",
      );
      session.report.checks.push(
        "Workspace source and immutable world catalog unchanged at scenario end",
      );
    }
    if (session.page && !session.page.isClosed()) {
      session.report.authorityProbes = await session.page.evaluate(() => ({
        ...window.__onlinePresentationAuthority,
      }));
    }
  } catch (error) {
    await failureCapture(session);
    throw error;
  } finally {
    await retire(session);
  }
}

async function failureCapture(session) {
  if (!session.page || session.page.isClosed()) return;
  try {
    // Never capture populated sign-in fields or account/character labels on failure.
    await session.page.evaluate(() =>
      document.querySelector(".online-login")?.remove(),
    );
    await capture(session, "failure-field-only");
  } catch (error) {
    session.report.failureCapture = error.name;
  }
}

async function retire(session) {
  session.closing = true;
  try {
    if (session.page && !session.page.isClosed()) {
      for (const key of ["ArrowRight", "ArrowLeft", "AltLeft"]) {
        await session.page.keyboard.up(key);
      }
    }
  } finally {
    if (session.context) await session.context.close();
  }
}
