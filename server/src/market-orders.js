import { MARKET_LIMITS } from "../../shared/market-protocol.js";
import { marketRequire, marketState, marketSlots } from "./market-state.js";
import {
  marketItem,
  marketTemplateAllowed,
  removeMarketItem,
  receiveMarketItem,
  takeEscrow,
  marketBalance,
  marketProceeds,
  reserveMarketDelivery,
  releaseMarketDelivery,
} from "./market-inventory.js";
import { effectiveItemStackLimit } from "../../client/src/items/inventory-model.js";

export function createMarketOrder(profile, request, context) {
  const state = marketState(profile);
  marketRequire(state.listings.length < MARKET_LIMITS.listings, "SERVER_BUSY");
  marketRequire(marketSlots(state) < MARKET_LIMITS.transfers, "INVENTORY_FULL");
  const wanted = request.kind === "mts.want";
  const item = wanted ? null : marketItem(profile, request.uid, context);
  const template = context.content.items[wanted ? request.itemId : item.id];
  marketRequire(
    template?.descriptor && Math.floor(template.id / 1000000) <= 4,
    "CONTENT_MISMATCH",
  );
  if (wanted) marketTemplateAllowed(template);
  marketRequire(request.quantity <= effectiveItemStackLimit(profile, template));
  const listing = orderRecord(item, request, context);
  if (wanted) marketBalance(profile, -listing.price);
  else {
    marketRequire(!item.expiresAt || item.expiresAt > listing.expiresAt);
    state.escrow.push({
      listingId: listing.id,
      item: removeMarketItem(profile, item, request.quantity),
    });
  }
  state.listings.push(listing);
  return listing;
}

function orderRecord(item, request, context) {
  const wanted = request.kind === "mts.want";
  const kind = wanted ? "wanted" : request.mode;
  const buyNow = kind === "auction" ? request.buyNow : 0;
  marketRequire(!buyNow || buyNow >= request.price);
  return {
    id: context.operationId,
    kind,
    itemId: wanted ? request.itemId : item.id,
    quantity: request.quantity,
    price: request.price,
    buyNow,
    createdAt: context.now,
    expiresAt: context.now + (wanted ? 168 : request.hours) * 3600000,
    realm: context.actor.realm,
    bidderId: context.actor.id,
    bid: 0,
    bids: 0,
  };
}

export function removeMarketOrder(profile, listing) {
  const state = marketState(profile);
  state.listings.splice(state.listings.indexOf(listing), 1);
}

export function buyMarketOrder(drafts, listing, context) {
  const buyer = drafts.get(context.actor.id),
    seller = drafts.get(context.ownerId);
  marketRequire(listing.kind !== "wanted");
  const price = listing.kind === "auction" ? listing.buyNow : listing.price;
  marketRequire(price > 0 && context.request.price === price, "STALE_REVISION");
  refundBid(drafts, listing);
  marketBalance(buyer, -price);
  receiveMarketItem(buyer, takeEscrow(seller, listing.id), true);
  marketBalance(seller, marketProceeds(price));
  removeMarketOrder(seller, listing);
}

export function bidMarketOrder(drafts, listing, context) {
  marketRequire(listing.kind === "auction" && listing.bids < 100000);
  marketRequire(!listing.bid || listing.bidderId !== context.actor.id);
  const minimum = listing.bid
    ? listing.bid + Math.max(1, Math.ceil((listing.bid * 5) / 100))
    : listing.price;
  marketRequire(
    context.request.price >= minimum &&
      (!listing.buyNow || context.request.price < listing.buyNow),
  );
  marketBalance(drafts.get(context.actor.id), -context.request.price);
  reserveMarketDelivery(drafts.get(context.actor.id), listing.id);
  refundBid(drafts, listing);
  listing.bidderId = context.actor.id;
  listing.bid = context.request.price;
  listing.bids++;
}

export function fulfillMarketOrder(drafts, listing, context) {
  marketRequire(listing.kind === "wanted");
  const seller = drafts.get(context.actor.id),
    buyer = drafts.get(context.ownerId);
  const item = marketItem(seller, context.request.uid, context);
  marketRequire(item.id === listing.itemId);
  removeMarketOrder(buyer, listing);
  receiveMarketItem(
    buyer,
    removeMarketItem(seller, item, listing.quantity),
    true,
  );
  marketBalance(seller, marketProceeds(listing.price));
}

export function cancelMarketOrder(profile, listing) {
  marketRequire(!listing.bid);
  if (listing.kind === "wanted") marketBalance(profile, listing.price);
  else receiveMarketItem(profile, takeEscrow(profile, listing.id));
  removeMarketOrder(profile, listing);
}

export function expireMarketOrder(drafts, listing, ownerId) {
  const seller = drafts.get(ownerId);
  if (!listing.bid) return cancelMarketOrder(seller, listing);
  const buyer = drafts.get(listing.bidderId);
  releaseMarketDelivery(buyer, listing.id);
  receiveMarketItem(buyer, takeEscrow(seller, listing.id), true);
  marketBalance(seller, marketProceeds(listing.bid));
  removeMarketOrder(seller, listing);
}

function refundBid(drafts, listing) {
  if (!listing.bid) return;
  const bidder = drafts.get(listing.bidderId);
  marketBalance(bidder, listing.bid);
  releaseMarketDelivery(bidder, listing.id);
}
