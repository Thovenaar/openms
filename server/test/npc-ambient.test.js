import { expect, test } from "bun:test";
import { loadContent } from "../src/content.js";
import { OnlineWorld } from "../src/world.js";
import { advanceNpcs } from "../src/field-npcs.js";
import { decodeServer } from "../../shared/protocol.js";
import { animationName } from "../../shared/motion-schema.js";

const content = await loadContent();
async function fixture() {
  const messages = [];
  const world = new OnlineWorld({
    content,
    database: {},
    publish: (actor, message) =>
      messages.push({ recipient: actor.id, ...message }),
  });
  world.nextUint32 = () => 0;
  const field = await world.fieldFor(50000);
  const npc = [...field.npcs.values()].find(
    (entry) => entry.templateId === 2003,
  );
  npc.ambient.cooldownMs = 30;
  return { world, field, npc, messages };
}
function step(probe, count = 1) {
  for (let index = 0; index < count; index++) {
    probe.field.tick++;
    advanceNpcs(probe.world, probe.field);
  }
}
function publish(probe, id) {
  probe.world.publishEntities({ id, field: probe.field });
  return probe.messages
    .at(-1)
    .entities.find((entry) => entry.id === probe.npc.id);
}
function wire(entity) {
  return {
    v: 1,
    type: "state",
    connectionEpoch: "connection",
    serverTick: 1,
    snapshotId: "snapshot",
    baseSnapshotId: "baseline",
    fieldEpoch: "field",
    eventSeq: 1,
    ackInputSeq: null,
    changes: [{ kind: "upsert", entity }],
  };
}

test("all map recipients and late joiners receive one server-selected authored NPC action and utterance", async () => {
  const probe = await fixture();
  step(probe);
  const first = publish(probe, "first");
  const second = publish(probe, "second");
  expect(first).toEqual(second);
  expect(first.npcSpeech).toEqual({
    actionIndex: 0,
    lineIndex: 0,
    startTick: 1,
  });
  expect(animationName(first.action)).toBe(
    probe.npc.template.speech.actions[0].action,
  );
  expect(decodeServer(JSON.stringify(wire(first))).changes[0].entity).toEqual(
    first,
  );
  step(probe, 10);
  expect(publish(probe, "late").npcSpeech).toEqual(first.npcSpeech);
});

test("native action duration returns to stand and expired speech is removed from snapshots", async () => {
  const probe = await fixture();
  step(probe);
  probe.npc.ambient.cooldownMs = 20000;
  step(probe, 167);
  const entity = publish(probe, "observer");
  expect(animationName(entity.action)).toBe(probe.npc.template.defaultAction);
  expect(entity.npcSpeech).toBeNull();
});

test("an active NPC conversation defers the shared ambient selection until it closes", async () => {
  const probe = await fixture();
  const actor = { state: "active", conversation: { npcId: probe.npc.id } };
  probe.field.characters.set("talking", actor);
  step(probe, 10);
  expect(probe.npc.npcSpeech).toBeNull();
  actor.conversation = null;
  step(probe);
  expect(probe.npc.npcSpeech.startTick).toBe(11);
});

test("NPC speech fields cannot be attached to monsters or contain unbounded authored indices", async () => {
  const probe = await fixture();
  step(probe);
  const entity = publish(probe, "observer");
  expect(() =>
    decodeServer(JSON.stringify(wire({ ...entity, kind: "mob" }))),
  ).toThrow();
  entity.npcSpeech.lineIndex = 4096;
  expect(() => decodeServer(JSON.stringify(wire(entity)))).toThrow();
});
