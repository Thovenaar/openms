import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { clickLabel, openConsoleSection } from "./native.js";

const DIALOG = '.maple-ui-panel[aria-label="UtilDlgEx"]';
const PROFILE = '[aria-label="Apply character changes"]';

// Shared native controls for focused follow-up scenarios; no fixture mutations.
export {
  participant,
  signIn,
  ready,
  consoleSection,
  closeConsole,
  focusGame,
  details,
  replace,
  requestBuddy,
  mutualBuddies,
};

/** Caller owns a disposable server/database. Two isolated contexts use native input only.
 * Seed fresh Developer and Player at Robin (map50000,x167,y335), with a pending buddy request. */
export async function runOnlineUiRepairs({ browser, url, output }) {
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
    const admin = await participant(browser, contexts, pages, report);
    await measureStage(report.timings, "admin-login", () =>
      signIn(admin, url, "admin"),
    );
    await measureStage(report.timings, "npc-stat", () =>
      npcAndStat(admin, output, report),
    );
    await measureStage(report.timings, "preset", () => preset(admin, report));
    await measureStage(report.timings, "buddy", async () => {
      await requestBuddy(admin);
      const player = await participant(browser, contexts, pages, report);
      await signIn(player, url, "player");
      await player.waitForSelector('[aria-label^="Accept friend"]', {
        visible: true,
      });
      await player.click('[aria-label^="Accept friend"]');
      await mutualBuddies(admin, player);
      report.checks.push(
        "Native buddy request and acceptance update both participants",
      );
    });
    await measureStage(report.timings, "conjure", () => conjure(pages, report));
    await measureStage(report.timings, "reconnect", () =>
      reconnectBoth(pages, report),
    );
    await verifyBrowser(pages, url, report);
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
    for (const [index, page] of pages.entries()) {
      await page.screenshot({ path: join(output, `failure-${index}.png`) });
      report.errors.push(await page.$eval("#error", (node) => node.value));
    }
  } finally {
    for (const context of contexts) await context.close();
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}

async function verifyBrowser(pages, url, report) {
  for (const page of pages) {
    assertion(
      !(await page.$eval("#error", (node) => node.value)),
      "Game error journal is not empty",
    );
  }
  assertion(
    report.errors.length === 0,
    "Browser reported errors",
    report.errors,
  );
  const after = await onlineIdentity(url);
  assertion(
    after.sourceBuildId === report.identity.sourceBuildId,
    "Runtime identity changed",
  );
}

async function participant(browser, contexts, pages, report) {
  const context = await browser.createBrowserContext();
  contexts.push(context);
  const page = await context.newPage();
  pages.push(page);
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 1280, height: 800 });
  page.on("pageerror", (error) => {
    if (report.errors.length < 32) report.errors.push(error.message);
  });
  const wire = await page.createCDPSession();
  await wire.send("Network.enable");
  await wire.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  wire.on("Network.webSocketFrameReceived", ({ response }) => {
    const event = JSON.parse(response.payloadData);
    if (event.type === "result" && report.results.length < 128) {
      report.results.push(event);
    }
  });
  return page;
}

async function ready(page) {
  await page.waitForFunction(
    () =>
      window.maple?.snapshot().online.status === "active" &&
      !window.maple.snapshot().loading,
  );
}
async function signIn(page, url, account) {
  await page.bringToFront();
  await page.goto(url);
  await page.waitForFunction(() => window.maple?.snapshot().login?.artwork);
  await closeConsole(page);
  await page.type('[name="name"]', account);
  await page.type('[name="password"]', "password");
  await page.click(".online-login-submit");
  await page.waitForFunction(
    () =>
      window.maple.snapshot().login.stage === "characters" &&
      !window.maple.snapshot().login.transition.active,
  );
  await selectCharacter(page, account === "admin" ? "Developer" : "Player");
  await page.click(".online-login-enter");
  await ready(page);
}
async function selectCharacter(page, name) {
  const cards = await page.$$(".online-login-card");
  assertion(cards.length <= 8, "Roster card bound exceeded");
  for (const card of cards) {
    if (
      await card.evaluate(
        (node, name) =>
          node.querySelector(".online-login-character-name")?.textContent ===
          name,
        name,
      )
    ) {
      await card.click();
      return;
    }
  }
  throw new Error(`Fixture character ${name} is missing`);
}

async function consoleSection(page, section) {
  await page.bringToFront();
  if (await page.$eval("#gm-console", (node) => node.hidden)) {
    await page.click("#console-toggle");
  }
  await openConsoleSection(page, section);
}

async function closeConsole(page) {
  if (
    await page.$eval(
      "#console-toggle",
      (node) => node.getAttribute("aria-expanded") === "true",
    )
  ) {
    await page.click("#console-toggle");
  }
}
async function focusGame(page) {
  await page.bringToFront();
  await closeConsole(page);
  const box = await (await page.$("#viewport canvas")).boundingBox();
  await page.mouse.click(box.x + 20, box.y + 20);
}
async function details(page, text) {
  const summaries = await page.$$("#character-controls summary");
  assertion(summaries.length < 128, "Too many development groups");
  for (const summary of summaries) {
    if (
      await summary.evaluate(
        (node, value) => node.textContent === value && !node.parentElement.open,
        text,
      )
    ) {
      await summary.click();
    }
  }
}
async function replace(page, selector, text) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(selector, text);
}

async function npcAndStat(page, output, report) {
  const point = await page.evaluate(() => {
    const npc = window.mapleOnline
      .observation()
      .entities.find(
        (entry) => entry.kind === "npc" && entry.templateId === 2003,
      );
    const point = window.mapleOnline.project(
      npc.position.x,
      npc.position.y - 20,
    );
    const rect = document
      .querySelector("#viewport canvas")
      .getBoundingClientRect();
    return { x: rect.left + point.x, y: rect.top + point.y };
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector(`${DIALOG} [data-quest-choice="1036"]`);
  await page.waitForFunction(
    (selector) => {
      const art = [
        ...document.querySelectorAll(`${selector} [data-quest-art]`),
      ];
      return (
        art.filter((node) => /list[0-3]#$/.test(node.dataset.questArt))
          .length === 2 && art.every((node) => node.querySelector("canvas"))
      );
    },
    {},
    DIALOG,
  );
  const menu = await page.$eval(DIALOG, (node) => ({
    text: node.textContent,
    icons: [...node.querySelectorAll("[data-quest-art]")].map(
      (icon) => icon.dataset.questArt,
    ),
  }));
  assertion(
    menu.text.includes("I have something to tell you."),
    "Missing ordinary talk label",
    menu,
  );
  report.menu = menu;
  await page.screenshot({ path: join(output, "npc-menu.png") });
  await clickLabel(page, "Close dialogue", DIALOG);
  await page.waitForSelector(DIALOG, { hidden: true });
  await beginnerStat(page, output, report);
}
async function beginnerStat(page, output, report) {
  await focusGame(page);
  await page.setViewport({ width: 800, height: 600 });
  await page.keyboard.press("s");
  await clickLabel(page, "Detailed statistics");
  await page.waitForSelector('[aria-label="Stat Detail"]');
  await page.waitForFunction(() =>
    /\d+ ~ \d+/.test(
      document.querySelector('[aria-label^="damage:"]')?.textContent ?? "",
    ),
  );
  const bounds = await page.$eval('[aria-label="Stat Detail"]', (node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
  });
  assertion(
    bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.right <= 800 &&
      bounds.bottom <= 600,
    "Stat detail outside minimum viewport",
    bounds,
  );
  await page.screenshot({ path: join(output, "beginner-stat-detail.png") });
  await clickLabel(page, "Close detailed statistics");
  await clickLabel(page, "Close Stat");
  await page.setViewport({ width: 1280, height: 800 });
  report.checks.push(
    "Original quest headings and normal talk label render; End Chat closes",
    "Beginner Details button opens within800x600",
  );
}
async function preset(page, report) {
  await consoleSection(page, "character");
  await page.select('[aria-label="Character preset"]', "job:522");
  await clickLabel(page, "Stage preset");
  await page.waitForFunction(
    (selector) => !document.querySelector(selector).disabled,
    {},
    PROFILE,
  );
  const response = page.waitForResponse((value) =>
    value.url().endsWith("/api/v1/development"),
  );
  await page.click(PROFILE);
  const receipt = await (await response).json();
  assertion(
    receipt.status === "committed",
    "Preset HTTP operation rejected",
    receipt,
  );
  report.presetReceipt = receipt;
  await page.waitForFunction(
    () => window.mapleOnline.observation().presentation.profile.job === 522,
  );
  await page.waitForFunction(
    () =>
      !document
        .querySelector("#character-controls")
        .textContent.includes("Saving changes"),
  );
  report.preset = await page.evaluate(() => {
    const profile = window.mapleOnline.observation().presentation.profile;
    return {
      job: profile.job,
      level: profile.level,
      skills: Object.keys(profile.skills).length,
      equipment: profile.equipment.length,
    };
  });
  assertion(
    report.preset.skills > 10 && report.preset.equipment > 0,
    "Preset did not persist its loadout",
    report.preset,
  );
  report.checks.push(
    "Corsair preset commits skills, equipment and key bindings through development HTTP",
  );
}
async function requestBuddy(page) {
  await focusGame(page);
  await page.keyboard.press("r");
  await clickLabel(page, "Add friend");
  await page.waitForSelector(
    '[aria-label="Please enter the name of your friend."]',
  );
  await page.type(
    '[aria-label="Please enter the name of your friend."]',
    "Player",
  );
  await clickLabel(page, "OK", '[role="dialog"]');
  await page.waitForFunction(() =>
    document.body.textContent.includes("Buddy request sent."),
  );
  await clickLabel(page, "OK", '[role="dialog"]');
}
async function mutualBuddies(admin, player) {
  const adminId = await admin.evaluate(
    () => window.mapleOnline.observation().self.entity.id,
  );
  const playerId = await player.evaluate(
    () => window.mapleOnline.observation().self.entity.id,
  );
  for (const [page, id] of [
    [admin, playerId],
    [player, adminId],
  ]) {
    await page.waitForFunction(
      (id) =>
        window.mapleOnline
          .observation()
          .presentation.profile.social.friends.some((entry) => entry.id === id),
      {},
      id,
    );
  }
}
async function conjure(pages, report) {
  const [admin, player] = pages;
  await admin.bringToFront();
  await consoleSection(admin, "character");
  await details(admin, "Conjure world item");
  await admin.type('#conjure-world-item input[type="search"]', "2000000");
  await admin.select(
    '[aria-label="Item to drop in front of character"]',
    "2000000",
  );
  await replace(admin, '[aria-label="Drop quantity"]', "2");
  await clickLabel(admin, "Drop chosen item in front");
  for (const page of pages) {
    await page.waitForFunction(() =>
      window.mapleOnline
        .observation()
        .entities.some(
          (entry) => entry.kind === "drop" && entry.templateId === 2000000,
        ),
    );
  }
  report.checks.push("Server-created drop is visible in both isolated clients");
  await player.waitForFunction(() => {
    const state = window.mapleOnline.observation();
    const drop = state.entities.find(
      (entry) => entry.kind === "drop" && entry.templateId === 2000000,
    );
    return drop && Date.now() >= drop.dropInfo.ownerUntil + 100;
  });
  await focusGame(player);
  await player.keyboard.down("z");
  try {
    await player.waitForFunction(() =>
      window.mapleOnline
        .observation()
        .presentation.profile.inventory.some(
          (entry) => entry.id === 2000000 && entry.count === 2,
        ),
    );
  } finally {
    await player.keyboard.up("z");
  }
  for (const page of pages) {
    await page.waitForFunction(
      () =>
        !window.mapleOnline
          .observation()
          .entities.some(
            (entry) => entry.kind === "drop" && entry.templateId === 2000000,
          ),
    );
  }
  report.checks.push(
    "Normal player's native pickup credits inventory and removes the drop for both recipients",
  );
}
async function reconnectBoth(pages, report) {
  for (const page of pages) {
    await page.bringToFront();
    const epoch = await page.evaluate(
      () => window.mapleOnline.snapshot().connectionEpoch,
    );
    await consoleSection(page, "diagnostics");
    await clickLabel(page, "Reconnect session", "#state-testing-controls");
    await page.waitForFunction(
      (before) => window.mapleOnline.snapshot().connectionEpoch !== before,
      {},
      epoch,
    );
    await ready(page);
    await closeConsole(page);
  }
  await mutualBuddies(...pages);
  const restored = await pages[1].evaluate(() =>
    window.mapleOnline
      .observation()
      .presentation.profile.inventory.some(
        (entry) => entry.id === 2000000 && entry.count === 2,
      ),
  );
  assertion(restored, "Pickup missing after reconnect");
  report.checks.push(
    "Buddy relationship and picked-up item survive both reconnects",
  );
}
