import { profileError, validateProfile } from "./profile-validation.js";
import { domainKeys, domainInteger } from "./profile-domain-validation.js";

// Cosmic Storage.java:74,114: four initial account/world slots, maximum48.
export function createAccountStorage() {
  return {
    id: "local",
    schemaVersion: 1,
    revision: 0,
    slots: 4,
    meso: 0,
    items: [],
  };
}

/** Storage has its own account row, independent of the character schema version. */
export function validateAccountStorage(value, profile, templates) {
  domainKeys(
    value,
    ["id", "schemaVersion", "revision", "slots", "meso", "items"],
    "account storage",
  );
  if (value.id !== "local" || value.schemaVersion !== 1) {
    throw profileError("corrupt-storage", "Unsupported saved account storage.");
  }
  domainInteger(value.revision, 0, Number.MAX_SAFE_INTEGER, "storage revision");
  domainInteger(value.slots, 4, 48, "storage slots");
  domainInteger(value.meso, 0, 2147483647, "storage mesos");
  if (!Array.isArray(value.items) || value.items.length > value.slots) {
    throw profileError(
      "corrupt-storage",
      "Invalid saved storage item capacity.",
    );
  }
  // Reuse the current instance/template/slot validator, not a parallel item schema.
  const projection = structuredClone(profile);
  projection.inventory = structuredClone(value.items);
  projection.equipment = [];
  projection.pets = [];
  projection.inventorySlots = [48, 48, 48, 48, 48];
  validateProfile(projection, templates);
  const owned = new Set();
  for (const entry of profile.inventory) owned.add(entry.uid);
  for (const entry of profile.equipment) owned.add(entry.uid);
  for (const entry of value.items) {
    if (owned.has(entry.uid)) {
      throw profileError(
        "duplicate-item-uid",
        "An item cannot belong to both character and storage.",
      );
    }
  }
  return value;
}

export function compareAccountStorage(current, expected) {
  if ((current?.revision ?? 0) !== expected.revision) {
    throw profileError(
      "storage-conflict",
      "Account storage changed in another character or tab. Reopen storage before continuing.",
    );
  }
  if (expected.revision === Number.MAX_SAFE_INTEGER) {
    throw profileError(
      "revision-exhausted",
      "Account storage revision limit reached.",
    );
  }
}
