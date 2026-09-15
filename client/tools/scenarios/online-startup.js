import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { closeConsole } from "./online-ui-repairs.js";
import { ready, observe, walking, reconnect } from "./online-latency.js";

/** Cold cache and a retained-cache reload, using native entry over the delayed relay. */
export async function runOnlineStartup({ browser, url, output, network }) {
  await mkdir(output, { recursive: true });
  const report = { status: "running", timings: {}, checks: [], errors: [] };
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  try {
    await page.evaluateOnNewDocument(() =>
      performance.setResourceTimingBufferSize(2048),
    );
    await page.setViewport({ width: 1280, height: 800 });
    await page.bringToFront();
    page.on("pageerror", (error) => {
      if (report.errors.length < 32) report.errors.push(error.message);
    });
    report.identity = await measureStage(report.timings, "identity", () =>
      onlineIdentity(url, ["100000000"]),
    );
    await exercise({ page, url, network, report });
    assertion(report.errors.length === 0, "Browser errors", report.errors);
    assertion(
      (await onlineIdentity(url)).sourceBuildId ===
        report.identity.sourceBuildId,
      "Source changed during check",
    );
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = { message: error.message, stack: error.stack };
    report.observation = await observe(page).catch((error) => ({
      error: error.message,
    }));
    await page.screenshot({ path: join(output, "failure.png") });
  } finally {
    await measureStage(report.timings, "teardown", () => context.close());
  }
  return report;
}

async function startup(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const state = window.maple?.snapshot();
    return (
      state?.login?.artwork &&
      !state.delivery.startup &&
      !state.delivery.visible
    );
  });
  await closeConsole(page);
  return resources(page);
}

async function resources(page) {
  return page.evaluate(() => {
    const state = window.maple.snapshot();
    const requests = performance
      .getEntriesByType("resource")
      .filter((entry) =>
        new URL(entry.name).pathname.startsWith("/generated/"),
      );
    return {
      generatedRequests: requests.length,
      state: {
        online: state.online,
        delivery: state.delivery,
        streaming: state.streaming,
        preload: state.startupPreload,
      },
    };
  });
}

async function exercise({ page, url, network, report }) {
  report.coldStartup = await measureStage(report.timings, "coldStartup", () =>
    startup(page, url),
  );
  await measureStage(report.timings, "login", async () => {
    await page.type('[name="name"]', "latency");
    await page.type('[name="password"]', "password");
    await page.click(".online-login-submit");
    await page.waitForFunction(() => {
      const login = window.maple.snapshot().login;
      return login.stage === "characters" && !login.transition.active;
    });
  });
  report.beforeEntry = await resources(page);
  await measureStage(report.timings, "entry", async () => {
    await page.click(".online-login-enter");
    await ready(page);
  });
  report.afterEntry = await resources(page);
  await measureStage(report.timings, "walkingAndStall", () =>
    walking({ page, network, report }),
  );
  await measureStage(report.timings, "reconnect", () => reconnect(page));
  report.warmStartup = await measureStage(report.timings, "warmStartup", () =>
    startup(page, url),
  );
  verifyPreload(report);
  report.checks.push(
    "Cold startup, entry, movement with a 1.5s stall, reconnect and retained-cache startup complete at 500ms RTT",
  );
  report.network = {
    roundTripMs: network.roundTripMs,
    httpRequests: network.httpRequests,
    frames: network.frames,
  };
}

function verifyPreload(report) {
  if (!report.coldStartup.state.preload) return; // Also supports the pre-change baseline.
  for (const startup of [report.coldStartup, report.warmStartup]) {
    const { preload, online, streaming } = startup.state;
    assertion(
      preload.status === "complete" && preload.complete === preload.files,
      "Startup exposed login before the common asset cache was complete",
      preload,
    );
    assertion(!online.connectionEpoch, "Startup opened a game connection");
    assertion(
      streaming.cacheEntries >= preload.files,
      "Preloaded files were not retained",
    );
  }
  assertion(
    report.warmStartup.generatedRequests < report.coldStartup.generatedRequests,
    "Warm startup did not reuse cached game files",
  );
  report.checks.push(
    "Common assets finish caching before a game connection; a reload reuses the cache",
  );
}
