import { expect, test } from "bun:test";
import { QuestSystem } from "../src/quests/quest-system.js";

function condition(npc = 0) {
  return { npc, items: [], mobs: [], quests: [], jobs: [] };
}

function record(id, startNpc = 10, endNpc = 10) {
  return {
    id,
    supported: true,
    blockers: [],
    stages: [startNpc, endNpc].map((npc) => ({
      check: condition(npc),
      actionCheck: condition(),
    })),
  };
}

function system(records) {
  const profile = {
    level: 10,
    job: 0,
    fame: 0,
    meso: 0,
    quests: {},
    inventory: [],
    equipment: [],
  };
  return new QuestSystem(
    {
      schemaVersion: 1,
      records: Object.fromEntries(records.map((entry) => [entry.id, entry])),
    },
    { profile },
  );
}

function entries(quests, npcId, profile = quests.store.profile) {
  return quests.npcEntries(npcId, profile).map((entry) => ({
    id: entry.record.id,
    state: entry.state,
    ready: entry.ready,
  }));
}

test("NPC menu groups only current available and relevant active quests", () => {
  const available = record(101);
  const future = record(102);
  future.stages[0].check.lvmin = 50;
  const otherStage = record(103, 20, 10);
  const completed = record(104);
  const unsupported = record(105);
  unsupported.supported = false;
  unsupported.blockers = [{ reason: "Unsupported original condition" }];
  const active = record(201, 20, 10);
  active.stages[1].check.mobs = [{ id: 1210100, count: 30 }];
  const quests = system([
    available,
    future,
    otherStage,
    completed,
    unsupported,
    active,
  ]);
  quests.store.profile.quests = {
    104: { state: 2, kills: {} },
    201: { state: 1, kills: {} },
  };
  expect(entries(quests, 10)).toEqual([
    { id: 201, state: 1, ready: false },
    { id: 101, state: 0, ready: false },
  ]);
  expect(entries(quests, 20)).toEqual([{ id: 103, state: 0, ready: false }]);
});

test("completion readiness reuses objective and action gates on the supplied profile", () => {
  const active = record(201, 20, 10);
  active.stages[1].check.mobs = [{ id: 1210100, count: 2 }];
  active.stages[1].actionCheck.endmeso = 10;
  const quests = system([active]);
  quests.store.profile.quests[201] = { state: 1, kills: {} };
  const draft = structuredClone(quests.store.profile);
  expect(entries(quests, 10)).toEqual([{ id: 201, state: 1, ready: false }]);
  draft.quests[201].kills[1210100] = 2;
  expect(entries(quests, 10, draft)[0].ready).toBe(false);
  draft.meso = 10;
  expect(entries(quests, 10, draft)[0].ready).toBe(true);
  expect(entries(quests, 10)[0].ready).toBe(false);
  expect(entries(quests, 20, draft)).toEqual([]);
  draft.quests[201].state = 2;
  expect(entries(quests, 10, draft)).toEqual([]);
});

test("unknown mandatory conditions never become available or completion-ready", () => {
  const unknown = record(301);
  unknown.supported = false;
  unknown.blockers = [
    { path: "Check/301/1/worldmin", reason: "Unknown world gate" },
  ];
  const quests = system([unknown]);
  expect(entries(quests, 10)).toEqual([]);
  quests.store.profile.quests[301] = { state: 1, kills: {} };
  expect(entries(quests, 10)).toEqual([{ id: 301, state: 1, ready: false }]);
  expect(quests.status(unknown, 10)).toMatchObject({
    ok: false,
    code: "unsupported",
    blockers: unknown.blockers,
  });
});

test("action-only endpoints are relevant but contradictory NPC gates cannot admit a row", () => {
  const actionOnly = record(401, 0, 0);
  actionOnly.stages[0].actionCheck.npc = 10;
  actionOnly.stages[1].actionCheck.npc = 20;
  const conflict = record(402);
  conflict.stages[0].actionCheck.npc = 20;
  conflict.stages[1].actionCheck.npc = 20;
  const quests = system([actionOnly, conflict]);
  expect(entries(quests, 10)).toEqual([{ id: 401, state: 0, ready: false }]);
  expect(entries(quests, 20)).toEqual([]);
  quests.store.profile.quests = {
    401: { state: 1, kills: {} },
    402: { state: 1, kills: {} },
  };
  expect(entries(quests, 10)).toEqual([]);
  expect(entries(quests, 20)).toEqual([{ id: 401, state: 1, ready: true }]);
});

function dialogueRecord(pages) {
  const quest = record(501);
  for (const stage of quest.stages) {
    stage.act = { items: [] };
    stage.say = {
      pages: pages.map((text, index) => ({ index, text })),
      yes: [],
      no: [],
      stop: {},
      choices: {},
    };
  }
  return quest;
}

test("the final plain quest page is the acceptance question without a duplicate Next", () => {
  const quest = dialogueRecord(["Read the request.", "Will you help?"]);
  const quests = system([quest]);
  const dialogue = quests.openDialogue(quest.id, 10);
  expect(dialogue.snapshot()).toMatchObject({
    mode: "offer",
    canPrevious: false,
  });
  expect(dialogue.advance().ok).toBe(true);
  expect(dialogue.snapshot()).toMatchObject({ mode: "confirm", page: 1 });
  expect(dialogue.advance().ok).toBe(false);
  expect(dialogue.previous()).toBe(true);
  expect(dialogue.snapshot()).toMatchObject({ mode: "offer", page: 0 });
  dialogue.advance();
  expect(dialogue.reject()).toBe(true);
  expect(dialogue.snapshot().mode).toBe("closed");
  expect(quests.store.profile.quests[quest.id]).toBeUndefined();
});

test("single-page acceptance is immediate but a final authored choice must still be answered", () => {
  const plain = dialogueRecord(["Will you help?"]);
  const quests = system([plain]);
  expect(quests.openDialogue(plain.id, 10).snapshot().mode).toBe("confirm");
  plain.stages[0].say.pages[0].text = "#L0#Correct#l#L1#Wrong#l";
  plain.stages[0].say.choices[0] = { 1: "Try again." };
  const dialogue = quests.openDialogue(plain.id, 10);
  expect(dialogue.snapshot().mode).toBe("offer");
  expect(dialogue.advance().ok).toBe(false);
  expect(dialogue.advance(1).ok).toBe(true);
  expect(dialogue.snapshot().mode).toBe("rejected");
  expect(quests.store.profile.quests[plain.id]).toBeUndefined();
});
