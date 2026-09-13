import { randomUUID } from "node:crypto";
import { protocolError } from "../../shared/protocol.js";
import { originalItem } from "../../client/src/items/inventory-action-rules.js";
import { itemStackLimit } from "../../client/src/items/inventory-model.js";
import { DROP_POLICY } from "../../client/src/world/drop-rules.js";
import {
  MAX_FIELD_DROPS,
  prepareFieldDrop,
  publishFieldDrop,
} from "./field-drops.js";

function conjuredItem(world, actor, action) {
  const template = originalItem(world.content.items, action.itemId);
  if (action.quantity > itemStackLimit(template)) {
    throw protocolError("INVALID_MESSAGE");
  }
  if (actor.profile.hp <= 0 || actor.tradeId || actor.field.paused) {
    throw protocolError("NOT_ALLOWED");
  }
  return {
    uid: randomUUID(),
    id: template.id,
    count: action.quantity,
    slot: 1,
    owner: "",
    flags: 0,
    expiresAt: null,
  };
}

/** GM-created items use ordinary field entitlements, recipient motion and atomic pickup. */
export async function conjureDevelopmentItem(world, actor, action, operation) {
  const field = actor.field;
  if (field.drops.size + field.dropReservations >= MAX_FIELD_DROPS) {
    throw protocolError("SERVER_BUSY");
  }
  const item = conjuredItem(world, actor, action);
  const drop = prepareFieldDrop(world, actor, {
    item,
    durableEntitlement: true,
    source: {
      x: actor.simulation.x + actor.simulation.facing * DROP_POLICY.spread,
      y: actor.simulation.y,
    },
  });
  field.dropReservations++;
  try {
    const receipt = await world.database.commit(actor, operation, () => ({
      value: {
        kind: "development.conjure",
        dropId: drop.id,
        itemId: item.id,
        quantity: item.count,
      },
      grantEntitlements: [{ id: drop.id, kind: "drop" }],
    }));
    if (receipt.status === "committed" && receipt.value?.dropId === drop.id) {
      publishFieldDrop(field, drop, world.now);
      world.invalidateField(field);
    }
    return receipt;
  } finally {
    field.dropReservations--;
  }
}
