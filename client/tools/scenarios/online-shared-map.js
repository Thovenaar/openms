import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, measureStage } from "../native-evidence.js";
import { clickLabel, focusCanvas, openConsoleSection } from "./native.js";
import { onlineIdentity } from "./online-lifecycle.js";
import {
  prepareSharedActions,
  recordSharedEvents,
  exerciseSharedActions,
} from "./online-shared-actions.js";

const TIMEOUT = 30000;

/** Native selection/creation and two-account map visibility; borrows servers/browser. */
export async function runOnlineSharedMap({
  browser,
  url,
  output,
  password = "password",
}) {
  await mkdir(output, { recursive: true });
  const report = {
    status: "running",
    timings: {},
    checks: [],
    errors: [],
    events: [[], []],
  };
  report.identity = await measureStage(report.timings, "identity", () =>
    onlineIdentity(url),
  );
  const contexts = [];
  const pages = [];
  try {
    await measureStage(report.timings, "browserAcquisition", () =>
      acquirePages(browser, contexts, pages, report),
    );
    const tools = { pages, url, output, report, password };
    await measureStage(report.timings, "loginAndCreation", () =>
      loginAndCreation(tools),
    );
    await measureStage(report.timings, "sharedMap", () => sharedMap(tools));
    const identity = await onlineIdentity(url);
    assertion(
      identity.sourceBuildId === report.identity.sourceBuildId,
      "Source changed during replay",
    );
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = { message: error.message, stack: error.stack };
    report.observations = [];
    for (const [index, page] of pages.entries()) {
      report.observations.push(await observation(page));
      await page.screenshot({ path: join(output, `failure-${index}.png`) });
    }
  } finally {
    await measureStage(report.timings, "teardown", () =>
      closeContexts(contexts, pages, report),
    );
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}

async function closeContexts(contexts, pages, report) {
  for (const [index, context] of contexts.entries()) {
    try {
      await logout(pages[index]);
    } catch (error) {
      report.status = "fail";
      report.errors.push(`Teardown: ${error.message}`);
    } finally {
      await context.close();
    }
  }
}

async function acquirePages(browser, contexts, pages, report) {
  for (let index = 0; index < 2; index++) {
    const context = await browser.createBrowserContext();
    contexts.push(context);
    const page = await context.newPage();
    await recordSharedEvents(page, report, index);
    page.on("pageerror", (error) => {
      if (report.errors.length < 32) report.errors.push(error.message);
    });
    pages.push(page);
    await page.setViewport({ width: 1280, height: 800 });
    const wire = await page.createCDPSession();
    await wire.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  }
}

async function login(page, url, name, password) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
  await page.waitForFunction(() => window.maple?.snapshot().login?.artwork, {
    timeout: TIMEOUT,
  });
  await page.type('.online-login [name="name"]', name);
  await page.type('.online-login [name="password"]', password);
  await page.click(".online-login-submit");
  await roster(page);
}

async function roster(page) {
  await page.waitForFunction(
    () => {
      const login = window.maple.snapshot().login;
      return (
        login.stage === "characters" &&
        !login.transition.active &&
        login.portraits > 0
      );
    },
    { timeout: TIMEOUT },
  );
}

async function loginAndCreation(tools) {
  const { pages, url, password, report, output } = tools;
  await login(pages[0], url, "admin", password);
  for (let index = 0; index < 2; index++) await createCharacter(tools, index);
  await pages[0].click(".online-login-card:nth-child(2)");
  report.selection = await layout(pages[0]);
  assertion(
    report.selection.info.fontSize === "12px" &&
      report.selection.info.color === "rgb(0, 0, 0)",
    "Selection font differs from original font1",
  );
  await pages[0].screenshot({ path: join(output, "selection.png") });
  await pages[0].setViewport({ width: 800, height: 600 });
  await pages[0].click("#console-toggle");
  await pages[0].screenshot({ path: join(output, "selection-800x600.png") });
  await pages[0].setViewport({ width: 1280, height: 800 });
  await pages[0].click("#console-toggle");
  await pages[0].click(".online-login-enter");
  await ready(pages[0]);
  await prepareSharedActions(pages[0], report);
  await login(pages[1], url, "player", password);
  await pages[1].click(".online-login-enter");
  await ready(pages[1]);
  report.checks.push(
    "Original selection font/background captured; both creation phases and original action rows exercised",
  );
}

async function createCharacter({ pages, report, output }, index) {
  const page = pages[0];
  await page.click(".online-login-new");
  await page.waitForFunction(
    () => !window.maple.snapshot().login.transition.active,
    { timeout: TIMEOUT },
  );
  await page.type('[name="character"]', `SharedProbe${index}`);
  if (index === 0) {
    report.nameLayout = await layout(page);
    assertion(
      report.nameLayout.submit.y === 273,
      "Name confirmation moved from its original row",
    );
    await page.screenshot({ path: join(output, "creation-name.png") });
  }
  await page.click(".online-login-create-submit");
  await page.waitForFunction(
    () => window.maple.snapshot().login.creationPhase === "appearance",
    { timeout: TIMEOUT },
  );
  if (index === 0) {
    await clickLabel(page, "Next face", ".online-login-options");
    report.appearanceLayout = await layout(page);
    assertion(
      report.appearanceLayout.submit.x === 546 &&
        report.appearanceLayout.submit.y === 425,
      "Appearance confirmation differs from original (546,425)",
    );
    assertion(
      report.appearanceLayout.cancel.x === 620 &&
        report.appearanceLayout.cancel.y === 425,
      "Appearance cancel differs from original (620,425)",
    );
    assertion(
      report.appearanceLayout.rows.every((r, i) => r.y === 200 + i * 18),
      "Appearance rows differ from original spacing",
    );
    await page.screenshot({ path: join(output, "creation-appearance.png") });
    await page.setViewport({ width: 800, height: 600 });
    await page.click("#console-toggle");
    await page.screenshot({ path: join(output, "creation-800x600.png") });
    await page.setViewport({ width: 1280, height: 800 });
    await page.click("#console-toggle");
  }
  await rollAndCreate(page);
  await roster(page);
}

async function rollAndCreate(page) {
  await page.click(".online-login-create-submit");
  await page.waitForSelector('.online-login-create[data-phase="stats"]', {
    timeout: TIMEOUT,
  });
  await page.click(".online-login-roll");
  await page.waitForFunction(
    () => !document.querySelector(".online-login-create-submit").disabled,
    { timeout: TIMEOUT },
  );
  const reply = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/characters") && r.request().method() === "POST",
    { timeout: TIMEOUT },
  );
  await page.click(".online-login-create-submit");
  const response = await reply;
  assertion(response.ok(), `Character creation HTTP ${response.status()}`);
}

function layout(page) {
  return page.evaluate(() => {
    const root = document
      .querySelector(".online-login-window")
      .getBoundingClientRect();
    function bounds(selector) {
      const node = document.querySelector(selector);
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        x: rect.x - root.x,
        y: rect.y - root.y,
        fontSize: style.fontSize,
        color: style.color,
      };
    }
    return {
      info: bounds(".online-login-character-detail"),
      submit: bounds(".online-login-create-submit"),
      cancel: bounds(".online-login-back"),
      rows: [...document.querySelectorAll(".online-login-option")].map(
        (node) => ({ y: node.getBoundingClientRect().y - root.y }),
      ),
    };
  });
}

async function ready(page) {
  await page.waitForFunction(
    () => {
      const state = window.maple.snapshot();
      return (
        state.online.status === "active" &&
        !state.loading &&
        state.ui?.ready &&
        state.ui.pending.length === 0
      );
    },
    { timeout: TIMEOUT },
  );
}

function observation(page) {
  return page.evaluate(() => {
    const state = window.maple?.snapshot();
    if (!state) return { error: "Browser inspection unavailable" };
    const model = window.mapleOnline?.observation();
    return {
      login: state.login,
      online: state.online,
      sourceBuildId: state.sourceBuildId,
      mapId: state.currentMap,
      field: model?.field,
      selfId: state.selfId,
      input: state.input,
      position: state.presentation,
      activeElement: document.activeElement?.tagName,
      pendingWindows: state.ui?.pending,
      players: model?.entities
        .filter((e) => e.kind === "player")
        .map((e) => ({
          id: e.id,
          position: e.position,
          name: e.appearance.name,
        })),
      error: state.lastError,
      errorLog: document.querySelector("#error")?.value.slice(0, 4000),
    };
  });
}

async function sharedMap(tools) {
  const { pages, output, report } = tools;
  const ids = await Promise.all(
    pages.map((page) => page.evaluate(() => window.maple.snapshot().selfId)),
  );
  for (const page of pages) {
    await page.waitForFunction(
      (expected) => {
        const players = window.mapleOnline
          .observation()
          .entities.filter((e) => e.kind === "player");
        return expected.every((id) => players.some((e) => e.id === id));
      },
      { timeout: TIMEOUT },
      ids,
    );
  }
  report.joined = await Promise.all(pages.map(observation));
  assertion(
    report.joined[0].field.instanceId === report.joined[1].field.instanceId,
    "Roles entered different map instances",
  );
  await movePeer(pages, ids[0]);
  report.moved = await Promise.all(pages.map(observation));
  for (const [index, page] of pages.entries()) {
    await page.screenshot({ path: join(output, `shared-map-${index}.png`) });
  }
  await exerciseSharedActions(tools, ids[0]);
  const epoch = report.joined[0].online.connectionEpoch;
  await openConsoleSection(pages[0], "diagnostics");
  await clickLabel(pages[0], "Reconnect session", "#state-testing-controls");
  await pages[0].waitForFunction(
    (before) => window.maple.snapshot().online.connectionEpoch !== before,
    { timeout: TIMEOUT },
    epoch,
  );
  await ready(pages[0]);
  report.reconnected = await observation(pages[0]);
  assertion(
    report.reconnected.players.some((p) => p.id === ids[1]),
    "Reconnect lost the other player",
  );
  assertion(
    report.reconnected.field.instanceId === report.joined[1].field.instanceId,
    "Reconnect entered a different map",
  );
  report.checks.push(
    "Developer and player see both actors in the same map, observe native movement, and retain shared membership after reconnect",
  );
}

async function movePeer(pages, id) {
  await pages[0].bringToFront();
  await ready(pages[0]);
  await pages[0].waitForFunction(
    () => window.maple.snapshot().simulation.state === "ground",
    { timeout: TIMEOUT },
  );
  await focusCanvas(pages[0]);
  await pages[0].waitForFunction(
    () => document.activeElement === document.querySelector("#viewport canvas"),
    { timeout: TIMEOUT },
  );
  const x = await pages[0].evaluate(
    () => window.maple.snapshot().presentation.x,
  );
  await pages[0].keyboard.down("ArrowRight");
  try {
    await pages[1].waitForFunction(
      (peer, before) =>
        window.mapleOnline.observation().entities.find((e) => e.id === peer)
          ?.position.x >
        before + 35,
      { timeout: TIMEOUT },
      id,
      x,
    );
  } finally {
    await pages[0].keyboard.up("ArrowRight");
  }
}

async function logout(page) {
  if (page.url() === "about:blank") return;
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
