import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { participant, closeConsole, ready } from "./online-ui-repairs.js";
import { clickLabel, openConsoleSection } from "./native.js";

const DIALOG = '.maple-ui-panel[aria-label="UtilDlgEx"]';
const NATIVE = `${DIALOG} [aria-label="Native NPC dialogue"]`;

/** Real worker turns and native controls; no live profile, dialogue or position injection. */
export async function runOnlineCabDialogue({ browser, url, output }) {
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
    const rider = await participant(browser, contexts, pages, report);
    await measureStage(report.timings, "login", () =>
      login(rider, url, "cabrider"),
    );
    await measureStage(report.timings, "cancel-stages", () =>
      cancelStages(rider, report),
    );
    await measureStage(report.timings, "pending-cancel", () =>
      pendingCancel(rider, report),
    );
    await measureStage(report.timings, "cab-ride", () =>
      cabRide(rider, output, report),
    );
    await measureStage(report.timings, "reconnect", () => reconnect(rider));
    assertion(
      (await rider.evaluate(() => window.maple.snapshot().profile.meso)) ===
        1900,
      "Fare did not survive reconnect",
    );
    const poor = await participant(browser, contexts, pages, report);
    await login(poor, url, "cabpoor");
    await measureStage(report.timings, "insufficient-fare", () =>
      insufficientFare(poor, report),
    );
    await verify(pages, url, report);
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

async function verify(pages, url, report) {
  for (const page of pages) {
    assertion(
      !(await page.$eval("#error", (node) => node.value)),
      "Game error journal is not empty",
    );
  }
  assertion(report.errors.length === 0, "Browser errors", report.errors);
  assertion(
    report.results.every((result) => result.status === "committed"),
    "Rejected NPC action",
    report.results,
  );
  assertion(
    (await onlineIdentity(url)).sourceBuildId === report.identity.sourceBuildId,
    "Source changed during cab check",
  );
}

async function login(page, url, account) {
  await page.goto(url);
  await page.bringToFront();
  await page.waitForFunction(() => window.maple?.snapshot().login?.artwork);
  await closeConsole(page);
  await page.type('[name="name"]', account);
  await page.type('[name="password"]', "password");
  await page.click(".online-login-submit");
  await page.waitForFunction(() => {
    const login = window.maple.snapshot().login;
    return login.stage === "characters" && !login.transition.active;
  });
  await page.click(".online-login-enter");
  await ready(page);
}

async function cab(page) {
  const point = await page.evaluate(() => {
    const npc = window.mapleOnline
      .observation()
      .entities.find(
        (entry) => entry.kind === "npc" && entry.templateId === 1012000,
      );
    const point = window.mapleOnline.project(
      npc.position.x,
      npc.position.y - 20,
    );
    const bounds = document
      .querySelector("#viewport canvas")
      .getBoundingClientRect();
    return { x: bounds.left + point.x, y: bounds.top + point.y };
  });
  await page.mouse.click(point.x, point.y);
  await text(page, "Hello, I drive the Regular Cab.");
}

function text(page, expected) {
  return page.waitForFunction(
    (selector, value) =>
      document.querySelector(selector)?.textContent.includes(value),
    {},
    NATIVE,
    expected,
  );
}

async function destinations(page) {
  await clickLabel(page, "Next", NATIVE);
  await page.waitForSelector(`${NATIVE} [data-quest-choice="4"]`, {
    visible: true,
  });
  assertion(
    (await page.$$(`${NATIVE} [data-quest-choice]`)).length === 5,
    "Cab must offer all five authored destinations",
  );
}

async function confirmation(page) {
  await page.click(`${NATIVE} [data-quest-choice="0"]`);
  await text(page, "100 mesos");
  await page.waitForSelector(`${NATIVE} [aria-label="Yes"]`, { visible: true });
}

async function closeChat(page) {
  await clickLabel(page, "Close dialogue", NATIVE);
  await page.waitForSelector(DIALOG, { hidden: true, timeout: 1000 });
  await page.waitForFunction(
    () => window.maple.snapshot().online.pendingOperations === 0,
  );
}

async function cancelStages(page, report) {
  for (const stage of [0, 1, 2]) {
    await cab(page);
    if (stage >= 1) await destinations(page);
    if (stage >= 2) await confirmation(page);
    await closeChat(page);
  }
  assertion(
    (await page.evaluate(() => window.maple.snapshot().profile.meso)) === 2000,
    "Cancellation charged a fare",
  );
  report.checks.push(
    "End Chat closes the introduction, destination menu and confirmation without charging a fare",
  );
}

async function pendingCancel(page, report) {
  await cab(page);
  await clickLabel(page, "Next", NATIVE);
  report.cancelWhilePending = await page.evaluate(
    () => window.maple.snapshot().online.pendingOperations > 0,
  );
  assertion(
    report.cancelWhilePending,
    "Expected an in-flight worker turn for cancellation",
  );
  await closeChat(page);
  await reconnect(page);
  assertion(
    !(await page.$(DIALOG)),
    "Cancelled dialogue reopened after reconnect",
  );
  report.checks.push(
    "End Chat stays enabled during a worker turn, closes immediately, and remains closed after its late result and reconnect",
  );
}

async function cabRide(page, output, report) {
  await cab(page);
  await destinations(page);
  await page.screenshot({ path: join(output, "cab-destinations.png") });
  await confirmation(page);
  await clickLabel(page, "Yes", NATIVE);
  await page.waitForFunction(() => {
    const state = window.maple.snapshot();
    return (
      state.online.status === "active" &&
      !state.loading &&
      state.currentMap === "104000000" &&
      state.profile.meso === 1900
    );
  });
  await page.waitForSelector(DIALOG, { hidden: true });
  report.checks.push(
    "Beginner cab ride reaches Lith Harbor and atomically charges its original 100-meso fare",
  );
}

async function reconnect(page) {
  const epoch = await page.evaluate(
    () => window.maple.snapshot().online.connectionEpoch,
  );
  if (await page.$eval("#gm-console", (node) => node.hidden)) {
    await page.click("#console-toggle");
  }
  await openConsoleSection(page, "diagnostics");
  await clickLabel(page, "Reconnect session", "#state-testing-controls");
  await page.waitForFunction(
    (previous) => {
      const state = window.maple.snapshot();
      return (
        state.online.status === "active" &&
        !state.loading &&
        state.online.connectionEpoch !== previous
      );
    },
    {},
    epoch,
  );
  await closeConsole(page);
}

async function insufficientFare(page, report) {
  await cab(page);
  await destinations(page);
  await confirmation(page);
  await clickLabel(page, "Yes", NATIVE);
  await text(page, "don't have enough mesos");
  await closeChat(page);
  const state = await page.evaluate(() => window.maple.snapshot());
  assertion(
    state.currentMap === "100000000" && state.profile.meso === 0,
    "Insufficient fare allowed travel or debited mesos",
  );
  report.checks.push(
    "Insufficient funds retains the original refusal and End Chat closes it without travel or debit",
  );
}
