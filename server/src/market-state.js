import { MARKET_LIMITS } from "../../shared/market-protocol.js";
import { commerceItemSchema } from "../../shared/commerce-protocol.js";
import {
  array,
  enumeration,
  id,
  number,
  record,
  revision,
  validate,
  protocolError,
} from "../../shared/schema.js";
import { effectiveItemStackLimit } from "../../client/src/items/inventory-model.js";

const listingSchema = record({
  id,
  kind: enumeration("sale", "wanted", "auction"),
  itemId: number(1, 99999999),
  quantity: number(1, 32767),
  price: number(1, MARKET_LIMITS.price),
  buyNow: number(0, MARKET_LIMITS.price),
  createdAt: revision,
  expiresAt: revision,
  realm: id,
  bidderId: id,
  bid: number(0, MARKET_LIMITS.price),
  bids: number(0, 100000),
});
const stateSchema = record({
  listings: array(
    listingSchema,
    MARKET_LIMITS.listings,
    0,
    (entry) => entry.id,
  ),
  escrow: array(
    record({ listingId: id, item: commerceItemSchema }),
    MARKET_LIMITS.listings,
    0,
    (entry) => entry.listingId,
  ),
  transfer: array(
    commerceItemSchema,
    MARKET_LIMITS.transfers,
    0,
    (entry) => entry.uid,
  ),
  cart: array(id, MARKET_LIMITS.cart, 0, true),
  incoming: array(id, MARKET_LIMITS.transfers, 0, true),
});

export function marketState(profile) {
  profile.onlineState ??= { effects: [], cooldowns: {} };
  return (profile.onlineState.market ??= {
    listings: [],
    escrow: [],
    transfer: [],
    cart: [],
    incoming: [],
  });
}

export function marketRequire(condition, code = "REQUIREMENTS_NOT_MET") {
  if (!condition) throw protocolError(code);
}

/** Canonical ownership validation includes both escrow and delivered, unclaimed items. */
export function validateMarket(profile, templates) {
  const state = profile.onlineState?.market;
  if (!state) return;
  validate(state, stateSchema);
  marketRequire(
    marketSlots(state) <= MARKET_LIMITS.transfers,
    "INVENTORY_FULL",
  );
  const seen = new Set();
  for (const entry of state.escrow) {
    const listing = state.listings.find((row) => row.id === entry.listingId);
    marketRequire(
      listing &&
        listing.kind !== "wanted" &&
        listing.itemId === entry.item.id &&
        listing.quantity === entry.item.count,
      "NOT_ALLOWED",
    );
    validateMarketItem(profile, entry.item, templates, seen);
  }
  for (const item of state.transfer) {
    validateMarketItem(profile, item, templates, seen);
  }
  for (const listing of state.listings) {
    marketRequire(
      listing.expiresAt > listing.createdAt &&
        (listing.kind === "wanted" ||
          state.escrow.some((entry) => entry.listingId === listing.id)),
      "NOT_ALLOWED",
    );
  }
}

export function marketSlots(state) {
  return (
    state.transfer.length +
    state.escrow.length +
    state.incoming.length +
    state.listings.filter((entry) => entry.kind === "wanted").length
  );
}

function validateMarketItem(profile, item, templates, seen) {
  const template = templates[item.id];
  marketRequire(
    template?.descriptor &&
      item.count > 0 &&
      item.count <= effectiveItemStackLimit(profile, template) &&
      !seen.has(item.uid),
    "NOT_ALLOWED",
  );
  seen.add(item.uid);
}

/** Reserved wanted-order payments and auction bids are distinct from spendable NX. */
export function marketHeld(profile) {
  let total = 0;
  for (const listing of profile.onlineState?.market?.listings ?? []) {
    total += listing.kind === "wanted" ? listing.price : listing.bid;
  }
  return total;
}
