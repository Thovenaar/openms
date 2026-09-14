import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { participant, focusGame } from "./online-ui-repairs.js";
import { login } from "./online-recycling-scrolls.js";
import { clickLabel } from "./native.js";

const ITEM = '.maple-ui-panel[aria-label="Item"]';
const DIALOG = '.maple-ui-panel[aria-label="Drop Mesos"]';
const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function dropMesos(page) {
  await focusGame(page);
  await page.keyboard.press("i");
  await page.waitForSelector(ITEM, { visible: true });
  await clickLabel(page, "Drop Mesos", ITEM);
  await page.waitForSelector('[aria-label="Mesos to drop"]', { visible: true });
  await clickLabel(page, "Drop Mesos", DIALOG);
  await page.waitForSelector(DIALOG, { hidden: true });
  await focusGame(page);
  await page.keyboard.press("i");
}

/** Read-only per-frame capture; no simulation or animation mutation. */
function sampleFrames() {
  const probe = { rows: [], running: true, overflow: false };
  window.__mesoProbe = probe;
  function frame(time) {
    if (!probe.running) return;
    if (probe.rows.length < 300) {
      probe.rows.push({ time, visuals: window.maple.snapshot().skillVisuals });
    } else probe.overflow = true;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

async function placePiles(page, direction) {
  for (let index = 0; index < 3; index++) {
    await dropMesos(page);
    await page.keyboard.down(direction);
    await delay(400);
    await page.keyboard.up(direction);
  }
  const reverse = direction === "ArrowRight" ? "ArrowLeft" : "ArrowRight";
  await page.keyboard.press(reverse, { delay: 90 });
  await page.waitForFunction(
    (facing) => window.maple.snapshot().simulation.facing === facing,
    {},
    reverse === "ArrowLeft" ? -1 : 1,
  );
  await page.waitForFunction(() => {
    const drops = window.mapleOnline
      .observation()
      .entities.filter((e) => e.kind === "drop");
    return (
      drops.length === 3 &&
      drops.every((e) => e.dropMotion.state === "grounded")
    );
  });
  return page.evaluate(() =>
    window.mapleOnline.observation().entities.filter((e) => e.kind === "drop"),
  );
}

async function cast(page, report, output, direction) {
  const drops = await placePiles(page, direction);
  await page.screenshot({ path: join(output, `${direction}-piles.png`) });
  await page.evaluate(sampleFrames);
  await page.keyboard.press("d");
  await page.waitForFunction(
    () =>
      window.maple
        .snapshot()
        .skillVisuals.filter(
          (v) =>
            v.visible &&
            v.sourceId.includes("4211006") &&
            v.sourceId.includes("hit"),
        ).length === 3,
  );
  await delay(160);
  await page.screenshot({ path: join(output, `${direction}-explosion.png`) });
  await delay(800);
  const probe = await page.evaluate(() => {
    window.__mesoProbe.running = false;
    return window.__mesoProbe;
  });
  const analysis = analyze(probe, drops);
  assertion(
    await page.evaluate(
      () =>
        !window.mapleOnline
          .observation()
          .entities.some((e) => e.kind === "drop"),
    ),
    "Exploded piles remained on the field",
  );
  report.casts.push({ direction, drops, ...analysis });
  await Bun.write(
    join(output, `${direction}-frames.json`),
    JSON.stringify(probe.rows),
  );
}

function analyze(probe, drops) {
  assertion(!probe.overflow, "Frame capture exceeded capacity");
  const origins = new Map();
  let samples = 0;
  for (const row of probe.rows) {
    for (const visual of row.visuals) {
      if (!visual.visible || !visual.sourceId.includes("hit")) continue;
      const point = visual.position;
      assertion(
        drops.some(
          (drop) =>
            drop.dropMotion.groundX === point.x &&
            drop.dropMotion.groundY - 12 === point.y,
        ),
        "Explosion drifted away from its meso landing point",
        visual,
      );
      origins.set(visual.id, point);
      samples++;
    }
  }
  assertion(origins.size === 3, "Each consumed pile needs a visible explosion");
  return { origins: [...origins.values()], samples };
}

async function verify(page, url, report) {
  assertion(
    report.results.filter(
      (m) => m.value?.kind === "skill.cast" && m.status === "committed",
    ).length === 2,
    "Two native Meso Explosion casts did not commit",
  );
  await measureStage(report.timings, "reconnect", () =>
    login(page, url, "meso"),
  );
  assertion(
    await page.evaluate(() => window.maple.snapshot().profile.meso === 9940),
    "Consumed mesos were not persisted",
  );
  assertion(report.errors.length === 0, "Browser errors", report.errors);
  assertion(
    (await onlineIdentity(url)).sourceBuildId === report.identity.sourceBuildId,
    "Source identity changed",
  );
}

/** Native drops, opposite-facing casts, fixed anchors, and persisted consumption. */
export async function runMesoExplosion({ browser, url, output }) {
  await mkdir(output, { recursive: true });
  const report = {
    status: "running",
    timings: {},
    results: [],
    errors: [],
    casts: [],
  };
  const contexts = [],
    pages = [];
  try {
    report.identity = await onlineIdentity(url);
    const page = await participant(browser, contexts, pages, report);
    await measureStage(report.timings, "readiness", () =>
      login(page, url, "meso"),
    );
    await clickLabel(page, "Minimize minimap");
    for (const direction of ["ArrowRight", "ArrowLeft"]) {
      await measureStage(report.timings, direction, () =>
        cast(page, report, output, direction),
      );
    }
    await verify(page, url, report);
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
    for (const page of pages) {
      await page.screenshot({ path: join(output, "failure.png") });
      report.lastState = await page.evaluate(() => ({
        snapshot: window.maple?.snapshot(),
        observation: window.mapleOnline?.observation(),
      }));
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
