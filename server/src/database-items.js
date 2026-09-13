import { PROFILE_LIMITS } from "../../client/src/profile/profile-validation.js";
import { PROFILE_DOMAIN_LIMITS } from "../../client/src/profile/profile-domains.js";
import { isRechargeable } from "../../client/src/items/inventory-model.js";

export const MAX_ITEMS =
  PROFILE_LIMITS.inventory +
  PROFILE_LIMITS.equipment +
  PROFILE_DOMAIN_LIMITS.locker +
  PROFILE_DOMAIN_LIMITS.giftItems;

function invalid(code = "NOT_ALLOWED") {
  throw Object.assign(new Error(code), { code });
}

function appendItems(target, items, location, containerId = "") {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (
      !/^[A-Za-z0-9_-]{1,64}$/.test(item.uid) ||
      item.count < 0 ||
      (item.count === 0 && !isRechargeable(item.id)) ||
      target.has(item.uid)
    ) {
      invalid();
    }
    target.set(item.uid, {
      item,
      location,
      containerId,
      tab: Math.floor(item.id / 1000000),
      slot:
        location === "gift" || location === "storage" ? index + 1 : item.slot,
    });
  }
}

/** Every economic item has one canonical row, including unopened gift contents. */
export function flatten(profile) {
  const result = new Map();
  appendItems(result, profile.inventory, "inventory");
  appendItems(result, profile.equipment, "equipped");
  appendItems(result, profile.cash.locker, "locker");
  for (const gift of profile.cash.gifts) {
    appendItems(result, gift.items, "gift", gift.uid);
  }
  if (result.size > MAX_ITEMS) invalid("INVENTORY_FULL");
  return result;
}

export function flattenStorage(storage) {
  const result = new Map();
  appendItems(result, storage.items, "storage");
  return result;
}

/** Cache envelope metadata, never a second copy of an owned economic item. */
export function cacheProfile(profile) {
  const cache = structuredClone(profile);
  delete cache.inventory;
  delete cache.equipment;
  delete cache.meso;
  cache.cash.locker = [];
  for (const gift of cache.cash.gifts) gift.items = [];
  return cache;
}

export function hydrateProfileItems(cache, rows, meso) {
  const profile = {
    ...cache,
    meso,
    inventory: [],
    equipment: [],
    cash: {
      ...cache.cash,
      locker: [],
      gifts: cache.cash.gifts.map((gift) => ({ ...gift, items: [] })),
    },
  };
  const gifts = new Map(profile.cash.gifts.map((gift) => [gift.uid, gift]));
  for (const row of rows) {
    if (row.location === "inventory") profile.inventory.push(row.data);
    else if (row.location === "equipped") profile.equipment.push(row.data);
    else if (row.location === "locker") profile.cash.locker.push(row.data);
    else if (row.location === "gift") {
      const gift = gifts.get(row.container_id);
      if (!gift) invalid("SERVER_BUSY");
      gift.items.push(row.data);
    } else invalid("SERVER_BUSY");
  }
  return profile;
}

/** Stable aggregate deltas let moves between containers conserve the same asset. */
export function itemDeltas(previous, next) {
  const assets = new Map();
  for (const value of previous.values()) {
    assets.set(
      value.item.id,
      (assets.get(value.item.id) ?? 0) - value.item.count,
    );
  }
  for (const value of next.values()) {
    assets.set(
      value.item.id,
      (assets.get(value.item.id) ?? 0) + value.item.count,
    );
  }
  return assets;
}
