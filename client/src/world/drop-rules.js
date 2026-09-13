import { itemStackLimit } from "../items/inventory-model.js";

/** Packaged Cosmic rates plus existing offline field policy, not Nexon server claims. */
export const DROP_POLICY = Object.freeze({
  authority: "Cosmic-server-reference/local-offline-policy",
  capacity: 256,
  maximumRows: 256,
  lifetimeMs: 180000,
  minimumMesoDrop: 10,
  maximumMesoDrop: 50000,
  pickupX: 40,
  pickupY: 60,
  categorySlots: 96,
  mesoLimit: 2147483647,
  spread: 25,
  defaultStackLimit: 100,
  ownership:
    "local character only; transient field drops expire and do not survive map replacement",
});

function randomUnit(random) {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new Error("Drop random source outside [0,1)");
  }
  return sample;
}

function validateDropModifiers(rate, family, showdown) {
  if (
    !Number.isFinite(rate) ||
    rate < 1 ||
    !Number.isFinite(family) ||
    family < 1 ||
    family > 2 ||
    !Number.isFinite(showdown) ||
    showdown < 1
  ) {
    throw new Error("Invalid admitted monster-card drop rate");
  }
}

/** Cosmic MapleMap666..669: Java float probability, never a meso quantity multiplier. */
export function dropChance(row, rates, showdown = 1) {
  const rate = rates.cardRate?.(row.itemId) ?? 1;
  const family = rates.familyRate?.() ?? 1;
  validateDropModifiers(rate, family, showdown);
  const chance = Math.fround(
    Math.fround(Math.fround(row.chance) * Math.fround(rate)) *
      Math.fround(family) *
      Math.fround(showdown),
  );
  return Math.trunc(Math.min(chance, 0x7fffffff));
}

function appendRoll(output, row, quantity, items) {
  const limit =
    Math.floor(row.itemId / 10000) === 238
      ? 1
      : row.itemId
        ? itemStackLimit(items[row.itemId])
        : DROP_POLICY.mesoLimit;
  if (!Number.isSafeInteger(quantity) || quantity < 0 || limit < 1) {
    throw new Error("Invalid admitted drop quantity");
  }
  while (quantity > 0 && output.count < DROP_POLICY.maximumRows) {
    output.rolls[output.count] = row;
    output.quantities[output.count++] = Math.min(quantity, limit);
    quantity -= Math.min(quantity, limit);
  }
  return quantity === 0;
}

/** The quantity modifier is admitted once per batch, even when no row can win. */
function admittedMesoUp(rates) {
  const mesoUp = rates.mesoUp?.() || 100;
  if (!Number.isFinite(mesoUp) || mesoUp < 0) {
    throw new Error("Invalid Meso Up rate");
  }
  return mesoUp;
}

/** Quantity consumes a second draw only for a won row with a nonconstant range. */
function rollDropQuantity(row, random, mesoUp) {
  const span = row.maximum - row.minimum;
  const quantity =
    row.minimum + (span ? Math.floor(randomUnit(random) * span) : 0);
  return row.itemId ? quantity : Math.trunc((quantity * mesoUp) / 100);
}

/** Output scratch arrays are owner allocated; -1 refuses the entire over-capacity batch. */
export function rollDropRows(rows, context, output, showdown = 1) {
  if (rows.length > DROP_POLICY.maximumRows) throw new Error("Drop row limit");
  output.count = 0;
  const mesoUp = admittedMesoUp(context.rates);
  for (const row of rows) {
    if (row.questId && context.profile.quests[row.questId]?.state !== 1)
      {continue;}
    const chance = dropChance(row, context.rates, showdown);
    if (Math.floor(randomUnit(context.random) * 999999) >= chance) continue;
    const quantity = rollDropQuantity(row, context.random, mesoUp);
    if (!appendRoll(output, row, quantity, context.items)) return -1;
  }
  return output.count;
}

/** Native server-reference alternating 25px fanout and authored positive-X floor selection. */
export function placeDrop(point, source, geometry, index = 0) {
  const order = index + 1;
  const offset =
    order % 2 === 0
      ? DROP_POLICY.spread * Math.floor((order + 1) / 2)
      : -DROP_POLICY.spread * Math.floor(order / 2);
  point.x = source.x + offset;
  point.y = Infinity;
  point.foothold = null;
  for (const segment of geometry.footholds) {
    if (
      segment.x2 <= segment.x1 ||
      point.x < segment.x1 ||
      point.x > segment.x2
    )
      {continue;}
    const y =
      segment.y1 +
      ((point.x - segment.x1) * (segment.y2 - segment.y1)) /
        (segment.x2 - segment.x1);
    if (y >= source.y - 85 && y < point.y) {
      point.y = y;
      point.foothold = segment;
    }
  }
  if (Number.isFinite(point.y)) return true;
  if (index === 0) return false;
  point.x = geometry.first.x;
  point.y = geometry.first.y;
  point.foothold = geometry.first.foothold;
  return Number.isFinite(point.y);
}

/** Same loose-meso eligibility for native Meso Explosion; pickup ownership is a separate gate. */
export function explosionEligible(slot, rectangle, reservation = null) {
  if (
    !slot.active ||
    slot.reserved ||
    (slot.reservation && slot.reservation !== reservation) ||
    slot.itemId ||
    slot.state !== "grounded" ||
    slot.disappearing
  )
    {return false;}
  return !(
    slot.x < rectangle.left ||
    slot.x > rectangle.right ||
    slot.y < rectangle.top ||
    slot.y > rectangle.bottom
  );
}

/** Caller bounds the resident slots and limit; stable lowest-quantity selection without allocation. */
export function selectExplosionDrops(slots, rectangle, output, limit) {
  let count = 0;
  for (const slot of slots) {
    if (!explosionEligible(slot, rectangle)) continue;
    if (count === limit && slot.quantity >= output[count - 1].quantity)
      {continue;}
    let index = Math.min(count, limit - 1);
    while (index > 0 && slot.quantity < output[index - 1].quantity) {
      output[index] = output[index - 1];
      index--;
    }
    output[index] = slot;
    if (count < limit) count++;
  }
  return count;
}
