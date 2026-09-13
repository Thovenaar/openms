import { profileError } from "../../client/src/profile/profile-validation.js";
import { grantItem } from "../../client/src/items/inventory-model.js";
import {
  cashCurrency,
  cashOffer,
  cashPurchasePlan,
  deliverCashPurchase,
  debitCashPurchase,
  deliverCashGift,
  claimCashGift,
  addCashItems,
  admitCashTransfer,
  expandCashInventory,
} from "../../client/src/items/cash-commerce.js";

export function cashRequire(condition, code, reason) {
  if (!condition) throw profileError(code, reason);
}

export function buyCash(draft, catalog, request, now) {
  const plan = cashPurchasePlan(draft, catalog, request, now);
  deliverCashPurchase(draft, catalog, plan);
  debitCashPurchase(draft, request.currency, plan);
  return plan;
}

function transferCash(draft, catalog, request, now) {
  if (request.kind === "cash.move-to-inventory") {
    const index = draft.cash.locker.findIndex(
      (item) => item.uid === request.uid,
    );
    const item = draft.cash.locker[index];
    const template = admitCashTransfer(catalog, item, now);
    draft.cash.locker.splice(index, 1);
    grantItem(draft, template, item.count, item);
    return;
  }
  const index = draft.inventory.findIndex((item) => item.uid === request.uid);
  const item = draft.inventory[index];
  cashRequire(
    !draft.pets.some(
      (pet) => pet.itemUid === request.uid && pet.summonedSlot !== null,
    ),
    "pet-summoned",
    "Dismiss the pet before moving it to Cash Inventory.",
  );
  admitCashTransfer(catalog, item, now);
  addCashItems(draft, [item]);
  draft.inventory.splice(index, 1);
}

function claimGift(draft, catalog, uid, now) {
  const index = draft.cash.gifts.findIndex((gift) => gift.uid === uid);
  cashRequire(
    index >= 0,
    "cash-gift-missing",
    "This gift was already received or is no longer available.",
  );
  const [gift] = draft.cash.gifts.splice(index, 1);
  claimCashGift(draft, catalog, gift, now);
}

function wishlist(draft, catalog, sns) {
  for (const sn of sns) {
    cashRequire(
      cashOffer(catalog, sn).category !== 8,
      "cash-wishlist",
      "Meso commodities cannot be added to the Wish List.",
    );
  }
  draft.cash.wishlist = sns.slice();
}

/** Every operation runs only inside one unpublished, validated authority draft. */
export function mutateCash(draft, catalog, request, now) {
  const action = request.kind.slice(5);
  const value = { kind: "cash.transaction", action };
  switch (request.kind) {
    case "cash.buy":
      buyCash(draft, catalog, request, now);
      value.sn = request.sn;
      break;
    case "cash.buy-avatar":
      cashCurrency(request.currency);
      for (const sn of request.sns)
        {buyCash(draft, catalog, { sn, currency: request.currency }, now);}
      value.sns = request.sns.slice();
      break;
    case "cash.expand-inventory":
      expandCashInventory(draft, request);
      value.type = request.type;
      break;
    case "cash.wishlist":
      wishlist(draft, catalog, request.sns);
      break;
    case "cash.claim-gift":
      claimGift(draft, catalog, request.uid, now);
      value.uid = request.uid;
      break;
    case "cash.move-to-inventory":
    case "cash.move-to-locker":
      transferCash(draft, catalog, request, now);
      value.uid = request.uid;
      break;
    default:
      cashRequire(false, "cash-request", "Unsupported cash operation.");
  }
  return { value };
}

/** Sender plus every recipient settles together; even the last full recipient aborts all debits. */
export function giftCash(profiles, senderId, context) {
  const { catalog, request, now } = context;
  const sender = profiles.get(senderId);
  cashRequire(
    request.currency === "prepaid",
    "cash-gift-currency",
    "Gifts require NX Prepaid.",
  );
  cashRequire(
    Boolean(request.message.trim()),
    "cash-gift-message",
    "Enter a gift message.",
  );
  for (const targetId of request.targetIds) {
    cashRequire(
      targetId !== senderId,
      "cash-self-gift",
      "You cannot send gifts to yourself.",
    );
    const recipient = profiles.get(targetId);
    cashRequire(recipient, "cash-recipient", "The recipient no longer exists.");
    const plan = cashPurchasePlan(
      sender,
      catalog,
      { ...request, gift: true },
      now,
    );
    cashRequire(
      !plan.meso && !plan.expansionType,
      "cash-gift-restricted",
      "This commodity cannot be gifted.",
    );
    deliverCashGift(recipient, catalog, plan, {
      id: senderId,
      name: sender.name,
      message: request.message,
    });
    debitCashPurchase(sender, request.currency, plan);
  }
  return {
    value: {
      kind: "cash.transaction",
      action: "gift",
      sn: request.sn,
      targetIds: request.targetIds.slice(),
    },
  };
}
