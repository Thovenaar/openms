import { expect, test } from "bun:test";
import { ProfileStore } from "../src/profile-store.js";
import { createProfile, migrateProfile } from "../src/profile-validation.js";

const LOCATION = { mapId: "100000000", x: 0, y: 0, facing: 1 };

// Memory mode shares the whole-profile transaction owner, without opening a browser database.
test("atomic commit exposes lock transitions and publishes coherent values without draft aliases", async () => {
  const store = ProfileStore.memory(createProfile(LOCATION));
  const seen = [];
  const pendingStates = [];
  store.subscribe(() => {
    pendingStates.push(store.profileTransactionPending);
    if (!store.profileTransactionPending) {
      seen.push([store.profile.hp, store.profile.maxHP]);
    }
  });
  let retained;
  const pending = store.commitProfile((draft) => {
    draft.maxHP = 200;
    draft.hp = 150;
    retained = draft;
  });
  expect(store.profileTransactionPending).toBe(true);
  expect(() => {
    store.profile.hp = 1;
  }).toThrow();
  await pending;
  expect(seen).toEqual([[150, 200]]);
  expect(pendingStates[0]).toBe(true);
  expect(pendingStates.at(-1)).toBe(false);
  retained.hp = 0;
  expect(store.profile.hp).toBe(150);
  store.profile.hp = 149;
  store.markDirty();
  await store.destroy();
});

test("invalid transaction restores equal mutable data without advancing save revision", async () => {
  const store = ProfileStore.memory(createProfile(LOCATION));
  const before = structuredClone(store.profile);
  const revision = store.revision;
  await expect(
    store.commitProfile((draft) => {
      draft.hp = draft.maxHP + 1;
    }),
  ).rejects.toThrow();
  expect(store.profile).toEqual(before);
  expect(store.revision).toBe(revision);
  expect(store.profileTransactionPending).toBe(false);
  store.profile.hp = 10;
  store.markDirty();
  await store.flush();
  await store.destroy();
});

test("flush and teardown drain accepted transactions while concurrent edits are rejected", async () => {
  const store = ProfileStore.memory(createProfile(LOCATION));
  const pending = store.commitProfile((draft) => {
    draft.meso = 500;
  });
  await expect(
    store.commitProfile((draft) => {
      draft.meso = 1;
    }),
  ).rejects.toThrow();
  const flush = store.flush();
  const close = store.destroy();
  await pending;
  await flush;
  await close;
  expect(store.profile.meso).toBe(500);
  expect(store.status).toBe("closed");
});

test("schema2 migration preserves customized bindings and all existing gameplay domains", () => {
  const old = createProfile(LOCATION);
  old.schemaVersion = 2;
  delete old.remainingSp;
  delete old.remainingAp;
  delete old.skills;
  delete old.settings.chat;
  old.hp = 12;
  old.meso = 9876;
  old.inventory.push({ id: 2000000, count: 9 });
  old.keyBindings.keys[18] = { type: 4, id: 0 };
  const migrated = migrateProfile(old);
  const { remainingSp, remainingAp, skills, ...previous } = migrated;
  expect(previous).toEqual({
    ...old,
    schemaVersion: 4,
    settings: { ...old.settings, chat: { state: 1, height: 70 } },
  });
  expect(remainingSp).toEqual(Array(10).fill(0));
  expect(remainingAp).toBe(0);
  expect(skills).toEqual({});
  migrated.inventory[0].count = 1;
  expect(old.inventory[0].count).toBe(9);
  old.hp = 999;
  expect(() => migrateProfile(old)).toThrow();
});

test("chat bounds reject an invalid atomic edit while valid saved settings survive", async () => {
  const store = ProfileStore.memory(createProfile(LOCATION));
  await store.commitProfile((draft) => {
    draft.settings.chat = { state: 3, height: 507 };
  });
  const revision = store.revision;
  await expect(
    store.commitProfile((draft) => {
      draft.settings.chat.height = 508;
    }),
  ).rejects.toThrow();
  expect(store.profile.settings.chat).toEqual({ state: 3, height: 507 });
  expect(store.revision).toBe(revision);
  await store.commitProfile((draft) => {
    draft.settings.chat = { state: 1, height: 26 };
  });
  await store.destroy();
});
