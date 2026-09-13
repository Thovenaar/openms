import { operationFor, admitActor } from "./action-rules.js";
import {
  requireCharacterRevision,
  interactionReceipt,
  publishInteraction,
} from "./interaction-common.js";
import { MARKET_LIMITS } from "../../shared/market-protocol.js";
import { marketListing, marketSearch } from "./database-market.js";
import { marketState, marketRequire } from "./market-state.js";
import { claimMarketItem } from "./market-inventory.js";
import {
  createMarketOrder,
  buyMarketOrder,
  bidMarketOrder,
  fulfillMarketOrder,
  cancelMarketOrder,
} from "./market-orders.js";

export function admitMarket(actor, message, world) {
  admitActor(actor, world, message.fieldEpoch);
  requireCharacterRevision(actor, message);
  marketRequire(
    actor.profile.hp > 0 && !actor.tradeId && !actor.conversation,
    "CHARACTER_BUSY",
  );
}

/** The owner/bidder identities are resolved before locking and revalidated against the durable lot. */
export async function executeMarket(actor, message, world) {
  admitMarket(actor, message, world);
  const request = message.action;
  if (request.kind === "mts.read") return readMarket(actor, request, world);
  const listing =
    request.listingId && request.kind !== "mts.cart"
      ? await marketListing(world.database, request.listingId)
      : null;
  const ids = listing
    ? [listing.ownerId, ...(listing.bid ? [listing.bidderId] : [])]
    : [];
  const owners = await world.participants.load([
    ...new Set([actor.id, ...ids]),
  ]);
  if (listing && listing.ownerId !== actor.id) {
    const owner = await world.participants.owner(listing.ownerId);
    marketRequire(owner.accountId !== actor.accountId, "NOT_ALLOWED");
  }
  const context = {
    actor,
    content: world.content,
    now: Date.now(),
    operationId: message.operationId,
    request,
    ownerId: listing?.ownerId,
  };
  const receipt = await world.participants.commit(
    actor,
    operationFor(message),
    [...owners.keys()],
    (drafts) => {
      admitMarket(actor, message, world);
      context.now = Date.now();
      return mutateMarket(drafts, context, listing);
    },
  );
  if (receipt.status === "committed") {
    publishMarketChange(world, actor.realm, receipt.value);
  }
  return receipt;
}

export function mutateMarket(drafts, context, expected) {
  const { request, actor } = context;
  const profile = drafts.get(actor.id);
  let listingId = request.listingId ?? request.uid ?? context.operationId;
  switch (request.kind) {
    case "mts.list":
    case "mts.want":
      listingId = createMarketOrder(profile, request, context).id;
      break;
    case "mts.claim":
      claimMarketItem(profile, request.uid, context.content);
      break;
    case "mts.cart":
      changeCart(profile, request);
      break;
    case "mts.cart.clear":
      marketState(profile).cart.length = 0;
      break;
    default:
      mutateExisting(drafts, context, expected);
  }
  return {
    value: {
      kind: "mts.changed",
      listingId,
      action:
        request.kind === "mts.cart.clear" ? "cart" : request.kind.slice(4),
    },
  };
}

function mutateExisting(drafts, context, expected) {
  const state = marketState(drafts.get(context.ownerId));
  const listing = state.listings.find(
    (entry) => entry.id === context.request.listingId,
  );
  marketRequire(listing && listing.realm === context.actor.realm, "NOT_FOUND");
  marketRequire(
    listing.expiresAt > context.now &&
      listing.bidderId === expected.bidderId &&
      listing.bid === expected.bid,
    "STALE_REVISION",
  );
  if (context.request.kind === "mts.cancel") {
    marketRequire(context.ownerId === context.actor.id, "NOT_ALLOWED");
    return cancelMarketOrder(drafts.get(context.ownerId), listing);
  }
  marketRequire(context.ownerId !== context.actor.id, "NOT_ALLOWED");
  if (context.request.kind === "mts.buy") {
    return buyMarketOrder(drafts, listing, context);
  }
  if (context.request.kind === "mts.bid") {
    return bidMarketOrder(drafts, listing, context);
  }
  marketRequire(context.request.kind === "mts.fulfill", "INVALID_MESSAGE");
  return fulfillMarketOrder(drafts, listing, context);
}

function changeCart(profile, request) {
  const cart = marketState(profile).cart;
  const index = cart.indexOf(request.listingId);
  if (request.add && index < 0) {
    marketRequire(cart.length < MARKET_LIMITS.cart, "INVENTORY_FULL");
    cart.push(request.listingId);
  } else if (!request.add && index >= 0) cart.splice(index, 1);
}

async function readMarket(actor, request, world) {
  const state = actor.profile.onlineState?.market;
  const query = request.query.trim().toLocaleLowerCase("en-US");
  const itemIds = matchingItems(world.content.items, query);
  const rows =
    request.tab === "transfer"
      ? []
      : await marketSearch(world.database, actor, {
          ...request,
          query,
          itemIds,
          now: Date.now(),
        });
  return interactionReceipt(actor.revision, {
    kind: "mts.page",
    owned: (state?.listings ?? []).map((entry) =>
      marketView(actor, {
        summary: entry,
        owner_id: actor.id,
        owner_name: actor.profile.name,
        item: state.escrow.find((row) => row.listingId === entry.id)?.item,
      }),
    ),
    listings: rows
      .slice(0, MARKET_LIMITS.page)
      .map((row) => marketView(actor, row)),
    transfers: state?.transfer ?? [],
    cart: state?.cart ?? [],
    balance: actor.profile.cash.balances.prepaid,
    page: request.page,
    more:
      request.tab === "transfer"
        ? (state?.transfer.length ?? 0) >
          (request.page + 1) * MARKET_LIMITS.page
        : rows.length > MARKET_LIMITS.page,
  });
}

function matchingItems(items, query) {
  if (!query) return [];
  const templates = Object.values(items);
  marketRequire(templates.length <= 20000, "CONTENT_MISMATCH");
  return templates
    .filter(
      (entry) =>
        String(entry.id) === query ||
        entry.name?.toLocaleLowerCase("en-US").includes(query),
    )
    .map((entry) => entry.id);
}

function marketView(actor, row) {
  const value = row.summary;
  return {
    id: value.id,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    kind: value.kind,
    itemId: value.itemId,
    quantity: value.quantity,
    price: value.price,
    buyNow: value.buyNow,
    bid: value.bid,
    bids: value.bids,
    expiresAt: value.expiresAt,
    mine: row.owner_id === actor.id,
    item: row.item ?? null,
  };
}

export function publishMarketChange(world, realm, event) {
  for (const peer of world.actors.values()) {
    if (peer.state !== "active" || peer.realm !== realm || peer.deliveryError) {
      continue;
    }
    try {
      publishInteraction(world, peer, event);
    } catch (error) {
      world.deliveryFailed(peer, error);
    }
  }
}
