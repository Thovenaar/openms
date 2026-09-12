import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CONSOLE_SECTIONS } from "../../src/development/inspection-theme.js";
import { assertion } from "../native-evidence.js";
import { TIMEOUT } from "./native.js";

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
      "Real Chromium against the development proxy and server: recovered creation choices, carousel portrait pixels, login music and console sections. Not original Windows parity.",
    checks: [],
  };
  const tools = { report, url, password, accounts, output };
  log("developer session");
  await developerSession(browser, tools);
  log("player session");
  await playerSession(browser, tools);
  report.status = report.checks.every((item) => item.pass) ? "pass" : "fail";
  report.finishedAt = new Date().toISOString();
  await Bun.write(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  return report;
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
  // The sign-in tab shares its label, so submit through the form's own button.
  await page.click(".online-login-submit");
  try {
    await waitForCarousel(page);
  } catch {
    // A refused challenge or a stale build states its reason; surface it, then retry once.
    const state = await readDialog(page);
    log(`sign in retry (${JSON.stringify(state.text ?? "no dialog")})`);
    if (state.open) await pressDialog(page, "confirm");
    await page.click(".online-login-submit");
    await waitForCarousel(page);
  }
}

async function waitForCarousel(page) {
  await page.waitForFunction(
    () => {
      const stage = document.querySelector(
        '.online-login[data-stage="characters"] .online-login-characters',
      );
      const enter = stage?.querySelector(".online-login-enter");
      return Boolean(
        stage?.querySelector(".online-login-card") && enter && !enter.disabled,
      );
    },
    { timeout: TIMEOUT },
  );
}

async function press(page, label) {
  await page.evaluate((text) => {
    const button = Array.from(
      document.querySelectorAll(".online-login button"),
    ).find((node) => node.textContent === text && !node.disabled);
    if (button) {
      button.click();
    }
  }, label);
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
    const status = document.querySelector(".online-login-status")?.textContent;
    return dialog || status || null;
  });
  throw new Error(`Entering the world failed: ${message}`);
}

/** The bottom message box is gone; failures must surface as a Win95 dialog. */
function readDialog(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector(".online-dialog-overlay");
    const cancel = document.querySelector(".online-dialog-cancel");
    return {
      open: Boolean(overlay && !overlay.hidden),
      title: document.querySelector(".online-dialog .maple95-title")
        ?.textContent,
      text: document.querySelector(".online-dialog-text")?.textContent,
      confirm: document.querySelector(".online-dialog-confirm")?.textContent,
      cancel: cancel && !cancel.hidden ? cancel.textContent : null,
      messageBoxes: document.querySelectorAll(
        ".online-login-message, .online-login-hint",
      ).length,
    };
  });
}

async function pressDialog(page, choice) {
  await page.evaluate(
    (selector) => {
      const button = document.querySelector(selector);
      if (button) button.click();
    },
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

/** Account characters as the server reports them, plus the carousel count. */
function listNames(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/v1/characters", { cache: "no-store" });
    const value = await response.json();
    return {
      names: value.characters.map((character) => character.name),
      dots: document.querySelectorAll(".online-login-dot").length,
    };
  });
}

/** Select one carousel entry by name; false when it is no longer listed. */
function selectCharacter(page, name) {
  return page.evaluate((expected) => {
    const dots = Array.from(document.querySelectorAll(".online-login-dot"));
    const index = dots.findIndex((dot) =>
      dot.getAttribute("aria-label")?.includes(expected),
    );
    if (index < 0) return false;
    dots[index].click();
    return true;
  }, name);
}

/** Open the confirm dialog and accept it, waiting for the entry to disappear. */
async function deleteSelected(page) {
  const before = await page.evaluate(
    () => document.querySelectorAll(".online-login-dot").length,
  );
  await press(page, "Delete character");
  await expectDialog(page);
  await pressDialog(page, "confirm");
  await page.waitForFunction(
    (count) => document.querySelectorAll(".online-login-dot").length < count,
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

/** A too-short name exercises the failure path: one Win95 dialog, no inline box. */
async function proveValidationDialog(page, tools) {
  await page.evaluate(() => {
    document.querySelector('.online-login [name="character"]').value = "abc";
  });
  await press(page, "Create");
  const open = await expectDialog(page)
    .then(() => true)
    .catch(() => false);
  if (!open) return null;
  const dialog = await readDialog(page);
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
    (count) => document.querySelectorAll(".online-login-dot").length < count,
    { timeout: 30000 },
    before.dots,
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
  const create = await readCreateScreen(page);
  await page.screenshot({ path: join(tools.output, "create.png") });
  const rejection = await proveValidationDialog(page, tools);
  if (rejection) await pressDialog(page, "confirm");
  const doomed = await createCharacter(page);
  const deletion = await deleteCreatedCharacter(page, tools, doomed);
  // Deletion returns to the carousel, so reopen the create screen for the playable one.
  await press(page, "Create character");
  await page.waitForFunction(
    () => document.querySelector(".online-login")?.dataset.stage === "create",
    { timeout: TIMEOUT },
  );
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
    const card = document.querySelector(".online-login-card");
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
      placeholderHidden: card.querySelector(".online-login-mark").hidden,
    };
  }, MIN_PAINTED_PIXELS);
}

async function readCardClip(page) {
  return page.evaluate(() => {
    const box = document
      .querySelector(".online-login-card")
      .getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
}

async function stepCarousel(page) {
  return page.evaluate(async () => {
    const index = () =>
      Array.from(document.querySelectorAll(".online-login-dot")).findIndex(
        (dot) => dot.textContent === "●",
      );
    const start = index();
    document.querySelector(".online-login-next").click();
    await new Promise((done) => {
      setTimeout(done, 400);
    });
    const moved = index();
    document.querySelector(".online-login-previous").click();
    await new Promise((done) => {
      setTimeout(done, 400);
    });
    return { start, moved, back: index() };
  });
}

async function readCreateScreen(page) {
  await page.waitForFunction(
    () => document.querySelector(".online-login").dataset.stage === "create",
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
  state.repaint = await page.evaluate(async () => {
    const canvas = document.querySelector(".online-login-preview canvas");
    const before = canvas.toDataURL();
    const row = Array.from(
      document.querySelectorAll(".online-login-option"),
    ).find(
      (entry) =>
        entry.querySelector(".online-login-label").textContent === "Face",
    );
    row.querySelector(".online-login-option-next").click();
    await new Promise((done) => {
      setTimeout(done, 1200);
    });
    return canvas.toDataURL() !== before;
  });
  return state;
}

async function createCharacter(page) {
  const input = '.online-login [name="character"]';
  // The field keeps whatever a previous step typed, so replace it outright.
  await page.$eval(input, (node) => {
    node.value = "";
  });
  await page.type(input, `Evidence${Date.now() % 1000000}`);
  // The field caps names at 13 characters, so read back what it accepted.
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

function checkDeveloperSession(
  report,
  { portrait, arrows, audio, consoleState, errors },
) {
  check(
    report,
    "Carousel portrait paints the character inside its host without the placeholder",
    portrait.meetsMinimum && portrait.insideHost && portrait.placeholderHidden,
    portrait,
  );
  check(
    report,
    "Carousel arrows move the selection",
    arrows.moved !== arrows.start && arrows.back === arrows.start,
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
  const { page, errors } = await openPage(browser);
  try {
    await signIn(page, tools, tools.accounts.developer);
    await page.screenshot({ path: join(tools.output, "carousel.png") });
    await wait(1500);
    const portrait = await readPortrait(page);
    await page.screenshot({
      path: join(tools.output, "carousel-portrait.png"),
      clip: await readCardClip(page),
    });
    const arrows = await stepCarousel(page);
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
    await page.close();
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
      !create.rows.some((row) => row.label === "Hat") &&
      create.rows.some(
        (row) => row.label === "Hair colour" && row.value === "Black",
      ),
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
      deletion.confirm.cancel === "Cancel" &&
      /cannot be undone/.test(deletion.confirm.text ?? "") &&
      deletion.afterCancel.names.length === deletion.before.names.length &&
      removed.length === 1 &&
      removed[0] === deletion.name &&
      deletion.after.dots === deletion.before.dots - 1,
    deletion,
  );
}

function checkDialogs(report, rejection, deletion) {
  check(
    report,
    "Failures open a Win95 dialog and the login keeps no bottom message box",
    rejection?.open === true &&
      rejection.messageBoxes === 0 &&
      deletion.confirm.messageBoxes === 0,
    { rejection, messageBoxes: deletion.confirm.messageBoxes },
  );
}

function checkPlayerSession(
  report,
  { create, created, fieldSelf, player, errors, rejection, deletion },
) {
  checkCreateChoices(report, create);
  checkDeletion(report, deletion);
  checkDialogs(report, rejection, deletion);
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
  const { page, errors } = await openPage(browser);
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
    await page.close();
  }
}
