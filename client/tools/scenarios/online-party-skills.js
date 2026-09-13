import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { participant, signIn, focusGame } from "./online-ui-repairs.js";
import { prepareSharedActions, approachMob } from "./online-shared-actions.js";

/** Native key input, real PostgreSQL commit, recipient delivery and cold server restoration. */
export async function runOnlinePartySkills({ browser, url, output, restart }) {
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
    const caster = await participant(browser, contexts, pages, report);
    const recipient = await participant(browser, contexts, pages, report);
    await measureStage(report.timings, "login", async () => {
      await signIn(caster, url, "admin");
      await signIn(recipient, url, "player");
    });
    await measureStage(report.timings, "cast-and-deliver", () =>
      castAndDeliver(caster, recipient, report),
    );
    await measureStage(report.timings, "shared-kill-credit", () =>
      sharedKill(caster, recipient, report),
    );
    await measureStage(report.timings, "restart-and-restore", async () => {
      for (const page of pages) await page.goto("about:blank");
      await restart();
      await signIn(recipient, url, "player");
      await received(recipient);
      const exp = await recipient.evaluate(
        () => window.maple.snapshot().profile.exp,
      );
      assertion(
        exp === report.experience[1],
        "Earned party EXP must survive server restart",
      );
      report.checks.push(
        "Recipient buff restores after server restart and fresh authentication",
      );
    });
    assertion(report.errors.length === 0, "Browser errors", report.errors);
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

async function sharedKill(caster, recipient, report) {
  await caster.waitForFunction(
    () =>
      !window.mapleOnline.observation().self.entity.combatState?.movementLocked,
  );
  await prepareSharedActions(caster, report);
  const pages = [caster, recipient];
  const before = await experience(pages);
  await focusGame(caster);
  await caster.waitForFunction(() =>
    window.mapleOnline
      .observation()
      .entities.some((entity) => entity.kind === "mob"),
  );
  const mob = await caster.evaluate(() =>
    window.mapleOnline
      .observation()
      .entities.find((entity) => entity.kind === "mob"),
  );
  await approachMob(caster, mob);
  for (let attempt = 0; attempt < 8; attempt++) {
    await caster.keyboard.press("ControlLeft", { delay: 120 });
    const tick = await caster.evaluate(
      () => window.maple.snapshot().online.serverTick,
    );
    await caster.waitForFunction(
      (before) => window.maple.snapshot().online.serverTick > before + 20,
      {},
      tick,
    );
    if (await caster.evaluate(() => window.maple.snapshot().profile.exp > 0)) {
      break;
    }
  }
  for (const [index, page] of pages.entries()) {
    await page.waitForFunction(
      (exp) => window.maple.snapshot().profile.exp > exp,
      { timeout: 15000 },
      before[index],
    );
  }
  report.experience = await experience(pages);
  assertion(
    report.experience.reduce(
      (sum, exp, index) => sum + exp - before[index],
      0,
    ) === 3,
    "Party members must share exactly the snail's authored 3 EXP",
  );
  report.checks.push(
    "Native monster kill credits both players with a total of 3 EXP",
  );
}

async function received(page) {
  await page.waitForFunction(
    () => {
      const model = window.mapleOnline.observation();
      return model?.self.effects.some((row) => row.templateId === 4101004);
    },
    { timeout: 15000 },
  );
}

async function castAndDeliver(caster, recipient, report) {
  const before = await caster.evaluate(
    () => window.maple.snapshot().profile.mp,
  );
  await focusGame(caster);
  await caster.keyboard.press("h");
  await received(caster);
  await received(recipient);
  const after = await caster.evaluate(() => window.maple.snapshot().profile.mp);
  assertion(after === before - 30, "Haste must debit exactly 30 MP", {
    before,
    after,
  });
  report.checks.push(
    "Native Haste key debits 30 MP and delivers a buff to both party members",
  );
  const hasRank = await recipient.evaluate(() =>
    Boolean(window.maple.snapshot().profile.skills[4101004]?.level),
  );
  assertion(!hasRank, "Receiving a buff must not grant a learned skill");
}

async function captureFailure(pages, report, output) {
  for (const [index, page] of pages.entries()) {
    await page.screenshot({ path: join(output, `failure-${index}.png`) });
    report.errors.push(
      await page.evaluate(() => document.querySelector("#error")?.value ?? ""),
    );
  }
}

function experience(pages) {
  return Promise.all(
    pages.map((page) =>
      page.evaluate(() => window.maple.snapshot().profile.exp),
    ),
  );
}
