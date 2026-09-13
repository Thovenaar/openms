import { closedRecord, protocolError } from "../../shared/protocol.js";
import {
  createProfile,
  validateProfile,
} from "../../client/src/profile/profile-validation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { recalculateVitals } from "../../client/src/character/character-stats.js";
import { grantItem } from "../../client/src/items/inventory-model.js";
import { validStartingStats } from "../../shared/starting-stats.js";

export const MAX_ACCOUNT_CHARACTERS = 8;
const CREATE_TABLE_VERSION = 1;
const PRIMARY_STATS = ["str", "dex", "int", "luk"];
const STARTER_SLOTS = Object.freeze({
  weapon: "Wp",
  top: "Ma",
  bottom: "Pn",
  shoes: "So",
});
const STARTER_FIELDS = Object.keys(STARTER_SLOTS);
const BODY_KEYS = [
  "csrfToken",
  "rollId",
  "name",
  "gender",
  "skin",
  "face",
  "hair",
  ...PRIMARY_STATS,
  ...STARTER_FIELDS,
];

function invalid() {
  throw protocolError("INVALID_MESSAGE");
}

function validateStats(body) {
  if (!validStartingStats(body)) invalid();
}

function validateCosmetic(avatar, id, kind) {
  if (!Number.isSafeInteger(id)) invalid();
  const entry = avatar.entries[id];
  if (!entry || entry.id !== id || entry.kind !== kind || !entry.visual) {
    invalid();
  }
}

/** Original create choices: only the values Etc.wz:MakeCharInfo.img offered for this
 * gender are admissible, however many further cosmetics are packaged. */
function createSet(create, gender) {
  if (create?.schemaVersion !== CREATE_TABLE_VERSION) invalid();
  const set = create.genders?.[String(gender)];
  if (!set) invalid();
  return set;
}

function originalChoice(set, field, value) {
  const values = set[field];
  if (
    !Array.isArray(values) ||
    !Number.isSafeInteger(value) ||
    !values.includes(value)
  ) {
    invalid();
  }
}

/** The packet carried base hair plus its colour suffix; the original validator
 * splits the submitted id by its last decimal digit. */
function validateHair(set, hair) {
  if (!Number.isSafeInteger(hair)) invalid();
  const colour = hair % 10;
  const base = hair - colour;
  if (!set.hairBase.includes(base) || !set.hairColor.includes(colour)) {
    invalid();
  }
}

/** The packaged baseline totals25; appearance requests may select only original
 * create choices that are also rendered catalog entries. */
export function validateCharacterCreation(body, { avatar, create }) {
  closedRecord(body, BODY_KEYS);
  if (typeof body.name !== "string" || !/^[A-Za-z0-9]{4,13}$/.test(body.name)) {
    invalid();
  }
  if (body.gender !== 0 && body.gender !== 1) invalid();
  const set = createSet(create, body.gender);
  originalChoice(set, "skin", body.skin);
  originalChoice(set, "face", body.face);
  validateHair(set, body.hair);
  validateCosmetic(avatar, body.face, "face");
  validateCosmetic(avatar, body.hair, "hair");
  if (!Object.hasOwn(avatar.skins, body.skin)) invalid();
  validateStats(body);
  return body;
}

/** Names are unique only within an account: profile JSON has no global name constraint. */
export function admitCharacterSlot(names, name) {
  if (!Array.isArray(names) || names.length > MAX_ACCOUNT_CHARACTERS + 1) {
    throw protocolError("CHARACTER_LIMIT");
  }
  if (names.includes(name)) throw protocolError("NAME_TAKEN");
  if (names.length >= MAX_ACCOUNT_CHARACTERS) {
    throw protocolError("CHARACTER_LIMIT");
  }
}

function starterEquipment(avatar, items, field, id) {
  validateCosmetic(avatar, id, "equipment");
  const entry = avatar.entries[id];
  const template = items[id];
  if (!template || entry.cash !== 0 || entry.islot !== STARTER_SLOTS[field]) {
    invalid();
  }
  validateStarterInfo(template.info, STARTER_SLOTS[field]);
  const slot = entry.equippedSlots?.[0];
  if (!Number.isInteger(slot) || slot >= 0 || slot < -199) invalid();
  return { id, slot };
}

function validateStarterInfo(info, islot) {
  if (
    !info ||
    info.islot !== islot ||
    !Number.isInteger(info.reqLevel) ||
    info.reqLevel < 0 ||
    info.reqLevel > 10
  ) {
    invalid();
  }
}

export function admitStarterEquipment(body, { avatar, create, items }) {
  const set = createSet(create, body.gender);
  const equipment = [];
  const occupied = new Set();
  // The original create packet always carried all four apparel choices.
  for (const field of STARTER_FIELDS) {
    originalChoice(set, field, body[field]);
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
  const avatar = content.catalog.ui.avatar;
  const create = content.catalog.ui.characterCreate;
  validateCharacterCreation(body, { avatar, create });
  const equipment = admitStarterEquipment(body, {
    avatar,
    create,
    items: content.items,
  });
  const manifest = await content.map(content.catalog.defaultMap);
  const arrival = nearestSavedArrival(manifest, { x: 0, y: 0, facing: 1 });
  const profile = createProfile({
    mapId: manifest.id,
    x: arrival.x,
    y: arrival.y,
    facing: arrival.facing,
  });
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
