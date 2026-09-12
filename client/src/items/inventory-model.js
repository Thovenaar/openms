import {
  PROFILE_LIMITS,
  PROFILE_VERSION,
  profileError,
} from "../profile/profile-validation.js";
import { validateItemUpgrade } from "../profile/profile-item-state.js";

/** Existing browser capacity policy; capacities above 96 retain legacy browser saves. */
export const INVENTORY_POLICY = Object.freeze({
  categorySlots: 96,
  defaultStackLimit: 100,
  ownerLength: 32,
  uidLength: 80,
});

// Cosmic SERVER-reference EquipSlot.java maps original info/islot to signed positions.
// Native 00460358 additionally admits the second pendant position51.
const EQUIPPED_SLOTS = Object.freeze({
  Cp: [-1],
  HrCp: [-1],
  Af: [-2],
  Ay: [-3],
  Ae: [-4],
  Ma: [-5],
  MaPn: [-5],
  Pn: [-6],
  So: [-7],
  GlGw: [-8],
  Gv: [-8],
  Sr: [-9],
  Si: [-10],
  Wp: [-11],
  WpSi: [-11],
  WpSp: [-11],
  Ri: [-12, -13, -15, -16],
  Pe: [-17, -51],
  Tm: [-18],
  Sd: [-19],
  Me: [-49],
  Be: [-50],
});
for (const slots of Object.values(EQUIPPED_SLOTS)) Object.freeze(slots);

export function inventoryType(id) {
  if (!Number.isSafeInteger(id) || id < 1000000 || id >= 6000000) {
    throw profileError(
      "invalid-item",
      `Unsupported inventory item ID ${String(id)}.`,
    );
  }
  return Math.floor(id / 1000000);
}

export function createItemUid() {
  return crypto.randomUUID();
}

/** Authored base capacity, retaining the existing explicit local 100 when absent. */
export function itemStackLimit(template) {
  if (!template) {
    throw profileError(
      "item-unavailable",
      "Original item template is unavailable.",
    );
  }
  if (
    inventoryType(template.id) === 1 ||
    Math.floor(template.id / 10000) === 500
  ) {
    return 1;
  }
  const limit = template.info?.slotMax;
  if (limit === undefined) return INVENTORY_POLICY.defaultStackLimit;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw profileError(
      "item-metadata",
      `Invalid slotMax for item ${template.id}.`,
    );
  }
  return limit;
}

/** Cosmic ItemConstants.isRechargeable: throwing-star207 and bullet233 families. */
export function isRechargeable(id) {
  const family = Math.floor(id / 10000);
  return family === 207 || family === 233;
}

/** Cosmic ItemInformationProvider:347-385; permanent learned mastery adds ten units/rank.
 * Save validation is clock-independent: expiring mastery is not an admitted capacity source.
 */
export function effectiveItemStackLimit(profile, template) {
  const base = itemStackLimit(template);
  if (!isRechargeable(template.id)) return base;
  const nightWalker =
    Math.floor(profile.job / 10) === 140 ||
    Math.floor(profile.job / 10) === 141;
  const id =
    Math.floor(template.id / 10000) === 233
      ? 5200000
      : nightWalker
        ? 14100000
        : 4100000;
  const mastery = profile.skills[id];
  if (!mastery) return base;
  if (
    !Number.isSafeInteger(mastery.level) ||
    mastery.level < 0 ||
    mastery.level > 255 ||
    mastery.expiresAt !== null
  ) {
    throw profileError(
      "item-capacity",
      "Rechargeable capacity requires a permanent learned mastery rank.",
    );
  }
  return base + mastery.level * 10;
}

/** Unknown equipment positions fail closed; no invented pet/cash destination. */
export function equippedSlots(template) {
  const slots = EQUIPPED_SLOTS[template?.info?.islot];
  if (!template || inventoryType(template.id) !== 1 || !slots) {
    throw profileError(
      "item-metadata",
      `Original equipped slot unavailable for item ${template?.id}.`,
    );
  }
  return template.info.cash === 1 ? slots.map((slot) => slot - 100) : slots;
}

export function itemCount(profile, id) {
  let count = 0;
  for (const entry of profile.inventory) {
    if (entry.id !== id) continue;
    count += entry.count;
    if (!Number.isSafeInteger(count)) {
      throw profileError(
        "inventory-limit",
        "Item quantity exceeds the save limit.",
      );
    }
  }
  return count;
}

export function isEquipped(profile, id) {
  return profile.equipment.some((entry) => entry.id === id);
}

export function slotItem(profile, type, slot) {
  return (
    (slot < 0 ? profile.equipment : profile.inventory).find(
      (entry) => entry.slot === slot && inventoryType(entry.id) === type,
    ) ?? null
  );
}

export function firstItem(profile, id) {
  let first = null;
  for (const entry of profile.inventory) {
    if (entry.id === id && (!first || entry.slot < first.slot)) first = entry;
  }
  return first;
}

function quantity(count) {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw profileError(
      "invalid-item-count",
      "Item quantity must be a positive safe integer.",
    );
  }
}

function mutableInventory(profile) {
  if (
    profile.schemaVersion !== PROFILE_VERSION ||
    Object.isFrozen(profile) ||
    !Array.isArray(profile.inventory) ||
    Object.isFrozen(profile.inventory) ||
    profile.inventory.length > PROFILE_LIMITS.inventory
  ) {
    throw profileError(
      "invalid-inventory-draft",
      "A mutable current-schema transaction draft is required.",
    );
  }
}

function validateAttributeRecord(attributes) {
  if (
    !attributes ||
    typeof attributes !== "object" ||
    Array.isArray(attributes)
  ) {
    throw profileError(
      "invalid-item-instance",
      "Item attributes must be a plain record.",
    );
  }
  const prototype = Object.getPrototypeOf(attributes);
  if (prototype !== Object.prototype && prototype !== null) {
    throw profileError(
      "invalid-item-instance",
      "Item attributes must be a plain record.",
    );
  }
  const fields = Reflect.ownKeys(attributes);
  const allowed = [
    "uid",
    "id",
    "count",
    "slot",
    "owner",
    "flags",
    "expiresAt",
    "upgrade",
  ];
  if (fields.length > allowed.length) {
    throw profileError("invalid-item-instance", "Unknown item attributes.");
  }
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(attributes, key);
    if (
      !allowed.includes(key) ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) {
      throw profileError(
        "invalid-item-instance",
        "Unknown or accessor-backed item attributes.",
      );
    }
  }
}

function instanceAttributes(attributes, id) {
  validateAttributeRecord(attributes);
  const value = {
    owner: Object.hasOwn(attributes, "owner") ? attributes.owner : "",
    flags: Object.hasOwn(attributes, "flags") ? attributes.flags : 0,
    expiresAt: Object.hasOwn(attributes, "expiresAt")
      ? attributes.expiresAt
      : null,
  };
  validateAttributeValues(value);
  if (Object.hasOwn(attributes, "upgrade")) {
    validateItemUpgrade(attributes.upgrade, id);
    value.upgrade = attributes.upgrade;
  }
  return value;
}

function validateAttributeValues(value) {
  if (
    typeof value.owner !== "string" ||
    value.owner.length > INVENTORY_POLICY.ownerLength ||
    !Number.isSafeInteger(value.flags) ||
    value.flags < 0 ||
    value.flags > 0xffff ||
    (value.expiresAt !== null &&
      (!Number.isSafeInteger(value.expiresAt) || value.expiresAt < 0))
  ) {
    throw profileError(
      "invalid-item-instance",
      "Invalid item owner, flags or expiration.",
    );
  }
}

function compatible(entry, id, attributes) {
  return (
    entry.id === id &&
    entry.owner === attributes.owner &&
    entry.flags === attributes.flags &&
    entry.expiresAt === attributes.expiresAt
  );
}

function grantPlan(profile, template, count, attributes) {
  const type = inventoryType(template.id);
  const limit = effectiveItemStackLimit(profile, template);
  const capacity = profile.inventorySlots[type - 1];
  if (
    !Number.isSafeInteger(capacity) ||
    capacity < 1 ||
    capacity > PROFILE_LIMITS.inventory
  ) {
    throw profileError("inventory-limit", "Invalid category capacity.");
  }
  const plan = {
    type,
    limit,
    capacity,
    used: new Uint8Array(capacity + 1),
    merges: [],
    remaining: count,
  };
  planStackMerges(profile, template, attributes, plan);
  const required =
    plan.remaining === 0 && attributes.uid !== undefined && count === 0
      ? 1
      : Math.ceil(plan.remaining / limit);
  const slots = [];
  for (let slot = 1; slot <= capacity && slots.length < required; slot++) {
    if (!plan.used[slot]) slots.push(slot);
  }
  if (
    slots.length !== required ||
    profile.inventory.length + required > PROFILE_LIMITS.inventory
  ) {
    throw profileError(
      "inventory-full",
      "Please make room in your inventory first.",
    );
  }
  return { merges: plan.merges, slots, remaining: plan.remaining, limit };
}

function claimStackSlot(entry, plan) {
  if (
    !Number.isSafeInteger(entry.slot) ||
    entry.slot < 1 ||
    entry.slot > plan.capacity ||
    plan.used[entry.slot]
  ) {
    throw profileError(
      "invalid-item-slot",
      "Existing inventory slots are invalid or duplicated.",
    );
  }
  plan.used[entry.slot] = 1;
}

function planStackMerges(profile, template, attributes, plan) {
  const canMerge =
    plan.type !== 1 && plan.type !== 5 && !isRechargeable(template.id);
  for (const entry of profile.inventory) {
    if (inventoryType(entry.id) !== plan.type) continue;
    claimStackSlot(entry, plan);
    if (!canMerge || !compatible(entry, template.id, attributes)) {
      continue;
    }
    if (entry.count > plan.limit) {
      throw profileError(
        "item-metadata",
        "Existing stack exceeds authored capacity.",
      );
    }
    const amount = Math.min(plan.remaining, plan.limit - entry.count);
    if (amount > 0) plan.merges.push({ entry, amount });
    plan.remaining -= amount;
  }
}

function grantQuantity(template, count, attributes) {
  if (
    !(
      count === 0 &&
      attributes?.uid !== undefined &&
      isRechargeable(template?.id)
    )
  ) {
    quantity(count);
  }
}

function transferredIdentities(profile, template, count, attributes) {
  if (attributes.id !== undefined && attributes.id !== template.id) {
    throw profileError(
      "invalid-item-instance",
      "Transferred instance does not match its original template.",
    );
  }
  const uid = attributes.uid;
  const identities = new Set();
  for (const entry of profile.inventory) identities.add(entry.uid);
  for (const entry of profile.equipment) identities.add(entry.uid);
  if (
    uid !== undefined &&
    (typeof uid !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(uid) ||
      identities.has(uid) ||
      count > effectiveItemStackLimit(profile, template) ||
      (attributes.count !== undefined && attributes.count !== count))
  ) {
    throw profileError(
      "invalid-item-uid",
      "Transferred item identity or quantity is invalid.",
    );
  }
  return identities;
}

function admitGrantTotal(profile, template, count) {
  if (!Number.isSafeInteger(itemCount(profile, template.id) + count)) {
    throw profileError(
      "inventory-limit",
      "Item quantity exceeds the save limit.",
    );
  }
  if (
    template.info?.only === 1 &&
    (count > 1 ||
      profile.inventory.some((entry) => entry.id === template.id) ||
      isEquipped(profile, template.id))
  ) {
    throw profileError("unique-item", "You already have this unique item.");
  }
}

function grantedInstances(template, plan, attributes, identities) {
  const added = [];
  for (const slot of plan.slots) {
    const identity = attributes.uid ?? createItemUid();
    if (identities.has(identity)) {
      throw profileError("invalid-item-uid", "Duplicate item identity.");
    }
    identities.add(identity);
    const amount = Math.min(plan.remaining, plan.limit);
    const entry = {
      uid: identity,
      id: template.id,
      count: amount,
      slot,
      owner: attributes.owner,
      flags: attributes.flags,
      expiresAt: attributes.expiresAt,
    };
    if (attributes.upgrade) entry.upgrade = structuredClone(attributes.upgrade);
    added.push(entry);
    plan.remaining -= amount;
  }
  return added;
}

/** Mutates detached drafts only. Compatible stacks absorb transfers; any remainder retains its UID. */
export function grantItem(profile, template, count, attributes = {}) {
  mutableInventory(profile);
  grantQuantity(template, count, attributes);
  if (!template?.descriptor) {
    throw profileError(
      "item-unavailable",
      "Original item template is unavailable.",
    );
  }
  const values = instanceAttributes(attributes, template.id);
  const identities = transferredIdentities(
    profile,
    template,
    count,
    attributes,
  );
  admitGrantTotal(profile, template, count);
  const instance = { ...values, uid: attributes.uid };
  const plan = grantPlan(profile, template, count, instance);
  const added = grantedInstances(template, plan, instance, identities);
  for (const merge of plan.merges) merge.entry.count += merge.amount;
  for (const entry of added) profile.inventory.push(entry);
}

/** No expiration clock here: use/trade authorities admit time-sensitive effects before debit. */
export function consumeItem(profile, uid, count) {
  mutableInventory(profile);
  if (count !== 0) quantity(count);
  const index = profile.inventory.findIndex((entry) => entry.uid === uid);
  const entry = profile.inventory[index];
  if (
    !entry ||
    entry.count < count ||
    (count === 0 && (entry.count !== 0 || !isRechargeable(entry.id)))
  ) {
    throw profileError(
      "insufficient-items",
      "The selected item is missing or its quantity changed.",
    );
  }
  if (entry.count === count) profile.inventory.splice(index, 1);
  else entry.count -= count;
}

export function consumeTemplate(profile, id, count) {
  mutableInventory(profile);
  quantity(count);
  if (itemCount(profile, id) < count) {
    throw profileError(
      "insufficient-items",
      "You do not have enough of this item.",
    );
  }
  const entries = profile.inventory.filter((entry) => entry.id === id);
  entries.sort((left, right) => left.slot - right.slot);
  let remaining = count;
  for (const entry of entries) {
    if (!remaining) break;
    const amount = Math.min(remaining, entry.count);
    consumeItem(profile, entry.uid, amount);
    remaining -= amount;
  }
}
