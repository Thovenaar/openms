import { closedRecord, protocolError } from "../../shared/protocol.js";
import { createProfile, validateProfile } from "../../client/src/profile/profile-validation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { recalculateVitals } from "../../client/src/character/character-stats.js";
import { grantItem } from "../../client/src/items/inventory-model.js";

export const MAX_ACCOUNT_CHARACTERS = 8;
const PRIMARY_STATS = ["str", "dex", "int", "luk"];
const BODY_KEYS = ["csrfToken", "name", "gender", "skin", "face", "hair", ...PRIMARY_STATS];
const STARTER_SLOTS = Object.freeze({ weapon: "Wp", top: "Ma", bottom: "Pn", overall: "MaPn", shoes: "So", hat: "Cp" });
const STARTER_FIELDS = Object.keys(STARTER_SLOTS);

function invalid() {
  throw protocolError("INVALID_MESSAGE");
}

function validateStats(body) {
  let sum = 0;
  for (const key of PRIMARY_STATS) {
    const value = body[key];
    if (!Number.isInteger(value) || value < 4 || value > 13) invalid();
    sum += value;
  }
  if (sum !== 25) invalid();
}

function validateCosmetic(avatar, id, kind) {
  if (!Number.isSafeInteger(id)) invalid();
  const entry = avatar.entries[id];
  if (!entry || entry.id !== id || entry.kind !== kind || !entry.visual) invalid();
}

/** The packaged baseline totals25; appearance requests may select only rendered catalog entries. */
export function validateCharacterCreation(body, avatar) {
  closedRecord(body, BODY_KEYS, STARTER_FIELDS);
  if (typeof body.name !== "string" || !/^[A-Za-z0-9]{4,13}$/.test(body.name)) invalid();
  if (body.gender !== 0 && body.gender !== 1) invalid();
  if (!Number.isSafeInteger(body.skin) || !Object.hasOwn(avatar.skins, body.skin)) invalid();
  validateCosmetic(avatar, body.face, "face");
  validateCosmetic(avatar, body.hair, "hair");
  validateStats(body);
  return body;
}

/** Names are unique only within an account: profile JSON has no global name constraint. */
export function admitCharacterSlot(names, name) {
  if (!Array.isArray(names) || names.length > MAX_ACCOUNT_CHARACTERS + 1) throw protocolError("CHARACTER_LIMIT");
  if (names.includes(name)) throw protocolError("NAME_TAKEN");
  if (names.length >= MAX_ACCOUNT_CHARACTERS) throw protocolError("CHARACTER_LIMIT");
}

function starterEquipment(avatar, items, field, id) {
  validateCosmetic(avatar, id, "equipment");
  const entry = avatar.entries[id];
  const template = items[id];
  if (!template || entry.cash !== 0 || entry.islot !== STARTER_SLOTS[field]) invalid();
  validateStarterInfo(template.info, STARTER_SLOTS[field]);
  const slot = entry.equippedSlots?.[0];
  if (!Number.isInteger(slot) || slot >= 0 || slot < -199) invalid();
  return { id, slot };
}

function validateStarterInfo(info, islot) {
  if (!info || info.islot !== islot || !Number.isInteger(info.reqLevel) || info.reqLevel < 0 || info.reqLevel > 10) invalid();
}

export function admitStarterEquipment(body, avatar, items) {
  if (Object.hasOwn(body, "overall") && (Object.hasOwn(body, "top") || Object.hasOwn(body, "bottom"))) invalid();
  const equipment = [];
  const occupied = new Set();
  for (const field of STARTER_FIELDS) {
    if (!Object.hasOwn(body, field)) continue;
    const item = starterEquipment(avatar, items, field, body[field]);
    if (occupied.has(item.slot)) invalid();
    occupied.add(item.slot);
    equipment.push(item);
  }
  return equipment;
}

function installStarterEquipment(profile, equipment, items) {
  profile.equipment = [];
  for (const selected of equipment) {
    grantItem(profile, items[selected.id], 1);
    const item = profile.inventory.pop();
    item.slot = selected.slot;
    profile.equipment.push(item);
  }
}

export async function prepareCreatedCharacter(content, body) {
  validateCharacterCreation(body, content.catalog.ui.avatar);
  const equipment = admitStarterEquipment(body, content.catalog.ui.avatar, content.items);
  const manifest = await content.map(content.catalog.defaultMap);
  const arrival = nearestSavedArrival(manifest, { x: 0, y: 0, facing: 1 });
  const profile = createProfile({ mapId: manifest.id, x: arrival.x, y: arrival.y, facing: arrival.facing });
  profile.name = body.name;
  profile.gender = body.gender;
  profile.appearance = { skin: body.skin, face: body.face, hair: body.hair };
  for (const key of PRIMARY_STATS) profile[key] = body[key];
  profile.level = 1;
  profile.job = 0;
  profile.exp = 0;
  profile.meso = 0;
  installStarterEquipment(profile, equipment, content.items);
  recalculateVitals(profile, content.items);
  return validateProfile(profile, content.items);
}
