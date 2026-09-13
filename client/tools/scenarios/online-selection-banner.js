import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";

const TIMEOUT = 30000;
// 00603e3a..00603e6f: scroll(-20,-25) relative to info; WZ final frame217×158.
const SCROLL = { x: -20, y: -25, width: 217, height: 158 };
const SAMPLES = [
  [50, 17],
  [50, 35],
  [50, 53],
  [37, 10],
  [91, 25],
  [125, 45],
  [50, 75],
  [50, 97], // Table separators and the gap above ranking.
  [-8, -17],
  [183, -17],
  [-2, 124],
  [177, 124], // Top/bottom scroll borders.
];

/** Login-only native check. Use a disposable account with three fixture characters;
 * the caller owns its database/runtimes and browser. No gameplay or account edits. */
export async function runOnlineSelectionBanner({
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
    observations: [],
    captures: [],
  };
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  try {
    report.identity = await onlineIdentity(url);
    await measureStage(report.timings, "login", () =>
      signIn(page, { url, account, password }),
    );
    await measureStage(report.timings, "banner", () =>
      inspectBanners(page, report, output),
    );
    const identity = await onlineIdentity(url);
    const source = await page.evaluate(
      () => window.maple.snapshot().sourceBuildId,
    );
    assertion(
      source === identity.sourceBuildId &&
        source === report.identity.sourceBuildId,
      "Banner check used a stale client",
    );
    await signOut(page);
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
    await page.screenshot({ path: join(output, "failure.png") });
  } finally {
    await measureStage(report.timings, "teardown", () => context.close());
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  return report;
}

async function signOut(page) {
  if (
    await page.$eval(
      "#console-toggle",
      (node) => node.getAttribute("aria-expanded") !== "true",
    )
  ) {
    await page.click("#console-toggle");
  }
  await page.click(".online-login-signout");
  await page.waitForFunction(
    () => window.maple.snapshot().login.stage === "account",
    { timeout: TIMEOUT },
  );
}

async function signIn(page, { url, account, password }) {
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
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
    () => {
      const login = window.maple?.snapshot().login;
      return (
        login?.stage === "characters" &&
        !login.transition.active &&
        document.querySelector(".online-login").getAttribute("aria-busy") ===
          "false"
      );
    },
    { timeout: TIMEOUT },
  );
}

async function inspectBanners(page, report, output) {
  for (const viewport of [
    { width: 1280, height: 800, deviceScaleFactor: 1 },
    { width: 800, height: 600, deviceScaleFactor: 2 },
  ]) {
    await page.setViewport(viewport);
    await page.waitForFunction(
      () => {
        const host = document
          .querySelector("#viewport")
          .getBoundingClientRect();
        const panel = document
          .querySelector(".online-login-window")
          .getBoundingClientRect();
        const scale = Math.min(1, host.width / 800, host.height / 600);
        return Math.abs(panel.width - 800 * scale) < 0.1;
      },
      { timeout: TIMEOUT },
    );
    for (let slot = 0; slot < 3; slot++) {
      const cards = await page.$$(".online-login-card");
      assertion(cards.length === 3, "Expected three native roster cards");
      await cards[slot].click();
      await page.waitForFunction(
        (index) =>
          document.querySelector(".online-login-character-detail").style
            .left === `${180 + 130 * index}px`,
        { timeout: TIMEOUT },
        slot,
      );
      // DOM selection changes synchronously; artwork is painted by the game ticker.
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          }),
      );
      const observed = await bannerPixels(page);
      const spotlight = await selectionSpotlight(page, slot);
      assertion(
        observed.samples.every((sample) => sample.alpha >= 250),
        "Parchment/border missing behind transparent stat cells",
        { actual: observed.samples },
      );
      report.observations.push({ viewport, slot, ...observed, spotlight });
      const name = `${viewport.width}x${viewport.height}-slot${slot}`;
      await page.screenshot({ path: join(output, `${name}.png`) });
      await page.screenshot({
        path: join(output, `${name}-banner.png`),
        clip: observed.clip,
      });
      report.captures.push(`${name}.png`, `${name}-banner.png`);
    }
  }
}

async function selectionSpotlight(page, slot) {
  await page.waitForFunction(
    (index) => {
      const light = window.maple.snapshot().login.spotlight;
      return (
        light?.visible &&
        light.beam.x === 260 + 125 * index &&
        light.beam.completed
      );
    },
    { timeout: TIMEOUT },
    slot,
  );
  const light = await page.evaluate(
    () => window.maple.snapshot().login.spotlight,
  );
  assertion(
    light.beam.frame === 4 &&
      light.beam.playback === "once" &&
      light.gleam.playback === "loop",
    "Native spotlight opening/gleam playback mismatch",
  );
  return light;
}

function bannerPixels(page) {
  return page.evaluate(
    ({ samples, scroll }) => {
      const detail = document
        .querySelector(".online-login-character-detail")
        .getBoundingClientRect();
      const canvas = document.querySelector(
        '[aria-label="Login character information"] canvas',
      );
      const bounds = canvas.getBoundingClientRect();
      const scale = detail.width / 183;
      const context = canvas.getContext("2d");
      return {
        clip: {
          x: detail.x + scroll.x * scale,
          y: detail.y + scroll.y * scale,
          width: scroll.width * scale,
          height: scroll.height * scale,
        },
        samples: samples.map(([x, y]) => {
          const px = Math.floor(
            ((detail.x + (x + 0.5) * scale - bounds.x) * canvas.width) /
              bounds.width,
          );
          const py = Math.floor(
            ((detail.y + (y + 0.5) * scale - bounds.y) * canvas.height) /
              bounds.height,
          );
          return { x, y, alpha: context.getImageData(px, py, 1, 1).data[3] };
        }),
      };
    },
    { samples: SAMPLES, scroll: SCROLL },
  );
}
