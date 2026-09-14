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
  gatherInventory,
} from "../../client/src/items/inventory-action-rules.js";
import {
  applyEnhancement,
  enhancementPlan,
} from "../../client/src/items/equipment-enhancement.js";
import { creditDrop, debitMesos } from "../../client/src/world/drop-system.js";
import { DROP_POLICY } from "../../client/src/world/drop-rules.js";
import { LEGENDARY_SPIRIT_SKILLS } from "../../client/src/skills/skill-utility-rules.js";
import { profileSkillLevel } from "../../client/src/skills/skill-allocation-rules.js";
import {
  MAX_FIELD_DROPS,
  dropGround,
  prepareFieldDrop,
  publishFieldDrop,
  ownsDrop,
} from "./field-drops.js";
import {
  preparePickupEffect,
  applyPickupEffect,
  publishPickupEffect,
  releasePickupEffect,
} from "./pickup-effects.js";
import {
  admitActor,
  availableMesos,
  ownedItem,
  reject,
  ruleError,
  createServerRandom,
} from "./action-rules.js";
import { useItem } from "./action-character.js";

import { executePetUse } from "./action-pets.js";

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

function gather(profile, action, context) {
  const type = TABS.indexOf(action.tab) + 1;
  for (const item of profile.inventory) {
    if (inventoryType(item.id) === type) {
      ownedItem(profile, context.actor, item.uid, context.now);
    }
  }
  gatherInventory(profile, context.items, { type });
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
    kind: "equipment.enhancement",
    outcome: applyEnhancement(profile, context.items, request, context.random),
  };
}

function mutateInventory(profile, action, context) {
  switch (action.kind) {
    case "inventory.move":
      move(profile, action, context);
      break;
    case "inventory.gather":
      gather(profile, action, context);
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
  if (message.action.kind === "item.use") {
    const item = actor.profile.inventory.find(
      (entry) => entry.uid === message.action.itemId,
    );
    if (item && Math.floor(item.id / 10000) === 500) {
      return executePetUse(actor, message, world, operation);
    }
  }
  const context = {
    actor,
    now: world.now,
    items: world.content.items,
    world,
    random: createServerRandom(),
  };
  const field = actor.field;
  const receipt = await world.participants.commit(
    actor,
    operation,
    [actor.id],
    async (profiles) => {
      const profile = profiles.get(actor.id);
      try {
        admitActor(actor, world, message.fieldEpoch);
        context.now = world.now;
        const result = mutateInventory(profile, message.action, context);
        availableMesos(profile, actor);
        return result;
      } catch (error) {
        throw ruleError(error);
      }
    },
  );
  if (
    receipt.status === "committed" &&
    receipt.applied &&
    receipt.value?.kind === "equipment.enhancement"
  ) {
    world.broadcast(field, {
      type: "event",
      fieldEpoch: field.epoch,
      event: {
        kind: "equipment.enhancement",
        eventId: operation.operationId,
        actorId: actor.id,
        outcome: receipt.value.outcome,
      },
    });
  }
  return receipt;
}

function createDropDebit(profile, action, context) {
  if (action.kind === "mesos.drop") {
    debitMesos(profile, action.amount);
    availableMesos(profile, context.actor);
    return { mesos: action.amount, disappearing: false };
  }
  const item = ownedItem(profile, context.actor, action.itemId, context.now);
  const template = originalItem(context.items, item.id);
  const disappearing = disappearingDrop(item, template);
  if (disappearing && action.confirmedDiscard !== true) {
    reject(
      "NOT_ALLOWED",
      "Discard requires the original irreversible-item confirmation.",
    );
  }
  return {
    disappearing,
    item: debitItemDrop(profile, context.items, {
      uid: item.uid,
      count: action.quantity,
      dropUid: context.itemId,
      temporary: context.actor.temporaryStats?.derived,
    }),
  };
}

async function commitDropDebit(profile, context) {
  const { actor, message, world, id, source, ground } = context;
  admitActor(actor, world, message.fieldEpoch);
  context.now = world.now;
  const debit = createDropDebit(profile, message.action, context);
  context.prepared = prepareFieldDrop(world, actor, {
    ...debit,
    id,
    playerDrop: true,
    source,
    ground,
    createdAt: context.now,
    durableEntitlement: !debit.disappearing,
  });
  return {
    value: {
      kind: "drop.dispatched",
      dropId: id,
      itemId: debit.item?.id ?? 0,
      quantity: debit.item?.count ?? debit.mesos,
      disappearing: debit.disappearing,
    },
    grantEntitlements: debit.disappearing ? [] : [{ id, kind: "drop" }],
  };
}

/** Reserve capacity, commit debit, then publish exactly that prepared receipt; discard grants nothing. */
export async function executeDrop(actor, message, world, operation) {
  const field = actor.field;
  if (field.drops.size + field.dropReservations >= MAX_FIELD_DROPS) {
    reject("SERVER_BUSY", "The field drop capacity is reserved.");
  }
  const source = { x: actor.simulation.x, y: actor.simulation.y };
  const context = {
    actor,
    message,
    world,
    source,
    id: crypto.randomUUID(),
    now: world.now,
    items: world.content.items,
    itemId: crypto.randomUUID(),
    ground: dropGround(field, source),
    prepared: null,
  };
  field.dropReservations++;
  try {
    const receipt = await world.participants.commit(
      actor,
      operation,
      [actor.id],
      async (profiles) => {
        const profile = profiles.get(actor.id);
        try {
          return await commitDropDebit(profile, context);
        } catch (error) {
          throw ruleError(error);
        }
      },
    );
    if (
      receipt.status === "committed" &&
      receipt.value?.dropId === context.id
    ) {
      publishFieldDrop(field, context.prepared, world.now);
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
  if (drop.disappearing || !drop.durableEntitlement) {
    reject("NOT_ALLOWED", "The drop has no recoverable entitlement.");
  }
  if (drop.state !== "grounded") {
    reject("NOT_ALLOWED", "The drop has not reached the ground.");
  }
  if (!ownsDrop(actor, drop, now)) {
    reject("NOT_ALLOWED", "The drop remains owned by another character.");
  }
  if (
    Math.abs(actor.simulation.x - drop.groundX) > DROP_POLICY.pickupX ||
    Math.abs(actor.simulation.y - drop.groundY) > DROP_POLICY.pickupY
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

function pickupCredit(profile, drop, context) {
  const { actor, world, prepared, pickupId } = context;
  const itemId = drop.item?.id ?? 0;
  const reserved = reservedPickupStacks(profile, actor);
  const card =
    creditDrop(
      profile,
      {
        itemId,
        quantity: drop.item?.count ?? drop.mesos,
        instance: drop.item,
        questId: drop.questId ?? 0,
      },
      world.content.items,
      world.content.catalog.ui.monsterBook,
    ) ?? null;
  const effect = applyPickupEffect(profile, actor, prepared, world.now);
  admitPickupStacks(reserved);
  const value = {
    kind: "drop.collected",
    pickupId,
    dropId: drop.id,
    itemId,
    quantity: drop.item?.count ?? drop.mesos,
    card,
    effect,
  };
  return {
    value,
    consumeEntitlements: [{ id: drop.id, kind: "drop" }],
    events: pickupObservations(actor, value),
  };
}

function pickupObservations(actor, value) {
  const identity = { actorId: actor.id, dropId: value.dropId };
  const events = [];
  if (value.card) {
    events.push({
      kind: "drop.card",
      eventId: crypto.randomUUID(),
      ...identity,
      ...value.card,
    });
  }
  if (!value.card) {
    events.push({
      kind: "drop.gain",
      eventId: crypto.randomUUID(),
      ...identity,
      itemId: value.itemId,
      quantity: value.quantity,
    });
  }
  if (
    value.effect &&
    (value.effect.hp || value.effect.mp || value.effect.effectId)
  ) {
    events.push({
      kind: "drop.effect",
      eventId: crypto.randomUUID(),
      ...identity,
      ...value.effect,
    });
  }
  return events;
}

function publishPickup(world, actor, drop, receipt) {
  const field = actor.field;
  world.broadcast(field, {
    type: "event",
    fieldEpoch: field.epoch,
    event: {
      kind: "drop.pickup",
      eventId: receipt.value.pickupId,
      dropId: drop.id,
      actorId: actor.id,
      position: { x: drop.groundX, y: drop.groundY },
      impactTick: field.tick,
    },
  });
  for (const event of receipt.events) {
    world.publish(actor, { type: "event", fieldEpoch: field.epoch, event });
  }
  field.drops.delete(drop.id);
}

/** Ground reservation and durable entitlement consumption fence both same-op replay and peer races. */
export async function executePickup(actor, message, world, operation) {
  const field = actor.field;
  const drop = field.drops.get(message.action.dropId);
  admitPickup(actor, drop, world.now);
  if (drop.reservation) {
    reject("SERVER_BUSY", "The drop is already being collected.");
  }
  drop.reservation = operation.operationId;
  const context = {
    actor,
    world,
    prepared: null,
    pickupId: crypto.randomUUID(),
  };
  try {
    context.prepared = await preparePickupEffect(world, actor, drop);
    const receipt = await world.participants.commit(
      actor,
      operation,
      [actor.id],
      async (profiles) => {
        const profile = profiles.get(actor.id);
        try {
          admitActor(actor, world, message.fieldEpoch);
          if (
            field.drops.get(drop.id) !== drop ||
            drop.reservation !== operation.operationId
          ) {
            reject("NOT_FOUND", "The drop ownership changed.");
          }
          admitPickup(actor, drop, world.now);
          const result = pickupCredit(profile, drop, context);
          return result;
        } catch (error) {
          throw ruleError(error);
        }
      },
    );
    if (
      receipt.status === "committed" &&
      receipt.value?.pickupId === context.pickupId
    ) {
      publishPickupEffect(context.prepared);
      publishPickup(world, actor, drop, receipt);
    }
    return receipt;
  } finally {
    releasePickupEffect(context.prepared);
    drop.reservation = null;
  }
}
