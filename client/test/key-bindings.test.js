import { expect, test } from "bun:test";
import { KeyBindings } from "../src/input/key-bindings.js";
import {
  createProfile,
  migrateProfile,
  validateProfile,
  PROFILE_VERSION,
} from "../src/profile/profile-validation.js";
import {
  configureTemporaryState,
  temporaryState,
  TemporaryStats,
} from "../src/skills/temporary-stats.js";

const LOCATION = { mapId: "100000000", x: 0, y: 0, facing: 1 };

function bindingCatalog() {
  return {
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
}

function fixture() {
  const profile = createProfile(LOCATION);
  profile.inventory.push({
    uid: "potion-stack",
    id: 2000000,
    count: 2,
    slot: 1,
    owner: "",
    flags: 0,
    expiresAt: null,
  });
  const listeners = new Set();
  const store = {
    profile,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markDirty() {},
    async commitProfile(transform) {
      if (this.profileTransactionPending) throw new Error("busy");
      this.profileTransactionPending = true;
      try {
        await Promise.resolve();
        const draft = structuredClone(this.profile);
        transform(draft);
        validateProfile(draft);
        this.profile = draft;
        for (const listener of listeners) listener(store);
      } finally {
        this.profileTransactionPending = false;
      }
    },
    async commitKeyBindings(bindings) {
      this.profile.keyBindings = structuredClone(bindings);
      for (const listener of listeners) listener(store);
    },
  };
  const catalog = bindingCatalog();
  const controls = { blocked: false, now: 0, actions: [], messages: [] };
  const service = new KeyBindings(store, catalog, {
    isBlocked: (excluded) =>
      controls.blocked ||
      store.profileTransactionPending ||
      (Boolean(service.items.pending) && excluded !== service.items),
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
  delete old.remainingAp;
  delete old.skills;
  delete old.inventorySlots;
  delete old.settings.chat;
  delete old.settings.questTracker;
  delete old.settings.gameOptions;
  delete old.settings.alerts;
  delete old.gender;
  delete old.appearance;
  delete old.baseMaxHP;
  delete old.baseMaxMP;
  delete old.cash;
  delete old.monsterBook;
  delete old.skillMacros;
  delete old.social;
  delete old.pets;
  delete old.mount;
  delete old.savedLocations;
  old.equipment = [];
  old.inventory.push({ id: 2000000, count: 7 });
  old.hp = 17;
  old.exp = 91;
  const items = {
    2000000: { id: 2000000, descriptor: {}, info: { slotMax: 100 } },
  };
  const migrated = migrateProfile(old, items);
  expect(migrated.hp).toBe(17);
  expect(migrated.exp).toBe(91);
  expect(migrated.inventory.reduce((sum, entry) => sum + entry.count, 0)).toBe(
    7,
  );
  expect(migrated.inventory[0].uid).toBeString();
  expect(migrated.keyBindings.keys[18]).toEqual({ type: 4, id: 0 });
  old.hp = -1;
  expect(() => migrateProfile(old)).toThrow();
  migrated.schemaVersion = PROFILE_VERSION + 1;
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

test("quick placement outside an editor checkpoints normal bindings; draft placement remains cancellable", async () => {
  const { service, profile } = fixture();
  expect(await service.assignQuick(29, { type: 2, id: 2000000 })).toBe(true);
  expect(profile.keyBindings.keys[29]).toEqual({ type: 2, id: 2000000 });
  service.beginEdit();
  expect(await service.assignQuick(42, { type: 2, id: 2000000 }, 29)).toBe(
    true,
  );
  expect(service.lookup("ShiftLeft")).toEqual({ type: 2, id: 2000000 });
  expect(profile.keyBindings.keys[29]).toEqual({ type: 2, id: 2000000 });
  service.cancel();
  expect(service.lookup("ControlLeft")).toEqual({ type: 2, id: 2000000 });
  expect(service.lookup("ShiftLeft")).toBeNull();
  service.destroy();
});

test("failed direct quickslot persistence restores gameplay bindings and permits a later placement", async () => {
  const { service, store, profile } = fixture();
  const before = structuredClone(profile.keyBindings);
  const commit = store.commitKeyBindings.bind(store);
  store.commitKeyBindings = async () => {
    throw new Error("Save unavailable");
  };
  await expect(
    service.assignQuick(29, { type: 2, id: 2000000 }),
  ).rejects.toThrow();
  expect(profile.keyBindings).toEqual(before);
  expect(service.actionForCode("ControlLeft")).toBe("attack");
  store.commitKeyBindings = commit;
  await service.assignQuick(29, { type: 2, id: 2000000 });
  expect(service.lookup("ControlLeft")).toEqual({ type: 2, id: 2000000 });
  service.destroy();
});

test("carry revalidates ownership and source identity and cannot mutate across a profile transaction", async () => {
  const { service, store, profile, controls } = fixture();
  const item = { type: 2, id: 2000000 };
  expect(service.canCarry(item)).toBe(true);
  expect(service.canCarry(item, 29)).toBe(false);
  store.profileTransactionPending = true;
  expect(await service.assignQuick(29, item)).toBe(false);
  expect(service.canCarry(item)).toBe(false);
  store.profileTransactionPending = false;
  controls.blocked = true;
  expect(await service.assignQuick(29, item)).toBe(false);
  controls.blocked = false;
  profile.inventory[0].count = 0;
  expect(service.canCarry(item)).toBe(false);
  expect(await service.assignQuick(29, item)).toBe(false);
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

test("unknown item effects and restrictions cannot consume an owned recovery stack", async () => {
  const { service, store, profile, catalog } = fixture();
  profile.hp = 1;
  const before = structuredClone(profile);
  catalog.ui.items[2000000].spec.morph = { 0: 1000 };
  expect((await service.useItem(2000000)).ok).toBe(false);
  delete catalog.ui.items[2000000].spec.morph;
  catalog.ui.items[2000000].info.reqLevel = 20;
  expect((await service.useItem(2000000)).ok).toBe(false);
  expect(store.profile).toEqual(before);
  service.destroy();
});

test("key activation and quickslot clicks share recovery caps, count and the 200ms admission clock", async () => {
  const { service, store, profile, controls } = fixture();
  profile.hp = 7;
  service.beginEdit();
  service.assign(30, { type: 2, id: 2000000 });
  service.setQuickSlot(0, 30);
  expect(service.activateCode("KeyA")).toBe(true);
  await service.lastItemUse.pending;
  expect(store.profile.hp).toBe(50);
  expect(store.profile.inventory[0].count).toBe(1);
  controls.now = 199;
  expect((await service.activateKey(service.active.quickSlots[0])).ok).toBe(
    false,
  );
  expect(store.profile.inventory[0].count).toBe(1);
  controls.now = 200;
  expect((await service.activateKey(service.active.quickSlots[0])).ok).toBe(
    true,
  );
  expect(store.profile.hp).toBe(50);
  expect(store.profile.inventory).toEqual([]);
  controls.now = 400;
  expect((await service.useItem(2000000)).ok).toBe(false);
  service.destroy();
});

test("dead and modal input cannot consume or start the recovery admission clock", async () => {
  const { service, store, profile, controls } = fixture();
  profile.hp = 0;
  expect((await service.useItem(2000000)).ok).toBe(false);
  profile.hp = 1;
  controls.blocked = true;
  expect((await service.useItem(2000000)).ok).toBe(false);
  expect(store.profile.inventory[0].count).toBe(2);
  controls.blocked = false;
  expect((await service.useItem(2000000)).ok).toBe(true);
  expect(store.profile.hp).toBe(50);
  expect(store.profile.inventory[0].count).toBe(1);
  service.destroy();
});

test("failed durable item use and concurrent admission leave vitals, stack and effects unchanged", async () => {
  const { service, store, profile, catalog } = fixture();
  profile.hp = 1;
  catalog.ui.items[2000000].spec = { hp: 50, pdd: 10, time: 10000 };
  const effects = new TemporaryStats();
  const prior = temporaryState("item", 2020000);
  configureTemporaryState(prior, { pdd: 2 }, 20000);
  effects.start(prior);
  service.hooks.skillSystem = () => ({
    store,
    effects,
    destroyed: false,
    level: () => 0,
  });
  service.hooks.prepareTemporaryStat = async () => {};
  let rejectCommit;
  let enteredCommit;
  const entered = new Promise((resolve) => {
    enteredCommit = resolve;
  });
  store.commitProfile = async (transform) => {
    const draft = structuredClone(store.profile);
    transform(draft);
    enteredCommit();
    await new Promise((resolve, reject) => {
      rejectCommit = reject;
    });
  };
  const before = structuredClone(store.profile);
  const first = service.useItem(2000000);
  await entered;
  expect(store.profile).toEqual(before);
  expect(effects.derived.pdd).toBe(2);
  expect((await service.useItem(2000000)).ok).toBe(false);
  rejectCommit(new Error("transaction aborted"));
  expect((await first).ok).toBe(false);
  expect(store.profile).toEqual(before);
  expect(effects.visible[0]).toBe(prior);
  expect(effects.derived.pdd).toBe(2);
  service.destroy();
});

test("durable timed use publishes real stats and exact selected instance only after commit", async () => {
  const { service, store, profile, catalog } = fixture();
  profile.hp = 1;
  profile.inventory.push({
    ...profile.inventory[0],
    uid: "second-stack",
    slot: 2,
  });
  catalog.ui.items[2000000].spec = { hp: 50, speed: 8, time: 10001 };
  const effects = new TemporaryStats();
  service.hooks.skillSystem = () => ({
    store,
    effects,
    destroyed: false,
    level: () => 0,
  });
  service.hooks.prepareTemporaryStat = async () => {};
  expect((await service.useItem(2000000, "second-stack")).ok).toBe(true);
  expect(store.profile.hp).toBe(50);
  expect(store.profile.inventory[0].count).toBe(2);
  expect(store.profile.inventory[1].count).toBe(1);
  expect(effects.derived.speed).toBe(8);
  expect(effects.visible[0].remaining).toBe(10001);
  service.destroy();
});
