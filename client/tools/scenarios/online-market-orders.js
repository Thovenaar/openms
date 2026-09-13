import { replace } from "./online-ui-repairs.js";

const MARKET = '.maple-ui-panel[aria-label="ITC"]';
const ROW = `${MARKET} [data-mts-listing]`;
const FORM = '[role="dialog"][aria-label="List an item"]';
const WANTED = '[role="dialog"][aria-label="Create wanted order"]';

export async function checkMarketFilters(buyer) {
  await buyer.bringToFront();
  await buyer.locator(`${MARKET} [aria-label="MTS category: Equip"]`).click();
  await buyer.waitForSelector(ROW, { hidden: true });
  await marketIdle(buyer);
  await buyer.locator(`${MARKET} [aria-label="MTS category: Use"]`).click();
  await buyer.waitForSelector(ROW, { visible: true });
  await marketIdle(buyer);
  await buyer.locator(ROW).click();
  await buyer.locator(`${MARKET} [aria-label="Selected item details"]`).click();
  await buyer.waitForFunction(() =>
    document
      .querySelector('.maple-ui-panel[aria-label="NativePrompt"]')
      ?.textContent.includes("Quantity: 4"),
  );
  await acceptMarketPrompt(buyer);
  await buyer
    .locator(`${MARKET} [aria-label="Change selected cart item"]`)
    .click();
  await marketIdle(buyer);
  await buyer.locator(`${MARKET} [aria-label="Shopping cart"]`).click();
  await buyer.waitForSelector(`${MARKET} [aria-label="Clear shopping cart"]`, {
    visible: true,
  });
  await buyer.waitForSelector(ROW, { visible: true });
  await marketIdle(buyer);
  await buyer.locator(`${MARKET} [aria-label="Clear shopping cart"]`).click();
  await buyer.waitForSelector(ROW, { hidden: true });
  await marketIdle(buyer);
  await buyer.locator(`${MARKET} [aria-label="For sale"]`).click();
  await buyer.waitForSelector(ROW, { visible: true });
}

export function marketIdle(page) {
  return page.waitForFunction(
    (selector) =>
      !document
        .querySelector(`${selector} [role="status"]`)
        ?.textContent.includes("Updating"),
    {},
    MARKET,
  );
}

export async function checkWantedOrder(seller, buyer) {
  await buyer.bringToFront();
  await marketIdle(buyer);
  await buyer
    .locator(`${MARKET} button[aria-label="Create wanted order"]`)
    .click();
  await buyer.waitForSelector(WANTED, { visible: true });
  await replace(buyer, '[aria-label="Find wanted item"]', "Red Potion");
  await buyer.select('[aria-label="Wanted item"]', "2000000");
  await replace(buyer, `${WANTED} [aria-label="Lot price (NX)"]`, "50");
  await buyer.locator(`${WANTED} button[type="submit"]`).click();
  await buyer.waitForSelector(WANTED, { hidden: true });
  await waitBalance(buyer, 9850);
  await seller.bringToFront();
  await seller.locator(`${MARKET} [aria-label="Wanted"]`).click();
  await seller.locator(ROW).click();
  await seller.locator(`${MARKET} [aria-label="Buy selected listing"]`).click();
  await acceptMarketPrompt(seller);
  await waitBalance(seller, 10142);
  await buyer.waitForSelector(`${MARKET} [aria-label="Red Potion × 1"]`, {
    visible: true,
  });
}

export async function checkAuction(seller, buyer) {
  await seller.bringToFront();
  await marketIdle(seller);
  await seller.locator(`${MARKET} [aria-label="Red Potion × 5"]`).click();
  await seller.waitForSelector(FORM, { visible: true });
  await replace(seller, `${FORM} [aria-label="Quantity"]`, "2");
  await seller.select(`${FORM} [aria-label="Listing type"]`, "auction");
  await replace(
    seller,
    `${FORM} [aria-label="Auction buy now (0 = none)"]`,
    "500",
  );
  await seller.locator(`${FORM} button[type="submit"]`).click();
  await seller.waitForSelector(FORM, { hidden: true });
  await buyer.bringToFront();
  await marketIdle(buyer);
  await buyer.locator(`${MARKET} [aria-label="Auction"]`).click();
  await buyer.locator(ROW).click();
  await buyer
    .locator(`${MARKET} [aria-label="Bid on selected listing"]`)
    .click();
  await acceptMarketPrompt(buyer);
  await waitBalance(buyer, 9750);
  await marketIdle(buyer);
  await buyer.locator(ROW).click();
  await buyer.locator(`${MARKET} [aria-label="Buy selected listing"]`).click();
  await acceptMarketPrompt(buyer);
  await waitBalance(buyer, 9350);
  await waitBalance(seller, 10617);
  await buyer.waitForSelector(`${MARKET} [aria-label="Red Potion × 2"]`, {
    visible: true,
  });
}

export async function acceptMarketPrompt(page) {
  await page
    .locator('.maple-ui-panel[aria-label="NativePrompt"] [aria-label="OK"]')
    .click();
}

function waitBalance(page, expected) {
  return page.waitForFunction(
    (value) => window.maple.snapshot().profile.cash.balances.prepaid === value,
    {},
    expected,
  );
}
