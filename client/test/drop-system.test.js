import { expect, test } from "bun:test";
import { DropSystem, DROP_POLICY } from "../src/drop-system.js";
import { ProfileStore } from "../src/profile-store.js";
import { createProfile } from "../src/profile-validation.js";

const LOCATION = { mapId: "100040000", x: 0, y: 0, facing: 1 };
const ITEM = 4000004;
const ITEMS = { [ITEM]: { descriptor: {}, info: { slotMax: 100 } } };
const GROUND = [{ x1: -100, y1: 0, x2: 100, y2: 0 }];
const MOB = { templateId: 210100, x: 0, y: 0 };

function row(itemId = ITEM, questId = 0) {
  return {
    itemId,
    minimum: 1,
    maximum: 1,
    chance: 999999,
    questId,
    status: "supported",
  };
}

function system(store, rows = [row()], items = ITEMS) {
  return new DropSystem(
    { schemaVersion: 1, mobs: { 210100: { rows } } },
    store,
    GROUND,
    { items, random: () => 0 },
  );
}

function land(drops) {
  for (let index = 0; index < DROP_POLICY.launchMs / 30; index++) {
    drops.step(30);
  }
}

test("two pickup intents cannot credit one drop twice before durable completion", async () => {
  const store = ProfileStore.memory(createProfile(LOCATION));
  const drops = system(store);
  drops.spawn(MOB);
  land(drops);
  const first = drops.pickup(LOCATION);
  expect((await drops.pickup(LOCATION)).code).toBe("pickup-busy");
  expect((await first).ok).toBe(true);
  expect(store.profile.inventory).toEqual([{ id: ITEM, count: 1 }]);
  expect((await drops.pickup(LOCATION)).code).toBe("nothing-nearby");
  await store.destroy();
});

test("durable refusal preserves world loot without credit or successful pickup animation", async () => {
  const store = ProfileStore.memory(createProfile(LOCATION));
  const drops = system(store, [row(0)]);
  drops.spawn(MOB);
  land(drops);
  await store.destroy();
  const before = store.profile.meso;
  expect((await drops.pickup(LOCATION)).ok).toBe(false);
  expect(store.profile.meso).toBe(before);
  expect(drops.slots[0].state).toBe("grounded");
  expect(drops.slots[0].active).toBe(true);
});

test("full category refuses a new stack without poisoning save state or consuming loot", async () => {
  const profile = createProfile(LOCATION);
  profile.inventory.push({ id: ITEM, count: DROP_POLICY.categorySlots * 100 });
  const store = ProfileStore.memory(profile);
  const drops = system(store);
  drops.spawn(MOB);
  land(drops);
  const before = store.revision;
  expect((await drops.pickup(LOCATION)).code).toBe("inventory-full");
  expect(store.error).toBeNull();
  expect(store.revision).toBe(before);
  expect(drops.slots[0].active).toBe(true);
  expect(store.profile.inventory[0].count).toBe(
    DROP_POLICY.categorySlots * 100,
  );
  await store.destroy();
});

test("quest eligibility is checked both at death and at pickup", async () => {
  const store = ProfileStore.memory(createProfile(LOCATION));
  const drops = system(store, [row(ITEM, 2104)]);
  expect(drops.spawn(MOB).count).toBe(0);
  store.profile.quests[2104] = { state: 1, kills: {} };
  expect(drops.spawn(MOB).count).toBe(1);
  land(drops);
  delete store.profile.quests[2104];
  expect((await drops.pickup(LOCATION)).code).toBe("quest-inactive");
  expect(store.profile.inventory).toEqual([]);
  expect(drops.slots[0].active).toBe(true);
  await store.destroy();
});

test("field capacity rejects whole batches rather than silently dropping their tail", async () => {
  const store = ProfileStore.memory(createProfile(LOCATION));
  const drops = system(store, [row(), row(0)]);
  for (let index = 0; index < DROP_POLICY.capacity / 2; index++) {
    drops.spawn(MOB);
  }
  expect(drops.count).toBe(DROP_POLICY.capacity);
  expect(drops.spawn(MOB).code).toBe("drop-capacity");
  expect(drops.count).toBe(DROP_POLICY.capacity);
  await store.destroy();
});
