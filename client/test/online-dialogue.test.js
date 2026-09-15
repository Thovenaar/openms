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
    whenCommandsSettled: async () => {},
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

function cancellable() {
  const commands = [],
    closes = [],
    errors = [];
  const deferred = Promise.withResolvers();
  const cancelled = Promise.withResolvers();
  const started = Promise.withResolvers();
  let active = false;
  const dialogue = new NativeDialogue({
    whenCommandsSettled: () =>
      active ? Promise.allSettled([deferred.promise]) : Promise.resolve(),
    command: (action) => {
      commands.push(action);
      if (action.answer.kind === "cancel") {
        cancelled.resolve();
        return Promise.resolve({ status: "committed" });
      }
      active = true;
      started.resolve();
      return deferred.promise.finally(() => {
        active = false;
      });
    },
    report: (error) => errors.push(error),
    ui: { windows: new Map(), close: (name) => closes.push(name) },
  });
  dialogue.event = event();
  dialogue.view = dialogue.dialogueView(
    dialogue.event,
    "Choose a destination.",
  );
  return { dialogue, commands, closes, errors, deferred, cancelled, started };
}

test("End Chat dismisses immediately during a pending turn and suppresses late pages", async () => {
  const probe = cancellable();
  const { dialogue } = probe;
  const pending = dialogue.respond({
    sessionId: "current",
    revision: 3,
    action: "choose",
    value: 0,
  });
  await probe.started.promise;
  expect(dialogue.pending).toBe(true);
  expect(dialogue.cancel("current").ok).toBe(true);
  expect(probe.closes).toEqual(["UtilDlgEx"]);
  expect(probe.commands).toHaveLength(1);
  expect(dialogue.view.kind).toBe("closed");
  await dialogue.publish({ ...event(), step: 4 }); // Must not fetch or reopen the next page.
  expect(dialogue.event).toBeNull();
  probe.deferred.resolve({ status: "committed" });
  await pending;
  await probe.cancelled.promise;
  expect(probe.commands[1].answer).toEqual({ kind: "cancel" });
  expect(probe.errors).toEqual([]);
});

test("End Chat also cancels after a rejected turn and cannot dismiss a different conversation", async () => {
  const probe = cancellable();
  const { dialogue } = probe;
  const pending = dialogue.respond({
    sessionId: "current",
    revision: 3,
    action: "choose",
    value: 0,
  });
  await probe.started.promise;
  dialogue.cancel("older");
  expect(probe.closes).toEqual([]);
  dialogue.cancel("current");
  probe.deferred.resolve({ status: "rejected", code: "CONTENT_MISMATCH" });
  expect((await pending).ok).toBe(false);
  await probe.cancelled.promise;
  expect(probe.commands[1].conversationId).toBe("current");
  expect(dialogue.view.kind).toBe("closed");
});

test("inline server prose renders without a dependent HTTP request", async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0,
    refreshes = 0;
  globalThis.fetch = () => {
    fetches++;
    throw new Error("Unexpected prose request");
  };
  const dialogue = new NativeDialogue({
    ui: {
      windows: new Map([
        [
          "UtilDlgEx",
          {
            dialogCleanup: {
              refresh() {
                refreshes++;
              },
            },
          },
        ],
      ]),
      dialogNpc: { conversationId: "current" },
    },
  });
  try {
    await dialogue.publish({
      ...event(),
      text: "Ready immediately from the server.",
    });
    expect(dialogue.view.text).toBe("Ready immediately from the server.");
    expect(refreshes).toBe(1);
    expect(fetches).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
    dialogue.destroy();
  }
});
