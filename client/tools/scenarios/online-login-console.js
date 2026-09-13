import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CONSOLE_SECTIONS } from "../../src/development/inspection-theme.js";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { TIMEOUT, clickLabel } from "./native.js";
import { onlineIdentity } from "./online-lifecycle.js";

const ENTER_ATTEMPTS = 8;
const ENTER_RETRY_MS = 2500;
const AUDIO_SECONDS = 1;
const MIN_TITLE_RMS = 0.001;
const MIN_PAINTED_PIXELS = 1000;
const EXPECTED_CREATE_ROWS = 9;
const EXPECTED_FACE_COUNT = 3;
const EXPECTED_HAIR_BASE_COUNT = 3;
const EXPECTED_HAIR_COLOUR_COUNT = 4;
const EXPECTED_SKIN_COUNT = 4;

const wait = (ms) =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

/** Existing Puppeteer Browser only; opens and closes its own pages, never launches Chromium.
 * Covers the login surface (recovered create choices, portrait pixels, title music) and the
 * development console in both authority modes. Not original Windows parity. */
export async function runOnlineLoginConsole({
  browser,
  url,
  output,
  accounts,
  password,
}) {
  assertion(
    browser && typeof browser.createBrowserContext === "function",
    "Puppeteer Browser required",
  );
  assertion(
    typeof url === "string" && url.startsWith("http"),
    "Online client URL required",
  );
  assertion(
    accounts?.developer && accounts?.player,
    "Developer and player account names required",
  );
  assertion(
    typeof password === "string" && password.length > 0,
    "Development password required",
  );
  await mkdir(output, { recursive: true });
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    url,
    accounts: { developer: accounts.developer, player: accounts.player },
    scope:
      "Real Chromium against the development proxy and server: recovered creation choices, three-slot roster portrait pixels, login music and console sections. Not original Windows parity.",
    checks: [],
  };
  const tools = { report, url, password, accounts, output };
  log("developer session");
  await developerSession(browser, tools);
  log("player session");
  await playerSession(browser, tools);
  await saveLoginReport(report, output);
  return report;
}

/** Change-scoped native login replay. The supplied account is a dedicated fixture;
 * only its four exact fixture character names are created/deleted. No field entry. */
export async function runNativeLoginPresentation({
  browser,
  url,
  output,
  account,
  password,
  register = false,
}) {
  await mkdir(output, { recursive: true });
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    url,
    account,
    scope:
      "Original MapLogin artwork, native controls, four-character paging, name/appearance creation and presentation-only tools. No Windows runtime parity.",
    timings: {},
    captures: [],
    checks: [],
  };
  const tools = { report, url, output, account, password, register };
  const context = await measureStage(report.timings, "browserAcquisition", () =>
    browser.createBrowserContext(),
  );
  const { page, errors } = await openPage(context);
  try {
    await measureStage(report.timings, "readiness", () =>
      nativeLoginReady(page, tools),
    );
    await measureStage(report.timings, "account", () =>
      nativeLoginAccount(page, tools),
    );
    await measureStage(report.timings, "creationAndRoster", () =>
      nativeLoginCharacters(page, tools),
    );
    await measureStage(report.timings, "transitions", () =>
      nativeLoginReplay(page, tools),
    );
    await measureStage(report.timings, "minimumViewport", () =>
      nativeLoginMinimum(page, tools),
    );
    await measureStage(report.timings, "fixtureCleanup", () =>
      nativeLoginCleanup(page, tools),
    );
    check(report, "No unexpected browser errors", errors.length === 0, {
      errors,
    });
  } catch (error) {
    await captureLoginFailure(page, tools, error, errors);
  } finally {
    await measureStage(report.timings, "teardown", () => context.close());
    await saveLoginReport(report, output);
  }
  return report;
}

async function saveLoginReport(report, output) {
  report.status ??= report.checks.every((entry) => entry.pass)
    ? "pass"
    : "fail";
  report.finishedAt = new Date().toISOString();
  await Bun.write(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}

async function captureLoginFailure(page, tools, error, errors) {
  tools.report.status = "fail";
  tools.report.failure = failureDetails(error);
  tools.report.errors = errors;
  tools.report.runtime = await page.evaluate(() => ({
    login: window.maple?.snapshot().login,
    lastError: window.maple?.snapshot().lastError,
    errorLog: document.querySelector("#error")?.value?.slice(0, 6000),
  }));
  await page.screenshot({ path: join(tools.output, "failure.png") });
}

async function nativeLoginArtwork(page) {
  await page.waitForFunction(
    () => {
      const state = window.maple?.snapshot();
      return state?.lastError || state?.login?.artwork;
    },
    { timeout: TIMEOUT },
  );
  const error = await page.evaluate(() => window.maple.snapshot().lastError);
  assertion(!error, `Native login startup failed: ${error}`);
}

async function nativeLoginReady(page, tools) {
  await page.goto(tools.url, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT,
  });
  await nativeLoginArtwork(page);
  tools.report.identity = await onlineIdentity(tools.url);
  await showConsole(page);
  await page.select("#console-section", "world");
  const observed = await page.evaluate(() => ({
    sourceBuildId: window.maple.snapshot().sourceBuildId,
    catalogBuildId: window.maple.snapshot().login.catalogBuildId,
  }));
  assertion(
    observed.sourceBuildId === tools.report.identity.sourceBuildId &&
      observed.catalogBuildId === tools.report.identity.assetBuildId,
    "Native login must use the current source and catalog",
    { observed, expected: tools.report.identity },
  );
  tools.report.observedIdentity = observed;
  const before = await nativeLoginPause(page, true);
  await wait(100);
  const paused = await page.evaluate(() => window.maple.snapshot().login);
  await page.click('[data-login-action="step"]');
  const stepped = await page.evaluate(() => window.maple.snapshot().login);
  check(
    tools.report,
    "Login animation pauses and advances by exactly 30ms",
    paused.elapsedMs === before.elapsedMs &&
      stepped.elapsedMs === paused.elapsedMs + 30,
    { before, paused, stepped },
  );
  await nativeLoginCapture(page, tools, "account");
  await nativeLoginPause(page, false);
}

async function nativeLoginPause(page, paused) {
  const current = await page.evaluate(
    () => window.maple.snapshot().login.paused,
  );
  if (current !== paused) await page.click('[data-login-action="pause"]');
  return page.evaluate(() => window.maple.snapshot().login);
}

async function nativeLoginAccount(page, tools) {
  await nativeLoginHomepage(page, tools);
  if (tools.register) {
    await press(page, "Register");
    await page.type('[name="registration-name"]', tools.account);
    await page.type('[name="registration-password"]', tools.password);
    await page.type('[name="registration-confirm"]', tools.password);
    await nativeLoginCapture(page, tools, "registration");
    await page.click(".online-registration-submit");
  } else await nativeLoginSignIn(page, tools.account, tools.password);
  await waitForRoster(page);
  await page.click(".online-login-signout");
  await waitForAccount(page);
  await nativeLoginSignIn(page, tools.account, tools.password);
  await waitForRoster(page);
  tools.names = Array.from(
    { length: 4 },
    (_, index) =>
      `${tools.account.replace(/[^A-Za-z0-9]/g, "").slice(0, 11)}${index}`,
  );
  const authenticated = await page.evaluate(async () => ({
    stage: window.maple.snapshot().login.stage,
    status: (await fetch("/api/v1/characters")).status,
  }));
  check(
    tools.report,
    "Valid credentials sign in again after logout",
    authenticated.stage === "characters" && authenticated.status === 200,
    authenticated,
  );
  await nativeLoginCleanup(page, tools);
  tools.baselineNames = (await listNames(page)).names;
  tools.report.baselineCharacters = tools.baselineNames;
}

async function nativeLoginHomepage(page, tools) {
  await waitForAccount(page);
  const destination = page.waitForRequest(
    (request) =>
      request.isNavigationRequest() &&
      request.url() === "https://docs.openms.dev/",
    { timeout: 10000 },
  );
  await press(page, "Homepage");
  tools.report.homepage = (await destination).url();
  await page.goto(tools.url, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT,
  });
  await waitForAccount(page);
  await showConsole(page);
  await page.select("#console-section", "world");
}

async function nativeLoginSignIn(page, account, password) {
  for (const [name, value] of [
    ["name", account],
    ["password", password],
  ]) {
    const input = `.online-login [name="${name}"]`;
    await page.click(input, { count: 3 });
    await page.keyboard.press("Backspace");
    await page.type(input, value);
  }
  await page.click(".online-login-submit");
}

function waitForAccount(page) {
  return page.waitForFunction(
    () => {
      const state = window.maple?.snapshot().login;
      return (
        state?.artwork &&
        state.stage === "account" &&
        !state.transition.active &&
        document.querySelector(".online-login")?.getAttribute("aria-busy") !==
          "true"
      );
    },
    { timeout: TIMEOUT },
  );
}

async function nativeLoginCharacters(page, tools) {
  for (let index = 0; index < tools.names.length; index++) {
    await press(page, "Create character");
    await waitForName(page);
    if (index === 0) {
      await nativeLoginCapture(page, tools, "create-name");
      const rejection = await proveValidationDialog(page, tools);
      assertion(
        rejection?.open,
        "Invalid name did not open the original-art modal",
      );
      await pressDialog(page, "confirm");
    }
    await nameCharacter(page, tools.names[index]);
    if (index === 0) {
      const choices = await readCreateScreen(page);
      checkCreateChoices(tools.report, choices);
      check(
        tools.report,
        "Face selection changes the paused avatar raster",
        choices.repaint,
      );
      await nativeLoginCapture(page, tools, "create-appearance");
    }
    await createCharacter(page);
    await page.waitForFunction(rosterPixelsReady, { timeout: TIMEOUT });
    if (tools.baselineNames.length + index + 1 === 3) {
      await nativeLoginCapture(page, tools, "roster-three");
    }
  }
  const roster = await listNames(page);
  await selectCharacter(page, roster.names[3]);
  await page.waitForFunction(rosterPixelsReady, { timeout: TIMEOUT });
  await nativeLoginCapture(page, tools, "roster-page-two");
  const second = await page.evaluate(rosterVisuals);
  await page.click(".online-login-previous");
  await page.waitForFunction(rosterPixelsReady, { timeout: TIMEOUT });
  const first = await page.evaluate(rosterVisuals);
  const seen = [...first, ...second]
    .map((slot) => slot.name)
    .filter(Boolean)
    .sort();
  check(
    tools.report,
    "Every character appears across three native slots per page",
    JSON.stringify(seen) ===
      JSON.stringify([...tools.baselineNames, ...tools.names].sort()) &&
      first.every((slot) => slot.painted >= MIN_PAINTED_PIXELS),
    { first, second, created: tools.names, baseline: tools.baselineNames },
  );
  await nativeLoginCapture(page, tools, "roster-page-one");
  await nativeLoginConfirmation(page, tools);
}

async function nativeLoginConfirmation(page, tools) {
  const before = await listNames(page);
  await press(page, "Delete character");
  await expectDialog(page);
  await nativeLoginCapture(page, tools, "delete-confirmation");
  await pressDialog(page, "cancel");
  const after = await listNames(page);
  check(
    tools.report,
    "Cancelling native deletion preserves every character",
    JSON.stringify(before.names) === JSON.stringify(after.names),
    { before, after },
  );
}

function rosterVisuals() {
  return Array.from(document.querySelectorAll(".online-login-card")).map(
    (card) => {
      const canvas = card.querySelector("canvas");
      let painted = 0;
      if (canvas?.width && canvas.height) {
        const bytes = canvas
          .getContext("2d")
          .getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 3; index < bytes.length; index += 4) {
          if (bytes[index]) painted++;
        }
      }
      return {
        name: card.querySelector(".online-login-character-name").textContent,
        selected: card.getAttribute("aria-pressed") === "true",
        painted,
      };
    },
  );
}

function rosterPixelsReady() {
  const slots = document.querySelectorAll(".online-login-card");
  for (const slot of slots) {
    if (!slot.querySelector(".online-login-character-name").textContent) {
      continue;
    }
    const canvas = slot.querySelector("canvas");
    if (!canvas?.width || !canvas.height) return false;
    const bytes = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let index = 3; index < bytes.length; index += 4) {
      if (bytes[index]) painted++;
    }
    if (painted < 1000) return false;
  }
  return true;
}

async function nativeLoginReplay(page, tools) {
  const before = await nativeLoginPause(page, true);
  await page.click('[data-login-action="replay"]');
  await page.waitForFunction(
    () => window.maple.snapshot().login.transition.elapsedMs === 0,
  );
  for (let index = 0; index < 10; index++) {
    await page.click('[data-login-action="step"]');
  }
  const middle = await page.evaluate(() => window.maple.snapshot().login);
  check(
    tools.report,
    "Replay moves the original camera without changing the roster",
    middle.transition.active &&
      middle.transition.elapsedMs === 300 &&
      middle.camera.y !== before.camera.y &&
      middle.characters === before.characters,
    { before, middle },
  );
  await nativeLoginCapture(page, tools, "transition");
  await nativeLoginPause(page, false);
  await waitForRoster(page);
}

async function nativeLoginMinimum(page, tools) {
  await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
  await page.click(".online-login-card:nth-child(2)");
  const state = await nativeLoginPause(page, true);
  check(
    tools.report,
    "Roster and login tools remain interactive at800x600",
    state.selected === 1 && state.paused,
  );
  await nativeLoginCapture(page, tools, "minimum-viewport");
  await nativeLoginPause(page, false);
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
}

async function nativeLoginCapture(page, tools, name) {
  await page.screenshot({ path: join(tools.output, `${name}.png`) });
  const scene = await page.$(".online-login-window");
  await scene.screenshot({ path: join(tools.output, `${name}-scene.png`) });
  await scene.dispose();
  tools.report.captures.push({
    name,
    state: await page.evaluate(() => window.maple.snapshot().login),
  });
}

async function nativeLoginCleanup(page, tools) {
  for (const name of tools.names) {
    if (await selectCharacter(page, name)) await deleteSelected(page);
  }
}

function log(message) {
  console.error(
    `[online-login-console ${new Date().toISOString().slice(11, 19)}] ${message}`,
  );
}

function check(report, name, pass, details = {}) {
  // Details may carry their own name (for example a character's); the check owns its name.
  report.checks.push({ ...details, name, pass: Boolean(pass) });
}

function openPage(browser) {
  const errors = [];
  return browser.newPage().then(async (page) => {
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(`console: ${message.text().slice(0, 300)}`);
      }
    });
    return { page, errors };
  });
}

/** A busy-character refusal is the expected retry cue for this check, not a defect. */
function unexpectedErrors(errors) {
  return errors.filter((error) => !/CHARACTER_BUSY/.test(error));
}

async function signIn(page, tools, account) {
  await page.goto(tools.url, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT,
  });
  await page.waitForSelector('.online-login [name="name"]', { visible: true });
  await page.type('.online-login [name="name"]', account);
  await page.type('.online-login [name="password"]', tools.password);
  await page.click(".online-login-submit");
  try {
    await waitForRoster(page);
  } catch {
    // A refused challenge or a stale build states its reason; surface it, then retry once.
    const state = await readDialog(page);
    log(`sign in retry (${JSON.stringify(state.text ?? "no dialog")})`);
    if (state.open) await pressDialog(page, "confirm");
    await page.click(".online-login-submit");
    await waitForRoster(page);
  }
}

async function waitForRoster(page) {
  await page.waitForFunction(
    () => {
      const stage = document.querySelector(
        '.online-login[data-stage="characters"] .online-login-characters',
      );
      const login = window.maple?.snapshot().login;
      return Boolean(
        stage &&
        login?.artwork &&
        !login.transition.active &&
        !stage.closest(".online-login-body").inert &&
        !document
          .querySelector(".online-login")
          .getAttribute("aria-busy")
          ?.includes("true"),
      );
    },
    { timeout: TIMEOUT },
  );
}

function press(page, label) {
  return clickLabel(page, label, ".online-login");
}

/** A released character lease can briefly outlive the previous browser. */
async function enterWorld(page) {
  for (let attempt = 0; attempt < ENTER_ATTEMPTS; attempt++) {
    const active = await page.evaluate(
      () => window.maple.snapshot().online?.status === "active",
    );
    if (active) return;
    await press(page, "Enter the world");
    await wait(ENTER_RETRY_MS);
  }
  const message = await page.evaluate(() => {
    const dialog = document.querySelector(".online-dialog-text")?.textContent;
    const status = window.maple.snapshot().login?.status;
    return dialog || status || null;
  });
  throw new Error(`Entering the world failed: ${message}`);
}

/** Failures use the original-art modal rather than a separate bottom message box. */
function readDialog(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector(".online-dialog-overlay");
    const cancel = document.querySelector(".online-dialog-cancel");
    return {
      open: Boolean(overlay && !overlay.hidden),
      title: document.querySelector(".online-dialog .online-dialog-title")
        ?.textContent,
      text: document.querySelector(".online-dialog-text")?.textContent,
      confirm: document.querySelector(".online-dialog-confirm")?.textContent,
      cancel: cancel && !cancel.hidden ? cancel.textContent : null,
    };
  });
}

async function pressDialog(page, choice) {
  await page.click(
    choice === "confirm" ? ".online-dialog-confirm" : ".online-dialog-cancel",
  );
  await page.waitForFunction(
    () => document.querySelector(".online-dialog-overlay")?.hidden !== false,
    { timeout: 10000 },
  );
}

async function expectDialog(page) {
  await page.waitForFunction(
    () => document.querySelector(".online-dialog-overlay")?.hidden === false,
    { timeout: 10000 },
  );
  return readDialog(page);
}

/** Account characters as the server reports them, plus the displayed roster count. */
function listNames(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/v1/characters", { cache: "no-store" });
    const value = await response.json();
    return {
      names: value.characters.map((character) => character.name),
      count: window.maple.snapshot().login.characters,
    };
  });
}

/** Page to the account-owned character and select its visible native slot. */
async function selectCharacter(page, name) {
  const roster = await listNames(page);
  const index = roster.names.indexOf(name);
  if (index < 0) return false;
  const target = Math.floor(index / 3);
  let current = await page.evaluate(() => window.maple.snapshot().login.page);
  for (let step = 0; current !== target && step < 22; step++) {
    await page.click(
      current < target ? ".online-login-next" : ".online-login-previous",
    );
    current = await page.evaluate(() => window.maple.snapshot().login.page);
  }
  assertion(
    current === target,
    "Character page did not reach the requested roster index",
  );
  await page.click(`.online-login-card:nth-child(${(index % 3) + 1})`);
  return true;
}

/** Open the confirm dialog and accept it, waiting for the entry to disappear. */
async function deleteSelected(page) {
  const before = await page.evaluate(
    () => window.maple.snapshot().login.characters,
  );
  await press(page, "Delete character");
  await expectDialog(page);
  await pressDialog(page, "confirm");
  await page.waitForFunction(
    (count) => window.maple.snapshot().login.characters < count,
    { timeout: 30000 },
    before,
  );
}

/** Previous runs leave the character they created for their field checks. */
async function cleanupEvidenceCharacters(page) {
  const removed = [];
  for (const name of await evidenceNames(page)) {
    if (!(await selectCharacter(page, name))) continue;
    await wait(500);
    await deleteSelected(page);
    removed.push(name);
  }
  return removed;
}

function evidenceNames(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/v1/characters", { cache: "no-store" });
    const value = await response.json();
    return value.characters
      .map((character) => character.name)
      .filter((name) => /^(Evidence|Probe|Doomed)/.test(name))
      .slice(0, 8);
  });
}

/** A too-short name exercises the failure path: one original-art dialog, no inline box. */
async function proveValidationDialog(page, tools) {
  const before = await page.evaluate(
    () => window.maple.snapshot().login.characters,
  );
  const input = '.online-login [name="character"]';
  await page.click(input, { count: 3 });
  await page.keyboard.press("Backspace");
  await page.type(input, "abc");
  await press(page, "Next");
  const open = await expectDialog(page)
    .then(() => true)
    .catch(() => false);
  if (!open) return null;
  const dialog = await readDialog(page);
  dialog.beforeCharacters = before;
  dialog.after = await page.evaluate(() => window.maple.snapshot().login);
  await page.screenshot({ path: join(tools.output, "error-dialog.png") });
  return dialog;
}

/** Delete asks first, cancels harmlessly, then removes the character when confirmed. */
async function deleteCreatedCharacter(page, tools, created) {
  const before = await listNames(page);
  await press(page, "Delete character");
  const confirm = await expectDialog(page);
  await page.screenshot({ path: join(tools.output, "delete-confirm.png") });
  await pressDialog(page, "cancel");
  const afterCancel = await listNames(page);
  await press(page, "Delete character");
  await expectDialog(page);
  await pressDialog(page, "confirm");
  await page.waitForFunction(
    (count) => window.maple.snapshot().login.characters < count,
    { timeout: 30000 },
    before.count,
  );
  return {
    before,
    confirm,
    afterCancel,
    after: await listNames(page),
    name: created.name,
  };
}

/** Create, prove the invalid-name dialog and deletion, then create the playable character. */
async function exerciseCreation(page, tools) {
  await press(page, "Create character");
  await waitForName(page);
  const rejection = await proveValidationDialog(page, tools);
  if (rejection) await pressDialog(page, "confirm");
  await nameCharacter(page, `Evidence${Date.now() % 1000000}`);
  const create = await readCreateScreen(page);
  await page.screenshot({ path: join(tools.output, "create.png") });
  const doomed = await createCharacter(page);
  const deletion = await deleteCreatedCharacter(page, tools, doomed);
  await press(page, "Create character");
  await waitForName(page);
  await nameCharacter(page, `Evidence${Date.now() % 1000000}`);
  return { create, rejection, deletion, created: await createCharacter(page) };
}

async function captureAudio(page, seconds) {
  return page.evaluate(async (length) => {
    const capture = await window.maple.captureAudio(length);
    const samples = new Float32Array(capture.pcm);
    let peak = 0;
    let sum = 0;
    for (const sample of samples) {
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
      sum += sample * sample;
    }
    return {
      status: capture.status,
      samples: samples.length,
      peak: Number(peak.toFixed(5)),
      rms: Number(Math.sqrt(sum / samples.length).toFixed(5)),
    };
  }, seconds);
}

async function showConsole(page) {
  const hidden = await page.$eval("#gm-console", (node) => node.hidden);
  if (hidden) await page.click("#console-toggle");
}

async function readSection(page, id) {
  await page.select("#console-section", id);
  await page.waitForFunction(
    (section) => !document.getElementById(`console-${section}`).hidden,
    { timeout: 10000 },
    id,
  );
  return page.evaluate(() => {
    const selected = document.querySelector("#console-section").value;
    const panel = document.getElementById(`console-${selected}`);
    return {
      id: selected,
      heading: panel ? (panel.querySelector("h2")?.textContent ?? null) : null,
      controls: panel
        ? panel.querySelectorAll("input, select, button, textarea").length
        : 0,
      visiblePanels: Array.from(
        document.querySelectorAll("section[id^=console-]"),
      )
        .filter((node) => !node.hidden)
        .map((node) => node.id),
    };
  });
}

async function readSections(page) {
  const sections = [];
  for (const id of CONSOLE_SECTIONS) sections.push(await readSection(page, id));
  return sections;
}

/** Composed portrait pixels and their placement inside the clipped portrait host. */
async function readPortrait(page) {
  return page.evaluate((minimum) => {
    const card = document.querySelector(
      '.online-login-card[aria-pressed="true"]',
    );
    const canvas = card.querySelector("canvas");
    const context = canvas.getContext("2d");
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] !== 0) {
        painted++;
      }
    }
    const box = canvas.getBoundingClientRect();
    const host = card
      .querySelector(".online-login-portrait")
      .getBoundingClientRect();
    return {
      painted,
      meetsMinimum: painted >= minimum,
      canvas: { width: canvas.width, height: canvas.height },
      insideHost:
        box.x >= host.x - 1 &&
        box.y >= host.y - 1 &&
        box.x + box.width <= host.x + host.width + 1 &&
        box.y + box.height <= host.y + host.height + 1,
    };
  }, MIN_PAINTED_PIXELS);
}

async function readCardClip(page) {
  return page.evaluate(() => {
    const box = document
      .querySelector('.online-login-card[aria-pressed="true"]')
      .getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
}

async function stepRoster(page) {
  const before = await page.evaluate(() => window.maple.snapshot().login);
  await page.click('.online-login-card[aria-pressed="true"]');
  await page.keyboard.press("ArrowRight");
  const moved = await page.evaluate(
    () => window.maple.snapshot().login.selected,
  );
  await page.keyboard.press("ArrowLeft");
  const back = await page.evaluate(
    () => window.maple.snapshot().login.selected,
  );
  return { start: before.selected, count: before.characters, moved, back };
}

async function readCreateScreen(page) {
  await page.waitForFunction(
    () =>
      document.querySelector(".online-login-create")?.dataset.phase ===
      "appearance",
    { timeout: TIMEOUT },
  );
  const state = await page.evaluate(() => ({
    rows: Array.from(document.querySelectorAll(".online-login-option")).map(
      (row) => ({
        label: row.querySelector(".online-login-label").textContent,
        value: row.querySelector(".online-login-option-value").textContent,
      }),
    ),
    note: document.querySelector(".online-login-note").textContent,
    choices: JSON.parse(
      document.querySelector(".online-login").dataset.options,
    ),
  }));
  const wasPaused = await page.evaluate(
    () => window.maple.snapshot().login.paused,
  );
  await showConsole(page);
  await page.select("#console-section", "world");
  await nativeLoginPause(page, true);
  const canvas = ".online-login-preview canvas";
  const before = await page.$eval(canvas, (node) => node.toDataURL());
  await clickLabel(page, "Next face", ".online-login");
  await page.waitForFunction(
    (previous) =>
      document.querySelector(".online-login-preview canvas").toDataURL() !==
      previous,
    { timeout: TIMEOUT },
    before,
  );
  state.repaint = true;
  await nativeLoginPause(page, wasPaused);
  return state;
}

async function createCharacter(page) {
  const input = '.online-login [name="character"]';
  const name = await page.$eval(input, (node) => node.value);
  const ready = await page.evaluate(() => ({
    stage: document.querySelector(".online-login")?.dataset.stage,
    dialogOpen:
      document.querySelector(".online-dialog-overlay")?.hidden === false,
    disabled:
      document.querySelector(".online-login-create-submit")?.disabled ?? null,
  }));
  if (ready.stage !== "create" || ready.dialogOpen || ready.disabled) {
    throw new Error(`Create is not available: ${JSON.stringify(ready)}`);
  }
  await press(page, "Create");
  await page.waitForFunction(
    (expected) => {
      const host = document.querySelector(".online-login");
      return (
        host.dataset.stage === "characters" &&
        !window.maple.snapshot().login.transition.active &&
        host.textContent.includes(expected)
      );
    },
    { timeout: TIMEOUT },
    name,
  );
  return page.evaluate(async (expected) => {
    const response = await fetch("/api/v1/characters", { cache: "no-store" });
    const value = await response.json();
    return (
      value.characters.find((character) => character.name === expected) ?? null
    );
  }, name);
}

async function waitForName(page) {
  await page.waitForFunction(
    () => {
      const login = window.maple?.snapshot().login;
      return (
        login?.stage === "create" &&
        login.creationPhase === "name" &&
        !login.transition.active
      );
    },
    { timeout: TIMEOUT },
  );
}

async function nameCharacter(page, name) {
  const input = '.online-login [name="character"]';
  await page.click(input, { count: 3 });
  await page.keyboard.press("Backspace");
  await page.type(input, name);
  await press(page, "Next");
  await page.waitForFunction(
    () =>
      document.querySelector(".online-login-create")?.dataset.phase ===
        "appearance" &&
      !document.querySelector(".online-login-create-submit").disabled,
    { timeout: TIMEOUT },
  );
}

function checkDeveloperSession(
  report,
  { portrait, arrows, audio, consoleState, errors },
) {
  check(
    report,
    "Selected roster portrait paints the character inside its host",
    portrait.meetsMinimum && portrait.insideHost,
    portrait,
  );
  check(
    report,
    "Roster keyboard navigation selects characters and returns to the original slot",
    (arrows.count === 1
      ? arrows.moved === arrows.start
      : arrows.moved !== arrows.start) && arrows.back === arrows.start,
    arrows,
  );
  check(
    report,
    "Login title music and field music both produce live PCM",
    audio.login.rms > MIN_TITLE_RMS && audio.field.rms > MIN_TITLE_RMS,
    audio,
  );
  check(
    report,
    "Console exposes its task sections with one panel visible and a GM badge",
    consoleState.sections.length === CONSOLE_SECTIONS.length &&
      consoleState.sections.every(
        (section) => section.heading && section.visiblePanels.length === 1,
      ) &&
      consoleState.badge === "SERVER · GM" &&
      consoleState.lifeHidden,
    consoleState,
  );
  check(
    report,
    "No unexpected page errors in the developer session",
    unexpectedErrors(errors).length === 0,
    {
      errors,
    },
  );
}

async function developerSession(browser, tools) {
  const context = await browser.createBrowserContext();
  const { page, errors } = await openPage(context);
  try {
    await signIn(page, tools, tools.accounts.developer);
    await page.screenshot({ path: join(tools.output, "roster.png") });
    await wait(1500);
    const portrait = await readPortrait(page);
    await page.screenshot({
      path: join(tools.output, "roster-portrait.png"),
      clip: await readCardClip(page),
    });
    const arrows = await stepRoster(page);
    await wait(1500);
    const audio = { login: await captureAudio(page, AUDIO_SECONDS) };
    await enterWorld(page);
    await wait(1500);
    audio.field = await captureAudio(page, AUDIO_SECONDS);
    await page.screenshot({ path: join(tools.output, "field.png") });
    await showConsole(page);
    const consoleState = {
      badge: await page.$eval(".console-badge", (node) => node.textContent),
      sections: await readSections(page),
      lifeHidden: await page.$eval("#life-inspection", (node) => node.hidden),
    };
    await page.screenshot({
      path: join(tools.output, "console-online-gm.png"),
    });
    Object.assign(tools.report, {
      portrait,
      arrows,
      audio,
      console: consoleState,
    });
    checkDeveloperSession(tools.report, {
      portrait,
      arrows,
      audio,
      consoleState,
      errors,
    });
    tools.report.developerErrors = errors;
  } finally {
    await context.close();
  }
}

function checkCreateChoices(report, create) {
  const counts = create.choices.counts;
  check(
    report,
    "Create screen offers exactly the recovered original choices",
    create.choices.source === "Etc.wz:MakeCharInfo.img/Info" &&
      counts.face === EXPECTED_FACE_COUNT &&
      counts.hairBase === EXPECTED_HAIR_BASE_COUNT &&
      counts.hairColor === EXPECTED_HAIR_COLOUR_COUNT &&
      counts.skin === EXPECTED_SKIN_COUNT &&
      create.rows.length === EXPECTED_CREATE_ROWS &&
      !create.rows.some((row) => row.label === "Hat"),
    { choices: create.choices, rows: create.rows, note: create.note },
  );
}

function checkDeletion(report, deletion) {
  const removed = deletion.before.names.filter(
    (name) => !deletion.after.names.includes(name),
  );
  check(
    report,
    "Delete asks first, cancels harmlessly and removes the character when confirmed",
    deletion.confirm.open &&
      deletion.afterCancel.names.length === deletion.before.names.length &&
      removed.length === 1 &&
      removed[0] === deletion.name &&
      deletion.after.count === deletion.before.count - 1,
    deletion,
  );
}

function checkDialogs(report, rejection) {
  check(
    report,
    "An invalid name opens a modal without advancing creation or changing the roster",
    rejection?.open === true &&
      rejection.after.creationPhase === "name" &&
      rejection.after.characters === rejection.beforeCharacters,
    { rejection },
  );
}

function checkPlayerSession(
  report,
  { create, created, fieldSelf, player, errors, rejection, deletion },
) {
  checkCreateChoices(report, create);
  checkDeletion(report, deletion);
  checkDialogs(report, rejection);
  check(
    report,
    "Changing the face repaints the create preview",
    create.repaint,
    { repaint: create.repaint },
  );
  check(
    report,
    "Created character keeps the selected original choices in the field",
    created &&
      fieldSelf.face === created.appearance.face &&
      fieldSelf.hair === created.appearance.hair &&
      fieldSelf.skin === created.appearance.skin &&
      fieldSelf.equipment.length === 4,
    { created, field: fieldSelf },
  );
  check(
    report,
    "Player session shows server authority and the GM requirement",
    player.badge === "SERVER" &&
      /GM developer session/.test(player.characterPanel),
    player,
  );
  check(
    report,
    "No unexpected page errors in the player session",
    unexpectedErrors(errors).length === 0,
    {
      errors,
    },
  );
}

async function playerSession(browser, tools) {
  const context = await browser.createBrowserContext();
  const { page, errors } = await openPage(context);
  try {
    await signIn(page, tools, tools.accounts.player);
    const cleaned = await cleanupEvidenceCharacters(page);
    const { create, rejection, deletion, created } = await exerciseCreation(
      page,
      tools,
    );
    log(
      `cleaned=${cleaned.length} doomed=${deletion.name} created=${created.name}`,
    );
    await enterWorld(page);
    await wait(1500);
    await page.screenshot({ path: join(tools.output, "field-created.png") });
    const fieldSelf = await page.evaluate(
      () => window.mapleOnline.observation().self.entity.appearance,
    );
    await showConsole(page);
    await readSection(page, "character");
    await wait(1200);
    const player = {
      badge: await page.$eval(".console-badge", (node) => node.textContent),
      characterPanel: await page.$eval("#inspection-controls", (node) =>
        node.textContent.trim().slice(0, 120),
      ),
    };
    await page.screenshot({
      path: join(tools.output, "console-online-player.png"),
    });
    Object.assign(tools.report, {
      created,
      fieldSelf,
      player,
      create,
      rejection,
      deletion,
      cleaned,
    });
    checkPlayerSession(tools.report, {
      create,
      created,
      fieldSelf,
      player,
      errors,
      rejection,
      deletion,
    });
    tools.report.playerErrors = errors;
  } finally {
    await context.close();
  }
}
