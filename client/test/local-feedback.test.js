import { expect, test } from "bun:test";
import { NativeSocialChat } from "../src/online/native-social-chat.js";
import { LocalSkillFeedback } from "../src/online/local-skill-feedback.js";
import { SceneEvents } from "../src/online/scene-events.js";

function chatFixture() {
  const records = [],
    bubbles = [],
    cleared = [];
  const response = Promise.withResolvers();
  response.promise.operationId = "operation";
  const messages = {
    records,
    settle(id, delivery, reason) {
      Object.assign(
        records.find((row) => row.messageId === id),
        { delivery, reason },
      );
    },
  };
  const scene = {
    events: {
      async chat(event) {
        bubbles.push(event);
      },
      rejectChat(...args) {
        cleared.push(args);
      },
    },
  };
  const owner = {
    store: { id: "self", profile: { name: "Player" } },
    ui: {
      chat: {
        messages,
        receive(row) {
          records.push(row);
        },
      },
    },
    hooks: { scene: () => scene },
    blocked: () => false,
    command: () => response.promise,
    report(error) {
      throw error;
    },
  };
  return {
    chat: new NativeSocialChat({ owner }),
    records,
    bubbles,
    cleared,
    response,
  };
}

test("chat log and map speech appear before the reply and the matching echo settles one row", async () => {
  const f = chatFixture();
  const result = await f.chat.submit("hello", 7);
  expect(result.delivery).toBe("pending");
  expect(f.records).toHaveLength(1);
  expect(f.records[0].delivery).toBe("pending");
  expect(f.bubbles).toHaveLength(1);
  f.chat.receive(f.bubbles[0]);
  expect(f.records).toHaveLength(1);
  expect(f.records[0].delivery).toBe("server");
  f.response.resolve({ status: "committed" });
  await f.response.promise;
  f.chat.receive(f.bubbles[0]);
  expect(f.records).toHaveLength(1);
});

test("a rejected local chat is marked unsent and clears only its own bubble", async () => {
  const f = chatFixture();
  await f.chat.submit("hello", 7);
  f.response.resolve({ status: "rejected", code: "NOT_ALLOWED" });
  await f.response.promise;
  expect(f.records[0].delivery).toBe("failed");
  expect(f.cleared).toEqual([["self", "operation"]]);
});

test("prepared local speech displays synchronously and keeps its skin after refusal", async () => {
  const shown = [];
  const speech = {
    resource: {},
    root: { visible: true },
    remainingMs: 5000,
    show: (...args) => shown.push(args),
  };
  const events = Object.assign(Object.create(SceneEvents.prototype), {
    owner: { views: new Map([["self", { entity: { appearance: {} } }]]) },
    speech: new Map([["self", speech]]),
    seenChat: new Set(),
    speechMessages: new Map(),
  });
  const event = {
    senderId: "self",
    senderName: "Player",
    messageId: "one",
    text: "Hello",
  };
  const pending = events.chat(event);
  expect(shown).toEqual([["Hello", "Player"]]);
  await pending;
  await events.chat(event);
  expect(shown).toHaveLength(1);
  events.rejectChat("self", "old");
  expect(speech.remainingMs).toBe(5000);
  events.rejectChat("self", "one");
  expect(speech.root.visible).toBe(false);
  expect(events.speech.get("self")).toBe(speech);
  const second = events.chat({ ...event, messageId: "two" });
  expect(shown).toHaveLength(2);
  await second;
});

function skillFixture() {
  const sound = Promise.withResolvers(),
    visual = Promise.withResolvers();
  const started = [],
    stopped = [],
    containers = [],
    errors = [];
  const descriptor = {
    bundle: {
      url: "/generated/example.json",
      sha256: "a".repeat(64),
      bytes: 1,
    },
  };
  const scene = {
    presentation: { x: 20, y: 30, facing: 1 },
    addWorldContainer(node) {
      containers.push(node);
    },
    removeWorldContainer(node) {
      containers.splice(containers.indexOf(node), 1);
    },
  };
  const parent = skillParent({
    scene,
    sound,
    visual,
    descriptor,
    started,
    stopped,
    errors,
  });
  const manifest = emptyEffectManifest();
  return {
    feedback: new LocalSkillFeedback(parent),
    parent,
    sound,
    visual,
    started,
    stopped,
    containers,
    errors,
    manifest,
  };
}
function emptyEffectManifest() {
  return {
    schemaVersion: 1,
    id: "effect",
    metadata: {},
    atlases: {},
    textures: {},
    entities: [
      {
        id: "effect",
        kind: "effect",
        order: 0,
        x: 0,
        y: 0,
        z: 0,
        action: "play",
        actions: { play: [{ delay: 100, parts: [] }] },
      },
    ],
  };
}

function skillParent({
  scene,
  sound,
  visual,
  descriptor,
  started,
  stopped,
  errors,
}) {
  return {
    scene,
    controller: new AbortController(),
    prepareSound: () => sound.promise,
    owner: {
      scene,
      store: {
        id: "self",
        profile: { hp: 10, skills: { 1001: { level: 1 } } },
      },
      catalog: {
        ui: {
          skills: {
            1001: { levels: { 1: {} }, visuals: { effect: descriptor } },
          },
        },
      },
      services: { network: { json: () => visual.promise } },
      audio: {
        audio: {
          start(entry) {
            const voice = { entry };
            started.push(voice);
            return voice;
          },
          stopVoice(voice) {
            stopped.push(voice);
          },
        },
      },
      report(error) {
        errors.push(error);
      },
    },
  };
}

async function prepared(f) {
  f.sound.resolve({ users: 1 });
  f.visual.resolve(f.manifest);
  // Drain the finite promise chain through resource validation and display creation.
  for (let index = 0; index < 20; index++) await Promise.resolve();
  expect(f.errors).toEqual([]);
}

test("local skill artwork and sound start independently of confirmation; echoes and foreign casts are distinct", async () => {
  const f = skillFixture();
  const record = f.feedback.begin(1001, "cast");
  await prepared(f);
  expect(record.visualPlayed).toBe(true);
  expect(record.soundPlayed).toBe(true);
  expect(record.visual.container.x).toBe(20);
  expect(f.started).toHaveLength(1);
  const event = {
    actorId: "self",
    visual: { feedbackId: "cast", bundle: record.descriptor.bundle },
  };
  expect(f.feedback.visualEcho(event)).toBe(true);
  expect(f.feedback.visualEcho({ ...event, actorId: "peer" })).toBe(false);
  expect(
    f.feedback.soundEcho({ actorId: "self", feedbackId: "cast", leaf: "Use" }),
  ).toBe(true);
  expect(
    f.feedback.soundEcho({ actorId: "self", feedbackId: "cast", leaf: "Hit" }),
  ).toBe(false);
  f.feedback.reject(record);
  expect(f.containers).toHaveLength(0);
  expect(f.stopped).toHaveLength(1);
  f.feedback.destroy();
});

test("an earlier server cue wins a slow local load and scene exit cancels staged playback", async () => {
  for (const exit of [false, true]) {
    const f = skillFixture();
    const record = f.feedback.begin(1001, "cast");
    if (exit) f.feedback.destroy();
    else {
      expect(
        f.feedback.visualEcho({
          actorId: "self",
          visual: { feedbackId: "cast", bundle: record.descriptor.bundle },
        }),
      ).toBe(false);
      expect(
        f.feedback.soundEcho({
          actorId: "self",
          feedbackId: "cast",
          leaf: "Use",
        }),
      ).toBe(false);
    }
    await prepared(f);
    expect(f.containers).toHaveLength(0);
    expect(f.started).toHaveLength(0);
    f.feedback.destroy();
  }
});

test("Flash Jump artwork stays at the local cast origin while ordinary Use effects follow", async () => {
  const f = skillFixture();
  const descriptor = f.parent.owner.catalog.ui.skills[1001].visuals.effect;
  f.parent.owner.catalog.ui.skills[4111006] = {
    levels: { 1: {} },
    visuals: {},
  };
  f.parent.owner.catalog.ui.skillWorld = { effects: { Flying: descriptor } };
  f.parent.owner.store.profile.skills[4111006] = { level: 1 };
  const flying = f.feedback.begin(4111006, "flying");
  const ordinary = f.feedback.begin(1001, "ordinary");
  await prepared(f);
  f.parent.scene.presentation.x = 80;
  f.feedback.draw(10);
  expect(flying.visual.container.x).toBe(20);
  expect(ordinary.visual.container.x).toBe(80);
  f.feedback.destroy();
});

test("completed confirmed casts make room so sustained play does not exhaust local feedback", async () => {
  const f = skillFixture();
  await prepared(f);
  for (let index = 0; index < 40; index++) {
    const record = f.feedback.begin(1001, `cast-${index}`);
    expect(record).not.toBeNull();
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    record.confirmed = true;
    f.feedback.draw(200);
  }
  expect(f.feedback.records.size).toBeLessThanOrEqual(32);
  f.feedback.destroy();
  expect(f.containers).toHaveLength(0);
});
