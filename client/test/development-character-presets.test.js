import { expect, test } from "bun:test";
import { CharacterDevelopment } from "../src/character/character-development.js";
import { stageJobPreset } from "../src/development/character-presets.js";
import { createProfile } from "../src/profile/profile-validation.js";
import { ProfileStore } from "./fixtures/memory-profile-store.js";
import { grantItem, itemCount } from "../src/items/inventory-model.js";

function fixture() {
  const profile = createProfile({ mapId: "100010000", x: 0, y: 0, facing: 1 });
  const items = {};
  for (const [id, islot] of [
    [1040002, "Ma"],
    [1060002, "Pn"],
    [1072001, "So"],
    [1302000, "Wp"],
    [1492000, "Wp"],
  ]) {
    items[id] = { id, name: String(id), descriptor: {}, info: { islot } };
  }
  items[2330000] = {
    id: 2330000,
    name: "Bullet",
    descriptor: {},
    info: { slotMax: 800, reqLevel: 10 },
  };
  items[2000000] = { id: 2000000, descriptor: {}, info: { slotMax: 100 } };
  const combat = {
    schemaVersion: 2,
    weaponId: 1492000,
    weaponType: 49,
    equipment: { attack: 9, attackSpeed: 5, incPAD: 13, sfx: "gun" },
    attacks: Object.fromEntries(
      ["swingT1", "swingT2", "proneStab", "shot"].map((name) => [
        name,
        {
          rectangle: { left: -44, top: -36, right: -1, bottom: -17 },
          timing: { duration: 600, release: 240 },
        },
      ]),
    ),
  };
  const catalog = {
    ui: {
      items,
      skills: {},
      avatar: { entries: { 1492000: { combat } } },
      coverage: { skillCoverage: { playerBooks: [0, 500, 520] } },
    },
  };
  grantItem(profile, items[2000000], 3);
  return { profile, catalog };
}

function service(store, catalog, hooks = {}) {
  return new CharacterDevelopment(store, catalog, {
    isCurrent: () => true,
    prepareAppearance: async () => ({ destroy() {} }),
    publishAppearance: () => {},
    releaseAppearance: (prepared) => prepared.destroy(),
    ...hooks,
  });
}

test("preset staging is detached and applies gear, ammunition and capped vitals together without losing owned items", async () => {
  const { profile, catalog } = fixture();
  const before = structuredClone(profile);
  const preset = stageJobPreset(catalog.ui, profile, 520);
  expect(profile).toEqual(before);
  const store = ProfileStore.memory(profile);
  let release;
  const prepared = new Promise((resolve) => {
    release = resolve;
  });
  const development = service(store, catalog, {
    prepareAppearance: () => prepared,
  });
  const applying = development.edit(preset.patch, { jobPreset: 520 });
  expect(store.profile).toEqual(before);
  expect(development.pending).toBe(true);
  release({ destroy() {} });
  await applying;
  const after = store.profile;
  expect(after.equipment.find((item) => item.slot === -11)?.id).toBe(1492000);
  expect(itemCount(after, 2330000)).toBe(800);
  expect([after.str, after.dex, after.int, after.luk]).toEqual([
    32767, 32767, 32767, 32767,
  ]);
  expect([after.hp, after.maxHP, after.mp, after.maxMP]).toEqual([
    30000, 30000, 30000, 30000,
  ]);
  for (const item of [...before.inventory, ...before.equipment]) {
    const retained = [...after.inventory, ...after.equipment].find(
      (entry) => entry.uid === item.uid,
    );
    expect(retained).toEqual({ ...item, slot: retained.slot });
  }
});

test("job presets choose equipment admitted by the ordinary wear contract", async () => {
  const { profile, catalog } = fixture();
  for (const [id, reqLevel] of [
    [1082191, 35],
    [1082192, "35"],
  ]) {
    catalog.ui.items[id] = {
      id,
      name: String(id),
      descriptor: {},
      info: { islot: "Gv", reqJob: 16, reqLevel },
    };
    catalog.ui.avatar.entries[id] = {
      visual: {},
      descriptor: {},
      equippedSlots: [-8],
    };
  }
  // Original1082192 has a string reqLevel; ordinary wear rejects that metadata.
  // Coercive preset ranking previously preferred it and aborted the entire preset.
  const preset = stageJobPreset(catalog.ui, profile, 520);
  const store = ProfileStore.memory(profile);
  await service(store, catalog).edit(preset.patch, { jobPreset: 520 });
  expect(store.profile.equipment.find((item) => item.slot === -8)?.id).toBe(
    1082191,
  );
  expect(store.profile.inventory.some((item) => item.id === 1082192)).toBe(
    false,
  );
});

test("a full equipment inventory rejects a job preset without publishing even unrelated scalar edits", async () => {
  const { profile, catalog } = fixture();
  profile.inventorySlots[0] = 1;
  grantItem(profile, catalog.ui.items[1040002], 1);
  const store = ProfileStore.memory(profile);
  const before = structuredClone(store.profile);
  await expect(
    service(store, catalog).edit(
      { job: 520, level: 200, exp: 0, name: "Rejected" },
      { jobPreset: 520 },
    ),
  ).rejects.toThrow();
  expect(store.profile).toEqual(before);
});

test("field replacement during artwork preparation releases the candidate and preserves the durable profile", async () => {
  const { profile, catalog } = fixture();
  const store = ProfileStore.memory(profile);
  const before = structuredClone(store.profile);
  const preset = stageJobPreset(catalog.ui, profile, 520);
  let current = true;
  let released = false;
  const development = service(store, catalog, {
    isCurrent: () => current,
    prepareAppearance: async () => {
      current = false;
      return {
        destroy() {
          released = true;
        },
      };
    },
  });
  await expect(
    development.edit(preset.patch, { jobPreset: 520 }),
  ).rejects.toThrow();
  expect(store.profile).toEqual(before);
  expect(released).toBe(true);
  expect(development.pending).toBe(false);
});
