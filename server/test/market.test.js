import { expect, test } from "bun:test";
import { loadContent } from "../src/content.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { grantItem } from "../../client/src/items/inventory-model.js";
import { equipmentUpgrade } from "../../client/src/items/equipment-enhancement.js";
import { mutateMarket } from "../src/interaction-market.js";
import {
  marketState,
  validateMarket,
  marketHeld,
  marketSlots,
} from "../src/market-state.js";
import { expireMarketOrder } from "../src/market-orders.js";
import { actionSchema } from "../../shared/protocol.js";
import { validate } from "../../shared/schema.js";
import {
  flatten,
  cacheProfile,
  hydrateProfileItems,
} from "../src/database-items.js";

const content = await loadContent();
const NOW = 1800000000000;

function fixture() {
  const profiles = new Map();
  for (const id of ["seller", "buyer", "bidder"]) {
    const profile = createProfile({
      mapId: "100000000",
      x: 0,
      y: 0,
      facing: 1,
    });
    profile.name = id;
    profile.cash.balances.prepaid = 10000;
    marketState(profile);
    profiles.set(id, profile);
  }
  grantItem(profiles.get("seller"), content.items[2000000], 10);
  return profiles;
}

function commit(profiles, actorId, request, expected = null) {
  const drafts = new Map(
    [...profiles].map(([id, profile]) => [id, structuredClone(profile)]),
  );
  const result = mutateMarket(
    drafts,
    {
      actor: { id: actorId, realm: "public", itemLocks: new Set() },
      content,
      request,
      now: NOW,
      operationId: crypto.randomUUID(),
      ownerId: expected?.ownerId,
    },
    expected,
  );
  const seen = new Set();
  for (const profile of drafts.values()) {
    validateMarket(profile, content.items);
    for (const uid of flatten(profile).keys()) {
      expect(seen.has(uid)).toBe(false);
      seen.add(uid);
    }
  }
  for (const [id, profile] of drafts) profiles.set(id, profile);
  return result.value;
}

function list(profiles, mode = "sale") {
  const seller = profiles.get("seller");
  const value = commit(profiles, "seller", {
    kind: "mts.list",
    uid: seller.inventory[0].uid,
    quantity: 4,
    price: 100,
    hours: 24,
    mode,
    buyNow: mode === "auction" ? 500 : 0,
  });
  return lot(profiles, value.listingId);
}

function lot(profiles, id, ownerId = "seller") {
  return {
    ...marketState(profiles.get(ownerId)).listings.find(
      (entry) => entry.id === id,
    ),
    ownerId,
  };
}

function total(profiles) {
  return [...profiles.values()].reduce(
    (sum, profile) => sum + profile.cash.balances.prepaid + marketHeld(profile),
    0,
  );
}

test("a partial stack enters escrow, purchase charges once, claim retains instance properties and rejects repeat claims", () => {
  const profiles = fixture();
  const listing = list(profiles);
  expect(profiles.get("seller").inventory[0].count).toBe(6);
  commit(
    profiles,
    "buyer",
    { kind: "mts.buy", listingId: listing.id, price: 100 },
    listing,
  );
  expect(total(profiles)).toBe(29995);
  const item = marketState(profiles.get("buyer")).transfer[0];
  commit(profiles, "buyer", { kind: "mts.claim", uid: item.uid });
  expect(profiles.get("buyer").inventory[0]).toMatchObject({
    uid: item.uid,
    count: 4,
  });
  expect(() =>
    commit(profiles, "buyer", { kind: "mts.claim", uid: item.uid }),
  ).toThrow("NOT_FOUND");
  expect(() =>
    commit(
      profiles,
      "bidder",
      { kind: "mts.buy", listingId: listing.id, price: 100 },
      listing,
    ),
  ).toThrow("NOT_FOUND");
});

test("locked, bound and wrong-price offers cannot debit inventory or NX", () => {
  const profiles = fixture();
  profiles.get("seller").inventory[0].flags = 1;
  expect(() => list(profiles)).toThrow("REQUIREMENTS_NOT_MET");
  profiles.get("seller").inventory[0].flags = 8;
  expect(() => list(profiles)).toThrow("REQUIREMENTS_NOT_MET");
  profiles.get("seller").inventory[0].flags = 0;
  const listing = list(profiles);
  expect(() =>
    commit(
      profiles,
      "buyer",
      { kind: "mts.buy", listingId: listing.id, price: 99 },
      listing,
    ),
  ).toThrow("STALE_REVISION");
  expect(total(profiles)).toBe(30000);
  expect(() =>
    commit(
      profiles,
      "seller",
      { kind: "mts.buy", listingId: listing.id, price: 100 },
      listing,
    ),
  ).toThrow("NOT_ALLOWED");
});

test("rechargeable items, oversized quantities and client-authored instance properties are refused", () => {
  const profiles = fixture();
  grantItem(profiles.get("seller"), content.items[2070000], 1);
  const request = {
    kind: "mts.list",
    uid: profiles.get("seller").inventory.find((item) => item.id === 2070000)
      .uid,
    quantity: 1,
    price: 100,
    hours: 24,
    mode: "sale",
    buyNow: 0,
  };
  expect(() => commit(profiles, "seller", request)).toThrow(
    "REQUIREMENTS_NOT_MET",
  );
  request.uid = profiles.get("seller").inventory[0].uid;
  request.quantity = 11;
  expect(() => commit(profiles, "seller", request)).toThrow(
    "REQUIREMENTS_NOT_MET",
  );
  expect(() => validate({ ...request, price: -1 }, actionSchema)).toThrow();
  expect(() => validate({ ...request, quantity: 1.5 }, actionSchema)).toThrow();
  expect(() =>
    validate({ ...request, item: { id: 2000000 } }, actionSchema),
  ).toThrow();
  expect(profiles.get("seller").inventory[0].count).toBe(10);
});

function fillTransfers(profile, count) {
  const template = profile.inventory[0];
  const state = marketState(profile);
  for (let index = 0; index < count; index++) {
    state.transfer.push({
      ...template,
      uid: crypto.randomUUID(),
      count: 1,
      slot: index + 1,
    });
  }
}

test("reserved returns fill the last transfer slot and rejected delivery leaves both owners unchanged", () => {
  const profiles = fixture();
  const listing = list(profiles);
  fillTransfers(profiles.get("seller"), 47);
  expect(marketSlots(marketState(profiles.get("seller")))).toBe(48);
  commit(
    profiles,
    "seller",
    { kind: "mts.cancel", listingId: listing.id },
    listing,
  );
  expect(marketState(profiles.get("seller")).transfer).toHaveLength(48);
  const next = fixture();
  const lot = list(next);
  grantItem(next.get("buyer"), content.items[2000000], 1);
  fillTransfers(next.get("buyer"), 48);
  expect(() =>
    commit(
      next,
      "buyer",
      { kind: "mts.buy", listingId: lot.id, price: 100 },
      lot,
    ),
  ).toThrow("INVENTORY_FULL");
  expect(next.get("buyer").cash.balances.prepaid).toBe(10000);
  expect(marketState(next.get("seller")).escrow).toHaveLength(1);
});

test("a leading bidder can fund buy-now from reserved NX and clear stale cart entries", () => {
  const profiles = fixture();
  profiles.get("buyer").cash.balances.prepaid = 500;
  const listing = list(profiles, "auction");
  commit(
    profiles,
    "buyer",
    { kind: "mts.bid", listingId: listing.id, price: 100 },
    listing,
  );
  commit(
    profiles,
    "buyer",
    { kind: "mts.buy", listingId: listing.id, price: 500 },
    lot(profiles, listing.id),
  );
  expect(profiles.get("buyer").cash.balances.prepaid).toBe(0);
  expect(marketState(profiles.get("buyer")).incoming).toEqual([]);
  commit(profiles, "buyer", {
    kind: "mts.cart",
    listingId: listing.id,
    add: true,
  });
  commit(profiles, "buyer", { kind: "mts.cart.clear" });
  expect(marketState(profiles.get("buyer")).cart).toEqual([]);
});

test("equipment keeps its actual upgrades, inscription and expiry while consuming its one-trade flag", () => {
  const profiles = fixture();
  const seller = profiles.get("seller");
  grantItem(seller, content.items[1302000], 1);
  const weapon = seller.inventory.find((item) => item.id === 1302000);
  weapon.owner = "Crafter";
  weapon.flags = 16;
  weapon.expiresAt = NOW + 172800000;
  weapon.upgrade = equipmentUpgrade(weapon, content.items[weapon.id]);
  weapon.upgrade.stats.incPAD += 7;
  weapon.upgrade.slots--;
  const expected = structuredClone(weapon);
  const value = commit(profiles, "seller", {
    kind: "mts.list",
    uid: weapon.uid,
    quantity: 1,
    price: 100,
    hours: 24,
    mode: "sale",
    buyNow: 0,
  });
  commit(
    profiles,
    "buyer",
    { kind: "mts.buy", listingId: value.listingId, price: 100 },
    lot(profiles, value.listingId),
  );
  commit(profiles, "buyer", { kind: "mts.claim", uid: expected.uid });
  expect(
    profiles.get("buyer").inventory.find((item) => item.uid === expected.uid),
  ).toMatchObject({
    upgrade: expected.upgrade,
    owner: "Crafter",
    expiresAt: expected.expiresAt,
    flags: 8,
  });
});

test("wanted orders reserve full payment and delivery space, then fulfill an entire lot with one fee", () => {
  const profiles = fixture();
  const { listingId } = commit(profiles, "buyer", {
    kind: "mts.want",
    itemId: 2000000,
    quantity: 3,
    price: 200,
  });
  expect(total(profiles)).toBe(30000);
  expect(marketSlots(marketState(profiles.get("buyer")))).toBe(1);
  commit(
    profiles,
    "seller",
    {
      kind: "mts.fulfill",
      listingId,
      uid: profiles.get("seller").inventory[0].uid,
    },
    lot(profiles, listingId, "buyer"),
  );
  expect(total(profiles)).toBe(29990);
  expect(marketState(profiles.get("buyer")).transfer[0].count).toBe(3);
});

test("auction bids escrow NX, refund the old bidder atomically and reject cancellation after a bid", () => {
  const profiles = fixture();
  const listing = list(profiles, "auction");
  commit(
    profiles,
    "buyer",
    { kind: "mts.bid", listingId: listing.id, price: 100 },
    listing,
  );
  expect(total(profiles)).toBe(30000);
  expect(profiles.get("buyer").cash.balances.prepaid).toBe(9900);
  let current = lot(profiles, listing.id);
  expect(() =>
    commit(
      profiles,
      "seller",
      { kind: "mts.cancel", listingId: listing.id },
      current,
    ),
  ).toThrow("REQUIREMENTS_NOT_MET");
  commit(
    profiles,
    "bidder",
    { kind: "mts.bid", listingId: listing.id, price: 105 },
    current,
  );
  expect(profiles.get("buyer").cash.balances.prepaid).toBe(10000);
  expect(marketState(profiles.get("buyer")).incoming).toEqual([]);
  current = lot(profiles, listing.id);
  expireMarketOrder(
    profiles,
    marketState(profiles.get("seller")).listings[0],
    "seller",
  );
  expect(marketState(profiles.get("bidder")).transfer[0].count).toBe(4);
  expect(total(profiles)).toBe(29994);
  expect(current.bidderId).toBe("bidder");
});

test("expired unsold items return to reserved transfer slots and cache envelopes contain no duplicate item payloads", () => {
  const profiles = fixture();
  const listing = list(profiles);
  const profile = profiles.get("seller");
  const cache = cacheProfile(profile);
  expect(cache.onlineState.market.escrow).toEqual([]);
  const rows = [...flatten(profile).values()].map((entry) => ({
    location: entry.location,
    container_id: entry.containerId,
    data: entry.item,
  }));
  const restored = hydrateProfileItems(cache, rows, profile.meso);
  validateMarket(restored, content.items);
  profiles.set("seller", restored);
  expireMarketOrder(profiles, marketState(restored).listings[0], "seller");
  expect(marketState(restored).transfer[0].count).toBe(listing.quantity);
  expect(marketState(restored).listings).toEqual([]);
  expect(total(profiles)).toBe(30000);
});
