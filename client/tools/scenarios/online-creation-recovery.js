import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { validStartingStats } from "../../../shared/starting-stats.js";

const TIMEOUT = 30000;
const STATS = ["str", "dex", "int", "luk"];

/** Isolated browser context and newly registered fixture account. No gameplay.
 * Native input drives success; direct HTTP is reserved for adversarial rejection. */
export async function runOnlineCreationRecovery({
  browser,
  url,
  output,
  account,
}) {
  await mkdir(output, { recursive: true });
  const report = {
    schemaVersion: 1,
    status: "running",
    timings: {},
    checks: [],
    captures: [],
  };
  const context = await measureStage(report.timings, "browserAcquisition", () =>
    browser.createBrowserContext(),
  );
  const page = await context.newPage();
  const tools = { page, report, output, account, url };
  try {
    await measureStage(report.timings, "readiness", () => readiness(tools));
    await measureStage(report.timings, "registration", () =>
      registration(tools),
    );
    await measureStage(report.timings, "creation", () => creation(tools));
    await measureStage(report.timings, "reconnect", () => reconnect(tools));
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
    report.login = await page.evaluate(() => window.maple?.snapshot().login);
    report.text = await page.evaluate(
      () => document.querySelector(".online-login")?.innerText,
    );
    await capture(tools, "failure");
  } finally {
    await measureStage(report.timings, "teardown", () => context.close());
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}

async function readiness(tools) {
  const { page, url, report } = tools;
  await page.setViewport({ width: 1280, height: 800 });
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
  await page.waitForFunction(() => window.maple?.snapshot().login?.artwork, {
    timeout: TIMEOUT,
  });
  report.identity = await onlineIdentity(url);
  const observed = await page.evaluate(() => ({
    source: window.maple.snapshot().sourceBuildId,
    assets: window.maple.snapshot().login.catalogBuildId,
  }));
  assertion(
    observed.source === report.identity.sourceBuildId &&
      observed.assets === report.identity.assetBuildId,
    "Served source/catalog differs from workspace",
    { actual: observed },
  );
  if (
    await page.$eval(
      "#console-toggle",
      (node) => node.getAttribute("aria-expanded") === "true",
    )
  ) {
    await page.click("#console-toggle");
  }
}

async function fill(page, selector, text) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(selector, text);
}

async function registration(tools) {
  const { page, report, account } = tools;
  await page.click(".online-login-register");
  await fill(page, '[name="registration-name"]', "admin");
  for (const name of ["registration-password", "registration-confirm"]) {
    await page.type(`[name="${name}"]`, "password");
  }
  await page.click(".online-registration-submit");
  await page.waitForFunction(
    () =>
      document
        .querySelector(".online-registration-status")
        .textContent.includes("already used"),
    { timeout: TIMEOUT },
  );
  assertion(
    await page.$eval(".online-registration-overlay", (node) => !node.hidden),
    "Duplicate account closed registration",
  );
  await capture(tools, "registration-retry");
  await fill(page, '[name="registration-name"]', account);
  for (const name of ["registration-password", "registration-confirm"]) {
    await fill(page, `[name="${name}"]`, "password");
  }
  await page.keyboard.press("Enter");
  await stage(page, "characters");
  assertion(
    (await characters(page)).length === 0,
    "Registration silently created a character",
  );
  report.checks.push(
    "Duplicate registration stays editable; Enter registers a fresh player account with an empty roster.",
  );
}

async function stage(page, expected) {
  await page.waitForFunction(
    (name) => {
      const login = window.maple?.snapshot().login;
      return (
        login?.stage === name &&
        !login.transition.active &&
        document.querySelector(".online-login").getAttribute("aria-busy") ===
          "false"
      );
    },
    { timeout: TIMEOUT },
    expected,
  );
}

async function phase(page, expected) {
  await page.waitForFunction(
    (name) =>
      document.querySelector(".online-login-create").dataset.phase === name &&
      document.querySelector(".online-login").getAttribute("aria-busy") ===
        "false",
    { timeout: TIMEOUT },
    expected,
  );
}

async function creation(tools) {
  const { page, report } = tools;
  await page.click(".online-login-new");
  await stage(page, "create");
  await page.type('[name="character"]', "DiceHero");
  const name = await geometry(page);
  assertion(
    name.name.x === 545 &&
      name.name.y === 203 &&
      name.name.width === 120 &&
      name.name.height === 15,
    "Name input differs from original (545,203), 120×15",
    { actual: name.name },
  );
  assertion(
    name.feet.x === 422 && name.feet.y === 339,
    "Avatar feet differ from recovered (422,339)",
    { actual: name.feet },
  );
  report.nameGeometry = name;
  await capture(tools, "name");
  await page.click(".online-login-create-submit");
  await phase(page, "appearance");
  await page.click('[aria-label="Next face"]');
  await capture(tools, "appearance");
  await page.click(".online-login-create-submit");
  await phase(page, "stats");
  assertion(
    await page.$eval(".online-login-create-submit", (node) => node.disabled),
    "Creation allowed before a roll",
  );
  await roll(tools, false);
  await page.click(".online-login-back");
  await phase(page, "appearance");
  await page.click(".online-login-create-submit");
  await phase(page, "stats");
  await roll(tools, true);
  await page.waitForFunction(
    () => !window.maple.snapshot().login.dice.rolling,
    { timeout: TIMEOUT },
  );
  await capture(tools, "dice");
  await minimumViewport(tools);
  await commitCharacter(tools);
  report.checks.push(
    "Native name → appearance → dice → creation preserves the server roll, and Back retains appearance choices.",
  );
}

async function roll(tools, keyboard) {
  const { page, report } = tools;
  const pending = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/character-roll"),
    { timeout: TIMEOUT },
  );
  await page.focus(".online-login-roll");
  if (keyboard) await page.keyboard.press("Space");
  else await page.click(".online-login-roll");
  const response = await pending;
  assertion(response.ok(), `Roll failed with HTTP ${response.status()}`);
  const rolled = await response.json();
  assertion(
    validStartingStats(rolled),
    "Server returned invalid starting stats",
  );
  tools.roll = rolled;
  await page.waitForFunction(
    () => !document.querySelector(".online-login-create-submit").disabled,
    { timeout: TIMEOUT },
  );
  const displayed = await page.$$eval(".online-login-stat-value", (nodes) =>
    nodes.map((node) => Number(node.value)),
  );
  assertion(
    STATS.every((key, index) => rolled[key] === displayed[index]),
    "Displayed stats differ from server roll",
  );
  report.rolledStats = Object.fromEntries(
    STATS.map((key) => [key, rolled[key]]),
  );
}

async function minimumViewport(tools) {
  const { page, report } = tools;
  await page.setViewport({ width: 800, height: 600 });
  await page.waitForFunction(() => window.innerWidth === 800);
  report.minimumGeometry = await geometry(page);
  const bounds = await page.$eval(".online-login-stats-step", (node) =>
    node.getBoundingClientRect().toJSON(),
  );
  assertion(
    bounds.left >= 0 &&
      bounds.right <= 800 &&
      bounds.top >= 0 &&
      bounds.bottom <= 600,
    "Dice pane clipped at minimum viewport",
  );
  await capture(tools, "dice-800x600");
  await page.setViewport({ width: 1280, height: 800 });
}

async function commitCharacter(tools) {
  const { page, report } = tools;
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/characters") &&
      response.request().method() === "POST",
    { timeout: TIMEOUT },
  );
  await page.click(".online-login-create-submit");
  const response = await pending;
  assertion(response.ok(), `Creation failed with HTTP ${response.status()}`);
  tools.payload = JSON.parse(response.request().postData());
  await stage(page, "characters");
  tools.character = (await characters(page))[0];
  assertion(
    STATS.every((key) => tools.character.stats[key] === tools.roll[key]),
    "Committed stats differ from the accepted roll",
  );
  report.character = tools.character;
  report.bannerGeometry = await bannerGeometry(page);
  assertion(
    report.bannerGeometry.every((cell) => cell.contained),
    "Stat value crosses its banner boundary",
  );
  await page.waitForFunction(
    () => window.maple.snapshot().login.portraits >= 2,
    { timeout: TIMEOUT },
  );
  await capture(tools, "selection");
  await rejectTampering(tools);
}

async function rejectTampering(tools) {
  const { page, payload, report } = tools;
  const result = await page.evaluate(async (valid) => {
    const results = [];
    for (const patch of [{ str: 999 }, { str: 4.5 }, { rollId: "forged" }]) {
      const response = await fetch("/api/v1/characters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...valid, name: "ForgedHero", ...patch }),
      });
      results.push({
        status: response.status,
        code: (await response.json()).code,
      });
    }
    return results;
  }, payload);
  assertion(
    result.every(
      (entry) => entry.status === 400 && entry.code === "INVALID_MESSAGE",
    ),
    "Server accepted tampered stats",
    { actual: result },
  );
  assertion(
    (await characters(page)).length === 1,
    "Rejected creation mutated the roster",
  );
  report.rejections = result;
}

async function reconnect(tools) {
  const { page, account, report, character } = tools;
  // Sign out is an existing inspection control; open that panel through its native toggle.
  if (
    await page.$eval(
      "#console-toggle",
      (node) => node.getAttribute("aria-expanded") !== "true",
    )
  ) {
    await page.click("#console-toggle");
  }
  await page.click(".online-login-signout");
  await stage(page, "account");
  await page.type('[name="name"]', account);
  await page.type('[name="password"]', "password");
  await page.keyboard.press("Enter");
  await stage(page, "characters");
  const roster = await characters(page);
  assertion(
    roster.length === 1 &&
      roster[0].id === character.id &&
      STATS.every((key) => roster[0].stats[key] === character.stats[key]),
    "Saved rolled character differs after sign-in",
  );
  report.checks.push(
    "Forged stats produce HTTP 400 without extra characters; the chosen stats survive sign-out/sign-in.",
  );
}

function characters(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/v1/characters");
    if (!response.ok) throw new Error(`Roster HTTP ${response.status}`);
    return (await response.json()).characters;
  });
}

function geometry(page) {
  return page.evaluate(() => {
    const root = document
      .querySelector(".online-login-window")
      .getBoundingClientRect();
    const scale = root.width / 800;
    const input = document
      .querySelector('[name="character"]')
      .getBoundingClientRect();
    const preview = document
      .querySelector(".online-login-preview")
      .getBoundingClientRect();
    const relative = (rect) => ({
      x: Math.round((rect.x - root.x) / scale),
      y: Math.round((rect.y - root.y) / scale),
      width: Math.round(rect.width / scale),
      height: Math.round(rect.height / scale),
    });
    const avatar = relative(preview);
    return {
      name: input.width ? relative(input) : null,
      feet: { x: avatar.x + avatar.width / 2, y: avatar.y + avatar.height },
      scale,
    };
  });
}

function bannerGeometry(page) {
  return page.evaluate(() => {
    const box = document
      .querySelector(".online-login-character-detail")
      .getBoundingClientRect();
    return [
      ...document.querySelectorAll(".online-login-character-detail > span"),
    ].map((node) => {
      const cell = node.getBoundingClientRect();
      return {
        field: node.className,
        text: node.textContent,
        contained:
          cell.left >= box.left &&
          cell.right <= box.right &&
          cell.bottom <= box.bottom,
      };
    });
  });
}

async function capture({ page, output, report }, name) {
  await page.screenshot({ path: join(output, `${name}.png`) });
  report.captures.push(`${name}.png`);
}
