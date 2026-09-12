import {
  domainArray,
  domainId,
  domainInteger,
  domainInvalid,
  domainKeys,
  domainText,
} from "./profile-domain-validation.js";

export const UPGRADE_STATS = Object.freeze([
  "incSTR",
  "incDEX",
  "incINT",
  "incLUK",
  "incMHP",
  "incMMP",
  "incPAD",
  "incMAD",
  "incPDD",
  "incMDD",
  "incACC",
  "incEVA",
  "incSpeed",
  "incJump",
]);
const MAX_PETS = 4096;
const PET_FIELDS = [
  "uid",
  "itemUid",
  "name",
  "level",
  "closeness",
  "fullness",
  "expiresAt",
  "summonedSlot",
];

/** Native equipment packet shorts and upgrade bytes; missing state means original template. */
export function validateItemUpgrade(upgrade, id) {
  if (Math.floor(id / 1000000) !== 1) domainInvalid("non-equipment upgrade");
  domainKeys(upgrade, ["slots", "level", "stats"], "equipment upgrade");
  domainInteger(upgrade.slots, 0, 255, "equipment upgrade slots");
  domainInteger(upgrade.level, 0, 255, "equipment upgrade level");
  domainKeys(upgrade.stats, UPGRADE_STATS, "equipment upgrade stats");
  for (const field of UPGRADE_STATS) {
    domainInteger(
      upgrade.stats[field],
      -32768,
      32767,
      "equipment upgrade stat",
    );
  }
}

/** Pet records belong to real owned cash items; three limits summoned slots, not ownership. */
export function validatePets(profile) {
  domainArray(profile.pets, MAX_PETS, "pets");
  const owned = new Map();
  const inventory = new Set();
  for (const item of profile.inventory) {
    owned.set(item.uid, item);
    inventory.add(item.uid);
  }
  for (const item of profile.cash.locker) owned.set(item.uid, item);
  for (const gift of profile.cash.gifts) {
    for (const item of gift.items) owned.set(item.uid, item);
  }
  const identities = new Set();
  const slots = new Set();
  for (const pet of profile.pets) {
    validatePet(pet, owned);
    if (identities.has(pet.itemUid)) domainInvalid("duplicate pet item owner");
    identities.add(pet.itemUid);
    if (pet.summonedSlot === null) continue;
    if (!inventory.has(pet.itemUid) || slots.has(pet.summonedSlot)) {
      domainInvalid("pet summon slot ownership");
    }
    slots.add(pet.summonedSlot);
  }
}

function validatePet(pet, owned) {
  domainKeys(pet, PET_FIELDS, "pet");
  const item = owned.get(pet.itemUid);
  domainId(pet.uid, "pet uid");
  domainId(pet.itemUid, "pet item uid");
  domainText(pet.name, 13, "pet name", 1);
  // Authorized Cosmic Pet.java:85-88; expiration remains the owned cash item's clock.
  domainInteger(pet.level, 1, 30, "pet level");
  domainInteger(pet.closeness, 0, 30000, "pet closeness");
  domainInteger(pet.fullness, 0, 100, "pet fullness");
  if (pet.expiresAt !== null) {
    domainInteger(pet.expiresAt, 0, Number.MAX_SAFE_INTEGER, "pet expiration");
  }
  if (pet.summonedSlot !== null) {
    domainInteger(pet.summonedSlot, 0, 2, "pet summoned slot");
  }
  if (
    !item ||
    Math.floor(item.id / 10000) !== 500 ||
    item.count !== 1 ||
    item.expiresAt !== pet.expiresAt ||
    pet.uid === pet.itemUid
  ) {
    domainInvalid("pet item identity or expiration");
  }
}

/** Cosmic Mount state is character-owned training; active riding still requires real equipment. */
export function validateMount(mount) {
  domainKeys(mount, ["level", "exp", "tiredness"], "mount");
  domainInteger(mount.level, 1, 30, "mount level");
  domainInteger(mount.exp, 0, 2147483647, "mount experience");
  domainInteger(mount.tiredness, 0, 99, "mount tiredness");
}
