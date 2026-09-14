import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { participant, ready } from "./online-ui-repairs.js";
import { login, completeQuest } from "./online-recycling-scrolls.js";
import { clickLabel, dragWindow, retainWindow } from "./native.js";

const ITEM = '.maple-ui-panel[aria-label="Item"]';
const EQUIP = '.maple-ui-panel[aria-label="Equip"]';
const SKILL = '.maple-ui-panel[aria-label="Skill"]';
const SPIRIT = '.maple-ui-panel[aria-label="EnchantSkill"]';

/** Native intent → SQL receipt → recipient appearance → reconnect, without changing cached assets. */
export async function runCharacterCorrections({ browser, url, output }) {
  await mkdir(output, { recursive: true });
  const report = {
    status: "running",
    checks: [],
    results: [],
    errors: [],
    curses: [],
  };
  const contexts = [],
    pages = [];
  try {
    report.identity = await onlineIdentity(url);
    for (const account of ["corrections", "witness"]) {
      const page = await participant(browser, contexts, pages, report);
      await login(page, url, account);
      await verifyServing(page, report);
    }
    const [page, witness] = pages;
    await page.bringToFront();
    await watchLoading(page);
    await skillPoints(page, false);
    await completeQuest(page, report);
    await page.waitForFunction(
      () => window.maple.snapshot().profile.level === 31,
    );
    await skillPoints(page, true);
    await equipmentWindows(page);
    await equipCycle(page, report);
    await refusal(page, report);
    await scrollTargets(page, witness, report);
    report.loadingFlashes = await page.evaluate(
      () => window.characterCheck.loadingFlashes,
    );
    assertion(
      report.loadingFlashes === 0,
      "Resident character updates showed a loading overlay",
    );
    await login(page, url, "corrections");
    await verifySaved(page, report);
    await verifyBrowser(page, url, report);
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

async function verifyBrowser(page, url, report) {
  await verifyServing(page, report);
  assertion(report.errors.length === 0, "Browser exceptions", report.errors);
  assertion(
    !(await page.$eval("#error", (node) => node.value)),
    "Error journal contains gameplay refusals",
  );
  assertion(
    (await onlineIdentity(url)).sourceBuildId === report.identity.sourceBuildId,
    "Source changed during validation",
  );
}

async function verifyServing(page, report) {
  const served = await page.evaluate(() => {
    const snapshot = window.maple.snapshot();
    return {
      sourceBuildId: snapshot.sourceBuildId,
      assetBuildId: snapshot.buildId,
    };
  });
  assertion(
    served.sourceBuildId === report.identity.sourceBuildId &&
      served.assetBuildId === report.identity.assetBuildId,
    "Browser is not running the checked source and catalog",
    served,
  );
  report.served ??= [];
  report.served.push(served);
}

async function watchLoading(page) {
  await page.evaluate(() => {
    const state = { loadingFlashes: 0 };
    window.characterCheck = state;
    const observer = new MutationObserver((changes) => {
      for (const change of changes) {
        if (change.oldValue !== null) state.loadingFlashes++;
      }
    });
    observer.observe(document.querySelector("#delivery-startup"), {
      attributes: true,
      attributeFilter: ["hidden"],
      attributeOldValue: true,
    });
  });
}

async function skillPoints(page, earned) {
  await page.keyboard.press("k");
  await page.waitForSelector(SKILL, { visible: true });
  await clickLabel(page, "Skill tab 3", SKILL);
  const learn = `${SKILL} [aria-label="Learn Sword Mastery"]`;
  await page.waitForSelector(learn, { visible: true });
  if (!earned) {
    assertion(
      await page.$eval(
        learn,
        (node) => node.getAttribute("aria-disabled") === "true",
      ),
      "First-job SP enabled a second-job skill",
    );
  } else {
    await page.waitForFunction(
      () =>
        document
          .querySelector('[aria-label="Learn Sword Mastery"]')
          .getAttribute("aria-disabled") === "false",
    );
    await page.locator(learn).click();
    await page.waitForFunction(
      () => window.maple.snapshot().profile.skills[1100000]?.level === 1,
    );
    await verifyPoints(page);
  }
  await page.keyboard.press("k");
}

async function verifyPoints(page) {
  const profile = await page.evaluate(() => window.maple.snapshot().profile);
  assertion(
    profile.remainingAp === 5 &&
      profile.remainingSp[0] === 12 &&
      profile.remainingSp[1] === 2,
    "Wrong AP/SP reward or allocation pool",
    profile.remainingSp,
  );
}

export async function equipmentWindows(page) {
  for (const [key, name, offset] of [
    ["i", "Item", -260],
    ["e", "Equip", 260],
  ]) {
    await page.keyboard.press(key);
    const panel = await retainWindow(page, name);
    await dragWindow(page, panel, offset, 0);
    await panel.handle.dispose();
  }
}

export async function equipCycle(page, report) {
  const uid = await page.evaluate(
    () =>
      window.maple
        .snapshot()
        .profile.equipment.find((item) => item.slot === -11).uid,
  );
  await page.locator(`${EQUIP} [data-item-uid="${uid}"]`).click();
  await page.locator(`${ITEM} [data-item-slot="6"]`).click();
  await page.waitForFunction(
    (id) =>
      window.maple.snapshot().profile.inventory.some((item) => item.uid === id),
    {},
    uid,
  );
  await clickLabel(page, "Item tab 1", ITEM);
  await page.locator(`${ITEM} [data-item-uid="${uid}"]`).click();
  await page.locator(`${EQUIP} [data-item-slot="-11"]`).click();
  await page.waitForFunction(
    (id) =>
      window.maple.snapshot().profile.equipment.some((item) => item.uid === id),
    {},
    uid,
  );
  report.checks.push(
    "Cached worn sword unequips and re-equips through native controls",
  );
}

async function refusal(page, report) {
  const count = report.results.length;
  await page.locator(`${ITEM} [data-item-id="1302023"]`).click();
  await page.locator(`${EQUIP} [data-item-slot="-11"]`).click();
  await page.waitForFunction(() =>
    window.maple.snapshot().ui.status?.includes("requirements"),
  );
  assertion(
    report.results
      .slice(count)
      .some((result) => result.code === "REQUIREMENTS_NOT_MET"),
    "No server requirement refusal observed",
  );
  assertion(
    !(await page.$eval("#error", (node) => node.value)),
    "Expected refusal entered error journal",
  );
}

async function scrollTargets(page, witness, report) {
  await page.keyboard.press("d");
  await page.waitForSelector(SPIRIT, { visible: true });
  await page.waitForFunction(
    () => window.maple.snapshot().online.pendingOperations === 0,
  );
  await clickLabel(page, "Use White Scroll", SPIRIT);
  for (const worn of [true, false]) {
    await clickLabel(page, "Item tab 1", ITEM);
    const target = await page.evaluate((equipped) => {
      const profile = window.maple.snapshot().profile;
      return (equipped ? profile.equipment : profile.inventory).find(
        (item) => item.id === 1302000,
      );
    }, worn);
    assertion(target, "No eligible sword instance remains");
    const selector = worn
      ? `${EQUIP} [data-item-slot="-11"]`
      : `${ITEM} [data-item-uid="${target.uid}"]`;
    await page.locator(selector).click();
    await clickLabel(page, "Equipment and scroll target", SPIRIT);
    await clickLabel(page, "Item tab 2", ITEM);
    await curse(page, target.uid, report);
    if (worn) {
      await witness.waitForFunction(() => {
        const player = window.mapleOnline
          .observation()
          .entities.find((entity) => entity.appearance?.name === "Corrections");
        return (
          player &&
          !player.appearance.equipment.some((item) => item.slot === 11)
        );
      });
    }
  }
}

async function curse(page, uid, report) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const before = report.results.length;
    const quantity = await page.evaluate(
      () =>
        window.maple
          .snapshot()
          .profile.inventory.find((item) => item.id === 2043005)?.count ?? 0,
    );
    await page.locator(`${ITEM} [data-item-id="2043005"]`).click();
    await clickLabel(page, "Equipment and scroll target", SPIRIT);
    const result = await scrollReceipt(report, before);
    if (result.code === "SERVER_BUSY") {
      assertion(
        !(await page.$eval("#error", (node) => node.value)),
        "SERVER_BUSY entered the error journal",
      );
      continue;
    }
    assertion(
      result.status === "committed" &&
        result.value?.kind === "equipment.enhancement",
      "Scroll did not commit",
      result,
    );
    await page.waitForFunction(
      (previous) =>
        (window.maple
          .snapshot()
          .profile.inventory.find((item) => item.id === 2043005)?.count ?? 0) <
        previous,
      {},
      quantity,
    );
    await ready(page);
    if (result.value.outcome === "curse") {
      await page.waitForFunction(
        (id) => {
          const p = window.maple.snapshot().profile;
          return (
            !p.inventory.some((item) => item.uid === id) &&
            !p.equipment.some((item) => item.uid === id)
          );
        },
        {},
        uid,
      );
      report.curses.push({ uid, attempts: attempt + 1 });
      return;
    }
  }
  throw new Error("No curse observed within the bounded real-RNG attempts");
}

async function scrollReceipt(report, index) {
  for (let poll = 0; poll < 100; poll++) {
    if (report.results[index]) return report.results[index];
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  throw new Error("Scroll receipt was not received within five seconds");
}

async function verifySaved(page, report) {
  await verifyPoints(page);
  const profile = await page.evaluate(() => window.maple.snapshot().profile);
  for (const { uid } of report.curses) {
    assertion(
      !profile.inventory.some((item) => item.uid === uid) &&
        !profile.equipment.some((item) => item.uid === uid),
      "Destroyed item returned after reconnect",
    );
  }
  report.checks.push(
    "Level-up points and both destroyed item instances persist across reconnect",
  );
}
