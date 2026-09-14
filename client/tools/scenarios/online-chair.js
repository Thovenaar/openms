import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import { participant, ready } from "./online-ui-repairs.js";
import { login } from "./online-recycling-scrolls.js";
import { clickLabel } from "./native.js";

const ITEM = '.maple-ui-panel[aria-label="Item"]';
const CHAIR = 3010000;

/** Native setup-tab chair use → committed seat receipt → resident sit pose for self and peers. */
export async function runChair({ browser, url, output }) {
  await mkdir(output, { recursive: true });
  const report = {
    status: "running",
    checks: [],
    results: [],
    errors: [],
  };
  const contexts = [],
    pages = [];
  try {
    report.identity = await onlineIdentity(url);
    for (const name of ["sitter", "witness"]) {
      const page = await participant(browser, contexts, pages, report);
      await login(page, url, name);
    }
    const [sitter, witness] = pages;
    await sitOnChair(sitter, output, report);
    await witnessSeesSeat(sitter, witness, report);
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

function seated(page) {
  return page
    .waitForFunction(() => window.maple.snapshot().simulation?.seat !== null, {
      timeout: 2000,
    })
    .then(() => true)
    .catch(() => false);
}

async function sitOnChair(page, output, report) {
  await page.bringToFront();
  await page.keyboard.press("i");
  await page.waitForSelector(ITEM, { visible: true });
  await clickLabel(page, "Item tab 3", ITEM);
  const uid = await page.evaluate(() => {
    const item = window.maple
      .snapshot()
      .profile.inventory.find((entry) => entry.id === 3010000);
    return item?.uid ?? null;
  });
  assertion(uid, "Seeded chair instance is missing from the setup tab");
  const selector = `${ITEM} [data-item-uid="${uid}"]`;
  await page.waitForSelector(selector, { visible: true });
  await activate(page, selector);
  await page.waitForFunction(
    () => window.maple.snapshot().online.status === "active",
  );
  await page.waitForFunction(
    () =>
      window.maple.snapshot().simulation?.seat !== null &&
      window.maple.snapshot().chairs === 1 &&
      window.mapleOnline
        .observation()
        .entities.some(
          (entry) => entry.appearance?.name === "Sitter" && entry.seat?.id,
        ),
    { timeout: 5000 },
  );
  const state = await page.evaluate(() => {
    const entity = window.mapleOnline
      .observation()
      .entities.find((entry) => entry.appearance?.name === "Sitter");
    return {
      status: window.maple.snapshot().online.status,
      seat: window.maple.snapshot().simulation?.seat ?? null,
      action: window.maple.snapshot().simulation?.action ?? null,
      entity,
      chairs: window.maple.snapshot().chairs ?? null,
    };
  });
  await page.screenshot({ path: join(output, "seated.png") });
  report.seated = state;
  assertion(
    state.status === "active",
    "Client left the active field after using a chair",
    state,
  );
  assertion(
    state.action === "sit",
    "Chair seat did not select the sit pose",
    state,
  );
  assertion(
    state.entity?.seat?.id === CHAIR,
    "Published entity did not retain the chair template",
    state.entity?.seat,
  );
  assertion(
    state.chairs === 1,
    "Local client did not build the seated chair artwork",
    state,
  );
  assertion(report.errors.length === 0, "Browser exceptions", report.errors);
  report.checks.push(
    "Seeded chair sits through the native setup tab without a reconnect",
  );
  await ready(page);
}

/** Native double click: the first down arms the carried instance, the second down (detail 2)
 *  consumes it. One synthetic clickCount:2 down never arms the carry, so it cannot use an item. */
async function activate(page, selector) {
  const box = await page.$eval(selector, (node) =>
    node.getBoundingClientRect().toJSON(),
  );
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y, { clickCount: 1 });
  await page.mouse.click(x, y, { clickCount: 2 });
  await seated(page);
}

/** A peer on the same map must observe both the chair template and the seated pose. */
async function witnessSeesSeat(sitter, witness, report) {
  await witness.waitForFunction(
    () =>
      window.mapleOnline
        .observation()
        .entities.some(
          (entity) =>
            entity.appearance?.name === "Sitter" &&
            entity.seat?.id === 3010000 &&
            entity.action === 7,
        ),
    { timeout: 10000 },
  );
  const observed = await witness.evaluate(() => {
    const entity = window.mapleOnline
      .observation()
      .entities.find((entry) => entry.appearance?.name === "Sitter");
    return {
      seat: entity?.seat ?? null,
      action: entity?.action ?? null,
      chairs: window.maple.snapshot().chairs ?? null,
      status: window.maple.snapshot().online.status,
    };
  });
  report.witness = observed;
  assertion(
    observed.status === "active",
    "Witness left the active field while the peer sat down",
    observed,
  );
  assertion(
    observed.chairs === 1,
    "Peer did not build the seated chair artwork",
    observed,
  );
  report.checks.push(
    "Peer observes the published chair seat and seated pose on the same map",
  );
}
