import {
  array,
  boolean,
  enumeration,
  id,
  nullable,
  number,
  record,
  revision,
  string,
} from "./schema.js";

export const MARKET_LIMITS = Object.freeze({
  listings: 25,
  transfers: 48,
  cart: 25,
  page: 16,
  price: 100000000,
});
const price = number(1, MARKET_LIMITS.price);
const quantity = number(1, 32767);
const identifier = number(1, 99999999);
const listingKind = enumeration("sale", "wanted", "auction");

/** Closed client intentions. Item attributes, currency balances and deadlines are server owned. */
export const MARKET_ACTION_ROWS = [
  [
    "mts.read",
    "character",
    {
      tab: enumeration("sale", "wanted", "auction", "mine", "cart", "transfer"),
      query: string(/^[\s\S]{0,64}$/u, 64),
      page: number(0, 1000),
      category: number(0, 4),
    },
  ],
  [
    "mts.list",
    "character",
    {
      uid: id,
      quantity,
      price,
      hours: number(24, 168),
      mode: enumeration("sale", "auction"),
      buyNow: number(0, MARKET_LIMITS.price),
    },
  ],
  ["mts.want", "character", { itemId: identifier, quantity, price }],
  ["mts.buy", "character", { listingId: id, price }],
  ["mts.bid", "character", { listingId: id, price }],
  ["mts.fulfill", "character", { listingId: id, uid: id }],
  ["mts.cancel", "character", { listingId: id }],
  ["mts.claim", "character", { uid: id }],
  ["mts.cart", "character", { listingId: id, add: boolean }],
  ["mts.cart.clear", "character", {}],
];

export function marketSchemas(item) {
  const listing = record({
    id,
    ownerId: id,
    ownerName: string(/^[\s\S]{1,64}$/u, 64),
    kind: listingKind,
    itemId: identifier,
    quantity,
    price,
    buyNow: number(0, MARKET_LIMITS.price),
    bid: number(0, MARKET_LIMITS.price),
    bids: number(0, 100000),
    expiresAt: revision,
    mine: boolean,
    item: nullable(item),
  });
  return {
    "mts.page": record({
      kind: enumeration("mts.page"),
      listings: array(listing, MARKET_LIMITS.page),
      owned: array(listing, MARKET_LIMITS.listings),
      transfers: array(item, MARKET_LIMITS.transfers),
      cart: array(id, MARKET_LIMITS.cart, 0, true),
      balance: number(0, 2147483647),
      page: number(0, 1000),
      more: boolean,
    }),
    "mts.changed": record({
      kind: enumeration("mts.changed"),
      listingId: id,
      action: enumeration(
        "list",
        "want",
        "buy",
        "bid",
        "fulfill",
        "cancel",
        "claim",
        "cart",
        "expire",
      ),
    }),
  };
}
