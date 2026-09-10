import { expect, test } from "bun:test";
import { DropSystem, DROP_POLICY } from "../src/drop-system.js";
import { ProfileStore } from "../src/profile-store.js";
import { createProfile } from "../src/profile-validation.js";

const LOCATION = { mapId: "100040000", x: 0, y: 0, facing: 1 };
const ITEM = 4000004;
const ITEMS = { [ITEM]: { id: ITEM, descriptor: {}, info: { slotMax: 100 } } };
const GROUND = [{ x1: -100, y1: 0, x2: 100, y2: 0, layer: 0, group: 0 }];
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
    { items, random: () => 0, pickupHeight: () => 60 },
  );
}

function land(drops) {
  for (let index = 0; index < 100; index++) {
    if (
      drops.slots.every((slot) => !slot.active || slot.state === "grounded")
    ) {
      return;
    }
    drops.step(30);
  }
  throw new Error("Drop landing exceeded smoke bound");
}

test("two pickup intents cannot credit one drop twice before durable completion", async () => {
  const store = ProfileStore.memory(createProfile(LOCATION));
  const drops = system(store);
  drops.spawn(MOB);
  land(drops);
  const instance = { ...drops.slots[0].instance };
  const first = drops.pickup(LOCATION);
  expect((await drops.pickup(LOCATION)).code).toBe("pickup-busy");
  expect((await first).ok).toBe(true);
  expect(store.profile.inventory).toEqual([instance]);
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
  for (let slot = 1; slot <= DROP_POLICY.categorySlots; slot++) {
    profile.inventory.push({
      uid: `full-${slot}`,
      id: ITEM,
      count: 100,
      slot,
      owner: "",
      flags: 0,
      expiresAt: null,
    });
  }
  const store = ProfileStore.memory(profile);
  const drops = system(store);
  drops.spawn(MOB);
  land(drops);
  const before = store.revision;
  expect((await drops.pickup(LOCATION)).code).toBe("inventory-full");
  expect(store.error).toBeNull();
  expect(store.revision).toBe(before);
  expect(drops.slots[0].active).toBe(true);
  expect(
    store.profile.inventory.reduce((sum, item) => sum + item.count, 0),
  ).toBe(DROP_POLICY.categorySlots * 100);
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

test("prepared partial drops conserve attributes and reject concurrent input without clearing the lease", async () => {
  const profile = createProfile(LOCATION);
  const source = {
    uid: "owned-stack",
    id: ITEM,
    count: 7,
    slot: 1,
    owner: "Maple",
    flags: 2,
    expiresAt: 4102444800000,
  };
  profile.inventory.push(source);
  const store = ProfileStore.memory(profile);
  const drops = system(store);
  let release;
  const preparation = new Promise((resolve) => {
    release = resolve;
  });
  drops.hooks.prepareItemDrop = () => preparation;
  drops.hooks.publishItemDrop = () => {};
  drops.hooks.releaseItemDrop = () => {};
  const first = drops.dropItem({ uid: source.uid, count: 3 }, LOCATION);
  expect(
    (await drops.dropItem({ uid: source.uid, count: 3 }, LOCATION)).code,
  ).toBe("drop-busy");
  expect(store.profile.inventory[0].count).toBe(7);
  release({ ready: true });
  expect((await first).ok).toBe(true);
  expect(store.profile.inventory[0].count).toBe(4);
  const ground = { ...drops.slots[0].instance };
  expect(ground.uid).not.toBe(source.uid);
  expect(ground).toMatchObject({
    id: ITEM,
    count: 3,
    owner: source.owner,
    flags: 2,
    expiresAt: source.expiresAt,
  });
  land(drops);
  expect((await drops.pickup(LOCATION)).ok).toBe(true);
  expect(
    store.profile.inventory.find((item) => item.uid === ground.uid),
  ).toEqual({ ...ground, slot: 2 });
  expect(
    store.profile.inventory.reduce((total, item) => total + item.count, 0),
  ).toBe(7);
  drops.destroy();
  await store.destroy();
});

test("failed item-art preparation never debits the source or retains world capacity", async () => {
  const profile = createProfile(LOCATION);
  profile.inventory.push({
    uid: "owned-stack",
    id: ITEM,
    count: 7,
    slot: 1,
    owner: "",
    flags: 0,
    expiresAt: null,
  });
  const store = ProfileStore.memory(profile);
  const drops = system(store);
  drops.hooks.prepareItemDrop = async () => {
    throw new Error("decode failed");
  };
  drops.hooks.publishItemDrop = () => {};
  drops.hooks.releaseItemDrop = () => {};
  expect(
    (await drops.dropItem({ uid: "owned-stack", count: 7 }, LOCATION)).ok,
  ).toBe(false);
  expect(store.profile.inventory[0].count).toBe(7);
  expect(drops.snapshot()).toMatchObject({
    count: 0,
    pending: false,
    reserved: 0,
  });
  drops.destroy();
  await store.destroy();
});
