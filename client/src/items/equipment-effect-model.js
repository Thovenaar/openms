import { resource } from "../rendering/stream-validation.js";

export const EQUIPMENT_EFFECT_LIMITS = Object.freeze({
  sets: 512,
  requirements: 52,
  alternatives: 256,
  frames: 256,
  parts: 256,
});

/** Metadata is validated before any resource request or equipment transaction publication. */
export function validateEquipmentEffectCatalog(catalog) {
  if (
    catalog?.schemaVersion !== 1 ||
    !Array.isArray(catalog.entries) ||
    catalog.entries.length > EQUIPMENT_EFFECT_LIMITS.sets
  ) {
    throw new Error("Invalid equipment effect catalog");
  }
  let previous = -1;
  for (const entry of catalog.entries) {
    validateEquipmentEffect(entry);
    if (entry.id <= previous || ![0, 1].includes(entry.cash)) {
      throw new Error("Invalid equipment effect precedence");
    }
    previous = entry.id;
    validateRequirements(entry.requirements);
    resource(entry.descriptor);
  }
  return catalog;
}

function validateRequirements(groups) {
  if (
    !Array.isArray(groups) ||
    !groups.length ||
    groups.length > EQUIPMENT_EFFECT_LIMITS.requirements
  ) {
    throw new Error("Invalid equipment effect requirements");
  }
  const slots = new Set();
  for (const group of groups) {
    if (
      !Number.isInteger(group.slot) ||
      group.slot < 0 ||
      group.slot >= 52 ||
      slots.has(group.slot) ||
      !validAlternatives(group.ids)
    ) {
      throw new Error("Invalid equipment effect slot alternatives");
    }
    slots.add(group.slot);
  }
}

function validAlternatives(ids) {
  return (
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.length <= EQUIPMENT_EFFECT_LIMITS.alternatives &&
    ids.every((id) => Number.isSafeInteger(id) && id >= 10000)
  );
}

export function validateEquipmentEffect(effect) {
  if (
    !Number.isSafeInteger(effect?.id) ||
    effect.id < 0 ||
    effect.source !== `Effect.wz:SetEff.img/${effect.id}/effect` ||
    ![0, 1].includes(effect.fixed) ||
    ![0, 1, 2, 3].includes(effect.pos) ||
    !Number.isInteger(effect.z) ||
    Math.abs(effect.z) > 10000
  ) {
    throw new Error("Invalid authored equipment effect");
  }
  return effect;
}

/** 005d925d: first complete cash set wins; otherwise first complete ordinary set.
 * Membership is in actual visible slots, including hair0 and all ring positions. */
export function selectEquipmentEffect(catalog, slots) {
  let ordinary = null;
  for (const entry of catalog.entries) {
    if (!matchesRequirements(entry.requirements, slots)) continue;
    if (entry.cash === 1) return entry;
    ordinary ??= entry;
  }
  return ordinary;
}

function matchesRequirements(groups, slots) {
  for (const group of groups) {
    let matched = false;
    // 004606a0 expands interchangeable equipment positions (notably the four ring slots).
    for (const id of group.ids) {
      if (
        group.slot === 0
          ? slots.get(0) === id
          : equippedAt(slots, group.slot, id)
      ) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

function equippedAt(slots, slot, id) {
  if (slot === 12 || slot === 13 || slot === 15 || slot === 16) {
    return (
      slots.get(12) === id ||
      slots.get(13) === id ||
      slots.get(15) === id ||
      slots.get(16) === id
    );
  }
  return slots.get(slot) === id;
}

/** Manifest pixels are already validated/tile-expanded by loadVisualBundle. */
export function leasedEquipmentEffect(entry, owner) {
  const metadata = validateEquipmentEffect(
    owner.manifest.metadata.equipmentEffect,
  );
  for (const key of ["id", "source", "fixed", "pos", "z"]) {
    if (metadata[key] !== entry[key]) {
      throw new Error("Equipment effect identity mismatch");
    }
  }
  const entities = owner.manifest.entities;
  if (entities.length !== 1) {
    throw new Error("Invalid equipment effect visual count");
  }
  const frames = entities[0].actions.default;
  if (!frames?.length || frames.length > EQUIPMENT_EFFECT_LIMITS.frames) {
    throw new Error("Equipment effect frame bound exceeded");
  }
  for (const frame of frames) {
    if (frame.parts.length > EQUIPMENT_EFFECT_LIMITS.parts) {
      throw new Error("Equipment effect sprite bound exceeded");
    }
    for (const part of frame.parts) {
      if (!owner.textures.has(part.texture)) {
        throw new Error("Unleased equipment effect pixels");
      }
    }
  }
  return { ...metadata, frames };
}
