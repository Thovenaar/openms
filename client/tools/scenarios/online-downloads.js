import { join } from "node:path";
import { assertion } from "../native-evidence.js";

/** Inspect and pause real regional caching through its native browser controls. */
export async function downloadDetails(page, output, report) {
  await page.waitForFunction(
    () => window.maple.snapshot().regionDownloads?.complete > 0,
  );
  report.regionBefore = await page.evaluate(
    () => window.maple.snapshot().regionDownloads,
  );
  await page.click("#asset-loading");
  await page.waitForSelector(".download-dialog[open]", { visible: true });
  await page.screenshot({ path: join(output, "download-details-800.png") });
  report.downloadDialog = await page.$eval(".download-dialog", (node) => {
    const box = node.getBoundingClientRect();
    return {
      text: node.textContent,
      width: box.width,
      height: box.height,
      left: box.left,
      right: box.right,
      bottom: box.bottom,
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  assertion(
    report.downloadDialog.text.includes("Victoria Island"),
    "Victoria was not queued by default",
  );
  assertion(
    report.downloadDialog.left >= 0 &&
      report.downloadDialog.right <= 800 &&
      report.downloadDialog.bottom <= 600,
    "Download window exceeds minimum viewport",
    report.downloadDialog,
  );
  await page.click(".download-toggle");
  await page.waitForFunction(
    () => window.maple.snapshot().regionDownloads.paused,
  );
  await page.click('[aria-label="Close download details"]');
  await new Promise((resolve) => {
    setTimeout(resolve, 800);
  });
  report.checks.push(
    "Victoria queued automatically; regional caching advances and its Win95 dialog pauses it at 800×600",
  );
}

/** Native held Left survives repeated Up taps; admitted travel plays Portal during preparation. */
export async function portalTravel(page, output, report, descriptor) {
  await walkToPortal(page);
  await coldDestination(page, descriptor, report);
  report.pendingPortalMovement = await enterWhileWalking(page);
  await page.waitForSelector(
    '#delivery-startup[data-state="map"]:not([hidden])',
    { visible: true },
  );
  await page.waitForFunction(() =>
    window.maple.snapshot().audio.lastSound?.source.endsWith("/Portal"),
  );
  report.portalSound = await page.evaluate(
    () => window.maple.snapshot().audio.lastSound,
  );
  report.mapProgress = await page.$eval("#delivery-startup", (node) => ({
    status: node.querySelector(".delivery-status").textContent,
    details: node.querySelector(".delivery-hint").textContent,
    progressDisplay: getComputedStyle(node.querySelector(".delivery-progress"))
      .display,
    countDisplay: getComputedStyle(node.querySelector(".delivery-count"))
      .display,
  }));
  assertion(
    report.mapProgress.progressDisplay !== "none" &&
      report.mapProgress.countDisplay !== "none",
    "Map progress is hidden",
    report.mapProgress,
  );
  await page.screenshot({ path: join(output, "map-progress.png") });
  await page.waitForFunction(
    () =>
      window.maple.snapshot().currentMap === "000050000" &&
      window.maple.snapshot().online.status === "active",
    { timeout: 120000 },
  );
  report.checks.push(
    "Held movement survives Up tapping; cross-map Portal audio plays and mushroom progress/details remain visible",
  );
}

async function enterWhileWalking(page) {
  const before = await page.evaluate(
    () => window.maple.snapshot().simulation.x,
  );
  await page.keyboard.down("ArrowRight");
  await page.keyboard.press("ArrowUp");
  await new Promise((resolve) => {
    setTimeout(resolve, 100);
  });
  const after = await page.evaluate(() => {
    const state = window.maple.snapshot();
    return {
      x: state.simulation.x,
      held: state.input.right,
      pending: state.online.pendingTravel,
    };
  });
  await page.keyboard.up("ArrowRight");
  assertion(
    after.held && after.x > before,
    "Portal intent blocked movement before acceptance",
    { before, after },
  );
  return { before, after };
}

/** Delay only one destination resource; network/cache policy elsewhere stays unchanged. */
async function coldDestination(page, descriptor, report) {
  await page.evaluate(async (url) => {
    const cache = await caches.open("maple-content-v2");
    await cache.delete(url);
  }, descriptor.url);
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const resume = () =>
      request.continue().catch((error) => {
        if (report.errors.length < 32) report.errors.push(error.message);
      });
    if (new URL(request.url()).pathname === descriptor.url) {
      setTimeout(resume, 2000);
    } else void resume();
  });
}

async function walkToPortal(page) {
  const initial = await page.evaluate(
    () => window.maple.snapshot().simulation.x,
  );
  await page.keyboard.down("ArrowLeft");
  for (let count = 0; count < 8; count++) {
    await page.keyboard.press("ArrowUp");
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
    assertion(
      await page.evaluate(() => window.maple.snapshot().input.left),
      "Up erased held movement",
    );
  }
  const walked = await page.evaluate(
    () => window.maple.snapshot().simulation.x,
  );
  assertion(initial - walked > 50, "Walking stalled while tapping Up", {
    initial,
    walked,
  });
  await page.waitForFunction(() => window.maple.snapshot().simulation.x < -54);
  await page.keyboard.up("ArrowLeft");
  await new Promise((resolve) => {
    setTimeout(resolve, 800);
  });
}
