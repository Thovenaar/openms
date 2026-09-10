import { test, expect } from "bun:test";
import { ReactorSystem } from "../src/reactor-system.js";
import { PROFILE_LIMITS, createProfile } from "../src/profile-validation.js";
import { ProfileStore } from "../src/profile-store.js";

function offeringFixture(entries, observer) {
  const inventory = Array.from({ length: entries }, (_, index) => ({
    id: 2000000 + index,
    count: 2,
    uid: `reactor-${index}`,
    slot: index + 1,
    owner: "",
    flags: 0,
    expiresAt: null,
  }));
  const event = {
    type: 100,
    state: -1,
    skills: [],
    hitMs: 0,
    count: 1,
    itemOption: 1,
    itemId: 2000000,
    status: "local-data-transition",
    lt: { x: -10, y: -10 },
    rb: { x: 10, y: 10 },
  };
  const scene = {
    simulation: { x: 0, y: 0 },
    byId: new Map(),
    manifest: {
      reactors: {
        schemaVersion: 1,
        placements: [
          { id: "offering", templateId: "1", x: 0, y: 0, respawnMs: 0 },
        ],
        templates: {
          1: {
            quest: null,
            action: null,
            states: [{ id: 0, events: [event], timeoutMs: 0, hitMs: 0 }],
          },
        },
      },
    },
  };
  const profile = createProfile({ mapId: "100000000", x: 0, y: 0, facing: 1 });
  profile.inventory = inventory;
  profile.inventorySlots[1] = entries;
  const store = ProfileStore.memory(profile);
  const system = new ReactorSystem(scene, store, {
    onChange: () => observer(store.profile.inventory[0].count),
  });
  return { system, store, request: { uid: "reactor-0", actorId: store.id } };
}

test("offering accepts the shared profile capacity and publishes the debited inventory once", async () => {
  const observations = [];
  const { system, store, request } = offeringFixture(
    PROFILE_LIMITS.inventory,
    (count) => observations.push(count),
  );
  expect((await system.offer(request)).consumed).toBe(1);
  expect(observations).toEqual([1]);
  expect(store.profile.inventory[0].count).toBe(1);
  expect((await system.offer(request)).accepted).toBe(false);
  system.destroy();
  await store.destroy();
});

test("an observer failure cannot separate a committed transition from its item debit", async () => {
  const { system, store, request } = offeringFixture(1, () => {
    throw new Error("observer failure");
  });
  expect((await system.offer(request)).accepted).toBe(true);
  expect(store.profile.inventory[0].count).toBe(1);
  expect((await system.offer(request)).accepted).toBe(false);
  system.destroy();
  await store.destroy();
});

test("a pending offer rejects repeated input and another local actor without extra debit", async () => {
  const { system, store, request } = offeringFixture(1, () => {});
  expect(
    (await system.offer({ ...request, actorId: "another-character" })).code,
  ).toBe("invalid-actor");
  const first = system.offer(request);
  expect((await system.offer(request)).code).toBe("reactor-busy");
  expect((await first).accepted).toBe(true);
  expect(store.profile.inventory[0].count).toBe(1);
  expect((await system.offer(request)).accepted).toBe(false);
  system.destroy();
  await store.destroy();
});
