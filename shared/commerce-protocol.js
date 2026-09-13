import {
  array,
  boolean,
  enumeration,
  id,
  nullable,
  number,
  optional,
  record,
  revision,
  string,
  union,
} from "./schema.js";
import { UPGRADE_STATS } from "../client/src/profile/profile-item-state.js";

const uid = string(/^[A-Za-z0-9_-]{1,80}$/, 80);
const sn = number(1, 999999999);
const cashCurrency = enumeration("credit", "points", "prepaid");
const currency = enumeration("credit", "points", "prepaid", "meso");
const name = string(/^[\u0020-\u{10ffff}]{1,64}$/u, 64);
const count = number(0, 2147483647);
export const commerceItemSchema = record({
  uid,
  id: number(1, 99999999),
  count,
  slot: number(1, 96),
  owner: string(/^[\s\S]*$/u, 64),
  flags: number(0, 65535),
  expiresAt: nullable(revision),
  upgrade: optional(
    record({
      slots: number(0, 255),
      level: number(0, 255),
      stats: record(
        Object.fromEntries(
          UPGRADE_STATS.map((key) => [key, number(-32768, 32767)]),
        ),
      ),
    }),
  ),
});
export const storageAccountSchema = record({
  id,
  schemaVersion: enumeration(1),
  revision,
  slots: number(4, 48),
  meso: count,
  items: array(commerceItemSchema, 48, 0, (item) => item.uid),
});
const storageRequest = union("kind", {
  deposit: record({ kind: enumeration("deposit"), uid, count }),
  withdraw: record({ kind: enumeration("withdraw"), uid }),
  "deposit-meso": record({
    kind: enumeration("deposit-meso"),
    count: number(1, 2147483647),
  }),
  "withdraw-meso": record({
    kind: enumeration("withdraw-meso"),
    count: number(1, 2147483647),
  }),
  sort: record({ kind: enumeration("sort") }),
});
export const storageProjectionSchema = record({
  kind: enumeration("storage"),
  storageSession: id,
  revision,
  npcId: number(1, 999999999),
  npcName: string(/^[\s\S]*$/u, 128),
  fees: record({ putFee: count, getFee: count }),
  account: storageAccountSchema,
});
export const bookSummarySchema = record({
  normal: number(0, 4096),
  special: number(0, 4096),
  total: number(0, 4096),
  collected: number(0, 20480),
  complete: number(0, 4096),
  level: number(1, 8),
  nextLevel: nullable(number(1, 281)),
  cover: number(0, 2389999),
});
export const COMMERCE_ACTION_ROWS = [
  ["cash.quote", "character", { sn, currency }],
  ["cash.recipients", "character", { names: array(name, 31, 1, true) }],
  ["cash.buy", "character", { sn, currency }],
  [
    "cash.buy-avatar",
    "character",
    { sns: array(sn, 30, 1, true), currency: cashCurrency },
  ],
  [
    "cash.expand-inventory",
    "character",
    { type: number(1, 4), currency: cashCurrency },
  ],
  [
    "cash.gift",
    "character",
    {
      sn,
      currency: enumeration("prepaid"),
      targetIds: array(id, 31, 1, true),
      message: string(/^[\s\S]{1,72}$/u, 72),
    },
  ],
  ["cash.wishlist", "character", { sns: array(sn, 10, 0, true) }],
  ["cash.claim-gift", "character", { uid }],
  ["cash.move-to-inventory", "character", { uid }],
  ["cash.move-to-locker", "character", { uid }],
  [
    "storage.execute",
    "character",
    { storageSession: id, storageRevision: revision, request: storageRequest },
  ],
  ["storage.close", "character", { storageSession: id }],
  ["monster-book.cover", "character", { itemId: number(0, 2389999) }],
];
export const COMMERCE_EPHEMERAL_ACTIONS = new Set([
  "cash.quote",
  "cash.recipients",
  "storage.close",
]);
export const COMMERCE_EVENT_SCHEMAS = {
  storage: storageProjectionSchema,
  "storage.closed": record({
    kind: enumeration("storage.closed"),
    storageSession: id,
  }),
};
export const COMMERCE_RESULT_SCHEMAS = {
  "cash.quote": record({
    kind: enumeration("cash.quote"),
    sn,
    price: count,
    currency,
  }),
  "cash.recipients": record({
    kind: enumeration("cash.recipients"),
    recipients: array(record({ id, name }), 31, 1, (entry) => entry.id),
  }),
  "cash.transaction": record({
    kind: enumeration("cash.transaction"),
    action: enumeration(
      "buy",
      "buy-avatar",
      "expand-inventory",
      "gift",
      "wishlist",
      "claim-gift",
      "move-to-inventory",
      "move-to-locker",
    ),
    sn: optional(sn),
    sns: optional(array(sn, 30)),
    uid: optional(uid),
    type: optional(number(1, 4)),
    targetIds: optional(array(id, 31)),
  }),
  "storage.transaction": record({
    kind: enumeration("storage.transaction"),
    storageSession: id,
    action: enumeration(
      "deposit",
      "withdraw",
      "deposit-meso",
      "withdraw-meso",
      "sort",
    ),
    storageRevision: revision,
  }),
  "monster-book.cover": record({
    kind: enumeration("monster-book.cover"),
    changed: boolean,
    cover: number(0, 2389999),
  }),
};
