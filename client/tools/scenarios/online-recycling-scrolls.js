import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { participant, closeConsole, ready } from "./online-ui-repairs.js";
import { clickLabel, dragWindow, retainWindow } from "./native.js";

const QUEST = '.maple-ui-panel[aria-label="Quest"]';
const ITEM = '.maple-ui-panel[aria-label="Item"]';
const EQUIP = '.maple-ui-panel[aria-label="Equip"]';
const DIALOG = '.maple-ui-panel[aria-label="UtilDlgEx"]';
const TITLE = "Pio's Collecting Recycled Goods";

export { login, completeQuest };

export async function runRecyclingScrolls({ browser, url, output }) {
  await mkdir(output, { recursive: true });
  const report = {
    status: "running",
    timings: {},
    checks: [],
    results: [],
    errors: [],
    events: [],
  };
  const contexts = [],
    pages = [];
  try {
    report.identity = await onlineIdentity(url);
    for (const name of ["recycler", "observer"]) {
      const page = await participant(browser, contexts, pages, report);
      await observeEvents(page, name, report);
      await login(page, url, name);
    }
    const [player, observer] = pages;
    await measureStage(report.timings, "quest-portrait", () =>
      portrait(player, output),
    );
    await measureStage(report.timings, "reactor-and-pickup", () =>
      recycling(player, observer, report),
    );
    await measureStage(report.timings, "quest-completion", () =>
      completeQuest(player, report),
    );
    await measureStage(report.timings, "scroll", () =>
      scroll(player, observer, output, report),
    );
    await measureStage(report.timings, "hud", () =>
      hud(player, output, report),
    );
    await login(player, url, "recycler");
    await verifySaved(pages, url, report);
    await measureStage(report.timings, "reactor-audio", async () => {
      const plant = await participant(browser, contexts, pages, report);
      await observeEvents(plant, "plant", report);
      await login(plant, url, "plant");
      await plantSound(plant, report);
    });
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
    await retainFailure(pages, output, report);
  } finally {
    for (const context of contexts) await context.close();
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}

async function retainFailure(pages, output, report) {
  report.lastStates = [];
  for (const [index, page] of pages.entries()) {
    await page.screenshot({ path: join(output, `failure-${index}.png`) });
    report.errors.push(await page.$eval("#error", (node) => node.value));
    report.lastStates.push(
      await page.evaluate(() => ({
        simulation: window.maple.snapshot().simulation,
        reactors: window.mapleOnline
          .observation()
          ?.entities.filter((e) => e.reactor),
      })),
    );
  }
}

async function verifySaved(pages, url, report) {
  const player = pages[0];
  const saved = await player.evaluate(() => window.maple.snapshot().profile);
  assertion(
    saved.quests[1008].state === 2 &&
      saved.equipment.find((item) => item.slot === -11).upgrade.level === 1,
    "Quest or scroll was lost on reconnect",
  );
  for (const page of pages) {
    assertion(
      !(await page.$eval("#error", (node) => node.value)),
      "Game error journal is not empty",
    );
  }
  assertion(report.errors.length === 0, "Browser error", report.errors);
  assertion(
    (await onlineIdentity(url)).sourceBuildId === report.identity.sourceBuildId,
    "Source changed during check",
  );
}

async function observeEvents(page, name, report) {
  const wire = await page.createCDPSession();
  await wire.send("Network.enable");
  wire.on("Network.webSocketFrameReceived", ({ response }) => {
    const message = JSON.parse(response.payloadData);
    if (message.type === "event" && report.events.length < 256) {
      report.events.push({ name, event: message.event });
    }
  });
}

async function login(page, url, name) {
  await page.goto(url);
  await page.bringToFront();
  await page.waitForFunction(() => window.maple?.snapshot().login?.artwork);
  await closeConsole(page);
  await page.type('[name="name"]', name);
  await page.type('[name="password"]', "password");
  await page.click(".online-login-submit");
  await page.waitForFunction(
    () =>
      window.maple.snapshot().login.stage === "characters" &&
      !window.maple.snapshot().login.transition.active,
  );
  await page.click(".online-login-enter");
  await ready(page);
}

async function portrait(page, output) {
  await page.bringToFront();
  await marker(page, 1);
  await page.keyboard.press("q");
  await page.waitForSelector(QUEST, { visible: true });
  await clickLabel(page, "In progress", QUEST);
  await clickLabel(page, TITLE, QUEST);
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.textContent.includes("Pio"),
    {},
    QUEST,
  );
  await page.waitForNetworkIdle({ idleTime: 200 });
  await page.screenshot({ path: join(output, "pio-quest.png") });
  await page.keyboard.press("q");
}

function marker(page, state) {
  return page.waitForFunction(
    (value) =>
      window.maple
        .snapshot()
        .npcPresentation.some(
          (npc) => npc.templateId === 10000 && npc.markerState === value,
        ),
    {},
    state,
  );
}

function capture(page, seconds) {
  return page.evaluate(async (duration) => {
    const audio = await window.maple.captureAudio(duration);
    return {
      audible: audio.audible,
      rms: audio.rms,
      peak: audio.peak,
      sha256: audio.sha256,
    };
  }, seconds);
}

async function recycling(page, observer, report) {
  await walkRight(page, 565);
  for (let hit = 1; hit <= 4; hit++) {
    await page.keyboard.press("Control", { delay: 100 });
    await page.waitForFunction(
      (generation) =>
        window.mapleOnline
          .observation()
          .entities.some(
            (entity) =>
              entity.reactor?.placementId === "reactor:0" &&
              entity.reactor.generation >= generation &&
              entity.reactor.phase === "idle",
          ),
      {},
      hit,
    );
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 450);
        }),
    );
  }
  await observer.waitForFunction(
    () =>
      window.mapleOnline
        .observation()
        .entities.filter(
          (entity) =>
            entity.kind === "drop" &&
            [4031161, 4031162].includes(entity.templateId),
        ).length === 2,
  );
  await walkRight(page, 610);
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.keyboard.press("z", { delay: 100 });
    if (
      await page.evaluate(() =>
        [4031161, 4031162].every((id) =>
          window.maple
            .snapshot()
            .profile.inventory.some((item) => item.id === id),
        ),
      )
    ) {
      break;
    }
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 150);
        }),
    );
  }
  await marker(page, 2);
  report.checks.push(
    "Both players see the box hits and quest drops; ordinary pickup makes Pio ready",
  );
}

async function walkRight(page, x) {
  await page.keyboard.down("ArrowRight");
  try {
    await page.waitForFunction(
      (target) => window.maple.snapshot().simulation.x >= target,
      {},
      x,
    );
  } finally {
    await page.keyboard.up("ArrowRight");
  }
}

async function completeQuest(page, report) {
  const point = await page.evaluate(() => {
    const npc = window.mapleOnline
      .observation()
      .entities.find(
        (entry) => entry.kind === "npc" && entry.templateId === 10000,
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
  await page.waitForSelector(DIALOG, { visible: true });
  const choice = await page.$(`${DIALOG} [data-quest-choice]`);
  if (choice) await choice.click();
  for (let step = 0; step < 6; step++) {
    if (
      await page.evaluate(
        () => window.maple.snapshot().profile.quests[1008].state === 2,
      )
    ) {
      break;
    }
    await clickContinuation(page);
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 150);
        }),
    );
  }
  await page.waitForFunction(
    () => window.maple.snapshot().profile.quests[1008].state === 2,
  );
  await clickLabel(page, "Close dialogue", DIALOG);
  await page.waitForSelector(DIALOG, { hidden: true });
  report.checks.push(
    "Pio completes quest 1008 through native dialogue and consumes the collected items",
  );
}

async function clickContinuation(page) {
  const handle = await page.waitForFunction(
    (selector) => {
      const buttons = document
        .querySelector(selector)
        ?.querySelectorAll("button");
      return (
        buttons &&
        Array.from(buttons).find(
          (button) =>
            ["Next", "Yes", "OK"].includes(button.getAttribute("aria-label")) &&
            button.getBoundingClientRect().width > 0 &&
            !button.disabled,
        )
      );
    },
    {},
    DIALOG,
  );
  try {
    await handle.asElement().click();
  } finally {
    await handle.dispose();
  }
}

async function scroll(page, observer, output, report) {
  await page.keyboard.press("i");
  await page.waitForSelector(ITEM, { visible: true });
  const inventory = await retainWindow(page, "Item");
  await dragWindow(page, inventory, -140, 0);
  await page.keyboard.press("e");
  await page.waitForSelector(EQUIP, { visible: true });
  const equipment = await retainWindow(page, "Equip");
  await dragWindow(page, equipment, 140, 0);
  await clickLabel(page, "Item tab 2", ITEM);
  await page.waitForSelector(`${ITEM} [data-item-id="2043000"]`, {
    visible: true,
  });
  await page.waitForSelector(`${EQUIP} [data-item-slot="-11"]`, {
    visible: true,
  });
  const audio = capture(observer, 2);
  await page.click(`${ITEM} [data-item-id="2043000"]`);
  await page.click(`${EQUIP} [data-item-slot="-11"]`);
  await page.waitForFunction(
    () =>
      window.maple
        .snapshot()
        .profile.equipment.find((item) => item.slot === -11).upgrade?.level ===
      1,
  );
  await observer.waitForFunction(() =>
    window.maple
      .snapshot()
      .enhancements.some((effect) => effect.name === "Enchant/Success"),
  );
  report.scrollEffects = await observer.evaluate(
    () => window.maple.snapshot().enhancements,
  );
  await observer.screenshot({ path: join(output, "scroll-observer.png") });
  report.scrollAudio = await audio;
  assertion(report.scrollAudio.audible, "Observer heard no scroll sound");
  assertion(
    report.events.filter((row) => row.event.kind === "equipment.enhancement")
      .length === 2,
    "Scroll outcome did not reach both players exactly once",
  );
  await scrollTooltip(page, output, report);
  await page.keyboard.press("i");
  await page.keyboard.press("e");
  await inventory.handle.dispose();
  await equipment.handle.dispose();
}

async function scrollTooltip(page, output, report) {
  await page.hover(`${EQUIP} [data-item-slot="-11"]`);
  await page.waitForSelector('[role="tooltip"]:not([hidden])', {
    visible: true,
  });
  report.tooltip = await page.$eval(
    '[role="tooltip"]:not([hidden])',
    (node) => node.textContent,
  );
  assertion(
    report.tooltip.includes("(17 + 1)"),
    "Scrolled tooltip lost base or bonus",
    report.tooltip,
  );
  await page.screenshot({ path: join(output, "scroll-tooltip.png") });
}

async function hud(page, output, report) {
  for (const width of [1280, 800]) {
    await page.setViewport({ width, height: width === 800 ? 600 : 800 });
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    const before = await noticeTop(page);
    await clickLabel(page, "Quick slots");
    await page.waitForSelector('[aria-label="Hide quick slots"]', {
      visible: true,
    });
    assertion(
      (await noticeTop(page)) === before,
      "Quickslots moved the notice anchor",
    );
    await clickLabel(page, "Hide quick slots");
    await clickLabel(page, "Game Logs");
    await page.waitForSelector('.maple-ui-panel[aria-label="Game Logs"]', {
      visible: true,
    });
    const bounds = await page.$eval(
      '.maple-ui-panel[aria-label="Game Logs"]',
      (panel) => {
        const frame = panel.getBoundingClientRect();
        return [...panel.querySelectorAll("button")].map((button) => {
          const box = button.getBoundingClientRect();
          return {
            label: button.textContent,
            x: box.left - frame.left,
            y: box.top - frame.top,
            width: box.width,
            height: (box.height * 399) / frame.height,
            inside:
              box.left >= frame.left &&
              box.right <= frame.right &&
              box.bottom <= frame.bottom,
          };
        });
      },
    );
    assertion(
      bounds.every(
        (button) =>
          button.inside &&
          (button.y < 28 || Math.abs(button.height - 22) < 0.05),
      ),
      "Log buttons escape their frame or differ in height",
      bounds,
    );
    await page.screenshot({ path: join(output, `game-logs-${width}.png`) });
    await clickLabel(page, "Close Game Logs");
    report.checks.push(
      `Stationary notices and aligned log controls at ${width}px`,
    );
  }
}

function noticeTop(page) {
  return page.$eval(
    '[aria-label="Gameplay notices"]',
    (node) => node.getBoundingClientRect().top,
  );
}

async function plantSound(page, report) {
  const soundPath =
    "/generated/audio/739ff00723a09d263efd92cc411f88b45c226bda185fb22aae5bcaebbc5d6194.mp3";
  const soundRequest = page.waitForResponse(
    (response) => response.url().endsWith(soundPath) && response.ok(),
  );
  const audio = capture(page, 2);
  await page.keyboard.press("Control", { delay: 100 });
  await page.waitForFunction(() =>
    window.mapleOnline
      .observation()
      .entities.some(
        (entity) =>
          entity.reactor?.placementId === "reactor:2" &&
          entity.reactor.generation >= 1,
      ),
  );
  await soundRequest;
  report.reactorAudio = await audio;
  assertion(
    report.reactorAudio.audible,
    "Authored plant hit produced no audio",
  );
  assertion(
    !(await page.$eval("#error", (node) => node.value)),
    "Plant error journal is not empty",
  );
  report.checks.push(
    "Native plant hit loads its original Reactor/1012000/0/Hit MP3 and produces audible PCM",
  );
}
