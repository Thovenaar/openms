import { expect, test } from "bun:test";
import {
  NPC_MENU_HEADINGS,
  npcQuestGroup,
  npcTalkLabel,
} from "../src/npc/npc-menu.js";

test("original NPC headings order ready, available, then unfinished quests", () => {
  const entries = [
    { state: 1, ready: false },
    { state: 0, ready: true },
    { state: 1, ready: true },
  ].sort((a, b) => npcQuestGroup(a) - npcQuestGroup(b));
  expect(
    entries.map((entry) => NPC_MENU_HEADINGS[npcQuestGroup(entry)]),
  ).toEqual([3, 1, 0]);
});

test("NPC script labels use original ScriptInfo with an explicit unlabelled talk fallback", () => {
  const template = {
    name: "Jane",
    sources: [{ metadata: [{ path: "info/script/0/script", value: "jane" }] }],
  };
  expect(npcTalkLabel(template, { jane: "Purchase Potion" })).toBe(
    "Purchase Potion",
  );
  expect(npcTalkLabel({ name: "Robin" })).toBe("Talk to Robin");
});
