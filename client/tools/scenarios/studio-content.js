import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { encodePNG } from "../../src/assets/png.js";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { participant, signIn, ready } from "./online-ui-repairs.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { focusCanvas, openConsoleSection, clickLabel } from "./native.js";
import {
  observeDialogue,
  waitForDialogue,
} from "./online-dialogue-observer.js";

const DIALOG = '.maple-ui-panel[aria-label="UtilDlgEx"]';

/** Native authoring → database publication → release → recipient observation → reconnect. */
export async function runStudioContent({
  browser,
  url,
  studioUrl,
  output,
  restart,
}) {
  await mkdir(output, { recursive: true });
  const report = {
    status: "running",
    timings: {},
    checks: [],
    errors: [],
    results: [],
  };
  const contexts = [],
    pages = [];
  try {
    report.identity = await onlineIdentity(url);
    const studio = await participant(browser, contexts, pages, report);
    await measureStage(report.timings, "studio-authoring", () =>
      author(studio, { url: studioUrl, output, report }),
    );
    const admin = await participant(browser, contexts, pages, report);
    const player = await participant(browser, contexts, pages, report);
    await measureStage(report.timings, "shared-gameplay", () =>
      play([admin, player], { url, output, report }),
    );
    await cleanGameJournals([admin, player]);
    await measureStage(report.timings, "restart", () =>
      restore(pages, { restart, url, report }),
    );
    await cleanGameJournals([player]);
    const identity = await onlineIdentity(url);
    assertion(
      identity.sourceBuildId === report.identity.sourceBuildId,
      "Source changed during Studio proof",
    );
    assertion(report.errors.length === 0, "Browser errors", {
      actual: report.errors,
    });
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
    await captureFailure(pages, { output, report });
  } finally {
    for (const context of contexts) await context.close();
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}

async function captureFailure(pages, { output, report }) {
  for (const [index, page] of pages.entries()) {
    await page.screenshot({ path: join(output, `failure-${index}.png`) });
    report.errors.push(
      await page.evaluate(() => ({
        text: document.body.innerText.slice(0, 2500),
        journal: document.querySelector("#error")?.value,
        state: window.maple?.snapshot().online,
      })),
    );
  }
}

async function cleanGameJournals(pages) {
  for (const page of pages) {
    const journal = await page.$eval("#error", (node) => node.value);
    assertion(!journal, "Game error journal is not empty", { actual: journal });
  }
}

async function restore(pages, { restart, url, report }) {
  for (const page of pages) await page.goto("about:blank");
  await restart();
  const player = pages[2];
  await signIn(player, url, "player");
  await player.waitForFunction(
    (id) => Number(window.maple.snapshot().currentMap) === id,
    {},
    report.mapId,
  );
  assertion(
    await player.evaluate(
      (id) => window.maple.snapshot().profile.quests[id]?.state === 1,
      report.questId,
    ),
    "Custom quest progress lost on restart",
  );
  report.checks.push(
    "Active release, saved custom-map location, and accepted quest survive server restart",
  );
}

async function press(page, text, parent = "") {
  const buttons = await page.$$(`${parent} button`);
  assertion(buttons.length < 512, "Studio control bound exceeded");
  for (const candidate of buttons) {
    if (
      await candidate.evaluate(
        (node, text) =>
          node.textContent.trim() === text && node.getClientRects().length > 0,
        text,
      )
    ) {
      await candidate.click();
      return;
    }
  }
  throw new Error(`Visible Studio button missing: ${text}`);
}

async function replace(page, selector, value) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(selector, String(value));
}

async function settled(page) {
  await page.waitForFunction(
    () => !document.querySelector("#app").hasAttribute("aria-busy"),
  );
  const error = await page.$eval(".notice", (node) =>
    node.classList.contains("error") ? node.textContent : "",
  );
  assertion(!error, `Studio rejected input: ${error}`);
}

async function published(page, name) {
  const response = page.waitForResponse((value) =>
    value.url().endsWith("/custom-content/publish"),
  );
  await press(page, "Publish revision");
  const result = await response;
  assertion(
    result.ok(),
    `Publication HTTP ${result.status()}: ${await result.text()}`,
  );
  await settled(page);
  assertion(
    (await page.$eval(".notice", (node) => node.textContent)).includes(
      `${name} published`,
    ),
    "Missing publication confirmation",
  );
  return result.json();
}

async function create(page, kind, name) {
  await press(page, "▦  My creations");
  await page.click(`.creation-card.${kind}`);
  await settled(page);
  await replace(page, '[aria-label="Creation name"]', name);
}

async function author(page, { url, output, report }) {
  await page.goto(`${url}/studio/`);
  await page.type('[name="username"]', "admin");
  await page.type('[name="password"]', "password");
  await page.click('.login-card [type="submit"]');
  await page.waitForSelector(".creation-cards");
  await page.screenshot({ path: join(output, "dashboard.png") });
  await create(page, "mob", "Mossback");
  await uploadSprite(page, output);
  const mob = await published(page, "Mossback");
  report.mobId = mob.runtimeId;
  await create(page, "map", "Shared Grove");
  await press(page, "Mossback · r1", ".custom-palette");
  await press(page, "♟ Spawn mob");
  const box = await page.$eval(".preview-canvas canvas", (node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  await settled(page);
  await press(page, "Update preview");
  await settled(page);
  await page.screenshot({ path: join(output, "map-editor.png") });
  const map = await published(page, "Shared Grove");
  report.mapId = map.runtimeId;
  await page.setViewport({ width: 800, height: 600 });
  assertion(
    await page.evaluate(() => document.documentElement.scrollWidth <= 800),
    "Studio overflows the minimum desktop viewport",
  );
  await page.screenshot({ path: join(output, "map-editor-800x600.png") });
  await page.setViewport({ width: 1280, height: 800 });
  await create(page, "quest", "Mossback Hunt");
  await press(page, "Mossback · r1", ".custom-palette");
  await press(page, "Add objective");
  const quest = await published(page, "Mossback Hunt");
  report.questId = quest.runtimeId;
  await press(page, "◉  Shared world");
  await settled(page);
  await press(page, "Activate 3 selected creations");
  await settled(page);
  await page.screenshot({ path: join(output, "release.png") });
  report.checks.push(
    "Native Studio controls create a sprite mob, place it in an inherited map, publish a dependent quest, and activate all three",
  );
}

async function uploadSprite(page, output) {
  const pixels = new Uint8Array(24 * 24 * 4);
  for (let index = 0; index < 24 * 24; index++) {
    pixels.set([70, 145, 80, 255], index * 4);
  }
  const path = join(output, "fixture-sprite.png");
  await Bun.write(path, encodePNG(24, 24, pixels));
  const uploaded = page.waitForResponse(
    (value) =>
      value.url().endsWith("/custom-content/images") &&
      value.request().method() === "POST",
  );
  await (await page.$('[aria-label="Upload sprite PNG"]')).uploadFile(path);
  assertion((await uploaded).ok(), "Sprite upload failed");
  await settled(page);
  await press(page, "Update preview");
  await settled(page);
}

async function play(pages, { url, output, report }) {
  await signIn(pages[0], url, "admin");
  await signIn(pages[1], url, "player");
  await acceptQuest(pages[1], report.questId);
  for (const page of pages) {
    await page.select('[aria-label="Community map"]', String(report.mapId));
    await page.click(".community-maps button");
    await page.waitForFunction(
      (id) =>
        Number(window.maple.snapshot().currentMap) === id &&
        window.maple.snapshot().online.status === "active",
      {},
      report.mapId,
    );
    await ready(page);
  }
  const actor = await pages[0].evaluate(() => window.maple.snapshot().selfId);
  await pages[1].waitForFunction(
    (id, mob) => {
      const entities = window.mapleOnline.observation().entities;
      return (
        entities.some((row) => row.id === id) &&
        entities.some((row) => row.kind === "mob" && row.templateId === mob)
      );
    },
    {},
    actor,
    report.mobId,
  );
  await focusCanvas(pages[0]);
  const before = await pages[0].evaluate(
    () => window.maple.snapshot().presentation.x,
  );
  await pages[0].keyboard.down("ArrowRight");
  try {
    await pages[1].waitForFunction(
      (id, x) =>
        window.mapleOnline.observation().entities.find((row) => row.id === id)
          ?.position.x >
        x + 25,
      {},
      actor,
      before,
    );
  } finally {
    await pages[0].keyboard.up("ArrowRight");
  }
  await pages[1].screenshot({ path: join(output, "shared-map.png") });
  await reconnect(pages[1], actor);
  report.checks.push(
    "Two native clients enter the released map, see custom mob artwork and peer movement, and reconnect into the same shared field",
  );
}

async function reconnect(page, actor) {
  const epoch = await page.evaluate(
    () => window.maple.snapshot().online.connectionEpoch,
  );
  await openConsoleSection(page, "diagnostics");
  await clickLabel(page, "Reconnect session", "#state-testing-controls");
  await page.waitForFunction(
    (value) => window.maple.snapshot().online.connectionEpoch !== value,
    {},
    epoch,
  );
  await ready(page);
  assertion(
    await page.evaluate(
      (id) =>
        window.mapleOnline.observation().entities.some((row) => row.id === id),
      actor,
    ),
    "Reconnect lost the recipient's peer",
  );
}

async function acceptQuest(page, id) {
  const dialogue = await observeDialogue(page);
  const point = await page.evaluate(() => {
    const npc = window.mapleOnline
      .observation()
      .entities.find((row) => row.kind === "npc" && row.templateId === 1012108);
    const screen = window.mapleOnline.project(
      npc.position.x,
      npc.position.y - 20,
    );
    const rect = document
      .querySelector("#viewport canvas")
      .getBoundingClientRect();
    return { x: rect.x + screen.x, y: rect.y + screen.y };
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector(`${DIALOG} [data-quest-choice="${id}"]`, {
    visible: true,
  });
  await page.click(`${DIALOG} [data-quest-choice="${id}"]`);
  await waitForDialogue(dialogue, (event) => event?.quest?.questId === id);
  for (let step = 0; step < 8; step++) {
    if (
      await page.evaluate(
        (id) => window.maple.snapshot().profile.quests[id]?.state === 1,
        id,
      )
    ) {
      break;
    }
    const current = dialogue.event;
    const label =
      current.native.kind === "accept-decline"
        ? "Accept"
        : current.native.next
          ? "Next"
          : "OK";
    await page
      .locator(`${DIALOG} [aria-label="${label}"]`)
      .setTimeout(5000)
      .click();
    await waitForDialogue(dialogue, (event) => event?.step !== current.step);
  }
  assertion(
    await page.evaluate(
      (id) => window.maple.snapshot().profile.quests[id]?.state === 1,
      id,
    ),
    "Custom quest was not accepted",
  );
  await page
    .locator(`${DIALOG} [aria-label="Close dialogue"]:not([hidden])`)
    .setTimeout(5000)
    .click();
  await page.waitForSelector(DIALOG, { hidden: true });
}
