import { PET_LEAD_SKILLS } from "../skills/skill-utility-rules.js";
import { PetPresentation } from "./pet-presentation.js";

export const PET_SLOT_COUNT = 3; // Native CPet slot selector00703d15; Cosmic Character715..726.
const PET_HUNGER_MS = 180000; //Cosmic World233/config PET_EXHAUST_COUNT3.

function petTemplate(profile, items, uid) {
  for (const item of profile.inventory) {
    if (item.uid === uid) return items[item.id];
  }
  throw new Error("Summoned pet lost its owned item");
}

export function petLimit(system) {
  for (const id of PET_LEAD_SKILLS) {
    if (system.level(id) > 0) return PET_SLOT_COUNT;
  }
  return 1;
}

export function petItem(profile, items, itemUid, now) {
  const item = profile.inventory.find((entry) => entry.uid === itemUid);
  const template = items[item?.id];
  if (!item || template?.category !== "Pet" || item.count !== 1) {
    throw new Error("Select an owned pet cash item");
  }
  if (item.expiresAt !== null && item.expiresAt <= now) {
    throw new Error("The pet's life has expired");
  }
  if (!template.name) throw new Error("The original pet name is unavailable");
  return { item, template };
}

/** Cosmic SpawnPetProcessor52..70: hatching is an item replacement, not simultaneous summoning. */
function hatchTemplate(profile, items, item, template) {
  if (item.id !== 5000028 && item.id !== 5000047) return null;
  if (profile.inventory.some((entry) => entry.id === item.id + 1)) {
    throw new Error("A baby of this pet egg is already owned");
  }
  const evolved = items[template.info.evol1];
  if (!evolved?.name || evolved.category !== "Pet") {
    throw new Error("Original pet evolution is unavailable");
  }
  return evolved;
}

/** SpawnPetProcessor72..94: a summon toggles; without Lead the current first pet is removed. */
export function togglePet(profile, items, request, context) {
  const { now, maximum } = context;
  const { item, template } = petItem(profile, items, request.itemUid, now);
  const evolved = hatchTemplate(profile, items, item, template);
  if (evolved) {
    item.id = evolved.id;
    return;
  }
  let pet = profile.pets.find((entry) => entry.itemUid === item.uid);
  if (!pet) {
    pet = {
      uid: request.petUid,
      itemUid: item.uid,
      name: template.name,
      level: 1,
      closeness: 0,
      fullness: 100,
      expiresAt: item.expiresAt,
      summonedSlot: null,
    };
    profile.pets.push(pet);
  }
  if (pet.summonedSlot !== null) {
    pet.summonedSlot = null;
    compactPets(profile.pets);
    return;
  }
  let count = 0;
  for (const entry of profile.pets) {
    if (entry.summonedSlot === null) continue;
    if (maximum === 1) entry.summonedSlot = null;
    else count++;
  }
  if (count >= maximum) throw new Error("Three pets are already summoned");
  if (request.lead) {
    for (const entry of profile.pets) {
      if (entry.summonedSlot !== null) entry.summonedSlot++;
    }
    pet.summonedSlot = 0;
  } else pet.summonedSlot = count;
}

function compactPets(pets) {
  let next = 0;
  for (let slot = 0; slot < PET_SLOT_COUNT; slot++) {
    for (const pet of pets) {
      if (pet.summonedSlot === slot) pet.summonedSlot = next++;
    }
  }
}

export class PetSkills {
  constructor(system) {
    this.system = system;
    this.presentation = new PetPresentation(system);
    this.pending = null;
    this.destroyed = false;
    this.hunger = new Float64Array(PET_SLOT_COUNT);
    this.slotUids = new Array(PET_SLOT_COUNT).fill(null);
  }

  async toggle(itemUid, lead = false) {
    if (
      this.destroyed ||
      this.pending ||
      this.system.store.profileTransactionPending
    ) {
      return { ok: false, reason: "A pet or profile operation is pending" };
    }
    const request = { itemUid, lead, petUid: crypto.randomUUID() };
    this.pending = true;
    try {
      const { item, template } = petItem(
        this.system.store.profile,
        this.system.fullCatalog.ui.items,
        itemUid,
        Date.now(),
      );
      await this.presentation.prepare(itemUid);
      const evolved = hatchTemplate(
        this.system.store.profile,
        this.system.fullCatalog.ui.items,
        item,
        template,
      );
      if (evolved) await this.presentation.prepare(itemUid, evolved.id);
      this.pending = this.system.store.commitProfile((draft) => {
        if (this.destroyed || draft.hp <= 0) {
          throw new Error("Pet summoning is unavailable");
        }
        togglePet(draft, this.system.fullCatalog.ui.items, request, {
          now: Date.now(),
          maximum: petLimit(this.system),
        });
      });
      await this.pending;
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error.message, code: error.code };
    } finally {
      this.pending = null;
      this.presentation.releaseUnused();
    }
  }

  step(ms) {
    const profile = this.system.store.profile;
    if (this.pending || this.system.store.profileTransactionPending) return;
    let dirty = false;
    const now = Date.now();
    const maximum = petLimit(this.system);
    for (const pet of profile.pets) {
      const slot = pet.summonedSlot;
      if (slot === null) continue;
      if (this.slotUids[slot] !== pet.uid) {
        this.slotUids[slot] = pet.uid;
        this.hunger[slot] = 0;
      }
      if (slot >= maximum || (pet.expiresAt !== null && pet.expiresAt <= now)) {
        pet.summonedSlot = null;
        dirty = true;
        continue;
      }
      if (!this.advanceHunger(pet, slot, ms)) continue;
      dirty = true;
    }
    if (dirty) {
      compactPets(profile.pets);
      this.system.store.markDirty();
    }
    this.presentation.step(ms);
  }

  advanceHunger(pet, slot, ms) {
    this.hunger[slot] += ms;
    if (this.hunger[slot] < PET_HUNGER_MS) return false;
    const count = Math.floor(this.hunger[slot] / PET_HUNGER_MS);
    this.hunger[slot] %= PET_HUNGER_MS;
    const template = petTemplate(
      this.system.store.profile,
      this.system.fullCatalog.ui.items,
      pet.itemUid,
    );
    pet.fullness -= count * (template.info.hungry ?? 1);
    if (pet.fullness <= 5) {
      pet.fullness = 15;
      pet.summonedSlot = null;
    }
    return true;
  }

  destroy() {
    this.destroyed = true;
    this.presentation.destroy();
  }
}
