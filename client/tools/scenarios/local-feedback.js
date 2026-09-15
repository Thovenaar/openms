import { join } from "node:path";
import { assertion } from "../native-evidence.js";

/** Real HUD input; hold transport replies long enough to observe the pending local row. */
export async function localChat(page, network, report) {
  await page.keyboard.press("Enter");
  await page.type(
    '[aria-label="Chat message"]',
    "Lag should not hide this message",
  );
  network.stall(1500);
  await page.keyboard.press("Enter");
  await page.waitForSelector('.maple-ui-chat-log [data-delivery="pending"]', {
    timeout: 1000,
  });
  report.chatPending = await page.$eval(
    ".maple-ui-chat-log",
    (node) => node.textContent,
  );
  await page.waitForFunction(() => window.maple.snapshot().speech?.visible, {
    timeout: 700,
  });
  report.chatBeforeReply = await page.evaluate(() => ({
    bubble: window.maple.snapshot().speech,
    pending: Boolean(
      document.querySelector('.maple-ui-chat-log [data-delivery="pending"]'),
    ),
  }));
  assertion(
    report.chatBeforeReply.pending,
    "Speech waited for server delivery",
    report.chatBeforeReply,
  );
  await page.waitForFunction(
    () =>
      !document.querySelector('.maple-ui-chat-log [data-delivery="pending"]'),
  );
  const count = await page.$$eval(
    ".maple-ui-chat-log > div",
    (rows) =>
      rows.filter((row) =>
        row.textContent.includes("Lag should not hide this message"),
      ).length,
  );
  assertion(count === 1, "Chat echo duplicated its locally displayed row", {
    count,
  });
  await page.keyboard.press("Escape");
  // Closing chat schedules a 250 ms settings write; isolate the following cast from it.
  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
  await page.waitForFunction(
    () => window.maple.snapshot().online.pendingOperations === 0,
  );
  report.checks.push(
    "Chat appears before the delayed receipt and its echo settles one row",
  );
}

/** The cold Use visual starts an actual download, exposing the indicator during native input. */
export async function localCast(page, network, output, report) {
  network.stall(3000);
  await page.keyboard.press("d");
  await page.waitForSelector("#asset-loading:not([hidden])", { timeout: 1500 });
  report.indicator = await indicator(page, output, "indicator-desktop.png");
  await page.setViewport({ width: 800, height: 600 });
  report.indicatorMinimum = await indicator(page, output, "indicator-800.png");
  await page.waitForFunction(
    () => {
      const record = window.maple.snapshot().localSkillFeedback.at(-1);
      return record?.visualPlayed && record.soundPlayed && !record.confirmed;
    },
    { timeout: 2500 },
  );
  report.beforeReply = await page.evaluate(() =>
    window.maple.snapshot().localSkillFeedback.at(-1),
  );
  await page.waitForFunction(
    () => window.maple.snapshot().localSkillFeedback.at(-1)?.confirmed,
  );
  report.afterReply = await page.evaluate(() => {
    const state = window.maple.snapshot();
    return {
      local: state.localSkillFeedback.at(-1),
      serverDisplays: state.skillVisuals.length,
      status: state.online.status,
    };
  });
  assertion(
    report.afterReply.local.serverVisual && report.afterReply.local.serverSound,
    "Server feedback was not reconciled",
    report.afterReply,
  );
  assertion(
    report.afterReply.serverDisplays === 0,
    "The server echo created a second local effect",
    report.afterReply,
  );
  assertion(
    report.afterReply.status === "active",
    "Cast disconnected the player",
  );
  report.checks.push(
    "Use artwork and audio start before a server reply; exact operation echoes do not replay them",
  );
}

async function indicator(page, output, filename) {
  const measured = await page.$eval("#asset-loading", (node) => {
    const box = node.getBoundingClientRect(),
      style = getComputedStyle(node);
    return {
      width: box.width,
      height: box.height,
      right: box.right,
      bottom: box.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      pointerEvents: style.pointerEvents,
      background: style.backgroundColor,
    };
  });
  assertion(
    measured.width >= 300 &&
      measured.height >= 60 &&
      measured.right <= measured.viewportWidth &&
      measured.bottom <= measured.viewportHeight - 80 &&
      measured.pointerEvents === "auto",
    "Download details button lies outside the usable viewport",
    measured,
  );
  await page.screenshot({ path: join(output, filename) });
  return measured;
}
