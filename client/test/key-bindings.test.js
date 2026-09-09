import { expect, test } from "bun:test";
import { KeyBindings } from "../src/key-bindings.js";
import { createProfile, migrateProfile } from "../src/profile-validation.js";

const LOCATION = { mapId: "100000000", x: 0, y: 0, facing: 1 };

function fixture() {
  const profile = createProfile(LOCATION);
  profile.inventory.push({ id: 2000000, count: 2 });
  const listeners = new Set();
  const store = {
    profile,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markDirty() {},
    async flush() {},
    async commitKeyBindings(bindings) {
      profile.keyBindings = structuredClone(bindings);
      for (const listener of listeners) listener(store);
    },
  };
  const catalog = {
    ui: {
      items: {
        2000000: {
          id: 2000000,
          category: "Consume",
          info: { price: 50, slotMax: 100 },
          spec: { hp: 50 },
          properties: {},
        },
      },
    },
  };
  const controls = { blocked: false, now: 0, actions: [], messages: [] };
  const service = new KeyBindings(store, catalog, {
    isBlocked: () => controls.blocked,
    now: () => controls.now,
    onAction(name) {
      controls.actions.push(name);
      return true;
    },
    report(message) {
      controls.messages.push(message);
    },
  });
  return { service, store, catalog, controls, profile };
}

test("v1 migration preserves gameplay and rejects damaged or future saves", () => {
  const old = createProfile(LOCATION);
  old.schemaVersion = 1;
  delete old.keyBindings;
  delete old.remainingSp;
  delete old.skills;
  delete old.settings.chat;
  old.inventory.push({ id: 2000000, count: 7 });
  old.hp = 17;
  old.exp = 91;
  const migrated = migrateProfile(old);
  const { schemaVersion, keyBindings, remainingSp, skills, ...gameplay } =
    migrated;
  const { schemaVersion: oldVersion, ...oldGameplay } = old;
  expect(gameplay).toEqual({
    ...oldGameplay,
    settings: { ...oldGameplay.settings, chat: { state: 1, height: 70 } },
  });
  expect(schemaVersion).toBe(3);
  expect(remainingSp).toEqual(Array(10).fill(0));
  expect(skills).toEqual({});
  expect(oldVersion).toBe(1);
  expect(keyBindings.keys[18]).toEqual({ type: 4, id: 0 });
  old.hp = -1;
  expect(() => migrateProfile(old)).toThrow();
  migrated.schemaVersion = 4;
  expect(() => migrateProfile(migrated)).toThrow();
});

test("replacement moves unique bindings live; cancel restores modifier aliases and quickslots", () => {
  const { service, profile } = fixture();
  const durable = structuredClone(profile.keyBindings);
  service.beginEdit();
  expect(service.assign(54, { type: 5, id: 52 }, 29)).toBe(true);
  expect(service.actionForCode("ControlRight")).toBeNull();
  expect(service.actionForCode("ShiftRight")).toBe("attack");
  service.assign(42, { type: 2, id: 2000000 });
  expect(service.actionForCode("ShiftLeft")).toBeNull();
  expect(service.setQuickSlot(0, 30)).toBe(true);
  expect(profile.keyBindings).toEqual(durable);
  service.cancel();
  expect(service.actionForCode("ControlRight")).toBe("attack");
  expect(service.active.quickSlots).toEqual(durable.quickSlots);
  service.destroy();
});

test("quick placement outside an editor checkpoints normal bindings; draft placement remains cancellable", () => {
  const { service, store, profile } = fixture();
  let checkpoints = 0;
  store.markDirty = () => {
    checkpoints++;
  };
  expect(service.assignQuick(29, { type: 2, id: 2000000 })).toBe(true);
  expect(profile.keyBindings.keys[29]).toEqual({ type: 2, id: 2000000 });
  expect(service.editing).toBe(false);
  expect(checkpoints).toBe(1);
  service.beginEdit();
  expect(service.assignQuick(42, { type: 2, id: 2000000 }, 29)).toBe(true);
  expect(service.lookup("ShiftLeft")).toEqual({ type: 2, id: 2000000 });
  expect(profile.keyBindings.keys[29]).toEqual({ type: 2, id: 2000000 });
  expect(checkpoints).toBe(1);
  service.cancel();
  expect(service.lookup("ControlLeft")).toEqual({ type: 2, id: 2000000 });
  expect(service.lookup("ShiftLeft")).toBeNull();
  service.destroy();
});

test("carry revalidates ownership and source identity and cannot mutate across a profile transaction", () => {
  const { service, store, profile, controls } = fixture();
  const item = { type: 2, id: 2000000 };
  expect(service.canCarry(item)).toBe(true);
  expect(service.canCarry(item, 29)).toBe(false);
  store.profileTransactionPending = true;
  expect(service.assignQuick(29, item)).toBe(false);
  expect(service.canCarry(item)).toBe(false);
  store.profileTransactionPending = false;
  controls.blocked = true;
  expect(service.assignQuick(29, item)).toBe(false);
  controls.blocked = false;
  profile.inventory[0].count = 0;
  expect(service.canCarry(item)).toBe(false);
  expect(service.assignQuick(29, item)).toBe(false);
  expect(profile.keyBindings.keys[29]).toEqual({ type: 5, id: 52 });
  profile.skills[1000000] = { level: 1, expiresAt: null };
  expect(service.canCarry({ type: 1, id: 1000000 })).toBe(false);
  profile.skills[1001004] = { level: 1, expiresAt: null };
  expect(service.canCarry({ type: 1, id: 1001004 })).toBe(true);
  service.destroy();
});

test("failed Save retains the recoverable draft without rolling back unrelated gameplay", async () => {
  const { service, store, profile } = fixture();
  const durable = structuredClone(profile.keyBindings);
  service.beginEdit();
  service.assign(30, { type: 2, id: 2000000 });
  store.commitKeyBindings = async () => {
    profile.hp = 9;
    profile.meso = 123;
    throw new Error("quota");
  };
  await expect(service.save()).rejects.toThrow("quota");
  expect(service.lookup("KeyA")).toEqual({ type: 2, id: 2000000 });
  expect(profile.keyBindings).toEqual(durable);
  expect(profile.hp).toBe(9);
  expect(profile.meso).toBe(123);
  expect(service.hasChanges()).toBe(true);
  service.cancel();
  expect(profile.hp).toBe(9);
  expect(service.lookup("KeyA")).toBeNull();
  service.destroy();
});

test("unknown item effects and restrictions cannot consume an owned recovery stack", () => {
  const { service, profile, catalog } = fixture();
  profile.hp = 1;
  catalog.ui.items[2000000].spec.morph = { 0: 1000 };
  expect(service.useItem(2000000)).toBe(false);
  delete catalog.ui.items[2000000].spec.morph;
  catalog.ui.items[2000000].info.reqLevel = 20;
  expect(service.useItem(2000000)).toBe(false);
  expect(profile.hp).toBe(1);
  expect(profile.inventory).toEqual([{ id: 2000000, count: 2 }]);
  service.destroy();
});

test("key activation and quickslot clicks share recovery caps, count and the 200ms admission clock", () => {
  const { service, profile, controls } = fixture();
  profile.hp = 7;
  service.beginEdit();
  service.assign(30, { type: 2, id: 2000000 });
  service.setQuickSlot(0, 30);
  expect(service.activateCode("KeyA")).toBe(true);
  expect(profile.hp).toBe(50);
  expect(profile.inventory[0].count).toBe(1);
  controls.now = 199;
  expect(service.activateKey(service.active.quickSlots[0])).toBe(false);
  expect(profile.inventory[0].count).toBe(1);
  controls.now = 200;
  expect(service.activateKey(service.active.quickSlots[0])).toBe(true);
  expect(profile.hp).toBe(50);
  expect(profile.inventory).toEqual([]);
  controls.now = 400;
  expect(service.useItem(2000000)).toBe(false);
  service.destroy();
});

test("dead and modal input cannot consume or start the recovery admission clock", () => {
  const { service, profile, controls } = fixture();
  profile.hp = 0;
  expect(service.useItem(2000000)).toBe(false);
  profile.hp = 1;
  controls.blocked = true;
  expect(service.useItem(2000000)).toBe(false);
  expect(profile.inventory[0].count).toBe(2);
  controls.blocked = false;
  expect(service.useItem(2000000)).toBe(true);
  expect(profile.hp).toBe(50);
  expect(profile.inventory[0].count).toBe(1);
  service.destroy();
});
