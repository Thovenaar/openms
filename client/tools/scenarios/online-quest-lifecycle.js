import {
  observeDialogue,
  waitForDialogue,
} from "./online-dialogue-observer.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { participant, signIn } from "./online-ui-repairs.js";

const DIALOG = '.maple-ui-panel[aria-label="UtilDlgEx"]';

export async function runOnlineQuestLifecycle({
  browser,
  url,
  output,
  restart,
}) {
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
    const page = await participant(browser, contexts, pages, report);
    const dialogue = await observeDialogue(page);
    await measureStage(report.timings, "login", () =>
      signIn(page, url, "player"),
    );
    await measureStage(report.timings, "accept-claim-repeat", () =>
      completeCycle(page, report, dialogue),
    );
    await page.goto("about:blank");
    await measureStage(report.timings, "restart-and-restore", async () => {
      await restart();
      await signIn(page, url, "player");
      assertion(
        (await questState(page)) === 1,
        "Second quest cycle must survive restart",
      );
      assertion(
        (await experience(page)) === 4000,
        "Reconnect must not duplicate rewards",
      );
    });
    assertion(report.errors.length === 0, "Browser errors", report.errors);
    report.checks.push(
      "Second cycle and exactly one 4000 EXP award survive server restart",
    );
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
    await captureFailure(pages, report, output);
  } finally {
    for (const context of contexts) await context.close();
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}

async function completeCycle(page, report, dialogue) {
  await openQuest(page, dialogue);
  await advanceToState(page, 1, dialogue);
  await closeDialogue(page, dialogue);
  await openQuest(page, dialogue);
  await advanceToState(page, 2, dialogue);
  assertion(
    (await experience(page)) === 4000,
    "Claim must award authored 4000 EXP once",
  );
  const shoe = await page.evaluate(() =>
    window.maple
      .snapshot()
      .profile.inventory.some((item) => item.id === 4001000),
  );
  assertion(!shoe, "Claim must consume the glass shoe");
  await closeDialogue(page, dialogue);
  await openQuest(page, dialogue);
  await advanceToState(page, 1, dialogue);
  assertion(
    (await experience(page)) === 4000,
    "Starting another cycle must not award completion EXP",
  );
  report.checks.push(
    "Native Arwen dialogue accepts, consumes one glass shoe, rewards once and accepts again",
  );
}

async function openQuest(page, dialogue) {
  const point = await page.evaluate(() => {
    const npc = window.mapleOnline
      .observation()
      .entities.find(
        (entry) => entry.kind === "npc" && entry.templateId === 1032100,
      );
    const screen = window.mapleOnline.project(
      npc.position.x,
      npc.position.y - 20,
    );
    const canvas = document
      .querySelector("#viewport canvas")
      .getBoundingClientRect();
    return { x: canvas.left + screen.x, y: canvas.top + screen.y };
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector(`${DIALOG} [data-quest-choice="2017"]`, {
    visible: true,
  });
  await page.click(`${DIALOG} [data-quest-choice="2017"]`);
  await waitForDialogue(dialogue, (event) => event?.quest?.questId === 2017);
}

async function advanceToState(page, expected, dialogue) {
  for (let step = 0; step < 12; step++) {
    if ((await questState(page)) === expected) return;
    const current = dialogue.event;
    const label =
      current.native.kind === "accept-decline"
        ? "Accept"
        : current.native.next
          ? "Next"
          : "OK";
    try {
      await page
        .locator(`${DIALOG} [aria-label="${label}"]`)
        .setTimeout(5000)
        .click();
    } catch (error) {
      throw new Error(
        `Quest step ${step}: expected ${expected}, observed ${await questState(page)}, clicked ${label}; server ${JSON.stringify(current)}`,
        { cause: error },
      );
    }
    await waitForDialogue(dialogue, (event) => event?.step !== current.step);
  }
  throw new Error("Original dialogue exceeded bounded acceptance steps");
}

async function closeDialogue(page, dialogue) {
  const visible = await page.$(DIALOG);
  if (!visible) return;
  // The old static panel close control is retained hidden; select the visible native control.
  await page
    .locator(`${DIALOG} [aria-label="Close dialogue"]:not([hidden])`)
    .setTimeout(5000)
    .click();
  await page.waitForSelector(DIALOG, { hidden: true });
  await waitForDialogue(dialogue, (event) => event === null);
}
function questState(page) {
  return page.evaluate(
    () => window.maple.snapshot().profile.quests[2017]?.state ?? 0,
  );
}
function experience(page) {
  return page.evaluate(() => window.maple.snapshot().profile.exp);
}

async function captureFailure(pages, report, output) {
  for (const page of pages) {
    await page.screenshot({ path: join(output, "failure.png") });
    report.errors.push(
      await page.evaluate(() => document.querySelector("#error")?.value ?? ""),
    );
  }
}
