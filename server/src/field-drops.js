import { randomUUID } from "node:crypto";
import { protocolError } from "../../shared/protocol.js";
import {
  launchDrop,
  stepDropFlight,
  hoverDrop,
} from "../../client/src/world/drop-motion.js";
import { itemStackLimit } from "../../client/src/items/inventory-model.js";

export const MAX_FIELD_DROPS = 128;
const DROP_LIFETIME_MS = 180000;

/** Authored positive-X floors only; existing reference drop placement policy. */
export function dropGround(field, source, offset = 0) {
  const point = { x: source.x + offset, y: Infinity, foothold: null };
  for (const segment of field.geometry.segments) {
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
    if (y >= source.y - 85 && y < point.y) {
      point.y = y;
      point.foothold = segment;
    }
  }
  if (!Number.isFinite(point.y)) throw protocolError("REQUIREMENTS_NOT_MET");
  return point;
}

/** Called only after durable debit, or for ephemeral server-generated kill loot. */
export function createFieldDrop(world, actor, request) {
  const field = actor.field;
  if (request.id && field.drops.has(request.id)) {
    return field.drops.get(request.id);
  }
  if (field.drops.size >= MAX_FIELD_DROPS) throw protocolError("SERVER_BUSY");
  const source = request.source ?? actor.simulation;
  const point = request.ground ?? dropGround(field, source);
  const drop = createDropState(world, actor, request);
  drop.position = { x: source.x, y: source.y };
  drop.foothold = point.foothold;
  launchDrop(drop, source, point);
  field.drops.set(drop.id, drop);
  return drop;
}

function createDropState(world, actor, request) {
  return {
    id: request.id ?? randomUUID(),
    item: request.item ?? null,
    mesos: request.mesos ?? 0,
    ownerId: request.ownerId ?? actor.id,
    createdAt: request.createdAt ?? world.now,
    expiresAt: world.now + DROP_LIFETIME_MS,
    reservation: null,
    position: null,
    foothold: null,
    durableEntitlement: request.durableEntitlement === true,
    questId: request.questId ?? 0,
    itemId: request.item?.id ?? 0,
    age: 0,
    phaseAge: 0,
  };
}

export function advanceDrops(world, field) {
  for (const drop of field.drops.values()) {
    if (drop.reservation) continue;
    if (world.now >= drop.expiresAt) {
      field.drops.delete(drop.id);
      continue;
    }
    drop.age += 30;
    drop.phaseAge += 30;
    if (drop.state === "waiting") {
      drop.state = "launching";
      drop.phaseAge = 0;
    } else if (drop.state === "grounded") hoverDrop(drop);
    else stepDropFlight(drop);
    drop.position.x = drop.x;
    drop.position.y = drop.y;
  }
}

/** Retained Cosmic packaged row probabilities; not native server drop fidelity. */
export function killDrops(world, actor, mob) {
  const rows = world.content.catalog.drops?.mobs?.[mob.templateId]?.rows;
  if (!rows) {
    actor.admission = "unsupported-content: mob drop table unavailable";
    return;
  }
  if (rows.length > 256) throw protocolError("CONTENT_MISMATCH");
  const pending = planKillDrops(world, actor, mob, rows);
  if (!pending) return;
  for (const drop of pending) createFieldDrop(world, actor, drop);
}

function eligibleDropRow(world, actor, row) {
  if (row.status === "unavailable") return false;
  if (row.status !== "supported") throw protocolError("CONTENT_MISMATCH");
  if (row.questId && actor.profile.quests[row.questId]?.state !== 1) {
    return false;
  }
  return !(Math.floor(world.random() * 999999) >= row.chance);
}

function planKillDrops(world, actor, mob, rows) {
  const pending = [];
  for (const row of rows) {
    if (!eligibleDropRow(world, actor, row)) continue;
    let quantity =
      row.minimum + Math.floor(world.random() * (row.maximum - row.minimum));
    const limit = row.itemId
      ? itemStackLimit(world.content.items[row.itemId])
      : 2147483647;
    for (let split = 0; quantity > 0 && split < 256; split++) {
      if (
        pending.length +
          actor.field.drops.size +
          actor.field.dropReservations >=
        MAX_FIELD_DROPS
      ) {
        actor.admission = "field drop capacity exhausted; loot batch refused";
        return null;
      }
      const count = Math.min(quantity, limit);
      pending.push({
        item: row.itemId ? createLootItem(row.itemId, count) : null,
        mesos: row.itemId ? 0 : count,
        source: mob,
        questId: row.questId,
        ground: dropGround(actor.field, mob),
      });
      quantity -= count;
    }
    if (quantity) throw protocolError("SERVER_BUSY");
  }
  return pending;
}

function createLootItem(id, count) {
  return {
    uid: randomUUID(),
    id,
    count,
    slot: 1,
    owner: "",
    flags: 0,
    expiresAt: null,
  };
}
