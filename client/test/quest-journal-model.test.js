import { expect, test } from "bun:test";
import {
  questDetailContent,
  questGroups,
  questJournalSelection,
  questObjectives,
} from "../src/quests/quest-journal-model.js";

function fixture() {
  const check = { items: [], mobs: [], quests: [], jobs: [] };
  const act = { items: [], exp: 0, money: 0, pop: 0 };
  const record = {
    id: 1009,
    name: "Quiz",
    info: {
      0: "Meet Rain.",
      1: "Answer Rain's quiz.",
      2: "You answered Rain's quiz.",
      summary: "Solve the quiz.",
      demandSummary: "Current objective",
      rewardSummary: "Authored reward",
    },
    stages: [
      { check, actionCheck: check, act },
      { check, actionCheck: check, act: { ...act, exp: 2 } },
    ],
  };
  const quests = {
    catalog: { records: { 1009: record }, strings: { item: {}, mob: {} } },
    store: { profile: { quests: {} } },
    records: [record],
    status: () => ({ ok: true }),
  };
  return { quests, record };
}

test("journal selects stage prose and confines live summary to In progress", () => {
  const { quests, record } = fixture();
  const available = questDetailContent(quests, record, 0);
  const active = questDetailContent(quests, record, 1);
  const completed = questDetailContent(quests, record, 2);
  expect(available.narrative).toBe(record.info[0]);
  expect(active.narrative).toBe(record.info[1]);
  expect(completed.narrative).toBe(record.info[2]);
  expect(active.summary).toContain("Current objective");
  expect(active.summary).toContain("Authored reward");
  expect(available.summary).toBe("");
  expect(completed.summary).toBe("");
  expect(completed.information).not.toContain("Current objective");
  expect(completed.information).toContain("Authored reward");
  expect(quests.store.profile.quests).toEqual({});
});

test("available reward preview uses completion rewards and excludes consumed items", () => {
  const { quests, record } = fixture();
  delete record.info.rewardSummary;
  record.stages[0].act = { items: [], exp: 99, money: 0, pop: 0 };
  record.stages[1].act.items = [
    { id: 4000003, count: -30 },
    { id: 1092000, count: 1, prop: -1 },
  ];
  const detail = questDetailContent(quests, record, 0);
  expect(detail.information).toContain("EXP: 2");
  expect(detail.information).not.toContain("EXP: 99");
  expect(detail.information).not.toContain("4000003");
  expect(detail.information).toContain("#Wselect#");
  expect(detail.information).toContain("#i1092000#");
});

test("authored summary owns objective content instead of duplicating live counters", () => {
  const { quests, record } = fixture();
  record.stages[1].check = {
    items: [],
    quests: [],
    jobs: [],
    mobs: [{ id: 1210100, count: 30 }],
  };
  quests.store.profile.quests[record.id] = { state: 1, kills: { 1210100: 7 } };
  const authored = questDetailContent(quests, record, 1);
  expect(authored.summary).toContain("Current objective");
  expect(authored.summary).not.toContain("7/30");
  delete record.info.demandSummary;
  const fallback = questDetailContent(quests, record, 1);
  expect(fallback.summary).toContain("7/30");
  expect(questDetailContent(quests, record, 2).summary).toBe("");
});

test("empty journal partitions contain neither region nor chain headings", () => {
  const { quests, record } = fixture();
  record.info.area = 1;
  record.info.parent = "A quest chain";
  quests.catalog.categories = { labels: { 1: "Victoria Island" } };
  expect(questGroups(quests, 0)[0].records).toEqual([record]);
  expect(questGroups(quests, 1)).toEqual([]);
  expect(questGroups(quests, 2)).toEqual([]);
  quests.store.profile.quests[record.id] = { state: 1 };
  expect(questGroups(quests, 0)).toEqual([]);
  expect(questGroups(quests, 1)[0].records).toEqual([record]);
  expect(questGroups(quests, 2)).toEqual([]);
});

test("journal selections cannot leak across tabs, completion, give-up or catalog replacement", () => {
  const { quests, record } = fixture();
  expect(questJournalSelection(quests, record.id, 0)).toBe(record);
  expect(questJournalSelection(quests, record.id, 1)).toBeNull();
  quests.store.profile.quests[record.id] = { state: 1 };
  expect(questJournalSelection(quests, record.id, 0)).toBeNull();
  expect(questJournalSelection(quests, record.id, 1)).toBe(record);
  quests.store.profile.quests[record.id].state = 2;
  expect(questJournalSelection(quests, record.id, 1)).toBeNull();
  expect(questJournalSelection(quests, record.id, 2)).toBe(record);
  delete quests.store.profile.quests[record.id];
  expect(questJournalSelection(quests, record.id, 2)).toBeNull();
  delete quests.catalog.records[record.id];
  expect(questJournalSelection(quests, record.id, 0)).toBeNull();
});

test("partial collected stock is helper progress without claiming the objective is complete", () => {
  const { quests, record } = fixture();
  record.stages[1].check = {
    items: [{ id: 4000001, count: 40 }],
    mobs: [],
    quests: [],
    jobs: [],
  };
  quests.store.profile.inventory = [{ id: 4000001, count: 1 }];
  quests.store.profile.equipment = [];
  const partial = questObjectives(quests, record)[0];
  expect(partial).toMatchObject({
    current: 1,
    required: 40,
    progress: true,
    done: false,
  });
  quests.store.profile.inventory[0].count = 40;
  expect(questObjectives(quests, record)[0].done).toBe(true);
  quests.store.profile.inventory = [];
  expect(questObjectives(quests, record)[0]).toMatchObject({
    progress: false,
    done: false,
  });
});
