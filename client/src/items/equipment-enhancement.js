import { consumeItem, firstItem } from "./inventory-model.js";
import { admitItem, selectedItem } from "./inventory-action-rules.js";
import { recalculateVitals } from "../character/character-stats.js";
import { LEGENDARY_SPIRIT_SKILLS } from "../skills/skill-utility-rules.js";

import { UPGRADE_STATS } from "../profile/profile-item-state.js";
const WHITE_SCROLL = 2340000;
const CLEAN_FIRST = 2049000;
const CLEAN_LAST = 2049003;
const CHAOS_FIRST = 2049100;
const CHAOS_LAST = 2049103;
const SURFACE_SCROLL_FLAGS = Object.freeze({ 2040727: 0x02, 2041058: 0x04 });
const UPGRADE_ITEM_FAMILIES = Object.freeze({
  equipment: { divisor: 1000000, family: 1 },
  scroll: { divisor: 10000, family: 204 },
});

export function equipmentUpgrade(entry, template) {
  if (entry.upgrade) return structuredClone(entry.upgrade);
  const stats = {};
  for (const key of UPGRADE_STATS) stats[key] = template.info[key] ?? 0;
  return { slots: template.info.tuc ?? 0, level: 0, stats };
}

function scrollKind(id) {
  if (id >= CLEAN_FIRST && id <= CLEAN_LAST) return "clean";
  if (id >= CHAOS_FIRST && id <= CHAOS_LAST) return "chaos";
  return "normal";
}

function compatibleScroll(scroll, equipment) {
  if (scrollKind(scroll.id) !== "normal") return true;
  const family = Math.trunc(scroll.id / 100) % 100;
  const category = Math.trunc(equipment.id / 10000) % 100;
  return family === 92 ? [11, 12, 13].includes(category) : family === category;
}

/** Cosmic ScrollHandler49..172, ItemInformationProvider1052..1135; WZ numeric chances. */
export function enhancementPlan(profile, items, request) {
  const equipment = upgradeItem(profile, items, request.equipUid, "equipment");
  const scroll = upgradeItem(profile, items, request.scrollUid, "scroll");
  const template = items[equipment.id];
  const scrollTemplate = items[scroll.id];
  if (template.info.cash || !compatibleScroll(scroll, equipment)) {
    throw new Error("This scroll cannot upgrade the selected equipment");
  }
  const info = scrollTemplate.info;
  checkScrollInfo(info, scrollTemplate.properties.req, equipment.id);
  const upgrade = equipmentUpgrade(equipment, template);
  const kind = scrollKind(scroll.id);
  checkUpgradeSlots(upgrade, template, info, kind);
  const white = whiteScroll(profile, request, kind);
  return {
    equipment,
    scroll,
    info,
    upgrade,
    kind,
    white,
    modifierFlag: SURFACE_SCROLL_FLAGS[scroll.id] ?? 0,
  };
}

function upgradeItem(profile, items, uid, kind) {
  const { divisor, family } = UPGRADE_ITEM_FAMILIES[kind];
  const item =
    kind === "equipment"
      ? selectedItem(profile, uid)
      : profile.inventory.find((entry) => entry.uid === uid);
  if (!item || Math.trunc(item.id / divisor) !== family || !items[item.id]) {
    throw new Error("Select an owned equipment or upgrade scroll instance");
  }
  admitItem(profile, item);
  return item;
}

function checkScrollInfo(info, required, equipmentId) {
  if (
    !Number.isInteger(info.success) ||
    info.success < 0 ||
    info.success > 100
  ) {
    throw new Error("Original scroll probability is unavailable");
  }
  if (required && !Object.values(required).includes(equipmentId)) {
    throw new Error("The scroll's original equipment requirement is not met");
  }
}

function checkUpgradeSlots(upgrade, template, info, kind) {
  if (info.reqRUC !== undefined && upgrade.slots !== info.reqRUC) {
    throw new Error("The scroll requires its original remaining upgrade count");
  }
  const missing =
    kind === "clean"
      ? upgrade.slots + upgrade.level >= (template.info.tuc ?? 0)
      : upgrade.slots < 1;
  if (missing) throw new Error("The equipment has no eligible upgrade slot");
}

function whiteScroll(profile, request, kind) {
  if (!request.whiteScroll || kind === "clean") return null;
  const item = request.whiteScrollUid
    ? profile.inventory.find((entry) => entry.uid === request.whiteScrollUid)
    : firstItem(profile, WHITE_SCROLL);
  if (!item || item.id !== WHITE_SCROLL) {
    throw new Error("A White Scroll is required");
  }
  admitItem(profile, item);
  return item;
}

function improveStats(plan, random) {
  for (const key of UPGRADE_STATS) {
    const current = plan.upgrade.stats[key];
    // Authorized Cosmic normal Chaos policy: independent uniform -5..5 on positive stats.
    const delta =
      plan.kind === "chaos"
        ? current > 0
          ? Math.floor(random() * 11) - 5
          : 0
        : (plan.info[key] ?? 0);
    plan.upgrade.stats[key] = Math.max(0, Math.min(32767, current + delta));
  }
}

/** Operates only on the detached profile transaction draft. All inputs validated before RNG. */
export function applyEnhancement(
  profile,
  items,
  request,
  random = Math.random,
) {
  const plan = enhancementPlan(profile, items, request);
  const success = random() * 100 < plan.info.success;
  const cursed = !success && random() * 100 < (plan.info.cursed ?? 0);
  consumeItem(profile, plan.scroll.uid, 1);
  if (plan.white) consumeItem(profile, plan.white.uid, 1);
  if (cursed) {
    if (plan.equipment.slot < 0) {
      profile.equipment.splice(profile.equipment.indexOf(plan.equipment), 1);
      recalculateVitals(profile, items, request.temporary);
    } else consumeItem(profile, plan.equipment.uid, 1);
    return "curse";
  }
  updateEquipment(plan, success, random);
  if (plan.equipment.slot < 0) {
    recalculateVitals(profile, items, request.temporary);
  }
  return success ? "success" : "failure";
}

function updateEquipment(plan, success, random) {
  if (success && plan.kind === "clean") {
    plan.upgrade.slots++;
  }
  if (success && plan.kind !== "clean") {
    if (plan.modifierFlag) {
      plan.equipment.flags = (plan.equipment.flags ?? 0) | plan.modifierFlag;
    } else {
      improveStats(plan, random);
    }
    plan.upgrade.level++;
  }
  if (plan.kind !== "clean" && !plan.modifierFlag && (success || !plan.white)) {
    plan.upgrade.slots--;
  }
  plan.equipment.upgrade = plan.upgrade;
}

export class EquipmentEnhancement {
  constructor(system) {
    this.system = system;
    this.pending = null;
    this.destroyed = false;
  }

  operationError() {
    if (
      this.destroyed ||
      this.system.hooks?.isCurrent?.() === false ||
      this.system.store.profile.hp <= 0
    ) {
      return "Enhancement is unavailable";
    }
    if (this.pending || this.system.store.profileTransactionPending) {
      return "A profile operation is pending";
    }
    return null;
  }

  /** Legendary Spirit gates bag equipment/window entry; normal worn-item scrolling needs no skill. */
  admissionError(equipUid = null) {
    const unavailable = this.operationError();
    if (unavailable) return unavailable;
    if (
      equipUid !== null &&
      this.system.store.profile.equipment.some(
        (entry) => entry.uid === equipUid,
      )
    ) {
      return null;
    }
    for (const id of LEGENDARY_SPIRIT_SKILLS) {
      if (this.system.level(id) > 0) return null;
    }
    return "Legendary Spirit has not been learned";
  }

  async enhance(request) {
    const denied = this.admissionError(request.equipUid);
    if (denied) return { ok: false, reason: denied };
    const selected = {
      equipUid: request.equipUid,
      scrollUid: request.scrollUid,
      whiteScroll: request.whiteScroll === true,
    };
    this.pending = true;
    let prepared = null;
    let committed = false;
    try {
      const before = JSON.stringify(this.system.store.profile);
      const draft = structuredClone(this.system.store.profile);
      const worn = draft.equipment.some(
        (entry) => entry.uid === selected.equipUid,
      );
      const outcome = applyEnhancement(
        draft,
        this.system.fullCatalog.ui.items,
        selected,
      );
      if (worn && outcome === "curse") {
        prepared = await this.prepareAppearance(draft);
      }
      await this.system.store.commitProfile((current) => {
        if (
          this.destroyed ||
          this.system.hooks.isCurrent?.() === false ||
          JSON.stringify(current) !== before
        ) {
          throw new Error("Enhancement was cancelled: the character changed");
        }
        Object.assign(current, draft);
      });
      committed = true;
      if (prepared) this.system.hooks.publishAppearance(prepared);
      return { ok: true, outcome };
    } catch (error) {
      return { ok: false, reason: error.message };
    } finally {
      if (prepared && !committed) this.system.hooks.releaseAppearance(prepared);
      this.pending = null;
    }
  }

  async prepareAppearance(draft) {
    const hooks = this.system.hooks;
    if (
      typeof hooks.prepareAppearance !== "function" ||
      typeof hooks.publishAppearance !== "function" ||
      typeof hooks.releaseAppearance !== "function"
    ) {
      throw new Error(
        "Original character appearance preparation is unavailable",
      );
    }
    const prepared = await hooks.prepareAppearance(draft);
    if (!prepared) {
      throw new Error("Equipment appearance preparation was cancelled");
    }
    return prepared;
  }

  destroy() {
    this.destroyed = true;
  }
}
