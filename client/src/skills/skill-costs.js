import { compatibleAmmunition, weaponType } from "../combat/weapon-usage.js";
import { isRechargeable } from "../items/inventory-model.js";

const MAX_COST_STACKS = 4096;
const AMPLIFICATION = [2110001, 2210001, 12110001, 22150000];
const NO_AMMUNITION = new Set([
  11101004, 15111007, 14101006, 4111004, 13101005,
]);
const COST_FIELDS = [
  "hpCon",
  "mpCon",
  "moneyCon",
  "itemCon",
  "itemConNo",
  "itemConsume",
  "bulletConsume",
  "bulletCount",
];

/** WZ integer properties may be authored as decimal strings (e.g. Double Uppercut). */
export function skillNumber(value, fallback = 0) {
  if (value === undefined) return fallback;
  if (typeof value === "string" && !/^-?\d+(?:\.\d+)?$/.test(value)) return NaN;
  return typeof value === "number" || typeof value === "string"
    ? Number(value)
    : NaN;
}

function equippedWeapon(profile) {
  for (const item of profile.equipment) if (item.slot === -11) return item.id;
  return 0;
}

/** Cosmic StatEffect1457..1474: amplify first, integer debit, then Concentrate/Infinity. */
export function skillMpCost(system, info) {
  const stats = system.derived();
  if (stats.infinity > 0) return 0;
  let cost = skillNumber(info.mpCon);
  for (const id of AMPLIFICATION) {
    const rank = system.level(id);
    if (rank) {
      cost *= skillNumber(system.info(id, rank).x, 100) / 100;
      break;
    }
  }
  cost = Math.trunc(cost);
  return cost - Math.trunc((cost * (stats.concentrate ?? 0)) / 100);
}

/** Sole synchronous resource transaction for every skill controller. */
export class SkillCosts {
  constructor(system) {
    this.system = system;
    this.entries = new Array(MAX_COST_STACKS).fill(null);
    this.quantities = new Uint32Array(MAX_COST_STACKS);
    this.count = 0;
    this.hp = 0;
    this.mp = 0;
    this.meso = 0;
    this.mpRestore = 0;
    this.mesoSpent = 0;
    this.projectileId = 0;
    this.projectilePAD = 0;
  }

  error(skill, info) {
    const store = this.system.store;
    if (store.profileTransactionPending) {
      return "Profile transaction is pending";
    }
    for (const key of COST_FIELDS) {
      const value = skillNumber(info[key]);
      if (!Number.isSafeInteger(value) || value < 0) {
        return `Invalid original ${key}`;
      }
    }
    this.prepareResources(skill, info);
    if (skill.id === 5101005) {
      const error = this.prepareRecovery(info);
      if (error) return error;
    }
    return (
      this.resourceError(skill) ??
      this.itemError(info) ??
      this.ammunitionError(skill, info)
    );
  }

  prepareResources(skill, info) {
    const profile = this.system.store.profile;
    for (let index = 0; index < this.count; index++) this.entries[index] = null;
    this.count = 0;
    this.projectileId = 0;
    this.projectilePAD = 0;
    this.hp = skillNumber(info.hpCon);
    if (skill.id === 1311006) {
      this.hp += Math.trunc((profile.maxHP * skillNumber(info.x)) / 100);
    }
    this.mp = skillMpCost(this.system, info);
    this.meso = skillNumber(info.moneyCon);
    this.mpRestore = 0;
  }

  prepareRecovery(info) {
    const profile = this.system.store.profile;
    if (!(skillNumber(info.x) > 0) || !(skillNumber(info.y) > 0)) {
      return "Invalid original MP Recovery conversion";
    }
    if (profile.hp <= 1 || profile.mp >= profile.maxMP) {
      return "MP Recovery requires spare HP and missing MP";
    }
    this.hp = Math.min(
      Math.trunc(profile.maxHP / skillNumber(info.x)),
      profile.hp - 1,
    );
    this.mpRestore = Math.min(
      profile.maxMP - profile.mp,
      Math.trunc((this.hp * skillNumber(info.y)) / 100),
    );
    return null;
  }

  resourceError(skill) {
    const store = this.system.store;
    if (!Number.isSafeInteger(this.mp) || this.mp < 0) {
      return "Invalid adjusted MP cost";
    }
    if (store.profile.hp <= this.hp) {
      return "Insufficient HP (skill cannot kill its caster)";
    }
    if (store.profile.mp < this.mp) return "Insufficient MP";
    if (this.meso && store.profile.meso < 1) return "Insufficient mesos";
    if (skill.id !== 4111004 && store.profile.meso < this.meso) {
      return "Insufficient mesos";
    }
    return null;
  }

  itemError(info) {
    const item = skillNumber(info.itemCon);
    const count = skillNumber(info.itemConNo);
    if (item || count) {
      if (!item || !count) return "Incomplete original item cost";
      const error = this.reserveItem(item, count);
      if (error) return error;
    }
    return null;
  }

  reserveItem(id, quantity) {
    const inventory = this.system.store.profile.inventory;
    if (inventory.length > MAX_COST_STACKS) {
      return "Skill inventory bound exceeded";
    }
    let remaining = quantity;
    for (const item of inventory) {
      if (item.id !== id || item.count < 1) continue;
      const debit = Math.min(this.available(item), remaining);
      if (debit <= 0) continue;
      const error = this.reserveEntry(item, debit);
      if (error) return error;
      remaining -= debit;
      if (!remaining) return null;
    }
    return "Insufficient original skill item";
  }

  available(item) {
    for (let index = 0; index < this.count; index++) {
      if (this.entries[index] === item) {
        return item.count - this.quantities[index];
      }
    }
    return item.count;
  }

  reserveEntry(item, quantity) {
    for (let index = 0; index < this.count; index++) {
      if (this.entries[index] !== item) continue;
      if (item.count - this.quantities[index] < quantity) {
        return "Insufficient reserved skill item";
      }
      this.quantities[index] += quantity;
      return null;
    }
    if (this.count === MAX_COST_STACKS) return "Skill item-plan bound exceeded";
    this.entries[this.count] = item;
    this.quantities[this.count++] = quantity;
    return null;
  }

  selectCapsule(info, items) {
    const id = skillNumber(info.itemConsume);
    if (!id) return null;
    let selected = null;
    const profile = this.system.store.profile;
    for (const item of profile.inventory) {
      if (item.id !== id || this.available(item) < 1) continue;
      if (profile.level < (items[id]?.info.reqLevel ?? 70)) continue;
      if (!selected || item.slot < selected.slot) selected = item;
    }
    return selected;
  }

  ammunitionError(skill, info) {
    const stats = this.system.derived();
    const shadowStars = skill.id === 4121006;
    if (!this.requiresAmmunition(skill, shadowStars)) return null;
    const quantity = this.ammunitionQuantity(info, stats, shadowStars);
    const weapon = equippedWeapon(this.system.store.profile);
    if (shadowStars && weaponType(weapon) !== 47) {
      return "Shadow Stars requires a claw";
    }
    const suppress = !shadowStars && (stats.soulArrow || stats.shadowStars);
    return this.reserveProjectile(info, weapon, quantity, suppress);
  }

  reserveProjectile(info, weapon, quantity, suppress) {
    const items = this.system.fullCatalog?.ui?.items ?? this.system.hooks.items;
    const capsule = this.selectCapsule(info, items);
    if (capsule) {
      this.setProjectile(capsule, items);
      return this.reserveEntry(capsule, 1);
    }
    const selected = this.selectAmmunition(weapon, quantity, items);
    if (!selected) {
      return suppress ? null : "Insufficient compatible ammunition";
    }
    this.setProjectile(selected, items);
    if (suppress) return null;
    return this.reserveEntry(selected, quantity);
  }

  requiresAmmunition(skill, shadowStars) {
    if (shadowStars) return true;
    return (
      skill.classification?.hooks?.includes("ammunition") &&
      !NO_AMMUNITION.has(skill.id)
    );
  }

  ammunitionQuantity(info, stats, shadowStars) {
    const count = shadowStars
      ? skillNumber(info.bulletConsume)
      : skillNumber(info.bulletConsume) || skillNumber(info.bulletCount, 1);
    return count * (!shadowStars && stats.shadowPartner ? 2 : 1);
  }

  selectAmmunition(weapon, quantity, items) {
    let selected = null;
    for (const item of this.system.store.profile.inventory) {
      if (!compatibleAmmunition(weapon, item.id)) continue;
      if (this.available(item) < quantity) continue;
      if (!this.ordinaryAmmunitionAllowed(item.id, items)) continue;
      if (!selected || item.slot < selected.slot) selected = item;
    }
    return selected;
  }

  ordinaryAmmunitionAllowed(id, items) {
    const family = Math.trunc(id / 1000);
    if (family === 2331 || family === 2332) return false;
    const metadata = items?.[id]?.info;
    return (
      metadata && !(this.system.store.profile.level < (metadata.reqLevel ?? 0))
    );
  }

  setProjectile(item, items) {
    this.projectileId = item.id;
    this.projectilePAD = items[item.id].info.incPAD ?? 0;
  }

  consume(skill, info) {
    const error = this.error(skill, info);
    if (error) return error;
    const profile = this.system.store.profile;
    let meso = this.meso;
    if (skill.id === 4111004 && meso > 0) {
      const field = this.system.hooks.gameplay();
      meso += field.damageGenerator.next() % Math.max(1, Math.trunc(meso / 2));
      meso = Math.min(meso, profile.meso);
    }
    profile.hp -= this.hp;
    profile.mp += this.mpRestore - this.mp;
    profile.meso -= meso;
    this.mesoSpent = meso;
    for (let index = 0; index < this.count; index++) {
      const entry = this.entries[index];
      entry.count -= this.quantities[index];
      if (!entry.count && !isRechargeable(entry.id)) {
        profile.inventory.splice(profile.inventory.indexOf(entry), 1);
      }
      this.entries[index] = null;
    }
    this.system.store.markDirty();
    return null;
  }
}
