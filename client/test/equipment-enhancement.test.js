import { expect, test } from "bun:test";
import { applyEnhancement } from "../src/items/equipment-enhancement.js";
import { createProfile } from "../src/profile/profile-validation.js";
import {
  firstItem,
  grantItem,
  itemCount,
} from "../src/items/inventory-model.js";

const ITEMS = {
  1302000: {
    id: 1302000,
    descriptor: {},
    info: { tuc: 7, incPAD: 17 },
    properties: {},
  },
  2043000: {
    id: 2043000,
    descriptor: {},
    info: { success: 0, incPAD: 1 },
    properties: {},
  },
  2340000: { id: 2340000, descriptor: {}, info: {}, properties: {} },
};

function profile() {
  const draft = createProfile({ mapId: "100000000", x: 0, y: 0, facing: 1 });
  draft.inventory = [];
  for (const id of [1302000, 2043000, 2340000]) grantItem(draft, ITEMS[id], 1);
  return draft;
}

function request(draft, whiteScroll = true) {
  return {
    equipUid: firstItem(draft, 1302000).uid,
    scrollUid: firstItem(draft, 2043000).uid,
    whiteScroll,
  };
}

test("White Scroll preserves a failed slot but is consumed along with the attempt", () => {
  const draft = profile();
  expect(applyEnhancement(draft, ITEMS, request(draft), () => 0.5)).toBe(
    "failure",
  );
  expect(draft.inventory.map((item) => item.id)).toEqual([1302000]);
  expect(draft.inventory[0].upgrade.slots).toBe(7);
  expect(draft.inventory[0].upgrade.level).toBe(0);
});

test("White Scroll does not protect the equipment from a curse", () => {
  const draft = profile();
  const items = {
    ...ITEMS,
    2043000: { ...ITEMS[2043000], info: { success: 0, cursed: 100 } },
  };
  expect(applyEnhancement(draft, items, request(draft), () => 0.5)).toBe(
    "curse",
  );
  expect(draft.inventory).toEqual([]);
});

test("Original remaining-slot requirements refuse before any scroll debit", () => {
  const draft = profile();
  const before = structuredClone(draft);
  const items = {
    ...ITEMS,
    2043000: { ...ITEMS[2043000], info: { success: 100, reqRUC: 3 } },
  };
  expect(() => applyEnhancement(draft, items, request(draft))).toThrow();
  expect(draft).toEqual(before);
});

test("A successful scroll changes owned equipment stats and spends one slot", () => {
  const draft = profile();
  const items = {
    ...ITEMS,
    2043000: { ...ITEMS[2043000], info: { success: 100, incPAD: 2 } },
  };
  expect(applyEnhancement(draft, items, request(draft, false), () => 0.5)).toBe(
    "success",
  );
  expect(draft.inventory[0].upgrade.slots).toBe(6);
  expect(draft.inventory[0].upgrade.level).toBe(1);
  expect(draft.inventory[0].upgrade.stats.incPAD).toBe(19);
  expect(draft.inventory.map((item) => item.id)).toEqual([1302000, 2340000]);
});

test("Surface scrolls preserve other item flags and do not spend upgrade slots", () => {
  const items = {
    ...ITEMS,
    1072001: { id: 1072001, descriptor: {}, info: { tuc: 5 }, properties: {} },
    2040727: {
      id: 2040727,
      descriptor: {},
      info: { success: 100, preventslip: 1 },
      properties: {},
    },
  };
  const draft = profile();
  draft.inventory = [];
  grantItem(draft, items[1072001], 1, { flags: 0x08 });
  grantItem(draft, items[2040727], 1);
  const boots = firstItem(draft, 1072001);
  const selected = {
    equipUid: boots.uid,
    scrollUid: firstItem(draft, 2040727).uid,
    whiteScroll: false,
  };
  expect(applyEnhancement(draft, items, selected, () => 0.5)).toBe("success");
  expect(boots.flags).toBe(0x0a);
  expect(boots.upgrade.slots).toBe(5);
  expect(boots.upgrade.level).toBe(1);
  expect(itemCount(draft, 2040727)).toBe(0);
});
