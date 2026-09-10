import {
  consumeItem,
  createItemUid,
  grantItem,
  inventoryType,
} from "./inventory-model.js";
import { profileError } from "./profile-validation.js";

export const TRADE_MESO_LIMIT = 2147483647;
// Ordinary EXE 007c39a0/007c20bc: 0x90 bytes, 0x10 per offer; not CashTradingRoom's five.
export const TRADE_SLOTS = 9;
const LOCK = 0x01;
const UNTRADEABLE = 0x08;
const KARMA_EQUIP = 0x10;
const KARMA_USE = 0x02;

/** Authorized Cosmic SERVER Trade.getFee; fee is deducted from received mesos. */
export function tradeFee(mesos) {
  tradeInteger(mesos, 0, TRADE_MESO_LIMIT, "mesos");
  if (mesos >= 100000000) return Math.floor((mesos * 6) / 100);
  if (mesos >= 25000000) return Math.floor((mesos * 5) / 100);
  if (mesos >= 10000000) return Math.floor((mesos * 4) / 100);
  if (mesos >= 5000000) return Math.floor((mesos * 3) / 100);
  if (mesos >= 1000000) return Math.floor((mesos * 18) / 1000);
  if (mesos >= 100000) return Math.floor((mesos * 8) / 1000);
  return 0;
}

export function tradeInteger(value, minimum, maximum, field) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw profileError("invalid-trade-value", `Invalid trade ${field}.`);
  }
  return value;
}

export function tradeParticipants(profiles, mapId) {
  for (const profile of profiles) {
    if (profile.hp <= 0) {
      throw profileError("trade-dead", "A defeated character cannot trade.");
    }
    if (profile.location.mapId !== mapId) {
      throw profileError(
        "trade-map",
        "The trade was cancelled because a character left the map.",
      );
    }
    tradeInteger(profile.meso, 0, TRADE_MESO_LIMIT, "wallet");
  }
}

/** Same canonical catalog as ProfileStore; absent original templates are not tradable. */
export function tradeTemplate(catalog, item) {
  const template = catalog.ui.items[item.id];
  if (!template?.descriptor || !template.info || template.id !== item.id) {
    throw profileError(
      "item-unavailable",
      "The original item template is unavailable.",
    );
  }
  return template;
}

/** Native instance restrictions plus authorized Cosmic PlayerInteractionHandler/KarmaManipulator. */
export function tradeItemAllowed(item, template, now) {
  if (item.slot <= 0) {
    throw profileError("trade-equipped", "Unequip the item before trading it.");
  }
  if (item.expiresAt !== null && item.expiresAt <= now) {
    throw profileError(
      "trade-expired",
      "The trade was cancelled because an item expired.",
    );
  }
  tradeTemplateAllowed(item, template.info);
  if (item.flags & LOCK) {
    throw profileError("trade-locked-item", "This item is locked.");
  }
  const karma = inventoryType(item.id) === 1 ? KARMA_EQUIP : KARMA_USE;
  const restricted =
    template.info.tradeBlock === 1 || template.info.quest === 1;
  if ((restricted || item.flags & UNTRADEABLE) && !(item.flags & karma)) {
    throw profileError("trade-untradeable", "This item cannot be traded.");
  }
}

function tradeTemplateAllowed(item, info) {
  // Cosmic config.yaml explicitly enables both cash and pet unmerchability.
  if (info.cash === 1 || Math.floor(item.id / 10000) === 500) {
    throw profileError(
      "trade-cash",
      "Cash items and pets cannot be traded in this room.",
    );
  }
  // 004f4011 ->005d28e3->005d4f4c: accountSharable is an unconditional native gate.
  if (info.accountSharable === 1) {
    throw profileError(
      "trade-account-item",
      "This item can only be moved within its account.",
    );
  }
}

export function tradeRechargeable(id) {
  const category = Math.floor(id / 10000);
  return category === 207 || category === 233;
}

/** Re-resolve every instance field, including its original positive inventory slot and full count. */
export function revalidateOffer(profile, offer, catalog, now) {
  const item = profile.inventory.find((entry) => entry.uid === offer.item.uid);
  const expected = offer.item;
  if (
    !item ||
    item.id !== expected.id ||
    item.count !== expected.count ||
    item.slot !== expected.slot ||
    item.owner !== expected.owner ||
    item.flags !== expected.flags ||
    item.expiresAt !== expected.expiresAt
  ) {
    throw profileError(
      "trade-item-changed",
      "An offered item changed. The trade was cancelled.",
    );
  }
  tradeInteger(offer.count, 1, item.count, "quantity");
  if (tradeRechargeable(item.id) && offer.count !== item.count) {
    throw profileError(
      "trade-rechargeable",
      "Throwing stars and bullets must be traded as a whole stack.",
    );
  }
  const template = tradeTemplate(catalog, item);
  tradeItemAllowed(item, template, now);
  return { item, template, count: offer.count };
}

function transferredItem(record) {
  const { item, count } = record;
  const karma = inventoryType(item.id) === 1 ? KARMA_EQUIP : KARMA_USE;
  const flags =
    item.flags & karma ? (item.flags & ~karma) | UNTRADEABLE : item.flags;
  return {
    ...item,
    count,
    flags,
    uid: count === item.count ? item.uid : createItemUid(),
  };
}

/** Mutate detached drafts only. All source removals precede capacity/unique destination checks. */
export function applyTradeItems(profiles, records) {
  const transfers = records.map((side) =>
    side.map((record) => ({
      template: record.template,
      item: transferredItem(record),
    })),
  );
  for (let side = 0; side < 2; side++) {
    for (const record of records[side]) {
      consumeItem(profiles[side], record.item.uid, record.count);
    }
  }
  for (let side = 0; side < 2; side++) {
    for (const transfer of transfers[side]) {
      grantItem(
        profiles[1 - side],
        transfer.template,
        transfer.item.count,
        transfer.item,
      );
    }
  }
}

export function applyTradeMesos(profiles, mesos) {
  const before = profiles[0].meso + profiles[1].meso;
  const fees = mesos.map(tradeFee);
  for (let side = 0; side < 2; side++) {
    tradeInteger(mesos[side], 0, profiles[side].meso, "offered mesos");
    const wallet =
      profiles[side].meso - mesos[side] + mesos[1 - side] - fees[1 - side];
    tradeInteger(wallet, 0, TRADE_MESO_LIMIT, "resulting wallet");
    profiles[side].meso = wallet;
  }
  if (profiles[0].meso + profiles[1].meso + fees[0] + fees[1] !== before) {
    throw profileError(
      "trade-conservation",
      "The trade did not conserve mesos and fees.",
    );
  }
}
