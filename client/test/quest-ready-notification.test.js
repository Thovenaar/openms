import { expect, test } from "bun:test";
import { QuestSystem } from "../src/quests/quest-system.js";

function fixture({ loadedReady = false } = {}) {
  const empty = () => ({ npc: 0, items: [], mobs: [], quests: [], jobs: [] });
  const record = {
    id: 100,
    name: "Original requirement fixture",
    supported: true,
    blockers: [],
    stages: [
      { check: empty(), actionCheck: empty() },
      {
        check: {
          ...empty(),
          npc: 9000000,
          items: [{ id: 4000001, count: 2 }],
          mobs: [{ id: 100100, count: 1 }],
        },
        actionCheck: { ...empty(), endmeso: 10 },
      },
    ],
  };
  const profile = {
    level: 1,
    job: 0,
    fame: 0,
    meso: 10,
    quests: { 100: { state: 1, kills: { 100100: 1 } } },
    inventory: [{ id: 4000001, count: loadedReady ? 2 : 1 }],
    equipment: [],
  };
  const store = { profile };
  const quests = new QuestSystem(
    { schemaVersion: 1, records: { 100: record } },
    store,
  );
  return { quests, store, record };
}

function edges(quests) {
  const change = quests.readinessChanges();
  return {
    ready: change.ready.map((record) => record.id),
    removed: change.removed,
  };
}

test("final durable objective produces one edge without completing or rewarding the quest", () => {
  const { quests, store } = fixture();
  expect(edges(quests)).toEqual({ ready: [], removed: [] });
  const draft = structuredClone(store.profile);
  draft.inventory[0].count = 2;
  expect(quests.isReady(quests.records[0], draft)).toBe(true);
  expect(edges(quests)).toEqual({ ready: [], removed: [] });
  store.profile = draft;
  const committed = structuredClone(store.profile);
  expect(edges(quests)).toEqual({ ready: [100], removed: [] });
  expect(store.profile).toEqual(committed);
  store.profile = structuredClone(committed);
  store.profile.fame++;
  expect(edges(quests)).toEqual({ ready: [], removed: [] });
  expect(store.profile.quests[100].state).toBe(1);
});

test("all item, kill and action gates must hold and lost requirements re-arm readiness", () => {
  const { quests, store, record } = fixture();
  store.profile.inventory[0].count = 2;
  store.profile.quests[100].kills[100100] = 0;
  expect(edges(quests)).toEqual({ ready: [], removed: [] });
  quests.applyKill(store.profile, 100100);
  store.profile.meso = 9;
  expect(edges(quests)).toEqual({ ready: [], removed: [] });
  store.profile.meso = 10;
  expect(edges(quests)).toEqual({ ready: [100], removed: [] });
  record.stages[1].check.items[0].count = 3;
  expect(edges(quests)).toEqual({ ready: [], removed: [100] });
  expect(edges(quests)).toEqual({ ready: [], removed: [] });
  store.profile.inventory[0].count = 3;
  expect(edges(quests)).toEqual({ ready: [100], removed: [] });
  store.profile.inventory[0].count = 2;
  expect(edges(quests)).toEqual({ ready: [], removed: [100] });
});

test("loaded ready quests are silent, completion and give-up retract without rewarding again", () => {
  const { quests, store } = fixture({ loadedReady: true });
  expect(edges(quests)).toEqual({ ready: [], removed: [] });
  store.profile.quests[100].state = 2;
  expect(edges(quests)).toEqual({ ready: [], removed: [100] });
  expect(edges(quests)).toEqual({ ready: [], removed: [] });
  store.profile.quests[100] = { state: 1, kills: { 100100: 1 } };
  expect(edges(quests)).toEqual({ ready: [100], removed: [] });
  delete store.profile.quests[100];
  expect(edges(quests)).toEqual({ ready: [], removed: [100] });
  expect(edges(quests)).toEqual({ ready: [], removed: [] });
});

test("absence, prerequisite quest and unsupported gates cannot emit a premature notice", () => {
  const { quests, store, record } = fixture();
  record.stages[1].check.items[0].count = 0;
  record.stages[1].check.quests = [{ id: 101, state: 2 }];
  expect(edges(quests)).toEqual({ ready: [], removed: [] });
  store.profile.inventory = [];
  expect(edges(quests)).toEqual({ ready: [], removed: [] });
  store.profile.quests[101] = { state: 2, kills: {} };
  expect(edges(quests)).toEqual({ ready: [100], removed: [] });
  record.supported = false;
  expect(edges(quests)).toEqual({ ready: [], removed: [100] });
  expect(edges(quests)).toEqual({ ready: [], removed: [] });
});
