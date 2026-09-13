import {
  consumeItem,
  createItemUid,
  grantItem,
  isRechargeable,
} from "../../client/src/items/inventory-model.js";
import { MARKET_LIMITS } from "../../shared/market-protocol.js";
import { marketState, marketRequire, marketSlots } from "./market-state.js";

/** WZ flags gate custody before debit. Transfer restrictions are OpenMS policy, not imported server logic. */
export function marketItem(profile, uid, context) {
  const item = profile.inventory.find((entry) => entry.uid === uid);
  const template = context.content.items[item?.id];
  marketRequire(item && template?.descriptor, "NOT_FOUND");
  marketTemplateAllowed(template);
  marketRequire(!context.actor.itemLocks?.has(uid), "CHARACTER_BUSY");
  marketRequire(
    item.slot > 0 && item.count > 0 && Math.floor(item.id / 1000000) <= 4,
  );
  marketRequire(!(item.flags & 9));
  marketRequire(item.expiresAt === null || item.expiresAt > context.now);
  return item;
}

export function marketTemplateAllowed(template) {
  const info = template.info;
  marketRequire(
    info &&
      !info.cash &&
      !info.quest &&
      !info.tradeBlock &&
      !info.accountSharable &&
      !info.notSale &&
      !isRechargeable(template.id),
  );
}

export function removeMarketItem(profile, item, quantity) {
  marketRequire(quantity > 0 && quantity <= item.count);
  const transferred = structuredClone(item);
  transferred.uid = quantity === item.count ? item.uid : createItemUid();
  transferred.count = quantity;
  transferred.slot = 1;
  consumeItem(profile, item.uid, quantity);
  return transferred;
}

export function receiveMarketItem(profile, item, changesOwner = false) {
  const state = marketState(profile);
  marketRequire(marketSlots(state) < MARKET_LIMITS.transfers, "INVENTORY_FULL");
  const next = structuredClone(item);
  // Native007c39a0 warns that a one-trade instance becomes bound on receipt.
  const oneTrade = Math.floor(item.id / 1000000) === 1 ? 16 : 2;
  if (changesOwner && next.flags & oneTrade) {
    next.flags = (next.flags & ~oneTrade) | 8;
  }
  next.slot = state.transfer.length + 1;
  state.transfer.push(next);
}

export function claimMarketItem(profile, uid, content) {
  const state = marketState(profile);
  const item = state.transfer.find((entry) => entry.uid === uid);
  marketRequire(item, "NOT_FOUND");
  const template = content.items[item.id];
  marketRequire(template?.descriptor, "CONTENT_MISMATCH");
  grantItem(profile, template, item.count, item);
  state.transfer.splice(state.transfer.indexOf(item), 1);
  for (let index = 0; index < state.transfer.length; index++) {
    state.transfer[index].slot = index + 1;
  }
}

export function takeEscrow(profile, listingId) {
  const state = marketState(profile);
  const entry = state.escrow.find((row) => row.listingId === listingId);
  marketRequire(entry, "CONTENT_MISMATCH");
  state.escrow.splice(state.escrow.indexOf(entry), 1);
  return entry.item;
}

/** The existing prepaid balance is the OpenMS MTS currency; payment providers are outside this feature. */
export function marketBalance(profile, delta) {
  const balance = profile.cash.balances.prepaid + delta;
  marketRequire(
    Number.isSafeInteger(balance) && balance >= 0 && balance <= 2147483647,
  );
  profile.cash.balances.prepaid = balance;
}

// Original decoded string4748 (00b09d88) explicitly describes a 5% seller transaction fee.
export function marketProceeds(price) {
  return price - Math.ceil((price * 5) / 100);
}

export function reserveMarketDelivery(profile, listingId) {
  const state = marketState(profile);
  marketRequire(
    marketSlots(state) < MARKET_LIMITS.transfers &&
      !state.incoming.includes(listingId),
    "INVENTORY_FULL",
  );
  state.incoming.push(listingId);
}

export function releaseMarketDelivery(profile, listingId) {
  const state = marketState(profile);
  const index = state.incoming.indexOf(listingId);
  marketRequire(index >= 0, "CONTENT_MISMATCH");
  state.incoming.splice(index, 1);
}
