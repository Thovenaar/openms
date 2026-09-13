import { expect, test } from "bun:test";
import { loadContent } from "../src/content.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { checkConditions } from "../../client/src/quests/quest-rules.js";
import { narrativeQuestSystem } from "../src/interaction-quest-system.js";
import { QuestDialogue } from "../../client/src/quests/quest-dialogue.js";
import { nativeQuestViews } from "../src/native-presentation.js";
import { progressQuestViews } from "../src/interaction-quest.js";
import { NativeQuests } from "../../client/src/online/native-quests.js";
import {
  questState,
  admitQuestLifecycle,
  commitQuestLifecycle,
  nextQuestWake,
  expireQuestRuns,
} from "../src/quest-lifecycle.js";

const content = await loadContent();
const NOW = 1800000000000;

function profile() {
  const value = createProfile({ mapId: "101000000", x: 0, y: 0, facing: 1 });
  value.level = 120;
  value.job = 100;
  value.onlineState = { effects: [], cooldowns: {} };
  return value;
}

function advance(value, id, stage, now) {
  const record = content.onlineQuests.records[id];
  admitQuestLifecycle(value, record, stage, now);
  value.quests[id] = { state: stage + 1, kills: {} };
  if (stage === 1) value.quests[id].completedAt = now;
  commitQuestLifecycle(value, record, stage, {
    content,
    now,
    operationId: crypto.randomUUID(),
  });
}

test("only recovered lifecycle blockers are admitted; original catalog and missing Say pages stay unchanged", () => {
  expect(() => questState(profile(), undefined, NOW)).toThrow(
    "CONTENT_MISMATCH",
  );
  expect(content.catalog.quests.records[2017].supported).toBe(false);
  expect(content.onlineQuests.records[2017].supported).toBe(true);
  expect(content.onlineQuests.records[3458].supported).toBe(true);
  expect(content.onlineQuests.records[1047].supported).toBe(false);
  expect(content.questControls.get(3458).durationMs).toBe(1800000);
});

test("a timed quest survives serialization and rejects claims at its deadline before timeout delivery", () => {
  const value = profile();
  advance(value, 3458, 0, NOW);
  const restored = structuredClone(value);
  const record = content.onlineQuests.records[3458];
  expect(nextQuestWake(restored, NOW)).toBe(NOW + 1800000);
  expect(questState(restored, record, NOW + 1799999)).toBe(1);
  expect(() => admitQuestLifecycle(restored, record, 1, NOW + 1800000)).toThrow(
    "REQUIREMENTS_NOT_MET",
  );
  expect(expireQuestRuns(restored, NOW + 1800000)).toEqual([3458]);
  expect(expireQuestRuns(restored, NOW + 1800001)).toEqual([]);
  expect(restored.quests[3458]).toEqual({ state: 0, kills: {} });
});

test("repeatable quest keeps completion evidence and starts a distinct cycle without automatic rewards", () => {
  const value = profile();
  advance(value, 2017, 0, NOW);
  const first = value.onlineState.questLifecycle[2017].cycle;
  advance(value, 2017, 1, NOW + 1);
  expect(questState(value, content.onlineQuests.records[2017], NOW + 1)).toBe(
    0,
  );
  advance(value, 2017, 0, NOW + 2);
  expect(value.onlineState.questLifecycle[2017].cycle).not.toBe(first);
  expect(value.onlineState.questLifecycle[2017].completedAt).toBe(NOW + 1);
  expect(
    checkConditions(
      { jobs: [], items: [], mobs: [], quests: [{ id: 2017, state: 2 }] },
      value,
      { questId: 999, npcId: 0 },
    ).ok,
  ).toBe(true);
  expect(value.exp).toBe(0);
});

test("nonzero repeat intervals gate another acceptance until the server deadline", () => {
  const [id, control] = [...content.questControls].find(
    ([, control]) => control.repeatMs > 0,
  );
  const value = profile();
  advance(value, id, 0, NOW);
  advance(value, id, 1, NOW + 1);
  const record = content.onlineQuests.records[id];
  expect(questState(value, record, NOW + control.repeatMs)).toBe(2);
  expect(questState(value, record, NOW + control.repeatMs + 1)).toBe(0);
});

test("NPC menu and original Say dialogue use the repeat cycle's acceptance stage", () => {
  const value = profile();
  advance(value, 2017, 0, 1);
  advance(value, 2017, 1, 2);
  const system = narrativeQuestSystem(value, { content });
  const entry = system
    .npcEntries(1032100)
    .find((row) => row.record.id === 2017);
  expect(entry.state).toBe(0);
  const dialogue = new QuestDialogue(system, entry.record, 1032100);
  expect(dialogue.stage).toBe(0);
  expect(dialogue.snapshot().text).toContain("Glass Shoe");
});

test("repeat eligibility retains completed history while the next acceptance uses stage zero", () => {
  const value = profile();
  advance(value, 2017, 0, 1);
  advance(value, 2017, 1, 2);
  const actor = { profile: value, revision: 1 };
  expect(
    progressQuestViews(actor, { content }).find((row) => row.id === 2017).state,
  ).toBe("claimed");
  const quests = nativeQuestViews(actor, { content });
  const native = new NativeQuests({
    catalog: content.catalog,
    state: { presentation: { quests } },
  });
  expect(native.view(2017).state).toBe(0);
  expect(native.selection(2017, 2)?.id).toBe(2017);
  expect(native.selection(2017, 0)?.id).toBe(2017);
});
