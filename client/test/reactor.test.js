import { test, expect } from "bun:test";
import { ReactorSystem } from "../src/reactor-system.js";
import { PROFILE_LIMITS } from "../src/profile-validation.js";

function offeringFixture(entries, observer) {
  const inventory = Array.from({ length: entries }, (_, index) => ({
    id: 2000000 + index,
    count: 2,
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
  const store = { profile: { inventory, quests: {} }, markDirty() {} };
  const system = new ReactorSystem(scene, store, {
    onChange: () => observer(inventory[0].count),
  });
  return { system, inventory };
}

test("offering accepts the shared profile capacity and publishes the debited inventory once", () => {
  const observations = [];
  const { system, inventory } = offeringFixture(
    PROFILE_LIMITS.inventory,
    (count) => observations.push(count),
  );
  expect(system.offer(2000000).consumed).toBe(1);
  expect(observations).toEqual([1]);
  expect(inventory[0].count).toBe(1);
  expect(system.offer(2000000).accepted).toBe(false);
  system.destroy();
});

test("an observer failure cannot separate a committed transition from its item debit", () => {
  const { system, inventory } = offeringFixture(1, () => {
    throw new Error("observer failure");
  });
  expect(() => system.offer(2000000)).toThrow("observer failure");
  expect(inventory[0].count).toBe(1);
  expect(system.offer(2000000).accepted).toBe(false);
  system.destroy();
});
