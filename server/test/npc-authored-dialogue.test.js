import { expect, test } from "bun:test";
import { loadContent } from "../src/content.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { executeNpc } from "../src/interaction-npc.js";
import { resolveNpcRoute } from "../src/interaction-npc-content.js";
import { getInteractionContent } from "../src/interaction-common.js";
import { questChoices } from "../../client/src/quests/quest-dialogue.js";

const content = await loadContent();
// Original Rina: no compiled numeric script and no SQL shop fallback.
const NPC_ID = 1010100;
const ROUTING = {
  routing: {
    nameOverride: {
      operator: "ends-with",
      value: "Maple TV",
      script: "mapleTV",
    },
  },
  namedScripts: { mapleTV: { precedence: "maple-tv-name" } },
};

const PROGRAM = {
  start: 0,
  nodes: [
    {
      id: 0,
      text: "Need anything?",
      options: [
        { label: "Tell me more", next: 1 },
        { label: "Goodbye", next: null },
      ],
    },
    {
      id: 1,
      text: "It is a small island.",
      options: [{ label: "Back", next: 0 }],
    },
  ],
};

/** The loaded content keeps its prototype methods; only the overlay index differs. */
function contentView(dialogues) {
  const view = Object.create(Object.getPrototypeOf(content));
  Object.assign(view, content);
  view.catalog = { ...content.catalog, dialogues };
  return view;
}

function fixture(dialogues = { [NPC_ID]: PROGRAM }, npcId = NPC_ID) {
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
  const npc = { id: "npc:authored", templateId: npcId };
  const world = {
    content: contentView(dialogues),
    actors: new Map([[actor.id, actor]]),
    npc: () => npc,
    publish: (recipient, message) =>
      events.push({ recipient: recipient.id, ...message }),
  };
  return { actor, world, events };
}

function open(probe) {
  return executeNpc(
    probe.actor,
    {
      expectedRevision: probe.actor.revision,
      action: { kind: "npc.open", npcId: "npc:authored" },
    },
    probe.world,
  );
}

function answer(probe, value, step = probe.actor.conversation.step) {
  return executeNpc(
    probe.actor,
    {
      expectedRevision: step,
      action: {
        kind: "npc.answer",
        conversationId: probe.actor.conversation.id,
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

/** The published content hash is the only path a client has to authored prose. */
function nodeText(probe) {
  const event = latest(probe);
  return getInteractionContent(probe.world, probe.actor, event.contentId).text;
}

function routeFor(dialogue, reference = null) {
  return resolveNpcRoute(
    {
      routes: reference ? new Map([[NPC_ID, reference]]) : new Map(),
      data: ROUTING,
      shops: new Map(),
    },
    { templateId: NPC_ID },
    {
      dialogues: dialogue,
      quests: { strings: { npc: { [NPC_ID]: "Rina" } } },
    },
  );
}

function codeFor(run) {
  try {
    run();
    return null;
  } catch (error) {
    return error.code ?? error.message;
  }
}

test("an authored dialogue opens at its start node with bounded choice rows", async () => {
  const probe = fixture();
  expect((await open(probe)).status).toBe("committed");
  expect(probe.actor.conversation.authored).toMatchObject({ start: 0 });
  expect(latest(probe)).toMatchObject({
    kind: "dialogue",
    step: 1,
    npcTemplateId: NPC_ID,
    native: {
      kind: "choice",
      speaker: 0,
      prev: false,
      next: false,
      defaultValue: null,
    },
    choices: [0, 1],
    input: "choice",
    minimum: null,
    maximum: null,
  });
  expect(nodeText(probe)).toBe(
    "Need anything?\r\n#L0# Tell me more#l\r\n#L1# Goodbye#l",
  );
  // The original client parser must recover exactly the published option set.
  expect(questChoices(nodeText(probe))).toEqual(latest(probe).choices);
});

test("authored choices walk the graph, revisit a node, and a null next closes it", async () => {
  const probe = fixture();
  await open(probe);
  const before = structuredClone(probe.actor.profile);
  const conversationId = probe.actor.conversation.id;
  expect((await answer(probe, { kind: "choice", choiceId: 0 })).status).toBe(
    "committed",
  );
  expect(latest(probe).step).toBe(2);
  expect(nodeText(probe)).toBe("It is a small island.\r\n#L0# Back#l");
  expect((await answer(probe, { kind: "choice", choiceId: 0 })).status).toBe(
    "committed",
  );
  expect(nodeText(probe)).toBe(
    "Need anything?\r\n#L0# Tell me more#l\r\n#L1# Goodbye#l",
  );
  expect((await answer(probe, { kind: "choice", choiceId: 1 })).status).toBe(
    "committed",
  );
  expect(probe.actor.conversation).toBeNull();
  expect(latest(probe)).toEqual({
    kind: "dialogue.closed",
    conversationId,
  });
  expect(probe.actor.profile).toEqual(before);
});

test("a final plain node ends the conversation on next", async () => {
  const probe = fixture({
    [NPC_ID]: {
      start: 0,
      nodes: [{ id: 0, text: "Come back later.", options: [] }],
    },
  });
  await open(probe);
  expect(latest(probe)).toMatchObject({
    native: { kind: "say", next: false },
    choices: [],
    input: "next",
  });
  expect(nodeText(probe)).toBe("Come back later.");
  await expect(
    answer(probe, { kind: "choice", choiceId: 0 }),
  ).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  expect((await answer(probe, { kind: "next" })).status).toBe("committed");
  expect(probe.actor.conversation).toBeNull();
});

test("an NPC with quest offers hands its menu talk option to the authored dialogue", async () => {
  const probe = fixture({ 20100: PROGRAM }, 20100);
  expect((await open(probe)).status).toBe("committed");
  expect(probe.actor.conversation.menu.length).toBeGreaterThan(0);
  expect(latest(probe).choices).toContain(0);
  expect((await answer(probe, { kind: "choice", choiceId: 0 })).status).toBe(
    "committed",
  );
  expect(probe.actor.conversation.menu).toBeNull();
  expect(probe.actor.conversation.authored).toMatchObject({ start: 0 });
  expect(latest(probe)).toMatchObject({
    step: 2,
    native: { kind: "choice" },
    choices: [0, 1],
  });
});

test("a choice outside the published option set is refused and cancel closes", async () => {
  const probe = fixture();
  await open(probe);
  for (const choiceId of [2, -1, "0", undefined]) {
    await expect(
      answer(probe, { kind: "choice", choiceId }),
    ).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  }
  await expect(answer(probe, { kind: "next" })).rejects.toMatchObject({
    code: "INVALID_MESSAGE",
  });
  expect(probe.actor.conversation.authored).toMatchObject({ start: 0 });
  expect((await answer(probe, { kind: "cancel" })).status).toBe("committed");
  expect(probe.actor.conversation).toBeNull();
});

test("policy routes and the Maple TV name override outrank an authored dialogue", () => {
  const dialogue = { [NPC_ID]: PROGRAM };
  expect(
    routeFor(dialogue, { status: "blocked", precedence: "duey" }),
  ).toMatchObject({ precedence: "duey" });
  expect(
    routeFor(dialogue, { status: "blocked", precedence: "gachapon" }),
  ).toMatchObject({ precedence: "gachapon" });
  expect(
    resolveNpcRoute(
      { routes: new Map(), data: ROUTING, shops: new Map() },
      { templateId: NPC_ID },
      {
        dialogues: dialogue,
        quests: { strings: { npc: { [NPC_ID]: "Rina Maple TV" } } },
      },
    ),
  ).toEqual({ precedence: "maple-tv-name" });
});

test("authored dialogue outranks the compiled script and its absence keeps the script", () => {
  const script = { status: "supported", precedence: "numeric-script" };
  expect(routeFor({ [NPC_ID]: PROGRAM }, script)).toMatchObject({
    status: "supported",
    precedence: "authored-dialogue",
    dialogue: { start: 0 },
  });
  expect(routeFor({}, script)).toMatchObject({ precedence: "numeric-script" });
  expect(routeFor(undefined, script)).toMatchObject({
    precedence: "numeric-script",
  });
  expect(routeFor(undefined)).toBeNull();
});

test("an untrusted authored graph is refused whole as CONTENT_MISMATCH", () => {
  const node = (id, extra = {}) => ({
    id,
    text: "Line",
    options: [],
    ...extra,
  });
  const cases = [
    ["duplicate node ids", { start: 0, nodes: [node(0), node(0)] }],
    ["out-of-range node id", { start: 0, nodes: [node(5)] }],
    ["missing text", { start: 0, nodes: [{ id: 0, options: [] }] }],
    ["empty text", { start: 0, nodes: [node(0, { text: "" })] }],
    ["text markup", { start: 0, nodes: [node(0, { text: "#bLine#k" })] }],
    ["text over 512", { start: 0, nodes: [node(0, { text: "x".repeat(513) })] }],
    ["invalid start", { start: 4, nodes: [node(0)] }],
    ["missing nodes", { start: 0 }],
    ["seventeen nodes", { start: 0, nodes: Array.from({ length: 17 }, (_, id) => node(id)) }],
    [
      "seven options",
      {
        start: 0,
        nodes: [
          node(0, {
            options: Array.from({ length: 7 }, () => ({ label: "ok", next: 0 })),
          }),
        ],
      },
    ],
    [
      "option markup",
      {
        start: 0,
        nodes: [node(0, { options: [{ label: "#bWhy#k", next: 0 }] })],
      },
    ],
    [
      "label over 64",
      {
        start: 0,
        nodes: [node(0, { options: [{ label: "y".repeat(65), next: 0 }] })],
      },
    ],
    [
      "dangling next",
      {
        start: 0,
        nodes: [node(0, { options: [{ label: "Why", next: 9 }] })],
      },
    ],
    [
      "missing next",
      {
        start: 0,
        nodes: [node(0, { options: [{ label: "Why" }] })],
      },
    ],
  ];
  for (const [label, dialogue] of cases) {
    expect([label, codeFor(() => routeFor({ [NPC_ID]: dialogue }))]).toEqual([
      label,
      "CONTENT_MISMATCH",
    ]);
  }
});

test("a graph at exactly every authored bound is admitted", () => {
  const max = {
    start: 15,
    nodes: Array.from({ length: 16 }, (_, id) => ({
      id,
      text: "x".repeat(512),
      options: Array.from({ length: 6 }, () => ({
        label: "y".repeat(64),
        next: id,
      })),
    })),
  };
  expect(routeFor({ [NPC_ID]: max })).toMatchObject({
    status: "supported",
    precedence: "authored-dialogue",
    dialogue: { start: 15 },
  });
});
