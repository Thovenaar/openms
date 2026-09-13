import {
  createItemUid,
  grantItem,
  inventoryType,
  itemStackLimit,
} from "./inventory-model.js";
import { profileError } from "../profile/profile-validation.js";
import { PROFILE_DOMAIN_LIMITS } from "../profile/profile-domains.js";

export const CASH_CURRENCIES = Object.freeze(["credit", "points", "prepaid"]);
export const CASH_POLICY = Object.freeze({
  balance: PROFILE_DOMAIN_LIMITS.cashBalance,
  locker: PROFILE_DOMAIN_LIMITS.locker,
  gifts: PROFILE_DOMAIN_LIMITS.gifts,
  wishlist: PROFILE_DOMAIN_LIMITS.wishlist,
  giftItems: PROFILE_DOMAIN_LIMITS.giftItems,
  // Original 007e47ef accepts length <0x49; Cosmic SERVER accepts <=73.
  message: 72,
  subscribers: 64,
  // Cosmic CashShop.CashItem: Period0 becomes90 days; days are wall-clock, not play time.
  defaultPeriodDays: 90,
  dayMs: 86400000,
});

export function cashFailure(code, reason) {
  return { ok: false, code, reason };
}

export function cashCurrency(currency) {
  if (!CASH_CURRENCIES.includes(currency)) {
    throw profileError(
      "cash-currency",
      "Select NX Credit, Maple Points or NX Prepaid.",
    );
  }
}

/** Cosmic action0x06; native004ba419 caps ordinary bags at96. Mutates a detached draft only. */
export function expandCashInventory(profile, { type, currency }) {
  cashCurrency(currency);
  if (!Number.isInteger(type) || type < 1 || type > 4) {
    throw profileError(
      "cash-inventory-type",
      "Select an ordinary inventory category.",
    );
  }
  if (profile.inventorySlots[type - 1] + 4 > 96) {
    throw profileError(
      "inventory-cap",
      "This inventory cannot be expanded beyond 96 slots.",
    );
  }
  if (profile.cash.balances[currency] < 4000) {
    throw profileError(
      "cash-insufficient",
      "You do not have enough funds for this expansion.",
    );
  }
  profile.inventorySlots[type - 1] += 4;
  profile.cash.balances[currency] -= 4000;
}

function templateOf(catalog, id) {
  const template = catalog.ui.items[id];
  if (!template?.descriptor || template.id !== id) {
    throw profileError(
      "item-unavailable",
      `Original item template ${id} is unavailable.`,
    );
  }
  return template;
}

// 004ba623 paired-ring checks and004baa03..36 literals; wedding IDs follow Cosmic ItemId.
function pairedRing(id) {
  const family = Math.floor(id / 100);
  return (
    (family === 11120 && id !== 1112000) ||
    (family === 11128 && id % 10 < 3) ||
    id === 1112803 ||
    id === 1112806 ||
    id === 1112807 ||
    id === 1112809
  );
}

export function cashGiftable(offer) {
  return (
    offer.price > 0 &&
    offer.category !== 8 &&
    Math.floor(offer.itemId / 10000) !== 911 &&
    !pairedRing(offer.itemId) &&
    ![5400000, 5401000, 5222000].includes(offer.itemId)
  );
}

/** Original native buy/gift admission 004ba623; identity domains absent from schema5 fail before debit. */
function admitTemplate(profile, template, gift = false) {
  const id = template.id;
  const kind = Math.floor(id / 10000);
  if (kind === 500 && !template.name) {
    throw profileError(
      "cash-pet-authority",
      "The original pet name is unavailable.",
    );
  }
  if (pairedRing(id)) {
    throw profileError(
      "cash-ring-authority",
      "Relationship rings require paired ring identities and relationship authority.",
    );
  }
  if (gift) return; // Cosmic action0x04 does not apply purchase-only level gates to recipients.
  const minimum = { 503: 16, 514: 16, 504: 7, 507: 11, 520: 16, 539: 11 }[kind];
  if (minimum && profile.level < minimum) {
    throw profileError("cash-level", `This item requires level ${minimum}.`);
  }
  // Authorized Cosmic SERVER-reference CashOperationHandler item admission, not a native level formula.
  if (kind === 543 && id !== 5430000 && profile.level < 30) {
    throw profileError("cash-level", "This Maple Life item requires level 30.");
  }
}

/** Every ownership domain participates in original info/only admission. */
function owned(profile, id) {
  return (
    profile.inventory.some((item) => item.id === id) ||
    profile.equipment.some((item) => item.id === id) ||
    profile.cash.locker.some((item) => item.id === id) ||
    profile.cash.gifts.some((gift) => gift.items.some((item) => item.id === id))
  );
}

function expiresAt(offer, now) {
  if (!Number.isSafeInteger(offer.period) || offer.period < 0) {
    throw profileError("cash-period", "Invalid original commodity period.");
  }
  let duration =
    (offer.period || CASH_POLICY.defaultPeriodDays) * CASH_POLICY.dayMs;
  if (offer.period === 1) {
    if (offer.itemId === 5211048 || offer.itemId === 5360042) {
      duration = 4 * 3600000;
    }
    if (offer.itemId === 5211060) duration = 2 * 3600000;
  }
  const result = now + duration;
  if (!Number.isSafeInteger(result)) {
    throw profileError(
      "cash-period",
      "Original item period exceeds the local clock range.",
    );
  }
  return result;
}

function purchasedItems(profile, offer, catalog, { now, gift }) {
  if (!Number.isSafeInteger(offer.count) || offer.count < 1) {
    throw profileError("cash-count", "Invalid original commodity count.");
  }
  const template = templateOf(catalog, offer.itemId);
  admitTemplate(profile, template, gift);
  if (template.info?.cash !== 1) {
    throw profileError(
      "cash-provenance",
      "This commodity requires original cash-instance provenance unavailable in the local item schema.",
    );
  }
  if (
    template.info?.only === 1 &&
    (offer.count !== 1 || owned(profile, offer.itemId))
  ) {
    throw profileError("unique-item", "You already have this unique item.");
  }
  const limit = itemStackLimit(template);
  const required = Math.ceil(offer.count / limit);
  if (required > CASH_POLICY.locker) {
    throw profileError(
      "cash-capacity",
      "The commodity exceeds the cash inventory capacity.",
    );
  }
  const items = [];
  let count = offer.count;
  const expiration = gift ? null : expiresAt(offer, now);
  for (let index = 0; index < required; index++) {
    const amount = Math.min(count, limit);
    items.push({
      uid: createItemUid(),
      id: offer.itemId,
      count: amount,
      slot: 1,
      owner: "",
      flags: 0,
      expiresAt: expiration,
    });
    count -= amount;
  }
  return items;
}

export function cashOffer(catalog, sn) {
  if (!Number.isSafeInteger(sn) || sn < 1) {
    throw profileError("cash-offer", "Select an original cash commodity.");
  }
  const offer = catalog.ui.cashShop.commodities[sn];
  if (!offer || !offer.onSale) {
    throw profileError(
      "cash-off-sale",
      "This item is not available for purchase.",
    );
  }
  return offer;
}

function contents(catalog, offer) {
  if ([9111000, 9112000, 9113000, 9114000].includes(offer.itemId)) return [];
  const pack = catalog.ui.cashShop.packages[offer.itemId];
  if (!pack) {
    if (offer.itemId >= 6000000) {
      throw profileError(
        "cash-service-authority",
        `Commodity ${offer.sn} requires its original account service, not an inventory item.`,
      );
    }
    return [offer];
  }
  if (pack.missing.length) {
    throw profileError(
      "cash-package-data",
      "The package references unavailable original commodities.",
    );
  }
  if (!pack.sns.length || pack.sns.length > CASH_POLICY.locker) {
    throw profileError(
      "cash-package-data",
      "Invalid original cash package size.",
    );
  }
  return pack.sns.map((sn) => catalog.ui.cashShop.commodities[sn]);
}

function admitCashOffer(profile, offer, request) {
  if (request.gift && !cashGiftable(offer)) {
    throw profileError(
      "cash-gift-restricted",
      "This commodity cannot use the ordinary gift service.",
    );
  }
  if (
    !request.gift &&
    offer.gender !== -1 &&
    offer.gender !== 2 &&
    offer.gender !== profile.gender
  ) {
    throw profileError(
      "cash-gender",
      "This item cannot be used by this character's gender.",
    );
  }
}

function cashPayment(profile, offer, request) {
  const meso = offer.category === 8;
  if (
    meso
      ? request.currency !== "meso"
      : !CASH_CURRENCIES.includes(request.currency)
  ) {
    throw profileError(
      "cash-currency",
      meso
        ? "This commodity is purchased with Mesos."
        : "Select a cash balance.",
    );
  }
  const price = offer.price;
  if (
    !Number.isSafeInteger(price) ||
    price <= 0 ||
    price > CASH_POLICY.balance
  ) {
    throw profileError("cash-price", "Invalid original commodity price.");
  }
  const balance = meso ? profile.meso : profile.cash.balances[request.currency];
  if (balance < price) {
    throw profileError(
      "cash-insufficient",
      "You do not have enough funds for this purchase.",
    );
  }
  return { meso, price };
}

/** One source SN carries its authored Count; the native purchase packet has no lot-count field. */
export function cashPurchasePlan(profile, catalog, request, now) {
  const offer = cashOffer(catalog, request.sn);
  admitCashOffer(profile, offer, request);
  const { meso, price } = cashPayment(profile, offer, request);
  const expansionType = [9111000, 9112000, 9113000, 9114000].includes(
    offer.itemId,
  )
    ? (offer.itemId - 9110000) / 1000
    : 0;
  if (expansionType && profile.inventorySlots[expansionType - 1] + 8 > 96) {
    throw profileError(
      "inventory-cap",
      "This inventory cannot be expanded beyond 96 slots.",
    );
  }
  return {
    offer,
    price,
    meso,
    now,
    expansionType,
    contents: contents(catalog, offer),
  };
}

export function addCashItems(profile, items) {
  if (profile.cash.locker.length + items.length > CASH_POLICY.locker) {
    throw profileError(
      "cash-locker-full",
      "Please make room in your Cash Inventory.",
    );
  }
  const occupied = new Set(profile.cash.locker.map((item) => item.slot));
  let slot = 1;
  for (const item of items) {
    while (slot <= CASH_POLICY.locker && occupied.has(slot)) slot++;
    if (slot > CASH_POLICY.locker) {
      throw profileError(
        "cash-locker-full",
        "Please make room in your Cash Inventory.",
      );
    }
    profile.cash.locker.push({ ...item, slot });
    occupied.add(slot++);
  }
}

/** Every package member is applied to one unpublished transaction draft. */
export function deliverCashPurchase(profile, catalog, plan) {
  if (plan.expansionType) profile.inventorySlots[plan.expansionType - 1] += 8;
  const purchase = { now: plan.now, gift: false };
  for (const offer of plan.contents) {
    if (plan.meso) {
      const template = templateOf(catalog, offer.itemId);
      admitTemplate(profile, template);
      // Cosmic action0x20 explicitly grants one quest item without cash expiration.
      grantItem(profile, template, 1);
    } else {
      addCashItems(profile, purchasedItems(profile, offer, catalog, purchase));
    }
  }
}

export function debitCashPurchase(profile, currency, plan) {
  if (plan.meso) profile.meso -= plan.price;
  else profile.cash.balances[currency] -= plan.price;
}

/** One original commodity SN produces one notice, including every package member. */
export function deliverCashGift(profile, catalog, plan, sender) {
  let count = profile.cash.gifts.reduce(
    (total, gift) => total + gift.items.length,
    0,
  );
  if (profile.cash.gifts.length >= CASH_POLICY.gifts) {
    throw profileError(
      "cash-gifts-full",
      "The recipient's gift inventory is full.",
    );
  }
  const envelope = {
    uid: createItemUid(),
    senderId: sender.id,
    senderName: sender.name,
    message: sender.message,
    sn: plan.offer.sn,
    items: [],
  };
  profile.cash.gifts.push(envelope);
  const purchase = { now: plan.now, gift: true };
  for (const offer of plan.contents) {
    const items = purchasedItems(profile, offer, catalog, purchase);
    if (count + items.length > CASH_POLICY.giftItems) {
      throw profileError(
        "cash-gifts-full",
        "The recipient's gift inventory is full.",
      );
    }
    for (const item of items) {
      item.slot = envelope.items.length + 1;
      envelope.items.push(item);
    }
    count += items.length;
  }
  if (!envelope.items.length) {
    throw profileError(
      "cash-gift-data",
      "The original gift has no deliverable contents.",
    );
  }
}

/** Cosmic loadGifts creates item periods at receipt, not when the sender pays. */
export function claimCashGift(profile, catalog, gift, now) {
  const source = catalog.ui.cashShop.commodities[gift.sn];
  if (!source) {
    throw profileError(
      "cash-gift-catalog",
      "The original gift commodity record is unavailable.",
    );
  }
  const claim = { gift, now, index: 0, unique: new Set() };
  for (const offer of contents(catalog, source)) {
    claimGiftCommodity(profile, catalog, offer, claim);
  }
  if (claim.index !== gift.items.length) {
    throw profileError(
      "cash-gift-data",
      "The gift contents do not match the original commodity.",
    );
  }
  addCashItems(profile, gift.items);
}

function claimGiftCommodity(profile, catalog, offer, claim) {
  const template = templateOf(catalog, offer.itemId);
  const limit = itemStackLimit(template),
    required = Math.ceil(offer.count / limit);
  if (
    !Number.isSafeInteger(required) ||
    required < 1 ||
    required > CASH_POLICY.giftItems
  ) {
    throw profileError("cash-gift-data", "Invalid original gift count.");
  }
  let remaining = offer.count;
  for (let stack = 0; stack < required; stack++) {
    const item = claim.gift.items[claim.index++],
      amount = Math.min(remaining, limit);
    if (!item || item.id !== offer.itemId || item.count !== amount) {
      throw profileError(
        "cash-gift-data",
        "The gift contents do not match the original commodity.",
      );
    }
    admitCashTransfer(catalog, item, claim.now);
    admitGiftOwnership(profile, template, item, claim.unique);
    claim.unique.add(item.id);
    if (item.expiresAt === null) item.expiresAt = expiresAt(offer, claim.now);
    remaining -= amount;
  }
}

function admitGiftOwnership(profile, template, item, unique) {
  if (
    template.info.only === 1 &&
    (item.count !== 1 || unique.has(item.id) || owned(profile, item.id))
  ) {
    throw profileError("unique-item", "You already have this unique item.");
  }
}

export function admitCashTransfer(catalog, item, now) {
  if (!item) {
    throw profileError(
      "cash-item-missing",
      "The selected cash item is no longer available.",
    );
  }
  const template = templateOf(catalog, item.id);
  if (template.info?.cash !== 1) {
    throw profileError(
      "not-cash-item",
      "Only cash items can be moved to Cash Inventory.",
    );
  }
  if (item.expiresAt !== null && item.expiresAt <= now) {
    throw profileError("item-expired", "This cash item has expired.");
  }
  if (item.slot < 1) {
    throw profileError(
      "item-equipped",
      "Unequip the item before moving it to Cash Inventory.",
    );
  }
  inventoryType(item.id);
  return template;
}
