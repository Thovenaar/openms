import {
  inventoryType,
  slotItem,
} from "../../client/src/items/inventory-model.js";
import {
  moveInventory,
  equipInventory,
  unequipInventory,
  originalItem,
  disappearingDrop,
  debitItemDrop,
} from "../../client/src/items/inventory-action-rules.js";
import {
  applyEnhancement,
  enhancementPlan,
} from "../../client/src/items/equipment-enhancement.js";
import {
  DROP_POLICY,
  creditDrop,
  debitMesos,
} from "../../client/src/world/drop-system.js";
import { isPickupItem } from "../../client/src/items/item-effects.js";
import { LEGENDARY_SPIRIT_SKILLS } from "../../client/src/skills/skill-utility-rules.js";
import { profileSkillLevel } from "../../client/src/skills/skill-allocation-rules.js";
import { MAX_FIELD_DROPS, dropGround } from "./field-drops.js";
import {
  admitActor,
  availableMesos,
  ownedItem,
  reject,
  ruleError,
  createServerRandom,
} from "./action-rules.js";
import { useItem } from "./action-character.js";

const TABS = ["equip", "use", "setup", "etc", "cash"];

function move(profile, action, context) {
  const source = ownedItem(profile, context.actor, action.itemId, context.now);
  const type = TABS.indexOf(action.to.tab) + 1;
  const target = slotItem(profile, type, action.to.slot);
  if (target) ownedItem(profile, context.actor, target.uid, context.now);
  if (type !== inventoryType(source.id)) {
    reject("NOT_ALLOWED", "Inventory category cannot change.");
  }
  if (
    !moveInventory(profile, context.items, {
      uid: source.uid,
      count: action.quantity,
      type,
      slot: action.to.slot,
    })
  ) {
    reject("NOT_ALLOWED", "The destination cannot accept this move.");
  }
}

function equipment(profile, action, context) {
  ownedItem(profile, context.actor, action.itemId, context.now);
  // Swaps and two-handed/overall conflicts can move a second equipped instance.
  const equipped = profile.equipment.map((item) => ({ item, slot: item.slot }));
  if (action.kind === "equipment.equip") {
    if (action.slot === 0) {
      reject("NOT_ALLOWED", "Equipment slots are positive wire identities.");
    }
    equipInventory(profile, context.items, {
      uid: action.itemId,
      slot: -action.slot,
      temporary: context.actor.temporaryStats?.derived,
    });
  } else {
    unequipInventory(profile, context.items, {
      uid: action.itemId,
      slot: action.toSlot,
      temporary: context.actor.temporaryStats?.derived,
    });
  }
  for (const previous of equipped) {
    if (previous.item.slot !== previous.slot) {
      ownedItem(profile, context.actor, previous.item.uid, context.now);
    }
  }
}

function scroll(profile, action, context) {
  ownedItem(profile, context.actor, action.scrollId, context.now);
  ownedItem(profile, context.actor, action.equipmentId, context.now);
  if (action.protectionId) {
    ownedItem(profile, context.actor, action.protectionId, context.now);
  }
  const request = {
    scrollUid: action.scrollId,
    equipUid: action.equipmentId,
    whiteScroll: action.protectionId !== undefined,
    whiteScrollUid: action.protectionId,
    temporary: context.actor.temporaryStats?.derived,
  };
  const plan = enhancementPlan(profile, context.items, request);
  if (action.protectionId && plan.white?.uid !== action.protectionId) {
    reject(
      "REQUIREMENTS_NOT_MET",
      "This scroll has no compatible protection mode.",
    );
  }
  const spirit = LEGENDARY_SPIRIT_SKILLS.some(
    (id) =>
      profileSkillLevel(
        context.world.content.catalog.ui.skills,
        profile,
        id,
        context.now,
      ) > 0,
  );
  if (plan.equipment.slot > 0 && !spirit) {
    reject(
      "REQUIREMENTS_NOT_MET",
      "Inventory scrolling requires learned Legendary Spirit.",
    );
  }
  return {
    outcome: applyEnhancement(profile, context.items, request, context.random),
  };
}

function mutateInventory(profile, action, context) {
  switch (action.kind) {
    case "inventory.move":
      move(profile, action, context);
      break;
    case "equipment.equip":
    case "equipment.unequip":
      equipment(profile, action, context);
      break;
    case "equipment.scroll":
      return { value: scroll(profile, action, context) };
    case "item.use":
      return useItem(profile, action, context);
    default:
      reject("INVALID_MESSAGE", "Not an inventory mutation.");
  }
  return {};
}

/** Every mutator reruns inventory, location, lock and active-field admission on its isolated draft. */
export async function executeInventory(actor, message, world, operation) {
  const context = {
    actor,
    now: world.now,
    items: world.content.items,
    world,
    random: createServerRandom(),
  };
  return world.database.commit(actor, operation, (profile) => {
    try {
      admitActor(actor, world, message.fieldEpoch);
      context.now = world.now;
      const result = mutateInventory(profile, message.action, context);
      availableMesos(profile, actor);
      return result;
    } catch (error) {
      throw ruleError(error);
    }
  });
}

function createDropDebit(profile, action, context) {
  if (action.kind === "mesos.drop") {
    debitMesos(profile, action.amount);
    availableMesos(profile, context.actor);
    return { mesos: action.amount };
  }
  const item = ownedItem(profile, context.actor, action.itemId, context.now);
  const template = originalItem(context.items, item.id);
  if (disappearingDrop(item, template)) {
    reject(
      "NOT_ALLOWED",
      "Restricted or quest-protected items cannot become online ground drops.",
    );
  }
  return {
    item: debitItemDrop(profile, context.items, {
      uid: item.uid,
      count: action.quantity,
      dropUid: context.itemId,
      temporary: context.actor.temporaryStats?.derived,
    }),
  };
}

/** Reserve field capacity first; publish only a committed debit, once per durable receipt. */
export async function executeDrop(actor, message, world, operation) {
  const field = actor.field;
  if (field.drops.size + field.dropReservations >= MAX_FIELD_DROPS) {
    reject("SERVER_BUSY", "The field drop capacity is reserved.");
  }
  const id = crypto.randomUUID();
  const context = {
    actor,
    now: world.now,
    items: world.content.items,
    itemId: crypto.randomUUID(),
  };
  const source = { x: actor.simulation.x, y: actor.simulation.y };
  const ground = dropGround(field, source);
  field.dropReservations++;
  try {
    const receipt = await world.database.commit(actor, operation, (profile) => {
      try {
        admitActor(actor, world, message.fieldEpoch);
        context.now = world.now;
        const value = createDropDebit(profile, message.action, context);
        return {
          value: {
            ...value,
            id,
            ownerId: actor.id,
            createdAt: context.now,
            durableEntitlement: true,
          },
          grantEntitlements: [{ id, kind: "drop" }],
        };
      } catch (error) {
        throw ruleError(error);
      }
    });
    if (receipt.status === "committed" && receipt.value?.id === id) {
      world.createDrop(actor, { ...receipt.value, source, ground });
    }
    return receipt;
  } finally {
    field.dropReservations--;
  }
}

function admitPickup(actor, drop, now) {
  if (!drop || drop.expiresAt <= now) {
    reject("NOT_FOUND", "The ground drop expired.");
  }
  if (drop.state !== "grounded") {
    reject("NOT_ALLOWED", "The drop has not reached the ground.");
  }
  if (
    drop.ownerId &&
    drop.ownerId !== actor.id &&
    (drop.ownerUntil === undefined || drop.ownerUntil > now)
  ) {
    reject("NOT_ALLOWED", "The drop remains owned by another character.");
  }
  if (
    Math.abs(actor.simulation.x - drop.position.x) > DROP_POLICY.pickupX ||
    Math.abs(actor.simulation.y - drop.position.y) > DROP_POLICY.pickupY
  ) {
    reject("NOT_IN_RANGE", "The server character is outside pickup geometry.");
  }
}

/** Preserve the draft stack identities so pickup cannot alter trade-reserved quantities. */
function reservedPickupStacks(profile, actor) {
  const reserved = [];
  for (const item of profile.inventory) {
    if (actor.itemLocks?.has(item.uid)) {
      reserved.push({ item, count: item.count });
    }
  }
  return reserved;
}

function admitPickupStacks(reserved) {
  for (const entry of reserved) {
    if (entry.item.count !== entry.count) {
      reject("NOT_ALLOWED", "The pickup would modify a trade-reserved stack.");
    }
  }
}

function pickupCredit(profile, drop, items, actor) {
  const itemId = drop.item?.id ?? 0;
  if (
    itemId &&
    (isPickupItem(items[itemId]) || Math.floor(itemId / 10000) === 238)
  ) {
    reject(
      "REQUIREMENTS_NOT_MET",
      "Automatic pickup effects and card entitlements require their dedicated authoritative controller.",
    );
  }
  const reserved = reservedPickupStacks(profile, actor);
  creditDrop(
    profile,
    {
      itemId,
      quantity: drop.item?.count ?? drop.mesos,
      instance: drop.item,
      questId: drop.questId ?? 0,
    },
    items,
    null,
  );
  admitPickupStacks(reserved);
  const result = { consumeEntitlements: [{ id: drop.id, kind: "drop" }] };
  if (!drop.durableEntitlement) {
    result.grantEntitlements = [{ id: drop.id, kind: "drop" }];
  }
  return result;
}

/** A field reservation and durable consumed entitlement protect distinct-operation pickup races. */
export async function executePickup(actor, message, world, operation) {
  const field = actor.field;
  const drop = field.drops.get(message.action.dropId);
  admitPickup(actor, drop, world.now);
  if (drop.reservation) {
    reject("SERVER_BUSY", "The drop is already being collected.");
  }
  drop.reservation = operation.operationId;
  try {
    const receipt = await world.database.commit(actor, operation, (profile) => {
      try {
        admitActor(actor, world, message.fieldEpoch);
        if (
          field.drops.get(drop.id) !== drop ||
          drop.reservation !== operation.operationId
        ) {
          reject("NOT_FOUND", "The drop ownership changed.");
        }
        admitPickup(actor, drop, world.now);
        return pickupCredit(profile, drop, world.content.items, actor);
      } catch (error) {
        throw ruleError(error);
      }
    });
    if (receipt.status === "committed") field.drops.delete(drop.id);
    return receipt;
  } finally {
    drop.reservation = null;
  }
}
