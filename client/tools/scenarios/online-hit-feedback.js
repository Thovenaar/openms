import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import {
  participant,
  focusGame,
  consoleSection,
  replace,
  ready,
} from "./online-ui-repairs.js";
import { login } from "./online-recycling-scrolls.js";

const pause = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function probe() {
  const run = { rows: [], active: true };
  window.__hitProbe = run;
  function frame() {
    if (!run.active || run.rows.length >= 600) return;
    const state = window.maple.snapshot();
    run.rows.push({
      time: performance.now(),
      combat: state.combat,
      local: state.localCombat,
      simulation: state.simulation,
      actors: state.actors,
      hp: state.profile?.hp,
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

async function spawn(page, network) {
  await page.waitForFunction(
    () => window.maple.snapshot().simulation.state === "ground",
  );
  const ids = await page.evaluate(() =>
    window.maple.snapshot().actors.map((actor) => actor.id),
  );
  await consoleSection(page, "world");
  await page.click("#mob-spawn-section > summary");
  await replace(page, "#mob-search", "130100");
  await page.select("#mob-template", "130100");
  // Grounding must have reached the authority before its development admission runs.
  for (let attempt = 0; attempt < 30; attempt++) {
    if (network.lastMotion?.motion.state === "ground") break;
    await pause(100);
  }
  assertion(
    network.lastMotion?.motion.state === "ground",
    "Authority is not grounded",
  );
  await page.click("#mob-spawn");
  await page.waitForFunction(
    (previous) =>
      window.maple
        .snapshot()
        .actors.some(
          (actor) =>
            actor.kind === "mob" &&
            actor.visible &&
            !previous.includes(actor.id),
        ),
    {},
    ids,
  );
  await focusGame(page);
  return page.evaluate(
    (previous) =>
      window.maple
        .snapshot()
        .actors.find(
          (actor) => actor.kind === "mob" && !previous.includes(actor.id),
        ).id,
    ids,
  );
}

/** Approach through native input, then hold replies just before the drawn bodies touch. */
async function approach(page, targetId) {
  await page.waitForFunction(() => {
    const s = window.maple.snapshot();
    return s.simulation.state === "ground" && !s.simulation.movementLocked;
  });
  const direction = await page.evaluate((id) => {
    const s = window.maple.snapshot();
    const mob = s.actors.find((actor) => actor.id === id);
    return mob.x >= s.simulation.x ? "ArrowRight" : "ArrowLeft";
  }, targetId);
  // Clear any earlier protection from the outgoing exercise at a safe separation.
  const away = direction === "ArrowRight" ? "ArrowLeft" : "ArrowRight";
  await page.keyboard.down(away);
  await pause(700);
  await page.keyboard.up(away);
  await pause(1800);
  await page.keyboard.down(direction);
  await page.waitForFunction(
    (id) => {
      const s = window.maple.snapshot();
      const mob = s.actors.find((actor) => actor.id === id);
      return (
        Math.abs(mob.x - s.simulation.x) <= 65 &&
        Math.abs(mob.y - s.simulation.y) < 10
      );
    },
    { timeout: 10000 },
    targetId,
  );
  await page.keyboard.up(direction);
  return direction;
}

async function aim(page, targetId) {
  const sample = (id) => {
    const s = window.maple.snapshot();
    return {
      x: s.actors.find((actor) => actor.id === id).x,
      self: s.simulation.x,
      time: performance.now(),
    };
  };
  const before = await page.evaluate(sample, targetId);
  await pause(120);
  const after = await page.evaluate(sample, targetId);
  const velocity = (after.x - before.x) / (after.time - before.time);
  const key =
    after.x + velocity * 420 >= after.self ? "ArrowRight" : "ArrowLeft";
  await page.keyboard.down(key);
  await pause(30);
  await page.keyboard.up(key);
}

async function exercise(page, network, output, { name, targetId }) {
  if (name === "outgoing") await aim(page, targetId);
  const key =
    name === "outgoing" ? "ControlLeft" : await approach(page, targetId);
  await page.evaluate(probe);
  const start = await page.evaluate(() => performance.now());
  network.stall(1200);
  await page.keyboard.down(key);
  await pause(name === "outgoing" ? 90 : 250);
  await page.keyboard.up(key);
  await pause(2000);
  const rows = await page.evaluate(() => {
    window.__hitProbe.active = false;
    return window.__hitProbe.rows;
  });
  await Bun.write(join(output, `${name}.json`), JSON.stringify(rows));
  const first = rows.find((row) =>
    name === "outgoing"
      ? row.actors.some(
          (actor) => actor.kind === "mob" && actor.action === "hit1",
        )
      : row.local.incomingAt >= start,
  );
  return {
    firstMs: first ? first.time - start : null,
    recoil: name === "incoming" && Boolean(first?.local.hitPreview),
    numbers: rows.at(-1).combat.emitted - rows[0].combat.emitted,
  };
}

export async function runHitFeedback({
  browser,
  url,
  output,
  network,
  baseline,
}) {
  await mkdir(output, { recursive: true });
  const contexts = [],
    pages = [];
  const report = {
    status: "running",
    baseline,
    timings: {},
    errors: [],
    results: [],
  };
  try {
    report.identity = await measureStage(report.timings, "identity", () =>
      onlineIdentity(url),
    );
    const page = await participant(browser, contexts, pages, report);
    await measureStage(report.timings, "login", () =>
      login(page, url, "fighter"),
    );
    const targetId = await measureStage(report.timings, "spawn", () =>
      spawn(page, network),
    );
    report.outgoing = await measureStage(report.timings, "outgoing", () =>
      exercise(page, network, output, { name: "outgoing", targetId }),
    );
    report.incoming = await measureStage(report.timings, "incoming", () =>
      exercise(page, network, output, { name: "incoming", targetId }),
    );
    await ready(page);
    assertion(report.errors.length === 0, "Browser errors", report.errors);
    assertion(
      (await onlineIdentity(url)).sourceBuildId ===
        report.identity.sourceBuildId,
      "Source changed",
    );
    verifyReactions(report);
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = failureDetails(error);
    for (const page of pages) {
      await Bun.write(
        join(output, "failure-state.json"),
        JSON.stringify(await page.evaluate(() => window.maple?.snapshot())),
      );
      await page.screenshot({ path: join(output, "failure.png") });
    }
  } finally {
    await measureStage(report.timings, "teardown", async () => {
      for (const context of contexts) await context.close();
    });
  }
  return report;
}

function verifyReactions(report) {
  if (!report.baseline) {
    assertion(
      report.outgoing.firstMs !== null && report.outgoing.firstMs < 1000,
      "Outgoing reaction waited for held traffic",
      report.outgoing,
    );
    assertion(
      report.incoming.firstMs !== null && report.incoming.firstMs < 1000,
      "Contact reaction waited for held traffic",
      report.incoming,
    );
  }
}
