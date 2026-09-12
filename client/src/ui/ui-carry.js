import { itemBindingType } from "../input/keymap.js";
import { inventoryType, slotItem } from "../items/inventory-model.js";
import { dropEnhancementItem, enhancementResult } from "./ui-enhancement.js";

export function carriedInstance(owner, drag = owner.bindingDrag) {
  if (!drag?.uid || !owner.store?.profile) return null;
  const profile = owner.store.profile;
  return (
    profile.inventory.find((item) => item.uid === drag.uid) ??
    profile.equipment.find((item) => item.uid === drag.uid) ??
    null
  );
}

/** Inventory carry records identity only; all slot/currency changes belong to controllers. */
export function beginItemCarry(owner, event, entry, visual) {
  if (
    event.button !== 0 ||
    owner.blocksGameplay() ||
    owner.bindingDrag ||
    owner.drag ||
    owner.hooks.isOperationPending?.()
  ) {
    return false;
  }
  if (!visual?.source?.entities.has(visual.path)) return false;
  const instance =
    owner.store.profile.inventory.find((item) => item.uid === entry.uid) ??
    owner.store.profile.equipment.find((item) => item.uid === entry.uid);
  if (!instance) return false;
  event.preventDefault();
  owner.hooks.clearInput();
  owner.carryBinding(
    event,
    { type: itemBindingType(owner.index.items[entry.id]), id: entry.id },
    null,
    visual,
  );
  owner.bindingDrag.uid = entry.uid;
  owner.sound("DragStart");
  return true;
}

export async function useInventoryItem(owner, entry) {
  if (owner.hooks.isOperationPending?.()) return false;
  try {
    const result = await owner.hooks.inventoryActions().use({ uid: entry.uid });
    if (!result.ok && result.code !== "cancelled") owner.status(result.reason);
    return result.ok;
  } catch (error) {
    owner.report(error);
    return false;
  }
}

function physicalDestination(owner, element, instance) {
  const inventory = owner.windows.get("Item");
  if (inventory?.element.contains(element)) {
    const slot = element.closest("[data-item-slot]");
    if (!slot) return null;
    return {
      kind: "inventory",
      type: Number(slot.dataset.inventoryType ?? inventory.selectedTab + 1),
      slot: Number(slot.dataset.itemSlot),
    };
  }
  const equipment = owner.windows.get("Equip");
  if (equipment?.element.contains(element)) {
    return equipmentDestination(owner, element, instance);
  }
  if (element === owner.app.canvas && inventoryType(instance.id) > 0) {
    return { kind: "ground" };
  }
  return null;
}

function equipmentDestination(owner, element, instance) {
  if (element.closest("[data-pet-equipment]")) return null;
  const slot = element.closest("[data-item-slot]");
  const signed = slot ? Number(slot.dataset.itemSlot) : undefined;
  if (Math.trunc(instance.id / 10000) === 204) {
    const equipment = slotItem(owner.store.profile, 1, signed);
    return equipment ? { kind: "scroll", equipUid: equipment.uid } : null;
  }
  const body = signed < -100 ? signed + 100 : signed;
  return {
    kind: "equip",
    slot:
      body === undefined
        ? undefined
        : body - (owner.index.items[instance.id]?.info.cash === 1 ? 100 : 0),
  };
}

function itemDestination(owner, element, instance) {
  const enhancement = owner.windows.get("EnchantSkill");
  if (enhancement?.element.contains(element)) {
    return { kind: "enhancement", panel: enhancement };
  }
  const trade = owner.windows.get("TradingRoom");
  if (trade?.element.contains(element)) {
    const slot = element.closest("[data-trade-slot]");
    return slot && Number(slot.dataset.tradeSide) === trade.tradeSide
      ? { kind: "trade", panel: trade, slot: Number(slot.dataset.tradeSlot) }
      : null;
  }
  const shop = owner.windows.get("Shop");
  if (shop?.element.contains(element)) return { kind: "shop" };
  return physicalDestination(owner, element, instance);
}

async function performItemDrop(owner, instance, target) {
  if (target.kind === "enhancement") {
    return dropEnhancementItem(target.panel, instance);
  }
  if (target.kind === "scroll") {
    const result = await owner.hooks.skillUtilities().enhancement.enhance({
      equipUid: target.equipUid,
      scrollUid: instance.uid,
    });
    if (result.ok) owner.status(enhancementResult(result.outcome));
    return result;
  }
  const actions = owner.hooks.inventoryActions();
  if (target.kind === "equip") {
    return actions.equip({ uid: instance.uid, slot: target.slot });
  }
  if (target.kind === "inventory") {
    if (target.type !== inventoryType(instance.id)) {
      return {
        ok: false,
        code: "wrong-inventory",
        reason: "Choose the same inventory category.",
      };
    }
    return instance.slot < 0
      ? actions.unequip({ uid: instance.uid, slot: target.slot })
      : actions.move({
          uid: instance.uid,
          type: target.type,
          slot: target.slot,
        });
  }
  if (target.kind === "shop") {
    return owner.hooks.shop().sell({ uid: instance.uid });
  }
  if (target.kind === "trade") {
    return target.panel.offerCarriedItem({ uid: instance.uid }, target.slot);
  }
  return dropWorldItem(owner, instance, actions);
}

/** Ground quantity prompts belong to the world-drop intent, never slot placement. */
async function dropWorldItem(owner, instance, actions) {
  let count = instance.count;
  const group = Math.floor(instance.id / 10000);
  if (count > 1 && group !== 207 && group !== 233) {
    count = await owner.prompt({
      kind: "number",
      text: "How many will you drop?",
      value: count,
      min: 1,
      max: count,
      owner: actions,
    });
    if (count === null) return { ok: false, code: "cancelled" };
  }
  return actions.drop({ uid: instance.uid, count });
}

/** Returns false only when key/macro routing should inspect the same destination. */
export function dropCarriedItem(owner, event, element) {
  const drag = owner.bindingDrag;
  if (!drag?.uid) return false;
  const instance = carriedInstance(owner, drag);
  if (!instance) {
    owner.endBindingDrag();
    return true;
  }
  const target = itemDestination(owner, element, instance);
  if (!target) return false;
  if (owner.hooks.isOperationPending?.()) return true;
  // 009e37c2 clears the icon/cursor before invoking the destination, including its dialog.
  owner.endBindingDrag();
  finishItemDrop(owner, instance, target);
  return true;
}

async function finishItemDrop(owner, instance, target) {
  const store = owner.store;
  const epoch = owner.epoch;
  try {
    const result = await performItemDrop(owner, instance, target);
    if (!owner.ownsProfile(store, epoch)) return;
    if (result.ok) {
      owner.sound("DragEnd");
    } else if (result.code !== "cancelled") {
      owner.status(result.reason ?? "The item could not be moved.");
    }
  } catch (error) {
    if (owner.ownsProfile(store, epoch)) owner.report(error);
  }
}
