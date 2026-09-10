import { PROFILE_LIMITS, profileError } from "./profile-validation.js";
import {
  consumeItem,
  createItemUid,
  equippedSlots,
  inventoryType,
  isRechargeable,
  itemStackLimit,
  slotItem,
} from "./inventory-model.js";
import { equippedStat, recalculateVitals } from "./character-stats.js";

const WEDDING_RINGS = Object.freeze([1112803, 1112806, 1112807, 1112809]);
// Native004f31a5 refuses these authored engagement/wedding/event items before prompting.
const NO_DROP_ITEMS = new Set([
  ...WEDDING_RINGS,
  4031481,
  4031376,
  4031480,
  4031375,
  4031373,
  4031374,
  3994085,
]);
export function selectedItem(profile, uid) {
  if (typeof uid !== "string") {
    throw profileError("invalid-item-uid", "Select an item instance.");
  }
  const item =
    profile.inventory.find((entry) => entry.uid === uid) ??
    profile.equipment.find((entry) => entry.uid === uid);
  if (!item) {
    throw profileError("item-missing", "The selected item is no longer there.");
  }
  return item;
}

export function admitItem(profile, item, now = Date.now()) {
  if (profile.hp <= 0) {
    throw profileError("character-dead", "You cannot use items while dead.");
  }
  if (item.expiresAt !== null && item.expiresAt <= now) {
    throw profileError("item-expired", "The selected item has expired.");
  }
}

export function originalItem(items, id) {
  const item = items[id];
  if (!item?.descriptor || item.id !== id || !item.info) {
    throw profileError(
      "item-unavailable",
      `Original item template unavailable: ${id}.`,
    );
  }
  return item;
}

function positiveSlot(profile, type, slot) {
  if (
    !Number.isSafeInteger(slot) ||
    slot < 1 ||
    slot > profile.inventorySlots[type - 1]
  ) {
    throw profileError(
      "invalid-item-slot",
      "The destination slot is outside this inventory.",
    );
  }
}

export function freeInventorySlot(profile, type) {
  for (let slot = 1; slot <= profile.inventorySlots[type - 1]; slot++) {
    if (!slotItem(profile, type, slot)) return slot;
  }
  throw profileError(
    "inventory-full",
    "Please make room in your inventory first.",
  );
}

function mergeable(source, target, type) {
  return (
    type !== 1 &&
    type !== 5 &&
    !isRechargeable(source.id) &&
    source.id === target.id &&
    source.owner === target.owner &&
    source.flags === target.flags &&
    source.expiresAt === target.expiresAt
  );
}

/** Native 004f3057 requests a whole-stack move; Cosmic InventoryManipulator.move merges then swaps.
 * Explicit count is local split authority, never a debit while the pointer carries the item. */
export function moveInventory(profile, items, request) {
  const source = selectedItem(profile, request.uid);
  admitItem(profile, source);
  const type = inventoryType(source.id);
  if (request.type !== type || source.slot < 0) {
    throw profileError(
      "wrong-inventory",
      "Choose the same inventory category.",
    );
  }
  positiveSlot(profile, type, request.slot);
  if (source.slot === request.slot) return false;
  const count = request.count ?? source.count;
  validateSplit(source, count);
  const target = slotItem(profile, type, request.slot);
  const limit = itemStackLimit(originalItem(items, source.id));
  if (target && mergeable(source, target, type)) {
    const amount = Math.min(count, limit - target.count);
    if (amount <= 0) return false;
    target.count += amount;
    consumeItem(profile, source.uid, amount);
  } else if (count < source.count) {
    if (target) {
      throw profileError(
        "occupied-slot",
        "Split the stack into an empty slot.",
      );
    }
    source.count -= count;
    profile.inventory.push({
      ...source,
      uid: createItemUid(),
      count,
      slot: request.slot,
    });
  } else {
    if (target) target.slot = source.slot;
    source.slot = request.slot;
  }
  return true;
}

/** Cosmic InventoryMergeHandler65..112: fill lower slots from matching later stacks,
 * then stably compact gaps. Instance attributes remain a stricter local merge boundary. */
export function gatherInventory(profile, items, request) {
  const type = request.type;
  if (!Number.isSafeInteger(type) || type < 1 || type > 5) {
    throw profileError("wrong-inventory", "Choose an inventory category.");
  }
  if (profile.hp <= 0) {
    throw profileError(
      "character-dead",
      "You cannot arrange items while dead.",
    );
  }
  const entries = profile.inventory.filter(
    (item) => inventoryType(item.id) === type,
  );
  entries.sort((left, right) => left.slot - right.slot);
  for (const item of entries) admitItem(profile, item);
  const { removed, changed } = mergeGatheredStacks(
    profile,
    items,
    entries,
    type,
  );
  let compacted = false;
  let slot = 1;
  for (const item of entries) {
    if (removed.has(item.uid)) continue;
    if (item.slot !== slot) compacted = true;
    item.slot = slot++;
  }
  return changed || compacted;
}

function mergeGatheredStacks(profile, items, entries, type) {
  const removed = new Set();
  let changed = false;
  for (let destination = 0; destination < entries.length; destination++) {
    const target = entries[destination];
    if (removed.has(target.uid)) continue;
    const limit = itemStackLimit(originalItem(items, target.id));
    for (
      let index = destination + 1;
      index < entries.length && target.count < limit;
      index++
    ) {
      const source = entries[index];
      if (removed.has(source.uid) || !mergeable(source, target, type)) continue;
      const amount = Math.min(source.count, limit - target.count);
      if (amount === source.count) removed.add(source.uid);
      consumeItem(profile, source.uid, amount);
      target.count += amount;
      changed = true;
    }
  }
  return { removed, changed };
}

export function validateSplit(source, count) {
  if (count === 0 && source.count === 0 && isRechargeable(source.id)) return;
  if (!Number.isSafeInteger(count) || count < 1 || count > source.count) {
    throw profileError("invalid-item-count", "Choose a quantity you own.");
  }
  if (isRechargeable(source.id) && count !== source.count) {
    throw profileError(
      "rechargeable-stack",
      "Throwing stars and bullets move as a whole stack.",
    );
  }
}

function requirement(info, field) {
  const value = info[field] ?? 0;
  if (!Number.isSafeInteger(value)) {
    throw profileError("item-metadata", `Invalid original ${field}.`);
  }
  return value;
}

/** Native004f2cee: reqJob mask, -1 beginners; families8/9 bypass wear requirements. */
function meetsJob(job, mask) {
  if (mask === 0) return true;
  const family = Math.floor((job % 1000) / 100);
  if (mask === -1) return family === 0;
  return family >= 1 && family <= 5 && (mask & (1 << (family - 1))) !== 0;
}

/** Cosmic ItemInformationProvider1821..1888 supplies local server stat/fame authority. */
function wearRequirements(profile, items, template) {
  const family = Math.floor((profile.job % 1000) / 100);
  const info = template.info;
  const gender = Math.floor(template.id / 1000) % 10;
  if (gender < 2 && gender !== profile.gender) {
    throw profileError(
      "equipment-gender",
      "This equipment is for another gender.",
    );
  }
  if (family === 8 || family === 9) return;
  if (!meetsJob(profile.job, requirement(info, "reqJob"))) {
    throw profileError("equipment-job", "Your job cannot wear this equipment.");
  }
  if (profile.level < requirement(info, "reqLevel")) {
    throw profileError(
      "equipment-level",
      "Your level is too low for this equipment.",
    );
  }
  const fame = requirement(info, "reqPOP");
  if (fame !== 0 && profile.fame < fame) {
    throw profileError(
      "equipment-fame",
      "You need more fame to wear this equipment.",
    );
  }
  for (const stat of ["STR", "DEX", "INT", "LUK"]) {
    if (
      profile[stat.toLowerCase()] + equippedStat(profile, items, `inc${stat}`) <
      requirement(info, `req${stat}`)
    ) {
      throw profileError(
        "equipment-stat",
        `You need more ${stat} to wear this equipment.`,
      );
    }
  }
}

function twoHanded(id) {
  const category = Math.floor(id / 10000) % 100;
  return category >= 40 && category <= 49;
}

/** Cosmic InventoryManipulator546..590: overall/pants and shield/two-handed conflicts. */
function conflicts(profile, source, slot) {
  const base = slot < -100 ? slot + 100 : slot;
  const offset = slot < -100 ? -100 : 0;
  const opposite = { [-5]: -6, [-6]: -5, [-10]: -11, [-11]: -10 }[base];
  if (!opposite) return null;
  const other = slotItem(profile, 1, opposite + offset);
  if (!other) return null;
  return equipmentConflict(base, source, other) ? other : null;
}

function equipmentConflict(base, source, other) {
  if (base === -5) return Math.floor(source.id / 10000) === 105;
  if (base === -6) return Math.floor(other.id / 10000) === 105;
  if (base === -10) return twoHanded(other.id);
  if (base === -11) return twoHanded(source.id);
  return false;
}

function takeEquipment(profile, item, slot) {
  if (profile.inventory.length >= PROFILE_LIMITS.inventory) {
    throw profileError(
      "inventory-full",
      "Please make room in your inventory first.",
    );
  }
  profile.equipment.splice(profile.equipment.indexOf(item), 1);
  item.slot = slot;
  profile.inventory.push(item);
}

function equipmentDestination(profile, template, requested) {
  if (requested === -51 || requested === -151) {
    throw profileError(
      "equipment-slot-locked",
      "The original pendant-slot expansion entitlement is unavailable.",
    );
  }
  // Native004f1c2d compares expanded pendant slot51's entitlement FILETIME before admission.
  const slots = equippedSlots(template).filter(
    (slot) => slot !== -51 && slot !== -151,
  );
  const slot =
    requested ??
    slots.find((candidate) => !slotItem(profile, 1, candidate)) ??
    slots[0];
  if (!slots.includes(slot)) {
    throw profileError(
      "invalid-equipped-slot",
      "This item cannot be worn in that position.",
    );
  }
  return slot;
}

export function equipInventory(profile, items, request) {
  const source = selectedItem(profile, request.uid);
  admitItem(profile, source);
  if (source.slot < 0 || inventoryType(source.id) !== 1) {
    throw profileError(
      "not-inventory-equipment",
      "Choose unequipped equipment.",
    );
  }
  const template = originalItem(items, source.id);
  const slot = equipmentDestination(profile, template, request.slot);
  wearRequirements(profile, items, template);
  wearSpecialEquipment(profile, source, slot);
  const conflict = conflicts(profile, source, slot);
  if (conflict) takeEquipment(profile, conflict, freeInventorySlot(profile, 1));
  const target = slotItem(profile, 1, slot);
  const previousSlot = source.slot;
  profile.inventory.splice(profile.inventory.indexOf(source), 1);
  if (target) takeEquipment(profile, target, previousSlot);
  source.slot = slot;
  if (template.info.equipTradeBlock === 1) source.flags |= 8;
  profile.equipment.push(source);
  recalculateVitals(profile, items);
  return true;
}

export function unequipInventory(profile, items, request) {
  const source = selectedItem(profile, request.uid);
  admitItem(profile, source);
  if (source.slot >= 0) {
    throw profileError("not-equipped", "Choose worn equipment.");
  }
  const slot = request.slot ?? freeInventorySlot(profile, 1);
  positiveSlot(profile, 1, slot);
  if (slotItem(profile, 1, slot)) {
    throw profileError(
      "inventory-full",
      "Choose an empty equipment inventory slot.",
    );
  }
  takeEquipment(profile, source, slot);
  recalculateVitals(profile, items);
  return true;
}

function ringGroup(id) {
  if (Math.floor(id / 100) === 11120 && id !== 1112000) return 1;
  if (Math.floor(id / 100) === 11128 && id % 10 < 3) return 2;
  return WEDDING_RINGS.includes(id) ? 3 : 0;
}

/** Native004f11b4 prohibits multiple members of each special ring-effect group. */
function wearSpecialEquipment(profile, source, slot) {
  const group = ringGroup(source.id);
  if (
    group &&
    profile.equipment.some(
      (item) => item.slot !== slot && ringGroup(item.id) === group,
    )
  ) {
    throw profileError(
      "equipment-ring-conflict",
      "You cannot wear two rings of this type.",
    );
  }
  const cygnus = profile.job >= 1000 && profile.job < 2000;
  const explorerMount =
    (source.id >= 1902000 && source.id <= 1902002) || source.id === 1912000;
  const cygnusMount =
    (source.id >= 1902005 && source.id <= 1902007) || source.id === 1912005;
  if ((explorerMount && cygnus) || (cygnusMount && !cygnus)) {
    throw profileError(
      "equipment-mount-job",
      "This mount equipment belongs to another job family.",
    );
  }
}

/** Cosmic InventoryManipulator688..810: restricted drops disappear rather than becoming loot. */
export function disappearingDrop(item, template) {
  if (NO_DROP_ITEMS.has(item.id) || Math.floor(item.id / 10000) === 224) {
    throw profileError("item-no-drop", "This item cannot be dropped.");
  }
  return (
    template.info.tradeBlock === 1 ||
    template.info.accountSharable === 1 ||
    template.info.quest === 1 ||
    template.info.cash === 1 ||
    inventoryType(item.id) === 5 ||
    (item.flags & 9) !== 0
  );
}

export function debitItemDrop(profile, items, request) {
  const source = selectedItem(profile, request.uid);
  admitItem(profile, source);
  validateSplit(source, request.count);
  disappearingDrop(source, originalItem(items, source.id));
  const instance = { ...source, count: request.count };
  if (request.count < source.count) instance.uid = request.dropUid;
  if (source.slot < 0) {
    profile.equipment.splice(profile.equipment.indexOf(source), 1);
    recalculateVitals(profile, items);
  } else consumeItem(profile, source.uid, request.count);
  return instance;
}
