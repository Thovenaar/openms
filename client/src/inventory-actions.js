import { profileError } from "./profile-validation.js";
import { inventoryType } from "./inventory-model.js";
import {
  admitItem,
  equipInventory,
  gatherInventory,
  moveInventory,
  selectedItem,
  unequipInventory,
} from "./inventory-action-rules.js";

function failed(error) {
  return {
    ok: false,
    code: error.code ?? "inventory-failed",
    reason: error.message,
  };
}

/** Native004ef140/00a0900a: carry is presentation only. All methods are terminal intents.
 * Main holds the field/profile lease while pending. Appearance preparation owns its resources
 * until publishAppearance transfers ownership or releaseAppearance discards them.
 * Publication/release/onError hooks must be synchronous and nonthrowing. */
export class InventoryActions {
  constructor(store, catalog, hooks = {}) {
    this.store = store;
    this.items = catalog.ui.items;
    this.hooks = hooks;
    this.pending = false;
    this.destroyed = false;
  }

  admit() {
    if (this.destroyed || this.hooks.isCurrent?.() === false) {
      throw profileError("field-cancelled", "The field is no longer current.");
    }
    if (
      this.pending ||
      this.store.profileTransactionPending ||
      this.hooks.isBusy?.()
    ) {
      throw profileError(
        "inventory-busy",
        "An item action is already pending.",
      );
    }
  }
  async move(request) {
    try {
      const item = selectedItem(this.store.profile, request?.uid);
      if (request.type !== inventoryType(item.id)) {
        throw profileError(
          "wrong-inventory",
          "Choose the same inventory category.",
        );
      }
      if (request.slot < 0) return await this.equip(request);
      if (item.slot < 0) return await this.unequip(request);
      return await this.mutate(request, moveInventory, false);
    } catch (error) {
      return failed(error);
    }
  }

  async equip(request) {
    return this.mutate(request, equipInventory, true);
  }

  async unequip(request) {
    return this.mutate(request, unequipInventory, true);
  }

  async gather(type) {
    return this.mutate({ type }, gatherInventory, false);
  }

  async mutate(request, transform, appearance) {
    let prepared = null;
    let committed = false;
    let ownsPending = false;
    try {
      this.admit();
      const input = { ...request };
      const before = JSON.stringify(this.store.profile);
      const draft = structuredClone(this.store.profile);
      if (!transform(draft, this.items, input)) {
        return { ok: true, code: "unchanged" };
      }
      this.pending = true;
      ownsPending = true;
      if (transform === equipInventory) await this.confirmEquipment(input.uid);
      if (appearance) prepared = await this.prepareAppearance(draft);
      this.#admitPreparedCommit(before);
      await this.store.commitProfile((current) => {
        transform(current, this.items, input);
      });
      committed = true;
      if (prepared) this.publishAppearance(prepared);
    } catch (error) {
      return failed(error);
    } finally {
      if (prepared && !committed) this.hooks.releaseAppearance(prepared);
      if (ownsPending) this.pending = false;
    }
    return { ok: true, code: "inventory-updated", uid: request.uid };
  }

  #admitPreparedCommit(before) {
    if (this.destroyed || this.hooks.isCurrent?.() === false) {
      throw profileError("field-cancelled", "The item action was cancelled.");
    }
    if (JSON.stringify(this.store.profile) !== before) {
      throw profileError(
        "inventory-changed",
        "Your character changed while preparing this item.",
      );
    }
  }

  /** Native004f1c2d final string0x363 warns before first equip; No never sends ItemMove. */
  async confirmEquipment(uid) {
    const item = selectedItem(this.store.profile, uid);
    if (
      this.items[item.id].info.equipTradeBlock !== 1 ||
      (item.flags & 8) !== 0
    ) {
      return;
    }
    if (typeof this.hooks.confirmEquipment !== "function") {
      throw profileError(
        "equipment-confirmation-required",
        "You cannot trade this item after equipping.",
      );
    }
    if ((await this.hooks.confirmEquipment({ ...item })) !== true) {
      throw profileError("cancelled", "Equipment change cancelled.");
    }
  }

  async prepareAppearance(draft) {
    if (
      typeof this.hooks.prepareAppearance !== "function" ||
      typeof this.hooks.publishAppearance !== "function" ||
      typeof this.hooks.releaseAppearance !== "function"
    ) {
      throw profileError(
        "appearance-unavailable",
        "Original character appearance preparation is unavailable.",
      );
    }
    const prepared = await this.hooks.prepareAppearance(draft);
    if (!prepared) {
      throw profileError(
        "appearance-unavailable",
        "Character appearance preparation was cancelled.",
      );
    }
    return prepared;
  }

  publishAppearance(prepared) {
    try {
      this.hooks.publishAppearance(prepared);
    } catch (error) {
      this.lastPublicationError = error.message;
    }
  }

  async drop(request) {
    let ownsPending = false;
    try {
      this.admit();
      if (typeof this.hooks.dropItem !== "function") {
        throw profileError(
          "drop-unavailable",
          "The current field cannot prepare this item drop.",
        );
      }
      this.pending = true;
      ownsPending = true;
      return await this.hooks.dropItem({ ...request });
    } catch (error) {
      return failed(error);
    } finally {
      if (ownsPending) this.pending = false;
    }
  }

  async use(request) {
    let ownsPending = false;
    try {
      this.admit();
      const item = selectedItem(this.store.profile, request.uid);
      admitItem(this.store.profile, item);
      if (inventoryType(item.id) === 1) {
        return item.slot < 0
          ? await this.unequip({ uid: item.uid })
          : await this.equip({ uid: item.uid });
      }
      if (typeof this.hooks.useItem !== "function") {
        throw profileError(
          "item-use-unavailable",
          "This item has no admitted use authority.",
        );
      }
      this.pending = true;
      ownsPending = true;
      return await this.hooks.useItem(item.id, item.uid);
    } catch (error) {
      return failed(error);
    } finally {
      if (ownsPending) this.pending = false;
    }
  }

  destroy() {
    if (this.pending) {
      throw profileError(
        "inventory-busy",
        "Await the item action before closing its field.",
      );
    }
    this.destroyed = true;
  }
}
