import { test, expect } from "bun:test";
import {
  validateCharacterCreation,
  admitCharacterSlot,
  prepareCreatedCharacter,
  MAX_ACCOUNT_CHARACTERS,
  admitStarterEquipment,
} from "../src/character-creation.js";
import { loadContent } from "../src/content.js";
import { Database } from "../src/database.js";
import { characterSummary } from "../src/character-summary.js";

// Fixture mirroring the recovered shape: original create sets plus their packaged artwork.
const create = {
  schemaVersion: 1,
  source: "Etc.wz:MakeCharInfo.img/Info",
  genders: {
    0: {
      face: [20000, 20001],
      hairBase: [30000],
      hairColor: [0, 7],
      skin: [0],
      top: [1040002],
      bottom: [1060002],
      shoes: [1072001],
      weapon: [1302000],
    },
    1: {
      face: [21000],
      hairBase: [31000],
      hairColor: [0],
      skin: [0],
      top: [1041002],
      bottom: [1061002],
      shoes: [1072001],
      weapon: [1302000],
    },
  },
};
const avatar = {
  skins: { 0: { body: 2000, head: 12000 } },
  entries: {
    20000: { id: 20000, kind: "face", visual: true },
    30000: { id: 30000, kind: "hair", visual: true },
    20001: { id: 20001, kind: "face", visual: false },
    21000: { id: 21000, kind: "face", visual: true },
    31000: { id: 31000, kind: "hair", visual: true },
  },
};
const catalog = { avatar, create };
const request = {
  csrfToken: "session-token",
  rollId: "issued-roll",
  name: "DiceHero",
  gender: 0,
  skin: 0,
  face: 20000,
  hair: 30000,
  str: 12,
  dex: 5,
  int: 4,
  luk: 4,
  top: 1040002,
  bottom: 1060002,
  shoes: 1072001,
  weapon: 1302000,
};

test("creation stats conserve the25-point baseline and enforce integer4..13 bounds", () => {
  expect(
    validateCharacterCreation({ ...request, str: 13, dex: 4 }, catalog).str,
  ).toBe(13);
  for (const stats of [
    { str: 11 },
    { str: 13 },
    { str: 3, dex: 13, int: 5 },
    { str: 14, dex: 3 },
    { str: 11.5, dex: 5.5 },
    { str: "12" },
  ]) {
    expect(() =>
      validateCharacterCreation({ ...request, ...stats }, catalog),
    ).toThrow("INVALID_MESSAGE");
  }
});

test("creation name policy allows only4..13 ASCII alphanumeric characters", () => {
  const accepted = ["Abc1", "Abcdefghijk12"];
  for (const name of accepted) {
    expect(validateCharacterCreation({ ...request, name }, catalog).name).toBe(
      name,
    );
  }
  for (const name of [
    "Ab1",
    "Abcdefghijk1234",
    "Hero_name",
    "Hero-name",
    "Héro",
    "Hero Name",
    1234,
  ]) {
    expect(() =>
      validateCharacterCreation({ ...request, name }, catalog),
    ).toThrow("INVALID_MESSAGE");
  }
});

test("creation appearance admits only original create choices that are rendered", () => {
  expect(
    validateCharacterCreation(
      { ...request, gender: 1, face: 21000, hair: 31000 },
      catalog,
    ).gender,
  ).toBe(1);
  for (const appearance of [
    { gender: 2 },
    { skin: 1 },
    { skin: "0" },
    { face: 20002 },
    { face: 30000 },
    { hair: 20000 },
    { face: 20001 },
    { hair: 30001 },
    { hair: 30003 },
  ]) {
    expect(() =>
      validateCharacterCreation({ ...request, ...appearance }, catalog),
    ).toThrow("INVALID_MESSAGE");
  }
  expect(() =>
    validateCharacterCreation({ ...request, level: 200 }, catalog),
  ).toThrow("INVALID_MESSAGE");
  expect(() =>
    validateCharacterCreation({ ...request, hat: 1002000 }, catalog),
  ).toThrow("INVALID_MESSAGE");
  expect(() =>
    validateCharacterCreation(
      {
        csrfToken: "t",
        name: "DiceHero",
        gender: 0,
        skin: 0,
        face: 20000,
        hair: 30000,
        str: 12,
        dex: 5,
        int: 4,
        luk: 4,
      },
      catalog,
    ),
  ).toThrow("INVALID_MESSAGE");
});

test("same-account names and the eight-character cap reject extra durable admissions", () => {
  const names = Array.from(
    { length: MAX_ACCOUNT_CHARACTERS - 1 },
    (_, index) => `Hero${index}`,
  );
  admitCharacterSlot(names, "NewHero");
  expect(() => admitCharacterSlot(names, names[0])).toThrow("NAME_TAKEN");
  expect(() => admitCharacterSlot([...names, "LastHero"], "NewHero")).toThrow(
    "CHARACTER_LIMIT",
  );
  admitCharacterSlot([], names[0]);
});

test("prepared character uses the actual default map and validated beginner profile", async () => {
  const content = await loadContent();
  const profile = await prepareCreatedCharacter(content, request);
  expect({
    name: profile.name,
    level: profile.level,
    job: profile.job,
    exp: profile.exp,
    meso: profile.meso,
  }).toEqual({ name: "DiceHero", level: 1, job: 0, exp: 0, meso: 0 });
  expect(profile.location.mapId).toBe(
    String(content.catalog.defaultMap).padStart(9, "0"),
  );
  expect(profile.appearance).toEqual({ skin: 0, face: 20000, hair: 30000 });
  expect(profile.str + profile.dex + profile.int + profile.luk).toBe(25);
});

test("PostgreSQL serialization errors use SQLSTATE errno rather than Bun's wrapper code", async () => {
  let first = true;
  const serializationError = Object.assign(
    new Error("could not serialize access"),
    {
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "40001",
    },
  );
  const sql = {
    async begin(work) {
      if (first) {
        first = false;
        throw serializationError;
      }
      return work(() => Promise.resolve());
    },
  };
  const database = new Database(sql, {});
  await expect(
    database.transaction(() => {
      admitCharacterSlot(Array(8).fill("Existing"), "NewHero");
    }),
  ).rejects.toMatchObject({ code: "CHARACTER_LIMIT" });
});

function starterCatalog() {
  const entries = {},
    items = {};
  for (const [id, islot, slot] of [
    [1302000, "Wp", -11],
    [1040002, "Ma", -5],
    [1060002, "Pn", -6],
    [1072001, "So", -7],
  ]) {
    entries[id] = {
      id,
      kind: "equipment",
      visual: true,
      cash: 0,
      islot,
      equippedSlots: [slot],
    };
    items[id] = { id, info: { islot, reqLevel: 0, cash: 0 } };
  }
  const equipment = { ...create };
  return {
    avatar: { entries },
    items,
    create: equipment,
    body: {
      gender: 0,
      weapon: 1302000,
      top: 1040002,
      bottom: 1060002,
      shoes: 1072001,
    },
  };
}

test("starter equipment derives negative authored slots and refuses foreign or mismatched grants", () => {
  const fixture = starterCatalog();
  expect(admitStarterEquipment(fixture.body, fixture)).toEqual([
    { id: 1302000, slot: -11 },
    { id: 1040002, slot: -5 },
    { id: 1060002, slot: -6 },
    { id: 1072001, slot: -7 },
  ]);
  for (const choice of [
    { weapon: 1302999 },
    { weapon: 1040002 },
    { top: 1041002 },
    { shoes: 1072005 },
  ]) {
    expect(() =>
      admitStarterEquipment({ ...fixture.body, ...choice }, fixture),
    ).toThrow("INVALID_MESSAGE");
  }
  expect(() =>
    admitStarterEquipment(
      { gender: 0, weapon: 1302000, top: 1040002, bottom: 1060002 },
      fixture,
    ),
  ).toThrow("INVALID_MESSAGE");
});

test("starter equipment refuses cash and above-level-ten entries", () => {
  const fixture = starterCatalog();
  fixture.avatar.entries[1302000].cash = 1;
  expect(() => admitStarterEquipment(fixture.body, fixture)).toThrow(
    "INVALID_MESSAGE",
  );
  fixture.avatar.entries[1302000].cash = 0;
  fixture.items[1302000].info.reqLevel = 11;
  expect(() => admitStarterEquipment(fixture.body, fixture)).toThrow(
    "INVALID_MESSAGE",
  );
  fixture.items[1302000].info.reqLevel = 10;
  expect(admitStarterEquipment(fixture.body, fixture)[0]).toEqual({
    id: 1302000,
    slot: -11,
  });
});

test("starter selection equips exactly accepted instances rather than silently retaining baseline clothes", async () => {
  const content = await loadContent();
  const profile = await prepareCreatedCharacter(content, request);
  expect(profile.equipment.map(({ id, slot }) => ({ id, slot }))).toEqual([
    { id: 1302000, slot: -11 },
    { id: 1040002, slot: -5 },
    { id: 1060002, slot: -6 },
    { id: 1072001, slot: -7 },
  ]);
  expect(profile.inventory).toEqual([]);
  const summary = characterSummary(
    "character",
    profile,
    profile.equipment,
    content.items,
  );
  expect(summary.gender).toBe(request.gender);
  expect(summary.appearance).toEqual(profile.appearance);
  expect(summary.equipment).toEqual(
    profile.equipment.map(({ id, slot }) => ({ id, slot })),
  );
  expect(() =>
    characterSummary(
      "character",
      profile,
      [{ id: 1302000, slot: 11 }],
      content.items,
    ),
  ).toThrow("INVALID_MESSAGE");
  expect(() =>
    characterSummary(
      "character",
      profile,
      [{ id: 9999999, slot: -11 }],
      content.items,
    ),
  ).toThrow("INVALID_MESSAGE");
  expect(() =>
    characterSummary(
      "character",
      profile,
      Array(33).fill(profile.equipment[0]),
      content.items,
    ),
  ).toThrow("INVALID_MESSAGE");
});
