import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { clickLabel } from "./native.js";
import {
  participant,
  signIn,
  ready,
  consoleSection,
  focusGame,
  details,
  replace,
  requestBuddy,
  mutualBuddies,
} from "./online-ui-repairs.js";

/** Native inputs against an owned fresh fixture: Developer/Player together at Robin. */
export async function runOnlineDropChat({ browser, url, output }) {
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
    for (const account of ["admin", "player"]) {
      const page = await participant(browser, contexts, pages, report);
      await measureStage(report.timings, `${account}-login`, () =>
        signIn(page, url, account),
      );
    }
    await measureStage(report.timings, "presets", () => presets(pages, report));
    await measureStage(report.timings, "chat", () =>
      chats(pages, output, report),
    );
    await measureStage(report.timings, "drop", () =>
      drop(pages, output, report),
    );
    await measureStage(report.timings, "shared-controls", () =>
      sharedControls(pages, report),
    );
    for (const page of pages) {
      await consoleSection(page, "diagnostics");
      await clickLabel(page, "Reconnect session", "#state-testing-controls");
      await ready(page);
      assertion(
        !(await page.$eval("#error", (node) => node.value)),
        "Game errors",
      );
    }
    assertion(
      (await onlineIdentity(url)).sourceBuildId ===
        report.identity.sourceBuildId,
      "Source changed during validation",
    );
    assertion(report.errors.length === 0, "Browser errors", report.errors);
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
    for (const [index, page] of pages.entries()) {
      await page.screenshot({ path: join(output, `failure-${index}.png`) });
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

async function presets([admin, player], report) {
  await consoleSection(admin, "character");
  report.presets = [];
  for (const value of ["job:112", "job:522", "job:112", "job:522"]) {
    await applyJobPreset(admin, value, report);
  }
  const equipment = await admin.evaluate(
    () => window.mapleOnline.observation().self.entity.appearance.equipment,
  );
  await player.waitForFunction(
    (equipment) =>
      window.mapleOnline
        .observation()
        .entities.some(
          (entry) =>
            entry.kind === "player" &&
            JSON.stringify(entry.appearance.equipment) ===
              JSON.stringify(equipment),
        ),
    {},
    equipment,
  );
  report.checks.push(
    "Hero and Corsair presets apply beside their preview; equipment reaches the peer",
  );
  await admin.select('[aria-label="Character preset"]', "restore");
  await clickLabel(admin, "Stage preset");
  await admin.click('[aria-label="Apply staged character preset"]');
  await admin.waitForFunction(() =>
    document
      .querySelector("#character-controls")
      .textContent.includes("already matches these values"),
  );
  report.checks.push(
    "Already-restored utility preset settles without an invalid empty server edit",
  );
}

async function applyJobPreset(admin, value, report) {
  await admin.select('[aria-label="Character preset"]', value);
  await clickLabel(admin, "Stage preset");
  await admin.waitForFunction(
    () =>
      !document.querySelector('[aria-label="Apply staged character preset"]')
        .disabled,
  );
  const response = admin.waitForResponse((value) =>
    value.url().endsWith("/api/v1/development"),
  );
  await admin.click('[aria-label="Apply staged character preset"]');
  const received = await response;
  assertion(received.status() === 200, "Preset HTTP refused");
  await admin.waitForFunction(
    (value) => {
      const profile = window.mapleOnline.observation().presentation.profile;
      return value === "mesos"
        ? profile.meso === 100000
        : profile.job === Number(value.slice(4));
    },
    {},
    value,
  );
  await admin.waitForFunction(() =>
    document
      .querySelector("#character-controls")
      .textContent.includes("Profile edits committed by the server."),
  );
  report.presets.push({
    value,
    httpStatus: received.status(),
    operationId: JSON.parse(received.request().postData()).operationId,
  });
}

async function sharedControls([admin, player], report) {
  await consoleSection(admin, "world");
  await developmentClick(admin, "#pause");
  for (const page of [admin, player]) {
    await page.waitForFunction(() => window.maple.snapshot().paused);
  }
  await consoleSection(admin, "diagnostics");
  await admin.click("#runtime-inspection > summary");
  await developmentClick(admin, "#step");
  await developmentClick(admin, "#pause");
  for (const page of [admin, player]) {
    await page.waitForFunction(() => !window.maple.snapshot().paused);
  }
  await consoleSection(admin, "world");
  await admin.click("#mob-spawn-section > summary");
  await replace(admin, "#mob-search", "100100");
  await admin.select("#mob-template", "100100");
  await developmentClick(admin, "#mob-spawn");
  for (const page of [admin, player]) {
    await page.waitForFunction(() =>
      window.mapleOnline
        .observation()
        .entities.some(
          (entry) => entry.kind === "mob" && entry.templateId === 100100,
        ),
    );
  }
  report.checks.push(
    "GM pause, step, resume and spawn work with a normal player present",
  );
}

async function developmentClick(page, selector) {
  await page.waitForFunction(
    (selector) => !document.querySelector(selector).disabled,
    {},
    selector,
  );
  const response = page.waitForResponse((value) =>
    value.url().endsWith("/api/v1/development"),
  );
  await page.click(selector);
  assertion(
    (await response).status() === 200,
    `Development ${selector} refused`,
  );
}

async function say(page, text, channel = "7") {
  await focusGame(page);
  await page.click('[aria-label^="Chat channel:"]');
  await page.click(`[role="option"][data-chat-channel="${channel}"]`);
  await page.type('[aria-label="Chat message"]', text, { delay: 25 });
  await page.keyboard.press("Enter");
}

async function received(pages, text, color) {
  for (const page of pages) {
    await page.waitForFunction(
      (text, color) =>
        [...document.querySelectorAll(".maple-ui-chat-log > div")].some(
          (row) =>
            row.textContent.includes(text) &&
            getComputedStyle(row).color === color,
        ),
      {},
      text,
      color,
    );
  }
}

async function chats([admin, player], output, report) {
  if (
    !(await admin.evaluate(
      () =>
        window.mapleOnline.observation().presentation.profile.social.friends
          .length,
    ))
  ) {
    await requestBuddy(admin);
    await player.waitForSelector('[aria-label^="Accept friend"]', {
      visible: true,
    });
    await player.click('[aria-label^="Accept friend"]');
  }
  await mutualBuddies(admin, player);
  for (const page of [admin, player]) {
    await focusGame(page);
    if (
      await page.$eval(
        '[aria-label="Expand chat"]',
        (node) => node.getBoundingClientRect().width > 0,
      )
    ) {
      await clickLabel(page, "Expand chat");
    }
  }
  await say(admin, "Map history from Developer");
  await received(
    [admin, player],
    "Map history from Developer",
    "rgb(255, 255, 255)",
  );
  await say(player, "Map history from Player");
  await received(
    [admin, player],
    "Map history from Player",
    "rgb(255, 255, 255)",
  );
  await say(admin, "/whisper Player Whisper history");
  await received([admin, player], "Whisper history", "rgb(0, 255, 0)");
  await say(player, "Buddy history", "0");
  await received([admin, player], "Buddy history", "rgb(255, 153, 0)");
  await player.screenshot({ path: join(output, "chat-history.png") });
  report.checks.push(
    "Server-confirmed own and peer map, whisper and buddy rows retain original colors",
  );
}

async function drop([admin, player], output, report) {
  await consoleSection(admin, "character");
  await details(admin, "Conjure world item");
  await admin.type('#conjure-world-item input[type="search"]', "2000000");
  await admin.select(
    '[aria-label="Item to drop in front of character"]',
    "2000000",
  );
  await replace(admin, '[aria-label="Drop quantity"]', "2");
  await clickLabel(admin, "Drop chosen item in front");
  await player.waitForFunction(() =>
    window.mapleOnline
      .observation()
      .entities.some(
        (entry) =>
          entry.kind === "drop" && entry.dropMotion.state === "launching",
      ),
  );
  await player.screenshot({ path: join(output, "drop-flight.png") });
  await player.waitForFunction(() =>
    window.mapleOnline
      .observation()
      .entities.some(
        (entry) =>
          entry.kind === "drop" && entry.dropMotion.state === "grounded",
      ),
  );
  report.checks.push(
    "Conjured item launch and landing render for the normal player",
  );
}
