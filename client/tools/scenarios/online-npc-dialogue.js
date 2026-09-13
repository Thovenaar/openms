import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { clickLabel, openConsoleSection } from "./native.js";

const TIMEOUT = 30000;
const DIALOG = '.maple-ui-panel[aria-label="UtilDlgEx"]';
const NATIVE = `${DIALOG} [aria-label="Native NPC dialogue"]`;
const NPC = 2003; // Map000050000, original Robin.
const QUEST = 1036;

/** Caller owns runtime/database/browser. Requires a fresh beginner beside Robin.
 * All quest progress is earned through native controls; inspection only observes. */
export async function runOnlineNpcDialogue({
  browser,
  url,
  output,
  account,
  password,
}) {
  await mkdir(output, { recursive: true });
  const report = {
    status: "running",
    timings: {},
    checks: [],
    events: [],
    errors: [],
  };
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  try {
    report.identity = await onlineIdentity(url);
    await observeWire(page, report);
    await measureStage(report.timings, "login", () =>
      signIn(page, { url, account, password }),
    );
    await measureStage(report.timings, "cancel-decline", () =>
      cancelAndDecline(page, report),
    );
    await measureStage(report.timings, "quest", () =>
      completeQuiz(page, report),
    );
    await measureStage(report.timings, "reconnect", () =>
      reconnect(page, report),
    );
    await measureStage(report.timings, "ambient", () =>
      ambientSpeech(page, report, output),
    );
    await verifyBrowser(page, url, report);
    report.status = "pass";
    await page.screenshot({
      path: join(output, "completed-after-reconnect.png"),
    });
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
    report.errorLog = await errorJournal(page);
    await page.screenshot({ path: join(output, "failure.png") });
  } finally {
    await context.close();
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}

async function errorJournal(page) {
  return page.evaluate(() => {
    const text = document.querySelector("#error")?.value ?? "";
    return { text: text.slice(-32768), truncated: text.length > 32768 };
  });
}

async function verifyBrowser(page, url, report) {
  report.errorLog = await errorJournal(page);
  assertion(
    !report.errorLog.text,
    "Handled game error during native dialogue",
    report.errorLog,
  );
  assertion(
    report.errors.length === 0,
    "Browser errors during native dialogue",
    report.errors,
  );
  await verifyIdentity(url, report.identity);
}

async function verifyIdentity(url, before) {
  const after = await onlineIdentity(url);
  assertion(
    after.sourceBuildId === before.sourceBuildId,
    "Source changed during NPC check",
  );
}

async function ambientSpeech(page, report, output) {
  await page.waitForFunction(
    () => {
      const npc = window.maple
        .snapshot()
        .npcPresentation.find((entry) => entry.templateId === 2003);
      const entity = window.mapleOnline
        .observation()
        .entities.find(
          (entry) => entry.kind === "npc" && entry.templateId === 2003,
        );
      return (
        npc?.speech?.visible &&
        entity?.npcSpeech &&
        npc.speechStartTick === entity.npcSpeech.startTick
      );
    },
    { timeout: TIMEOUT },
  );
  report.ambient = await page.evaluate(() =>
    window.maple
      .snapshot()
      .npcPresentation.find((entry) => entry.templateId === 2003),
  );
  assertion(
    report.ambient.markerState < 0 && report.ambient.speech.remainingMs <= 5000,
    "Original marker precedence/speech lifetime mismatch",
  );
  await page.screenshot({ path: join(output, "authoritative-npc-speech.png") });
  report.checks.push(
    "original NPC ambient prose follows the server-selected authored line and clock",
  );
}

async function observeWire(page, report) {
  const wire = await page.createCDPSession();
  await wire.send("Network.enable");
  await wire.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  page.on("pageerror", (error) => {
    if (report.errors.length < 24) report.errors.push(error.message);
  });
  wire.on("Network.webSocketFrameReceived", ({ response }) => {
    if (report.events.length >= 128) return;
    const message = JSON.parse(response.payloadData);
    if (message.type === "result") {
      report.events.push({
        type: "result",
        operationId: message.operationId,
        status: message.status,
        code: message.code,
      });
    } else if (message.event?.kind.startsWith("dialogue")) {
      report.events.push({ type: "event", event: message.event });
    }
  });
}

async function signIn(page, { url, account, password }) {
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
  await page.waitForFunction(() => window.maple?.snapshot().login?.artwork, {
    timeout: TIMEOUT,
  });
  if (
    await page.$eval(
      "#console-toggle",
      (node) => node.getAttribute("aria-expanded") === "true",
    )
  ) {
    await page.click("#console-toggle");
  }
  await page.type('[name="name"]', account);
  await page.type('[name="password"]', password);
  await page.click(".online-login-submit");
  await page.waitForFunction(
    () =>
      window.maple.snapshot().login.stage === "characters" &&
      !window.maple.snapshot().login.transition.active,
    { timeout: TIMEOUT },
  );
  await page.click(".online-login-enter");
  await ready(page);
}

async function ready(page) {
  await page.waitForFunction(
    () => {
      const state = window.maple?.snapshot();
      return (
        state?.online.status === "active" &&
        !state.loading &&
        state.currentMap === "000050000" &&
        state.npcs > 0
      );
    },
    { timeout: TIMEOUT },
  );
}

async function clickNpc(page) {
  const point = await page.evaluate((id) => {
    const npc = window.mapleOnline
      .observation()
      .entities.find(
        (entry) => entry.kind === "npc" && entry.templateId === id,
      );
    if (!npc) throw new Error("Fixture NPC is missing from server publication");
    const point = window.mapleOnline.project(
      npc.position.x,
      npc.position.y - 20,
    );
    const rect = document
      .querySelector("#viewport canvas")
      .getBoundingClientRect();
    if (
      point.x < 0 ||
      point.y < 0 ||
      point.x >= rect.width ||
      point.y >= rect.height
    ) {
      throw new Error("Fixture NPC is outside the viewport");
    }
    return { x: rect.left + point.x, y: rect.top + point.y };
  }, NPC);
  await page.mouse.click(point.x, point.y);
}

async function step(page, selector) {
  const previous = await page.$eval(NATIVE, (node) => node.textContent);
  const target = `${NATIVE} ${selector}`;
  await page.waitForSelector(target, { visible: true, timeout: TIMEOUT });
  await page.waitForFunction(
    (path) => !document.querySelector(path)?.disabled,
    { timeout: TIMEOUT },
    target,
  );
  await page.click(target);
  await page.waitForFunction(
    ({ path, previous }) => {
      const panel = document.querySelector(path);
      return (
        !panel ||
        (panel.textContent !== previous &&
          panel.getAttribute("aria-busy") !== "true")
      );
    },
    { timeout: TIMEOUT },
    { path: NATIVE, previous },
  );
}

async function openQuest(page) {
  await clickNpc(page, NPC);
  await page.waitForSelector(`${NATIVE} [data-quest-choice="${QUEST}"]`, {
    visible: true,
    timeout: TIMEOUT,
  });
  await step(page, `[data-quest-choice="${QUEST}"]`);
}

async function closeChat(page) {
  await step(page, '[aria-label="Close dialogue"]');
  await page.waitForSelector(DIALOG, { hidden: true, timeout: TIMEOUT });
  assertion(
    await page.$$eval(
      '[aria-label="Native NPC dialogue"]',
      (nodes) => nodes.length === 0,
    ),
    "Retired dialogue artwork remains mounted",
  );
}

async function questState(page) {
  return page.evaluate(
    () =>
      window.mapleOnline.observation().presentation.profile.quests[1036]
        ?.state ?? 0,
  );
}

async function cancelAndDecline(page, report) {
  await clickNpc(page, NPC);
  await page.waitForSelector(NATIVE, { visible: true, timeout: TIMEOUT });
  await closeChat(page);
  await openQuest(page);
  await closeChat(page);
  assertion((await questState(page)) === 0, "End Chat changed quest progress");
  await openQuest(page);
  await step(page, '[aria-label="Decline"]');
  assertion(
    await page.$eval(NATIVE, (node) =>
      node.textContent.includes("You must be confident"),
    ),
    "Original decline response is missing",
  );
  await step(page, '[aria-label="OK"]');
  await page.waitForSelector(DIALOG, { hidden: true, timeout: TIMEOUT });
  report.checks.push(
    "menu and confirmation End Chat close; Decline preserves original No prose",
  );
}

async function completeQuiz(page, report) {
  await openQuest(page);
  await step(page, '[aria-label="Accept"]');
  await step(page, '[aria-label="OK"]');
  await page.waitForFunction(
    () =>
      window.mapleOnline.observation().presentation.profile.quests[1036]
        ?.state === 1,
    { timeout: TIMEOUT },
  );
  await openQuest(page);
  for (const choice of [1, 1, 3]) {
    await step(page, `[data-quest-choice="${choice}"]`);
  }
  await step(page, '[aria-label="OK"]');
  await step(page, '[aria-label="OK"]');
  await page.waitForSelector(DIALOG, { hidden: true, timeout: TIMEOUT });
  await page.waitForFunction(
    () =>
      window.mapleOnline.observation().presentation.profile.quests[1036]
        ?.state === 2,
    { timeout: TIMEOUT },
  );
  report.checks.push(
    "native quest acceptance, authored quiz choices and server completion reward",
  );
}

async function reconnect(page, report) {
  const before = await page.evaluate(() => ({
    profile: window.mapleOnline.observation().presentation.profile,
    epoch: window.mapleOnline.snapshot().connectionEpoch,
  }));
  if (await page.$eval("#gm-console", (node) => node.hidden)) {
    await page.click("#console-toggle");
  }
  await openConsoleSection(page, "diagnostics");
  await clickLabel(page, "Reconnect session", "#state-testing-controls");
  await page.waitForFunction(
    (epoch) => window.mapleOnline.snapshot().connectionEpoch !== epoch,
    { timeout: TIMEOUT },
    before.epoch,
  );
  await ready(page);
  await page.click("#console-toggle");
  const after = await page.evaluate(() => ({
    profile: window.mapleOnline.observation().presentation.profile,
    epoch: window.mapleOnline.snapshot().connectionEpoch,
  }));
  assertion(
    before.epoch !== after.epoch,
    "Reconnect did not acquire a new connection",
  );
  assertion(
    after.profile.quests[QUEST]?.state === 2 &&
      after.profile.exp === before.profile.exp,
    "Quest progress/reward did not survive reconnect",
  );
  await clickNpc(page, NPC);
  await page.waitForSelector(`${NATIVE} [data-quest-choice="0"]`, {
    visible: true,
    timeout: TIMEOUT,
  });
  assertion(
    await page.$eval(NATIVE, (node) =>
      node.textContent.includes("How do I move?"),
    ),
    "Completed quest prevents default NPC topics",
  );
  await closeChat(page);
  report.checks.push(
    "reconnect retains completed quest and reward; default script End Chat closes",
  );
}
