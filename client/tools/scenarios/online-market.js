import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertion, failureDetails, measureStage } from "../native-evidence.js";
import { onlineIdentity } from "./online-lifecycle.js";
import {
  checkMarketFilters,
  checkWantedOrder,
  checkAuction,
} from "./online-market-orders.js";
import {
  participant,
  signIn,
  replace,
  closeConsole,
} from "./online-ui-repairs.js";

const MARKET = '.maple-ui-panel[aria-label="ITC"]';

export async function runOnlineMarket({ browser, url, output, restart }) {
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
    const seller = await participant(browser, contexts, pages, report);
    const buyer = await participant(browser, contexts, pages, report);
    await measureStage(report.timings, "recovery-dialog", () =>
      recovery(buyer, url, output),
    );
    report.checks.push(
      "Account recovery validates email, explains deferred delivery and clears the address when closed",
    );
    await measureStage(report.timings, "login", async () => {
      await signIn(seller, url, "admin");
      await signIn(buyer, url, "player");
      await openMarket(seller);
      await openMarket(buyer);
    });
    await measureStage(report.timings, "list-and-purchase", () =>
      purchase(seller, buyer),
    );
    await seller.screenshot({ path: join(output, "seller-after-sale.png") });
    await buyer.screenshot({ path: join(output, "buyer-transfer.png") });
    report.checks.push(
      "Native inventory listing reaches another client; purchase debits 100 NX and credits 95 NX atomically",
    );
    for (const page of pages) await page.goto("about:blank");
    await measureStage(report.timings, "restart-and-claim", () =>
      restorePurchase({ seller, buyer, url, restart }),
    );
    report.checks.push(
      "Unclaimed purchase survives server restart, then moves to the buyer inventory once",
    );
    await checkOrderKinds(seller, buyer, report);
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

async function checkOrderKinds(seller, buyer, report) {
  await measureStage(report.timings, "wanted-and-auction", async () => {
    await openMarket(seller);
    await checkWantedOrder(seller, buyer);
    await checkAuction(seller, buyer);
  });
  report.checks.push(
    "Native wanted orders reserve funds and fulfill; auction bids and buy-now reuse escrow with correct fees",
  );
}

async function captureFailure(pages, report, output) {
  for (const [index, page] of pages.entries()) {
    await page.screenshot({ path: join(output, `failure-${index}.png`) });
    report.errors.push(
      await page.evaluate(() => document.querySelector("#error")?.value ?? ""),
    );
    report.forms ??= [];
    report.forms.push(await page.evaluate(marketFormState));
  }
}

function marketFormState() {
  const form = document.querySelector('[aria-label="List an item"] form');
  if (!form) return null;
  const button = form.querySelector('[type="submit"]');
  const box = button.getBoundingClientRect();
  return {
    inputs: Array.from(form.querySelectorAll("input")).map((input) => ({
      label: input.getAttribute("aria-label"),
      value: input.value,
      valid: input.validity.valid,
      message: input.validationMessage,
    })),
    hit: document.elementFromPoint(
      box.x + box.width / 2,
      box.y + box.height / 2,
    )?.outerHTML,
    events: form.dataset.events,
  };
}

async function restorePurchase({ seller, buyer, url, restart }) {
  await restart();
  await signIn(buyer, url, "player");
  await openMarket(buyer);
  await buyer.locator(`${MARKET} [aria-label="Red Potion × 4"]`).click();
  await buyer.waitForFunction(() =>
    window.maple
      .snapshot()
      .profile.inventory.some(
        (item) => item.id === 2000000 && item.count === 4,
      ),
  );
  assertion((await balance(buyer)) === 9900, "Buyer balance survives restart");
  await signIn(seller, url, "admin");
  assertion(
    (await balance(seller)) === 10095,
    "Seller proceeds survive restart",
  );
}

async function openMarket(page) {
  await page.locator('[aria-label="NPT"]').click();
  await page.waitForSelector(MARKET, { visible: true });
  await page.waitForFunction(
    (selector) =>
      !document
        .querySelector(`${selector} [role="status"]`)
        ?.textContent.includes("Updating"),
    {},
    MARKET,
  );
}

async function purchase(seller, buyer) {
  await seller.bringToFront();
  await seller.locator(`${MARKET} [aria-label="Red Potion × 10"]`).click();
  await seller.waitForSelector('[aria-label="List an item"]', {
    visible: true,
  });
  await replace(seller, '[aria-label="Quantity"]', "4");
  await replace(seller, '[aria-label="Duration (hours)"]', "24");
  await seller
    .locator('[aria-label="List an item"] button[type="submit"]')
    .click();
  await seller.waitForSelector('[aria-label="List an item"]', {
    hidden: true,
    timeout: 5000,
  });
  await buyer.bringToFront();
  await checkMarketFilters(buyer);
  await buyer.locator(`${MARKET} [data-mts-listing]`).click();
  await buyer.locator(`${MARKET} [aria-label="Buy selected listing"]`).click();
  await buyer
    .locator('.maple-ui-panel[aria-label="NativePrompt"] [aria-label="OK"]')
    .click();
  await buyer.waitForFunction(
    () => window.maple.snapshot().profile.cash.balances.prepaid === 9900,
  );
  await seller.waitForFunction(
    () => window.maple.snapshot().profile.cash.balances.prepaid === 10095,
  );
  const quantity = await seller.evaluate(
    () =>
      window.maple
        .snapshot()
        .profile.inventory.find((item) => item.id === 2000000)?.count,
  );
  assertion(
    quantity === 6,
    "Only the listed four-item lot leaves seller inventory",
  );
  await buyer.waitForSelector(`${MARKET} [aria-label="Red Potion × 4"]`, {
    visible: true,
  });
}

function balance(page) {
  return page.evaluate(
    () => window.maple.snapshot().profile.cash.balances.prepaid,
  );
}

async function recovery(page, url, output) {
  await page.goto(url);
  await page.waitForFunction(() => window.maple?.snapshot().login?.artwork);
  await closeConsole(page);
  await page.locator(".online-login-recovery").click();
  await page.type(
    '[aria-label="Recovery email address"]',
    "player@example.invalid",
  );
  await page
    .locator('[aria-label="Recover your account"] button[type="submit"]')
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="Recover your account"] [role="status"]')
      .textContent.includes("No email has been sent"),
  );
  await page.screenshot({ path: join(output, "account-recovery.png") });
  await page.keyboard.press("Escape");
  const value = await page.$eval(
    '[aria-label="Recovery email address"]',
    (input) => input.value,
  );
  assertion(value === "", "Closing recovery clears the entered address");
}
