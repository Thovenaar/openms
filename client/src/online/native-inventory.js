import { inventoryType } from "../items/inventory-model.js";
import { unsupported } from "./native-source.js";
import {
  disappearingDrop,
  itemDropWarning,
} from "../items/inventory-action-rules.js";
import { enhancementPlan } from "../items/equipment-enhancement.js";

const TABS = [null, "equip", "use", "setup", "etc", "cash"];

/** Item identities are opaque server instance IDs; adapters never rewrite observed slots. */
export class NativeInventory {
  constructor(owner) {
    this.owner = owner;
    this.destroyed = false;
  }
  item(uid) {
    const profile = this.owner.store.profile;
    const item =
      profile.inventory.find((entry) => entry.uid === uid) ??
      profile.equipment.find((entry) => entry.uid === uid);
    if (!item) {
      throw new Error("The server no longer publishes this item instance.");
    }
    return item;
  }
  use(request, uid = null) {
    if (this.destroyed) {
      return Promise.resolve(unsupported("activation after teardown"));
    }
    let item;
    if (typeof request === "number") {
      item = uid
        ? this.item(uid)
        : this.owner.store.profile.inventory.find(
            (entry) => entry.id === request,
          );
      if (!item) {
        return Promise.resolve({
          ok: false,
          reason: "No observed inventory instance is available.",
        });
      }
      request = { uid: item.uid };
    } else item = this.item(request.uid);
    if (Math.floor(item.id / 10000) === 516) {
      return this.owner.worldActions.useCashExpression(item.id);
    }
    if (item.slot < 0) return this.unequip(request);
    if (inventoryType(item.id) === 1) return this.equip(request);
    return this.owner.request({ kind: "item.use", itemId: item.uid });
  }
  async equip(request) {
    const item = this.item(request.uid);
    if (
      this.owner.catalog.ui.items[item.id]?.info.equipTradeBlock === 1 &&
      !(item.flags & 8) &&
      (await this.owner.ui.prompt({
        kind: "confirm",
        text: "You cannot trade this item after equipping.\r\n Do you still wish to equip?",
        owner: this,
      })) !== true
    )
      {return { ok: false, code: "cancelled" };}
    if (this.destroyed) return unsupported("activation after teardown");
    const slot =
      request.slot ??
      this.owner.catalog.ui.avatar.entries[item.id]?.equippedSlots?.[0];
    if (!Number.isInteger(slot)) {
      return Promise.resolve(unsupported("an equipment slot for this item"));
    }
    return this.owner.request({
      kind: "equipment.equip",
      itemId: item.uid,
      slot: Math.abs(slot),
    });
  }
  unequip(request) {
    const profile = this.owner.store.profile;
    let slot = request.slot;
    if (slot === undefined) {
      slot = 1;
      while (
        slot <= profile.inventorySlots[0] &&
        this.occupiedEquipmentSlot(profile, slot)
      ) {
        slot++;
      }
      if (slot > profile.inventorySlots[0]) {
        return Promise.resolve({
          ok: false,
          reason: "The equipment inventory is full.",
        });
      }
    }
    return this.owner.request({
      kind: "equipment.unequip",
      itemId: request.uid,
      toSlot: slot,
    });
  }
  occupiedEquipmentSlot(profile, slot) {
    return profile.inventory.some(
      (entry) => inventoryType(entry.id) === 1 && entry.slot === slot,
    );
  }
  move(request) {
    const item = this.item(request.uid);
    return this.owner.request({
      kind: "inventory.move",
      itemId: item.uid,
      quantity: request.count ?? item.count,
      to: { tab: TABS[request.type], slot: request.slot },
    });
  }
  async drop(request) {
    const item = this.item(request.uid);
    const template = this.owner.catalog.ui.items[item.id];
    let discard;
    try {
      discard = disappearingDrop(item, template);
    } catch (error) {
      return { ok: false, reason: error.message };
    }
    if (
      discard &&
      (await this.owner.ui.prompt({
        kind: "confirm",
        text: itemDropWarning(item, template),
        owner: this,
      })) !== true
    )
      {return { ok: false, code: "cancelled" };}
    if (this.destroyed) return unsupported("activation after teardown");
    return this.owner.request({
      kind: "item.drop",
      itemId: request.uid,
      quantity: request.count,
      ...(discard ? { confirmedDiscard: true } : {}),
    });
  }
  gather(type) {
    return this.owner.request({ kind: "inventory.gather", tab: TABS[type] });
  }
  async enhance(request) {
    let plan;
    try {
      plan = enhancementPlan(
        this.owner.store.profile,
        this.owner.catalog.ui.items,
        request,
      );
    } catch (error) {
      return { ok: false, reason: error.message };
    }
    const result = await this.owner.request({
      kind: "equipment.scroll",
      scrollId: request.scrollUid,
      equipmentId: request.equipUid,
      ...(plan.white ? { protectionId: plan.white.uid } : {}),
    });
    if (!result.ok) return result;
    const value = result.receipt?.value;
    if (value?.kind !== "equipment.enhancement") {
      return {
        ok: false,
        code: "OUTCOME_UNKNOWN",
        reason: "The server did not publish the enhancement outcome.",
        receipt: result.receipt,
      };
    }
    return { ...result, outcome: value.outcome };
  }
  destroy() {
    this.destroyed = true;
  }
}
