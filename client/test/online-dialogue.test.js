import { expect, test } from "bun:test";
import { NativeDialogue } from "../src/online/native-dialogue.js";

function event(quest) {
  return {
    conversationId: "current",
    step: 3,
    npcTemplateId: 20100,
    native: { kind: "choice", speaker: 0, next: false, prev: false },
    choices: [0, 42],
    minimum: null,
    maximum: null,
    quest,
  };
}

test("server choices retain authored IDs in the shared native control contract", () => {
  const dialogue = new NativeDialogue({});
  const view = dialogue.dialogueView(event(), "#L42#Answer#l");
  expect(view.choices.some((choice) => choice.id === 42)).toBe(true);
  expect(
    dialogue.commandFor({ action: "choose", value: 42 }, event()),
  ).toMatchObject({
    kind: "npc.answer",
    answer: { kind: "choice", choiceId: 42 },
    step: 3,
  });
});

test("End Chat and Decline submit distinct server intents even on a quest", () => {
  const dialogue = new NativeDialogue({});
  dialogue.event = event({
    mode: "confirm",
    questId: 1039,
    stage: 0,
    rewardChoices: [],
  });
  dialogue.dialogueView(dialogue.event, "Help?");
  expect(
    dialogue.commandFor({ action: "close" }, dialogue.event).answer,
  ).toEqual({ kind: "cancel" });
  expect(
    dialogue.commandFor({ action: "decline" }, dialogue.event).answer,
  ).toEqual({ kind: "yesno", value: false });
  expect(
    dialogue.commandFor({ action: "accept" }, dialogue.event),
  ).toMatchObject({ kind: "quest.accept", questId: 1039 });
});

test("reward choices are selectable and only the selected offered index reaches the server", async () => {
  const commands = [];
  const dialogue = new NativeDialogue({
    command: async (action) => {
      commands.push(action);
      return { status: "committed" };
    },
    ui: { windows: new Map() },
  });
  dialogue.event = event({
    mode: "confirm",
    questId: 1039,
    stage: 1,
    rewardChoices: [{ index: 7, id: 2000000, count: 3 }],
  });
  dialogue.view = dialogue.dialogueView(dialogue.event, "Choose a reward.");
  expect(dialogue.view.choices).toEqual([{ id: 7 }]);
  const respond = (action, value) =>
    dialogue.respond({ sessionId: "current", revision: 3, action, value });
  expect((await respond("acknowledge")).ok).toBe(false);
  expect((await respond("choose", 99)).ok).toBe(false);
  expect(commands).toEqual([]);
  expect((await respond("choose", 7)).ok).toBe(true);
  expect((await respond("acknowledge")).ok).toBe(true);
  expect(commands).toEqual([
    {
      kind: "quest.claim",
      questId: 1039,
      conversationId: "current",
      step: 3,
      rewardChoice: 7,
    },
  ]);
});
