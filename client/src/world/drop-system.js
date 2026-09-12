import { profileError } from "../profile/profile-validation.js";
import {
  createItemUid,
  grantItem,
  isRechargeable,
  itemStackLimit,
} from "../items/inventory-model.js";
import { applyCard } from "../character/monster-book.js";
import { isPickupItem } from "../items/item-effects.js";
import {
  admitItem,
  debitItemDrop,
  disappearingDrop,
  itemDropWarning,
  originalItem,
  selectedItem,
  validateSplit,
} from "../items/inventory-action-rules.js";
import {
  DROP_MOTION,
  launchDrop,
  stepDropFlight,
  hoverDrop,
  collectDrop,
  fadeDisappearingDrop,
} from "./drop-motion.js";

/** Rates/ownership/limits are declared offline policy, not original Nexon server rules. */
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

function dropSlot() {
  return {
    active: false,
    reserved: false,
    generation: 0,
    itemId: 0,
    quantity: 0,
    instance: null,
    ownerId: null,
    disappearing: false,
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
    targetHeight: 0,
    durationMs: 0,
    launchSpeed: 400,
    rotation: 0,
    alpha: 1,
    target: null,
    foothold: null,
  };
}

function outcome(code, reason, extra = {}) {
  return {
    ok:
      code === "picked-up" ||
      code === "spawned" ||
      code === "mesos-dropped" ||
      code === "item-dropped" ||
      code === "item-conjured",
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
  if (row.itemId) originalItem(items, row.itemId);
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

/** One shared schema5 transaction draft: mesos, preserved item instance, or MonsterBook card. */
export function creditDrop(profile, drop, items, monsterBook) {
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
  return creditItemDrop(profile, drop, items, monsterBook);
}

function creditItemDrop(profile, drop, items, monsterBook) {
  if (
    !drop.instance ||
    drop.instance.id !== drop.itemId ||
    drop.instance.count !== drop.quantity
  ) {
    throw profileError(
      "invalid-drop-instance",
      "The ground item has no matching instance identity.",
    );
  }
  admitItem(profile, drop.instance);
  const template = originalItem(items, drop.itemId);
  if (Math.floor(drop.itemId / 10000) === 238) {
    if (!monsterBook?.cards?.[drop.itemId]) {
      throw profileError(
        "card-unavailable",
        "Original monster card metadata is unavailable.",
      );
    }
    if (drop.quantity !== 1) {
      throw profileError(
        "invalid-card-drop",
        "A monster card drop must contain one card.",
      );
    }
    return applyCard(profile, drop.itemId);
  } else if (!pickupEffect(template)) {
    grantItem(profile, template, drop.quantity, drop.instance);
  }
}

function pickupEffect(template) {
  return Math.floor(template?.id / 10000) === 238 || isPickupItem(template);
}

function validateCredit(drop) {
  if (
    !Number.isSafeInteger(drop.itemId) ||
    drop.itemId < 0 ||
    !Number.isSafeInteger(drop.quantity) ||
    drop.quantity < 0 ||
    (drop.quantity === 0 && !isRechargeable(drop.itemId)) ||
    !Number.isSafeInteger(drop.questId) ||
    drop.questId < 0
  ) {
    throw profileError("invalid-drop", "Drop credit is invalid.");
  }
}

/** Native dialog 0081dac6..0081dadd; Cosmic MesoDropHandler confirms 10..50000. */
export function debitMesos(profile, amount) {
  if (
    !Number.isSafeInteger(amount) ||
    amount < DROP_POLICY.minimumMesoDrop ||
    amount > DROP_POLICY.maximumMesoDrop
  ) {
    throw profileError(
      "invalid-meso-amount",
      "Drop between 10 and 50,000 mesos.",
    );
  }
  if (profile.hp <= 0) {
    throw profileError("character-dead", "You cannot drop mesos while dead.");
  }
  if (amount > profile.meso) {
    throw profileError("insufficient-mesos", "You do not have enough mesos.");
  }
  profile.meso -= amount;
}

/** Explicit development producer; one original stack, credited only by ordinary pickup. */
function conjuredInstance(items, request) {
  if (!Number.isSafeInteger(request?.itemId) || request.itemId <= 0) {
    throw profileError("invalid-item", "Choose an original item template.");
  }
  const template = originalItem(items, request.itemId);
  const maximum = itemStackLimit(template);
  if (
    !Number.isSafeInteger(request.quantity) ||
    request.quantity < 1 ||
    request.quantity > maximum
  ) {
    throw profileError(
      "invalid-quantity",
      `Choose between 1 and ${maximum} items.`,
    );
  }
  return {
    uid: createItemUid(),
    id: template.id,
    count: request.quantity,
    slot: 1,
    owner: "",
    flags: 0,
    expiresAt: null,
  };
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
        !validPoint({ x: segment.x2, y: segment.y2 }) ||
        !Number.isSafeInteger(segment.layer) ||
        !Number.isSafeInteger(segment.group)
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
      foothold: null,
    }));
    this.count = 0;
    this.clock = 0;
    this.lastDropSound = -Infinity;
    this.pending = false;
    this.pendingPromise = null;
    this.resolveIdle = null;
    this.remainderMs = 0;
    this.reserved = 0;
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

  /** Cosmic MapleMap666..669: card rate changes drop probability, not meso quantity.
   * Local rows retain their packaged channel-rate policy; multiply using Java float rounding. */
  dropChance(row, showdown = 1) {
    const rate = this.hooks.cardRate?.(row.itemId) ?? 1;
    const family = this.hooks.familyRate?.() ?? 1;
    if (
      !Number.isFinite(rate) ||
      rate < 1 ||
      !Number.isFinite(family) ||
      family < 1 ||
      family > 2
    ) {
      throw new Error("Invalid admitted monster-card drop rate");
    }
    const chance = Math.fround(
      Math.fround(Math.fround(row.chance) * Math.fround(rate)) *
        Math.fround(family) *
        Math.fround(showdown),
    );
    return Math.trunc(Math.min(chance, 0x7fffffff));
  }

  roll(rows, showdown = 1) {
    let count = 0;
    const mesoUp = this.hooks.mesoUp?.() || 100;
    for (const row of rows) {
      if (row.questId && this.store.profile.quests[row.questId]?.state !== 1) {
        continue;
      }
      const chance = this.dropChance(row, showdown);
      if (Math.floor(this.randomUnit() * 999999) >= chance) continue;
      const span = row.maximum - row.minimum;
      let quantity =
        row.minimum + (span ? Math.floor(this.randomUnit() * span) : 0);
      if (!row.itemId) quantity = Math.trunc((quantity * mesoUp) / 100);
      count = this.appendRoll(row, quantity, count);
      if (count < 0) return -1;
    }
    return count;
  }

  appendRoll(row, quantity, count) {
    const limit =
      Math.floor(row.itemId / 10000) === 238
        ? 1
        : row.itemId
          ? itemStackLimit(this.items[row.itemId])
          : DROP_POLICY.mesoLimit;
    while (quantity > 0 && count < DROP_POLICY.maximumRows) {
      this.rolls[count] = row;
      this.quantities[count++] = Math.min(quantity, limit);
      quantity -= Math.min(quantity, limit);
    }
    return quantity > 0 ? -1 : count;
  }

  /** Native server-reference spread uses 25px; slope placement uses original footholds. */
  place(point, mob, index) {
    const order = index + 1;
    const offset =
      order % 2 === 0
        ? DROP_POLICY.spread * Math.floor((order + 1) / 2)
        : -DROP_POLICY.spread * Math.floor(order / 2);
    point.x = mob.x + offset;
    point.y = Infinity;
    point.foothold = null;
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
      if (y >= mob.y - 85 && y < point.y) {
        point.y = y;
        point.foothold = segment;
      }
    }
    if (Number.isFinite(point.y)) return true;
    if (index === 0) return false;
    point.x = this.positions[0].x;
    point.y = this.positions[0].y;
    point.foothold = this.positions[0].foothold;
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
    const count = this.roll(rows, mob.killDropRate ?? 1);
    if (
      count < 0 ||
      count > DROP_POLICY.capacity - this.count - this.reserved
    ) {
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
    this.activateBatch(mob, count);
    return this.result("spawned", null, { count });
  }

  activateBatch(mob, count) {
    let index = 0;
    for (const slot of this.slots) {
      if (index === count) break;
      if (slot.active || slot.reserved) continue;
      this.activate(slot, mob, index++);
    }
    this.count += count;
  }

  activate(slot, mob, index) {
    const row = this.rolls[index],
      point = this.positions[index];
    slot.active = true;
    slot.generation++;
    slot.itemId = row.itemId;
    slot.quantity = this.quantities[index];
    slot.instance = row.itemId
      ? {
          uid: createItemUid(),
          id: row.itemId,
          count: slot.quantity,
          slot: 1,
          owner: "",
          flags: 0,
          expiresAt: null,
        }
      : null;
    slot.ownerId = this.store.id;
    slot.disappearing = false;
    slot.questId = row.questId;
    slot.foothold = point.foothold;
    launchDrop(slot, mob, point);
  }

  step(deltaMs) {
    if (!Number.isFinite(deltaMs) || deltaMs < 0 || deltaMs > 250) {
      throw new Error("Invalid drop simulation quantum");
    }
    if (this.destroyed) return;
    this.remainderMs += deltaMs;
    const ticks = Math.floor(this.remainderMs / DROP_MOTION.quantumMs);
    this.remainderMs -= ticks * DROP_MOTION.quantumMs;
    for (let tick = 0; tick < ticks; tick++) this.stepQuantum();
  }

  stepQuantum() {
    this.clock += DROP_MOTION.quantumMs;
    for (const slot of this.slots) {
      if (!slot.active || slot.state === "pending") continue;
      slot.age += DROP_MOTION.quantumMs;
      slot.phaseAge += DROP_MOTION.quantumMs;
      if (slot.age >= DROP_POLICY.lifetimeMs) {
        this.remove(slot);
        continue;
      }
      if (
        slot.state === "waiting" ||
        slot.state === "launching" ||
        slot.state === "falling"
      ) {
        this.launch(slot);
      } else if (slot.state === "collecting") this.collect(slot);
      else hoverDrop(slot);
      if (slot.disappearing && fadeDisappearingDrop(slot)) this.remove(slot);
    }
  }

  launch(slot) {
    if (slot.state !== "waiting") {
      stepDropFlight(slot);
      return;
    }
    slot.state = "launching";
    slot.phaseAge = 0;
    // 0050542d..00505687: launch visibility/sound, globally throttled strictly >300ms.
    if (!slot.disappearing && this.clock - this.lastDropSound > 300) {
      this.lastDropSound = this.clock;
      this.hooks.onSound?.("DropItem");
    }
  }

  collect(slot) {
    const height = this.hooks.pickupHeight?.();
    if (Number.isFinite(height) && height >= 0 && height <= 4096) {
      slot.targetHeight = height;
    }
    if (!validPoint(slot.target) || collectDrop(slot)) this.remove(slot);
  }

  nearest(position) {
    let chosen = null,
      distance = Infinity;
    for (const slot of this.slots) {
      if (!slot.active || slot.state !== "grounded") continue;
      if (slot.disappearing || slot.ownerId !== this.store.id) continue;
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
    if (!slot) return this.result("nothing-nearby", null);
    // Business-rule refusal must not mark the durable store as an I/O failure.
    try {
      creditDrop(
        structuredClone(this.store.profile),
        slot,
        this.items,
        this.hooks.monsterBook,
      );
    } catch (error) {
      return this.result(error.code ?? "pickup-invalid", error.message);
    }
    const targetHeight = this.hooks.pickupHeight?.();
    if (
      !Number.isFinite(targetHeight) ||
      targetHeight < 0 ||
      targetHeight > 4096
    ) {
      return this.result(
        "pickup-anchor-unavailable",
        "Original character canvas height is unavailable.",
      );
    }
    slot.targetHeight = targetHeight;
    return this.commitPickup(slot, position);
  }

  /** Own the pending credit barrier and publish collection only after durable success. */
  async commitPickup(slot, position) {
    this.beginPending();
    slot.state = "pending";
    slot.target = position;
    let prepared = null;
    let committed = false;
    let card = null;
    try {
      const before = JSON.stringify(this.store.profile);
      prepared = await this.preparePickup(slot);
      if (prepared) {
        const preview = structuredClone(this.store.profile);
        creditDrop(preview, slot, this.items, this.hooks.monsterBook);
        this.hooks.applyPickup(preview, prepared);
      }
      if (this.destroyed || this.hooks.isCurrent?.() === false) {
        throw profileError("field-cancelled", "The pickup was cancelled.");
      }
      if (JSON.stringify(this.store.profile) !== before) {
        throw profileError(
          "profile-changed",
          "The character changed while preparing the pickup.",
        );
      }
      await this.store.commitProfile((draft) => {
        card =
          creditDrop(draft, slot, this.items, this.hooks.monsterBook) ?? null;
        if (prepared) this.hooks.applyPickup(draft, prepared);
      });
      committed = true;
      slot.state = "collecting";
      slot.phaseAge = 0;
      slot.sourceX = slot.groundX;
      slot.sourceY = slot.groundY;
      slot.rotation = 0;
      this.publishPickup(prepared);
      return this.result("picked-up", null, {
        itemId: slot.itemId,
        quantity: slot.quantity,
        card,
      });
    } catch (error) {
      if (!committed) {
        if (slot.active) slot.state = "grounded";
        slot.target = null;
      }
      return this.result(error.code ?? "pickup-save-failed", error.message);
    } finally {
      if (prepared && !committed) this.hooks.releasePickup(prepared);
      this.finishPending();
    }
  }

  async preparePickup(slot) {
    if (!pickupEffect(this.items[slot.itemId])) return null;
    if (
      typeof this.hooks.preparePickup !== "function" ||
      typeof this.hooks.applyPickup !== "function" ||
      typeof this.hooks.releasePickup !== "function" ||
      typeof this.hooks.publishPickup !== "function"
    ) {
      throw profileError(
        "pickup-effect-unavailable",
        "Original pickup effect authority is unavailable.",
      );
    }
    const prepared = await this.hooks.preparePickup({
      itemId: slot.itemId,
      quantity: slot.quantity,
      questId: slot.questId,
      instance: { ...slot.instance },
      ownerId: slot.ownerId,
    });
    if (!prepared) {
      throw profileError(
        "pickup-cancelled",
        "Pickup effect preparation was cancelled.",
      );
    }
    return prepared;
  }

  publishPickup(prepared) {
    try {
      if (prepared) this.hooks.publishPickup(prepared);
      this.hooks.onSound?.("PickUpItem");
    } catch (error) {
      this.lastPublicationError = error.message;
    }
  }
  /** Reserve world capacity, durably debit, then publish. No value-bearing visual before commit. */
  async dropMesos(amount, simulation) {
    if (this.destroyed || !validPoint(simulation)) {
      return this.result("invalid-field", "Drop position is unavailable.");
    }
    if (this.pending) {
      return this.result(
        "drop-busy",
        "A drop transaction is already being saved.",
      );
    }
    try {
      debitMesos(structuredClone(this.store.profile), amount);
    } catch (error) {
      return this.result(error.code ?? "invalid-meso-amount", error.message);
    }
    const slot = this.slots.find((entry) => !entry.active && !entry.reserved);
    if (!slot) {
      return this.result("drop-capacity", "Field drop capacity is full.");
    }
    const point = { x: 0, y: 0, foothold: null };
    if (!this.place(point, simulation, 0)) {
      return this.result(
        "no-drop-ground",
        "No authored foothold supports this drop.",
      );
    }
    const source = { x: simulation.x, y: simulation.y };
    slot.itemId = 0;
    slot.instance = null;
    slot.ownerId = this.store.id;
    slot.disappearing = false;
    slot.quantity = amount;
    slot.questId = 0;
    slot.foothold = point.foothold;
    launchDrop(slot, source, point);
    slot.reserved = true;
    this.reserved++;
    this.beginPending();
    try {
      await this.store.commitProfile((draft) => {
        if (this.destroyed) {
          throw profileError(
            "field-cancelled",
            "Field was closed before the debit.",
          );
        }
        debitMesos(draft, amount);
      });
      slot.generation++;
      slot.active = true;
      this.count++;
      return this.result("mesos-dropped", null, { quantity: amount });
    } catch (error) {
      return this.result(error.code ?? "drop-save-failed", error.message);
    } finally {
      slot.reserved = false;
      this.reserved--;
      this.finishPending();
    }
  }

  confirmDisappearingDrop(source, count) {
    if (typeof this.hooks.confirmItemDrop !== "function") {
      throw profileError(
        "drop-confirmation-required",
        "This item cannot be recovered once dropped.",
      );
    }
    const template = originalItem(this.items, source.id);
    return this.hooks.confirmItemDrop({
      ...source,
      count,
      dropWarning: itemDropWarning(source, template),
    });
  }

  admitPreparedDrop(before) {
    if (this.destroyed || this.hooks.isCurrent?.() === false) {
      throw profileError(
        "field-cancelled",
        "The field was closed before the drop.",
      );
    }
    if (JSON.stringify(this.store.profile) !== before) {
      throw profileError(
        "inventory-changed",
        "The character changed while preparing the drop.",
      );
    }
  }

  /** Native004f31a5 prompts before00a0900a; cancellation never owns/debits an item. */
  async dropItem(request, simulation) {
    if (this.pending || this.store.profileTransactionPending) {
      return this.result(
        "drop-busy",
        "An item transaction is already pending.",
      );
    }
    if (this.destroyed || !validPoint(simulation)) {
      return this.result("invalid-field", "Drop position is unavailable.");
    }
    let plan = null;
    let committed = false;
    this.beginPending();
    try {
      const input = { ...request, dropUid: createItemUid() };
      const before = JSON.stringify(this.store.profile);
      const source = selectedItem(this.store.profile, input.uid);
      admitItem(this.store.profile, source);
      validateSplit(source, input.count);
      const template = originalItem(this.items, source.id);
      const disappearing = disappearingDrop(source, template);
      if (
        disappearing &&
        (await this.confirmDisappearingDrop(source, input.count)) !== true
      ) {
        return this.result("cancelled", null);
      }
      const draft = structuredClone(this.store.profile);
      const instance = debitItemDrop(draft, this.items, input);
      plan = await this.prepareItemDrop(
        { instance, draft, disappearing },
        simulation,
      );
      this.admitPreparedDrop(before);
      await this.store.commitProfile((current) => {
        debitItemDrop(current, this.items, input);
      });
      committed = true;
      this.publishItemDrop(plan);
      return this.result("item-dropped", null, {
        itemId: instance.id,
        quantity: instance.count,
        disappearing,
      });
    } catch (error) {
      return this.result(error.code ?? "drop-failed", error.message);
    } finally {
      if (plan) this.releaseItemDrop(plan, committed);
      this.finishPending();
    }
  }

  /** Inspector-only creation: preflight real art/ground, never grant inventory directly. */
  async conjureItem(request, simulation) {
    if (this.pending || this.store.profileTransactionPending) {
      return this.result(
        "drop-busy",
        "An item transaction is already pending.",
      );
    }
    let plan = null;
    let published = false;
    this.beginPending();
    try {
      const instance = conjuredInstance(this.items, request);
      admitItem(this.store.profile, instance);
      const position = this.conjurePosition(simulation);
      plan = await this.prepareItemDrop(
        { instance, disappearing: false },
        position,
      );
      if (this.destroyed || this.hooks.isCurrent?.() === false) {
        throw profileError(
          "field-cancelled",
          "The field changed before the drop.",
        );
      }
      admitItem(this.store.profile, instance);
      this.publishItemDrop(plan);
      published = true;
      return this.result("item-conjured", null, {
        itemId: instance.id,
        quantity: instance.count,
      });
    } catch (error) {
      return this.result(error.code ?? "drop-failed", error.message);
    } finally {
      if (plan) this.releaseItemDrop(plan, published);
      this.finishPending();
    }
  }

  conjurePosition(simulation) {
    if (
      this.destroyed ||
      !validPoint(simulation) ||
      ![-1, 1].includes(simulation.facing) ||
      this.hooks.isCurrent?.() === false
    ) {
      throw profileError("invalid-field", "The current field is unavailable.");
    }
    return {
      x: simulation.x + simulation.facing * DROP_POLICY.spread,
      y: simulation.y,
    };
  }

  async prepareItemDrop(value, simulation) {
    if (
      typeof this.hooks.prepareItemDrop !== "function" ||
      typeof this.hooks.publishItemDrop !== "function" ||
      typeof this.hooks.releaseItemDrop !== "function"
    ) {
      throw profileError(
        "drop-art-unavailable",
        "Original item drop artwork preparation is unavailable.",
      );
    }
    const slot = this.slots.find((entry) => !entry.active && !entry.reserved);
    if (!slot) {
      throw profileError("drop-capacity", "Field drop capacity is full.");
    }
    const point = { x: 0, y: 0, foothold: null };
    if (!this.place(point, simulation, 0)) {
      throw profileError(
        "no-drop-ground",
        "No authored foothold supports this drop.",
      );
    }
    const plan = { slot, art: null, appearance: null };
    slot.reserved = true;
    this.reserved++;
    try {
      slot.instance = value.instance;
      slot.itemId = value.instance.id;
      slot.quantity = value.instance.count;
      slot.ownerId = this.store.id;
      slot.disappearing = value.disappearing;
      slot.questId = 0;
      slot.foothold = point.foothold;
      launchDrop(slot, simulation, point);
      plan.art = await this.hooks.prepareItemDrop(value.instance, slot);
      if (!plan.art) {
        throw profileError(
          "drop-art-unavailable",
          "Original item drop artwork was not prepared.",
        );
      }
      if (value.instance.slot < 0) {
        plan.appearance = await this.prepareDropAppearance(value.draft);
      }
      return plan;
    } catch (error) {
      this.releaseItemDrop(plan, false);
      throw error;
    }
  }

  async prepareDropAppearance(draft) {
    if (
      typeof this.hooks.prepareAppearance !== "function" ||
      typeof this.hooks.publishAppearance !== "function" ||
      typeof this.hooks.releaseAppearance !== "function"
    ) {
      throw profileError(
        "appearance-unavailable",
        "Original equipment appearance preparation is unavailable.",
      );
    }
    const prepared = await this.hooks.prepareAppearance(draft);
    if (!prepared) {
      throw profileError(
        "appearance-unavailable",
        "Original equipment appearance was not prepared.",
      );
    }
    return prepared;
  }

  /** All hooks are nonthrowing publication only; art and motion already exist before debit. */
  publishItemDrop(plan) {
    plan.slot.generation++;
    plan.slot.active = true;
    this.count++;
    try {
      if (plan.appearance) this.hooks.publishAppearance(plan.appearance);
      this.hooks.publishItemDrop(plan.art, plan.slot);
    } catch (error) {
      this.lastPublicationError = error.message;
    }
  }

  releaseItemDrop(plan, committed) {
    if (!committed) {
      if (plan.art) this.hooks.releaseItemDrop(plan.art);
      if (plan.appearance) this.hooks.releaseAppearance(plan.appearance);
    }
    plan.slot.reserved = false;
    this.reserved--;
  }

  beginPending() {
    this.pending = true;
    this.pendingPromise = new Promise((resolve) => {
      this.resolveIdle = resolve;
    });
  }

  finishPending() {
    this.pending = false;
    this.resolveIdle?.();
    this.resolveIdle = null;
    this.pendingPromise = null;
  }

  /** Lifecycle barrier: map replacement must await before destroying this field. */
  waitForIdle() {
    return this.pendingPromise ?? Promise.resolve();
  }

  result(code, reason, extra) {
    const result = outcome(code, reason, extra);
    this.lastResult = result;
    return result;
  }

  selectExplosion(rectangle, output, limit) {
    if (
      this.destroyed ||
      this.pending ||
      this.store.profileTransactionPending
    ) {
      return 0;
    }
    let count = 0;
    for (const slot of this.slots) {
      if (!this.explosionEligible(slot, rectangle)) continue;
      if (count === limit && slot.quantity >= output[count - 1].quantity) {
        continue;
      }
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

  explosionEligible(slot, rectangle) {
    if (
      !slot.active ||
      slot.reserved ||
      slot.itemId ||
      slot.state !== "grounded" ||
      slot.disappearing
    ) {
      return false;
    }
    return !(
      slot.x < rectangle.left ||
      slot.x > rectangle.right ||
      slot.y < rectangle.top ||
      slot.y > rectangle.bottom
    );
  }

  consumeExplosion(slots, count) {
    for (let index = 0; index < count; index++) {
      const slot = slots[index];
      if (
        !slot.active ||
        slot.reserved ||
        slot.itemId ||
        slot.state !== "grounded"
      ) {
        throw new Error("Admitted meso drop changed synchronously");
      }
    }
    for (let index = 0; index < count; index++) this.remove(slots[index]);
  }

  spawnPickpocket(mob, amount) {
    if (
      this.destroyed ||
      this.pending ||
      !Number.isSafeInteger(amount) ||
      amount <= 0
    ) {
      return false;
    }
    let slot = null;
    for (const candidate of this.slots) {
      if (!candidate.active && !candidate.reserved) {
        slot = candidate;
        break;
      }
    }
    if (!slot || !this.place(this.positions[0], mob, 0)) return false;
    slot.itemId = 0;
    slot.quantity = amount;
    slot.instance = null;
    slot.ownerId = this.store.id;
    slot.questId = 0;
    slot.disappearing = false;
    slot.foothold = this.positions[0].foothold;
    slot.active = true;
    slot.generation++;
    launchDrop(slot, mob, this.positions[0]);
    this.count++;
    return true;
  }

  remove(slot) {
    if (!slot.active) return;
    slot.active = false;
    slot.state = "empty";
    slot.target = null;
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
        instance: slot.instance ? { ...slot.instance } : null,
        ownerId: slot.ownerId,
        disappearing: slot.disappearing,
        quantity: slot.quantity,
        state: slot.state,
        x: slot.x,
        y: slot.y,
        groundX: slot.groundX,
        groundY: slot.groundY,
        questId: slot.questId,
        rotation: slot.rotation,
        alpha: slot.alpha,
        durationMs: slot.durationMs,
        age: slot.age,
      });
    }
    return {
      count: this.count,
      pending: this.pending,
      reserved: this.reserved,
      lastResult: this.lastResult ? { ...this.lastResult } : null,
      drops,
    };
  }

  destroy() {
    if (this.pending) {
      throw profileError(
        "field-busy",
        "Await waitForIdle before destroying pending drop transactions.",
      );
    }
    this.destroyed = true;
    for (const slot of this.slots) slot.active = false;
    this.count = 0;
  }
}
