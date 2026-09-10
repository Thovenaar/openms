import {
  ACTION_PALETTE,
  bindingAction,
  canonicalKeyIndex,
  createDefaultBindings,
  heldActionForCode,
  isAssignableKey,
  itemBindingType,
  keyIndexForCode,
  KEY_COUNT,
} from "./keymap.js";
import { validateKeyBindings } from "./profile-validation.js";
import { ItemUse } from "./item-use.js";
import { itemCount } from "./inventory-model.js";

const MAX_LISTENERS = 64;

function sameBinding(a, b) {
  return a.type === b.type && a.id === b.id;
}

function sameMap(a, b) {
  for (let index = 0; index < KEY_COUNT; index++) {
    if (!sameBinding(a.keys[index], b.keys[index])) return false;
  }
  for (let slot = 0; slot < 8; slot++) {
    if (a.quickSlots[slot] !== b.quickSlots[slot]) return false;
  }
  return true;
}

function itemType(type) {
  return type === 2 || type === 3 || type === 7;
}

/** Shared active native map; only successful explicit Save publishes its durable counterpart. */
export class KeyBindings {
  constructor(store, catalog, hooks) {
    if (!store?.profile || !catalog?.ui?.items) {
      throw new TypeError(
        "Bindings require a loaded profile and item catalog.",
      );
    }
    for (const name of ["onAction", "isBlocked", "now", "report"]) {
      if (typeof hooks?.[name] !== "function") {
        throw new TypeError(`Missing binding hook: ${name}`);
      }
    }
    validateKeyBindings(store.profile.keyBindings);
    this.store = store;
    this.catalog = catalog;
    this.hooks = hooks;
    this.active = structuredClone(store.profile.keyBindings);
    this.committedReference = store.profile.keyBindings;
    this.editing = false;
    this.saving = false;
    this.destroyed = false;
    this.listeners = new Set();
    this.items = new ItemUse(store, catalog, hooks);
    this.lastSkillUse = null;
    this.lastItemUse = null;
    this.lastActionUse = null;
    this.lastMacroUse = null;
    this.onStoreChange = this._storeChanged.bind(this);
    this.unsubscribeStore = store.subscribe(this.onStoreChange);
  }

  _storeChanged() {
    const committed = this.store.profile?.keyBindings;
    if (!committed || committed === this.committedReference) return;
    this.committedReference = committed;
    if (!this.editing && !sameMap(this.active, committed)) {
      this.active = structuredClone(committed);
    }
    this._notify();
  }

  lookup(code) {
    const index = keyIndexForCode(code);
    if (index < 0 || this.destroyed) return null;
    const binding = this.active.keys[index];
    return binding.type === 0 ? null : binding;
  }

  actionForCode(code) {
    if (this.destroyed || this.hooks.isBlocked()) return null;
    return heldActionForCode(code, this.active);
  }

  activateCode(code) {
    if (this.destroyed || this.hooks.isBlocked()) return false;
    if (heldActionForCode(code, this.active)) {
      this.hooks.macros?.()?.interrupt();
      return false;
    }
    const index = keyIndexForCode(code);
    if (index < 0 || this.active.keys[index].type === 0) return false;
    this.activateKey(index);
    return true;
  }

  activateKey(index) {
    index = canonicalKeyIndex(index);
    if (index < 0 || this.destroyed || this.hooks.isBlocked()) return false;
    const binding = this.active.keys[index];
    if (binding.type === 0) return false;
    if (binding.type !== 8) this.hooks.macros?.()?.interrupt();
    if (binding.type === 2) return this.useItem(binding.id);
    if (binding.type === 8) {
      const result = this.hooks.macros().activate(binding.id);
      this.lastMacroUse = { id: binding.id, result };
      return result.ok;
    }
    if (binding.type === 1) return this.useSkill(binding.id);
    return this.activateNamedBinding(binding);
  }

  activateNamedBinding(binding) {
    if (binding.type === 3 && this.hooks.onCashExpression) {
      return this.hooks.onCashExpression(binding.id);
    }
    const action = bindingAction(binding);
    if (action) {
      const accepted = this.hooks.onAction(action);
      if (typeof accepted !== "boolean") {
        throw new TypeError("Binding authority must report boolean admission");
      }
      this.lastActionUse = { action, accepted };
      return accepted;
    }
    return this.rejectBinding(binding);
  }

  rejectBinding(binding) {
    const dependency =
      binding.type === 7
        ? "The original item-script/effect controller is not available."
        : "The original binding category or identifier is not supported.";
    this.hooks.report(dependency);
    this.lastActionUse = {
      type: binding.type,
      id: binding.id,
      accepted: false,
      dependency,
    };
    return false;
  }

  async useItem(id, uid = null) {
    if (this.destroyed) {
      return { ok: false, reason: "Binding owner was destroyed" };
    }
    const operation = this.items.use(id, uid);
    const use = { id, uid, pending: operation, result: null };
    this.lastItemUse = use;
    const result = await operation;
    use.result = result;
    use.pending = null;
    if (result.ok) {
      try {
        this.hooks.onSound?.("UI", "DragEnd");
      } catch (error) {
        console.error("Item completion sound failed", error);
      }
    }
    return result;
  }

  useSkill(id) {
    if (this.destroyed || this.hooks.isBlocked()) return false;
    if (!this._learned(id)) {
      this.hooks.report("This skill has no learned, unexpired rank.");
      return false;
    }
    if (typeof this.hooks.onSkill !== "function") {
      this.hooks.report("The field skill authority is unavailable.");
      return false;
    }
    const accepted = this.hooks.onSkill(id);
    if (typeof accepted !== "boolean") {
      throw new TypeError("Skill authority must report boolean admission");
    }
    this.lastSkillUse = { id, accepted };
    return accepted;
  }

  _learned(id) {
    const skill = this.store.profile.skills?.[id];
    return Boolean(
      skill?.level > 0 &&
      (skill.expiresAt === null || skill.expiresAt > Date.now()),
    );
  }

  beginEdit() {
    if (this.destroyed || this.saving) return false;
    if (this.editing) return true;
    this.active = structuredClone(this.store.profile.keyBindings);
    this.editing = true;
    this._notify();
    return true;
  }

  _canEdit() {
    return this.editing && !this.saving && !this.destroyed;
  }

  _available(binding) {
    if (
      !binding ||
      !Number.isInteger(binding.type) ||
      !Number.isSafeInteger(binding.id)
    ) {
      return false;
    }
    if (binding.type >= 4 && binding.type <= 6) {
      return ACTION_PALETTE.some((entry) => sameBinding(entry, binding));
    }
    if (binding.type === 1) return this._learned(binding.id);
    if (binding.type === 8) {
      return (
        binding.id >= 0 &&
        binding.id < 5 &&
        this.store.profile.skillMacros[binding.id].skills.some((id) => id > 0)
      );
    }
    // Original drag admission and real ownership, not whether an effect is implemented.
    return (
      itemType(binding.type) &&
      binding.type === itemBindingType(this.catalog.ui.items[binding.id]) &&
      itemCount(this.store.profile, binding.id) > 0
    );
  }

  /** 0083550d / 008d6409: owned items, learned nonpassive skills, or original actions. */
  canCarry(binding, sourceIndex = null) {
    if (this.saving || this.destroyed || this.store.profileTransactionPending) {
      return false;
    }
    if (!this._available(binding)) return false;
    if (binding.type === 1) {
      const family = Math.floor(binding.id / 1000) % 10;
      if (family === 0 || family === 9) return false;
    }
    if (sourceIndex === null) return true;
    const source = canonicalKeyIndex(sourceIndex);
    return source >= 0 && sameBinding(this.active.keys[source], binding);
  }

  /** 004f9386 / 004f38f4: normal key drops replace, globally clear duplicate sources. */
  assign(targetIndex, binding, sourceIndex = null) {
    if (!this._canEdit() || !this._assign(targetIndex, binding, sourceIndex)) {
      return false;
    }
    this._notify();
    return true;
  }

  /** Expanded native quickslots also accept placement outside the keyboard editor. */
  assignQuick(targetIndex, binding, sourceIndex = null) {
    const target = canonicalKeyIndex(targetIndex);
    if (
      this.hooks.isBlocked() ||
      !this.active.quickSlots.includes(target) ||
      !this._assign(target, binding, sourceIndex)
    ) {
      return false;
    }
    if (!this.editing) {
      const committed = structuredClone(this.active);
      this.store.profile.keyBindings = committed;
      this.committedReference = committed;
      this.store.markDirty();
    }
    this._notify();
    return true;
  }

  _assign(targetIndex, binding, sourceIndex) {
    if (!isAssignableKey(targetIndex) || !this.canCarry(binding, sourceIndex)) {
      return false;
    }
    const target = canonicalKeyIndex(targetIndex);
    if (sameBinding(this.active.keys[target], binding)) return false;
    const incoming = { type: binding.type, id: binding.id };
    this._clearMatching(incoming);
    this.active.keys[target] = incoming;
    return true;
  }

  /** Dropping a key back in the palette removes it; displaced actions become available automatically. */
  remove(index) {
    index = canonicalKeyIndex(index);
    if (!this._canEdit() || index < 0 || this.active.keys[index].type === 0) {
      return false;
    }
    this._clearMatching(this.active.keys[index]);
    this._notify();
    return true;
  }

  _clearMatching(binding) {
    const { type, id } = binding;
    for (let index = 0; index < KEY_COUNT; index++) {
      const current = this.active.keys[index];
      const matchingType =
        current.type === type || (itemType(type) && itemType(current.type));
      if (matchingType && current.id === id) current.type = 0;
    }
  }

  resetDefaults() {
    if (!this._canEdit()) return false;
    this.active = createDefaultBindings();
    this._notify();
    return true;
  }

  clearKeys() {
    if (!this._canEdit()) return false;
    for (const binding of this.active.keys) {
      binding.type = 0;
      binding.id = 0;
    }
    this._notify();
    return true;
  }

  setQuickSlot(slot, keyIndex) {
    keyIndex = canonicalKeyIndex(keyIndex);
    if (!this._canEdit() || !Number.isInteger(slot) || slot < 0 || slot >= 8) {
      return false;
    }
    if (
      !isAssignableKey(keyIndex) ||
      this.active.quickSlots.includes(keyIndex)
    ) {
      return false;
    }
    this.active.quickSlots[slot] = keyIndex;
    this._notify();
    return true;
  }

  /** Publish a complete nested-dialog draft into the outer live preview, including permutations. */
  setQuickSlots(quickSlots) {
    if (!this._canEdit()) return false;
    validateKeyBindings({ keys: this.active.keys, quickSlots });
    this.active.quickSlots = quickSlots.slice();
    this._notify();
    return true;
  }

  hasChanges() {
    return !sameMap(this.active, this.store.profile.keyBindings);
  }

  async save() {
    if (!this._canEdit()) throw new Error("Key configuration is not editable.");
    validateKeyBindings(this.active);
    this.saving = true;
    this._notify();
    try {
      await this.store.commitKeyBindings(this.active);
      this.editing = false;
    } finally {
      this.saving = false;
      this._notify();
    }
    return this.snapshot();
  }

  cancel() {
    if (!this._canEdit()) return false;
    this.active = structuredClone(this.store.profile.keyBindings);
    this.editing = false;
    this._notify();
    return true;
  }

  subscribe(listener) {
    if (
      this.destroyed ||
      typeof listener !== "function" ||
      this.listeners.size >= MAX_LISTENERS
    ) {
      throw new Error("Invalid key configuration observer.");
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _notify() {
    for (const listener of this.listeners) {
      try {
        listener(this);
      } catch (error) {
        console.error("Key configuration observer failed", error);
      }
    }
  }

  snapshot() {
    return {
      active: structuredClone(this.active),
      saved: structuredClone(this.store.profile.keyBindings),
      pending: this.editing ? structuredClone(this.active) : null,
      previewing: this.editing && this.hasChanges(),
      editing: this.editing,
      saving: this.saving,
      changed: this.hasChanges(),
    };
  }

  destroy() {
    this.items.destroy();
    this.unsubscribeStore();
    this.listeners.clear();
    this.destroyed = true;
  }
}
