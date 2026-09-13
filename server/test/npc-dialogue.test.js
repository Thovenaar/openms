import { expect, test } from "bun:test";
import { loadContent } from "../src/content.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { freshLease } from "../src/interaction-common.js";
import { executeNpc } from "../src/interaction-npc.js";
import { questOffers, executeQuest } from "../src/interaction-quest.js";
import { startQuestDialogue } from "../src/interaction-quest-dialogue.js";

const content = await loadContent();

function fixture(questId = 1039, npcId = 20100) {
  const events = [];
  const field = { epoch: crypto.randomUUID(), characters: new Map() };
  const actor = {
    id: crypto.randomUUID(),
    accountId: crypto.randomUUID(),
    session: { expiresAt: Date.now() + 60000 },
    state: "active",
    field,
    profile: createProfile({ mapId: "001010000", x: 0, y: 0, facing: 1 }),
    revision: 1,
  };
  field.characters.set(actor.id, actor);
  const npc = { id: "npc:fixture", templateId: npcId };
  const world = {
    content,
    actors: new Map([[actor.id, actor]]),
    npc: () => npc,
    publish: (recipient, message) =>
      events.push({ recipient: recipient.id, ...message }),
  };
  const lease = freshLease(actor, npc);
  actor.conversation = lease;
  return { actor, world, lease, events, questId };
}

function answer(probe, value, step = probe.lease.step) {
  return executeNpc(
    probe.actor,
    {
      expectedRevision: step,
      action: {
        kind: "npc.answer",
        conversationId: probe.lease.id,
        step,
        answer: value,
      },
    },
    probe.world,
  );
}

function latest(probe) {
  return probe.events.at(-1).event;
}

test("End Chat closes a quest confirmation without running its authored decline page", async () => {
  const probe = fixture();
  startQuestDialogue(probe.actor, probe.world, probe.lease, probe.questId);
  expect(latest(probe).native.kind).toBe("accept-decline");
  const before = structuredClone(probe.actor.profile);
  expect((await answer(probe, { kind: "cancel" })).status).toBe("committed");
  expect(probe.actor.conversation).toBeNull();
  expect(latest(probe).kind).toBe("dialogue.closed");
  expect(probe.actor.nativeInteractions.size).toBe(0);
  expect(probe.actor.profile).toEqual(before);
});

test("Decline retains original No prose and its final OK; cancellation remains separate", async () => {
  const probe = fixture();
  startQuestDialogue(probe.actor, probe.world, probe.lease, probe.questId);
  await answer(probe, { kind: "yesno", value: false });
  expect(latest(probe)).toMatchObject({
    quest: { mode: "rejected" },
    native: { kind: "say", next: false },
  });
  expect(probe.lease.questDialogue.snapshot().text).toBe(
    content.catalog.quests.records[1039].stages[0].say.no[0].text,
  );
  await answer(probe, { kind: "next" });
  expect(latest(probe).kind).toBe("dialogue.closed");
  expect(probe.actor.profile.quests[1039]).toBeUndefined();
});

test("unfinished quests remain browsable but cannot grant a completion lease or reward", async () => {
  const probe = fixture();
  probe.actor.profile.quests[1039] = { state: 1, kills: {} };
  expect(questOffers(probe.actor, probe.world, probe.lease)).toContainEqual({
    questId: 1039,
    action: "claim",
  });
  startQuestDialogue(probe.actor, probe.world, probe.lease, 1039);
  expect(latest(probe)).toMatchObject({
    quest: { mode: "blocked" },
    native: { kind: "say", next: false },
  });
  expect(probe.lease.questDialogue.snapshot().text).toContain("10 each");
  expect(probe.lease.offers).toEqual([]);
  await expect(
    executeQuest(
      probe.actor,
      {
        action: {
          kind: "quest.claim",
          questId: 1039,
          conversationId: probe.lease.id,
          step: probe.lease.step,
        },
      },
      probe.world,
    ),
  ).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  await answer(probe, { kind: "cancel" });
  expect(latest(probe).kind).toBe("dialogue.closed");
});

test("menu cancellation validates the conversation step and clears reconnect presentation", async () => {
  const probe = fixture();
  probe.lease.menu = questOffers(probe.actor, probe.world, probe.lease);
  probe.lease.step = 4;
  await expect(answer(probe, { kind: "cancel" }, 3)).rejects.toMatchObject({
    code: "STALE_REVISION",
  });
  expect(probe.actor.conversation).toBe(probe.lease);
  await answer(probe, { kind: "cancel" });
  expect(probe.actor.conversation).toBeNull();
  expect(latest(probe)).toEqual({
    kind: "dialogue.closed",
    conversationId: probe.lease.id,
  });
});
