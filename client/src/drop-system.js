import { PROFILE_LIMITS, profileError } from "./profile-validation.js";

/** Rates/ownership/limits are declared offline policy, not original Nexon server rules. */
export const DROP_POLICY = Object.freeze({
  authority: "Cosmic-server-reference/local-offline-policy",
  capacity: 256,
  maximumRows: 256,
  lifetimeMs: 180000,
  launchMs: 600,
  launchHeight: 48,
  pickupMs: 300,
  pickupX: 40,
  pickupY: 60,
  categorySlots: 96,
  mesoLimit: 2147483647,
  spread: 25,
  currencyFrameMs: 120,
  motion:
    "local launch/pickup curves; native settled hover at 00504d98..00504e44",
  hoverAmplitude: 3,
  hoverPhasePer30Ms: 0.09424769999999999,
  defaultStackLimit: 100,
  ownership:
    "local character only; transient field drops expire and do not survive map replacement",
});

function dropSlot() {
  return {
    active: false,
    generation: 0,
    itemId: 0,
    quantity: 0,
    questId: 0,
    state: "empty",
    age: 0,
    phaseAge: 0,
    x: 0,
    y: 0,
    sourceX: 0,
    sourceY: 0,
    groundX: 0,
    groundY: 0,
    targetX: 0,
    targetY: 0,
  };
}

function outcome(code, reason, extra = {}) {
  return {
    ok: code === "picked-up" || code === "spawned",
    code,
    reason,
    ...extra,
  };
}

function validPoint(point) {
  return (
    Number.isFinite(point?.x) &&
    Number.isFinite(point?.y) &&
    Math.abs(point.x) <= 1000000 &&
    Math.abs(point.y) <= 1000000
  );
}

function validateRow(row, items) {
  if (
    ![row.itemId, row.minimum, row.maximum, row.questId, row.chance].every(
      Number.isSafeInteger,
    ) ||
    row.itemId < 0 ||
    row.questId < 0 ||
    row.chance < 0 ||
    row.minimum < 1 ||
    row.maximum < row.minimum ||
    row.maximum > DROP_POLICY.mesoLimit ||
    (row.itemId && !items[row.itemId]?.descriptor)
  ) {
    throw new Error("Invalid supported drop row or missing original template");
  }
}

/** Construction validates the immutable release boundary, never each simulation tick. */
function dropTables(data, items) {
  if (data?.schemaVersion !== 1 || !data.mobs) {
    throw new Error("Invalid drop catalog");
  }
  const entries = Object.entries(data.mobs);
  if (entries.length > 65536) throw new Error("Drop mob catalog exceeds limit");
  const result = new Map();
  for (const [id, mob] of entries) {
    if (!Array.isArray(mob.rows) || mob.rows.length > DROP_POLICY.maximumRows) {
      throw new Error("Drop table exceeds per-mob limit");
    }
    const rows = [];
    for (const row of mob.rows) {
      if (row.status === "unavailable") continue;
      if (row.status !== "supported") {
        throw new Error("Invalid drop row status");
      }
      validateRow(row, items);
      rows.push(row);
    }
    result.set(Number(id), rows);
  }
  return result;
}

/** Transaction transform uses profile's aggregate inventory; equipment is a base template only. */
export function creditDrop(profile, drop, items) {
  validateCredit(drop);
  if (profile.hp <= 0) {
    throw profileError(
      "character-dead",
      "You cannot pick up items while dead.",
    );
  }
  if (drop.questId && profile.quests[drop.questId]?.state !== 1) {
    throw profileError(
      "quest-inactive",
      "This quest item no longer belongs to an active quest.",
    );
  }
  if (!drop.itemId) {
    if (
      !Number.isSafeInteger(profile.meso + drop.quantity) ||
      profile.meso + drop.quantity > DROP_POLICY.mesoLimit
    ) {
      throw profileError("meso-limit", "You cannot hold any more mesos.");
    }
    profile.meso += drop.quantity;
    return;
  }
  creditItem(profile, drop, items);
}

function validateCredit(drop) {
  if (
    !Number.isSafeInteger(drop.itemId) ||
    drop.itemId < 0 ||
    !Number.isSafeInteger(drop.quantity) ||
    drop.quantity < 1 ||
    !Number.isSafeInteger(drop.questId) ||
    drop.questId < 0
  ) {
    throw profileError("invalid-drop", "Drop credit is invalid.");
  }
}

function creditItem(profile, drop, items) {
  const template = items[drop.itemId];
  if (!template?.descriptor) {
    throw profileError(
      "item-unavailable",
      "Original item template is unavailable.",
    );
  }
  const inventory = inventoryUsage(profile, drop.itemId, items);
  const existing = inventory.existing;
  if (
    template.info?.only === 1 &&
    (drop.quantity > 1 || existing || profile.equipment.includes(drop.itemId))
  ) {
    throw profileError("unique-item", "You already have this unique item.");
  }
  const count = creditedCount(profile, drop, template, inventory);
  if (existing) existing.count = count;
  else profile.inventory.push({ id: drop.itemId, count });
}

/** Scan the category once; an aggregate stack can occupy multiple native inventory slots. */
function inventoryUsage(profile, id, items) {
  const category = Math.floor(id / 1000000);
  let existing = null,
    used = 0;
  for (const entry of profile.inventory) {
    if (entry.id === id) existing = entry;
    if (Math.floor(entry.id / 1000000) === category) {
      used += occupiedSlots(entry, itemsStackLimit(items[entry.id]), category);
    }
  }
  return { category, existing, used };
}

function creditedCount(profile, drop, template, inventory) {
  const { category, existing, used } = inventory;
  const limit = itemsStackLimit(template);
  const before = existing ? occupiedSlots(existing, limit, category) : 0;
  const count = (existing?.count ?? 0) + drop.quantity;
  if (!Number.isSafeInteger(count)) {
    throw profileError(
      "inventory-limit",
      "Item quantity exceeds the save limit.",
    );
  }
  const after = category === 1 ? count : Math.ceil(count / limit);
  if (
    used - before + after > DROP_POLICY.categorySlots ||
    (!existing && profile.inventory.length >= PROFILE_LIMITS.inventory)
  ) {
    throw profileError(
      "inventory-full",
      "Please make room in your inventory first.",
    );
  }
  return count;
}

function itemsStackLimit(template) {
  const authored = template?.info?.slotMax;
  // Aggregate saves have no authored slot count. Missing slotMax uses explicit local 100.
  return Number.isSafeInteger(authored) && authored > 0
    ? authored
    : DROP_POLICY.defaultStackLimit;
}

function occupiedSlots(entry, limit, category) {
  return category === 1 ? entry.count : Math.ceil(entry.count / limit);
}

/** Sole gameplay owner; renderer borrows slots and may not award or remove loot. */
export class DropSystem {
  constructor(data, store, footholds, options = {}) {
    this.store = store;
    this.items = options.items ?? {};
    this.tables = dropTables(data, this.items);
    if (!Array.isArray(footholds) || footholds.length > 65536) {
      throw new Error("Drop foothold limit");
    }
    for (const segment of footholds) {
      if (
        !validPoint({ x: segment.x1, y: segment.y1 }) ||
        !validPoint({ x: segment.x2, y: segment.y2 })
      ) {
        throw new Error("Invalid drop foothold");
      }
    }
    this.footholds = footholds;
    this.hooks = options;
    this.random = options.random ?? Math.random;
    this.slots = Array.from({ length: DROP_POLICY.capacity }, dropSlot);
    this.rolls = new Array(DROP_POLICY.maximumRows).fill(null);
    this.quantities = new Uint32Array(DROP_POLICY.maximumRows);
    this.positions = Array.from({ length: DROP_POLICY.maximumRows }, () => ({
      x: 0,
      y: 0,
    }));
    this.count = 0;
    this.clock = 0;
    this.lastDropSound = 0;
    this.pending = false;
    this.destroyed = false;
    this.lastResult = null;
  }

  randomUnit() {
    const sample = this.random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new Error("Drop random source outside [0,1)");
    }
    return sample;
  }

  roll(rows) {
    let count = 0;
    for (const row of rows) {
      if (row.questId && this.store.profile.quests[row.questId]?.state !== 1) {
        continue;
      }
      if (Math.floor(this.randomUnit() * 999999) >= row.chance) continue;
      this.rolls[count] = row;
      const span = row.maximum - row.minimum;
      this.quantities[count++] =
        row.minimum + (span ? Math.floor(this.randomUnit() * span) : 0);
    }
    return count;
  }

  /** Native server-reference spread uses 25px; slope placement uses original footholds. */
  place(point, mob, index) {
    const offset =
      index % 2 === 0
        ? 25 * Math.floor((index + 1) / 2)
        : -25 * Math.floor(index / 2);
    point.x = mob.x + offset;
    point.y = Infinity;
    for (const segment of this.footholds) {
      if (
        segment.x2 <= segment.x1 ||
        point.x < segment.x1 ||
        point.x > segment.x2
      ) {
        continue;
      }
      const y =
        segment.y1 +
        ((point.x - segment.x1) * (segment.y2 - segment.y1)) /
          (segment.x2 - segment.x1);
      if (y >= mob.y - 85 && y < point.y) point.y = y;
    }
    if (Number.isFinite(point.y)) return true;
    if (index === 0) return false;
    point.x = this.positions[0].x;
    point.y = this.positions[0].y;
    return Number.isFinite(point.y);
  }

  spawn(mob) {
    if (this.destroyed || !validPoint(mob)) {
      return this.result("invalid-field", "Drop source is unavailable.");
    }
    const rows = this.tables.get(mob.templateId);
    if (!rows) {
      return this.result(
        "unsupported-mob",
        "No Cosmic rows were packaged for this mob.",
      );
    }
    const count = this.roll(rows);
    if (count > DROP_POLICY.capacity - this.count) {
      return this.result(
        "drop-capacity",
        "Field drop capacity is full; this loot batch was not spawned.",
      );
    }
    for (let index = 0; index < count; index++) {
      if (!this.place(this.positions[index], mob, index)) {
        return this.result(
          "no-drop-ground",
          "No authored foothold supports this drop batch.",
        );
      }
    }
    let index = 0;
    for (const slot of this.slots) {
      if (index === count) break;
      if (slot.active) continue;
      this.activate(slot, mob, index++);
    }
    this.count += count;
    return this.result("spawned", null, { count });
  }

  activate(slot, mob, index) {
    const row = this.rolls[index],
      point = this.positions[index];
    slot.active = true;
    slot.generation++;
    slot.itemId = row.itemId;
    slot.quantity = this.quantities[index];
    slot.questId = row.questId;
    slot.state = "launching";
    slot.age = 0;
    slot.phaseAge = 0;
    slot.sourceX = slot.x = mob.x;
    slot.sourceY = slot.y = mob.y - 20;
    slot.groundX = point.x;
    slot.groundY = point.y;
  }

  step(deltaMs) {
    if (!Number.isFinite(deltaMs) || deltaMs < 0 || deltaMs > 250) {
      throw new Error("Invalid drop simulation quantum");
    }
    if (this.destroyed) return;
    this.clock += deltaMs;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += deltaMs;
      slot.phaseAge += deltaMs;
      if (slot.state === "pending") continue;
      if (slot.age >= DROP_POLICY.lifetimeMs) {
        this.remove(slot);
        continue;
      }
      if (slot.state === "launching") this.launch(slot);
      else if (slot.state === "collecting") this.collect(slot);
      else {
        slot.y = Math.trunc(
          slot.groundY +
            DROP_POLICY.hoverAmplitude *
              Math.sin((slot.phaseAge / 30) * DROP_POLICY.hoverPhasePer30Ms),
        );
      }
    }
  }

  launch(slot) {
    const t = Math.min(1, slot.phaseAge / DROP_POLICY.launchMs);
    slot.x = slot.sourceX + (slot.groundX - slot.sourceX) * t;
    slot.y =
      slot.sourceY +
      (slot.groundY - slot.sourceY) * t -
      4 * DROP_POLICY.launchHeight * t * (1 - t);
    if (t < 1) return;
    slot.state = "grounded";
    slot.phaseAge = 0;
    // 0050563e..00505687: settlement sound is globally throttled, strictly >300ms.
    if (this.clock - this.lastDropSound > 300) {
      this.lastDropSound = this.clock;
      this.hooks.onSound?.("DropItem");
    }
  }

  collect(slot) {
    const t = Math.min(1, slot.phaseAge / DROP_POLICY.pickupMs);
    slot.x = slot.sourceX + (slot.targetX - slot.sourceX) * t;
    slot.y =
      slot.sourceY +
      (slot.targetY - slot.sourceY) * t -
      24 * Math.sin(t * Math.PI);
    if (t === 1) this.remove(slot);
  }

  nearest(position) {
    let chosen = null,
      distance = Infinity;
    for (const slot of this.slots) {
      if (!slot.active || slot.state !== "grounded") continue;
      const dx = Math.abs(slot.groundX - position.x),
        dy = Math.abs(slot.groundY - position.y);
      if (dx > DROP_POLICY.pickupX || dy > DROP_POLICY.pickupY) continue;
      const candidate = dx * dx + dy * dy;
      if (candidate < distance) {
        chosen = slot;
        distance = candidate;
      }
    }
    return chosen;
  }

  /** One native intent, one durable credit. Failure keeps the world entity available. */
  async pickup(position) {
    if (this.destroyed || !validPoint(position)) {
      return this.result("invalid-field", "Pickup position is unavailable.");
    }
    if (this.pending) {
      return this.result("pickup-busy", "A pickup is already being saved.");
    }
    if (this.store.profile.hp <= 0) {
      return this.result(
        "character-dead",
        "You cannot pick up items while dead.",
      );
    }
    const slot = this.nearest(position);
    if (!slot) {
      return this.result(
        "nothing-nearby",
        "There is nothing nearby to pick up.",
      );
    }
    // Business-rule refusal must not mark the durable store as an I/O failure.
    try {
      creditDrop(structuredClone(this.store.profile), slot, this.items);
    } catch (error) {
      return this.result(error.code ?? "pickup-invalid", error.message);
    }
    this.pending = true;
    slot.state = "pending";
    slot.targetX = position.x;
    slot.targetY = position.y - 24;
    try {
      await this.store.commitProfile((draft) => {
        creditDrop(draft, slot, this.items);
      });
    } catch (error) {
      slot.state = "grounded";
      this.pending = false;
      return this.result(error.code ?? "pickup-save-failed", error.message);
    }
    this.pending = false;
    slot.state = "collecting";
    slot.phaseAge = 0;
    slot.sourceX = slot.x;
    slot.sourceY = slot.y;
    if (!this.destroyed) this.hooks.onSound?.("PickUpItem");
    return this.result("picked-up", null, {
      itemId: slot.itemId,
      quantity: slot.quantity,
    });
  }

  result(code, reason, extra) {
    const result = outcome(code, reason, extra);
    this.lastResult = result;
    return result;
  }

  remove(slot) {
    slot.active = false;
    slot.state = "empty";
    this.count--;
  }

  /** Bounded readout; world slots remain owned by this field, never by the inspector. */
  snapshot() {
    const drops = [];
    for (let index = 0; index < this.slots.length; index++) {
      const slot = this.slots[index];
      if (!slot.active) continue;
      drops.push({
        id: `drop:${index}`,
        itemId: slot.itemId,
        quantity: slot.quantity,
        state: slot.state,
        x: slot.x,
        y: slot.y,
        groundX: slot.groundX,
        groundY: slot.groundY,
        questId: slot.questId,
        age: slot.age,
      });
    }
    return {
      count: this.count,
      pending: this.pending,
      lastResult: this.lastResult ? { ...this.lastResult } : null,
      drops,
    };
  }

  destroy() {
    this.destroyed = true;
    for (const slot of this.slots) slot.active = false;
    this.count = 0;
  }
}
