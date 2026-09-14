import { expect, test } from "bun:test";
import { publishNarrativeEvents } from "../src/interaction-npc-feedback.js";

function testWorld(publications) {
  return {
    publish(recipient, message) {
      publications.push({ recipient: recipient.id, message });
    },
    broadcast(field, message) {
      for (const actor of field.characters.values()) {
        this.publish(actor, message);
      }
    },
    deliveryFailed() {
      throw new Error("Unexpected delivery failure");
    },
  };
}

function questReward() {
  return {
    kind: "narrative.reward",
    source: "quest",
    sourceId: 1000,
    items: [],
    mesos: 0,
    exp: 15,
    fame: 0,
    levels: 1,
    questClear: true,
  };
}

test("quest level-ups publish private rewards and the foreign effect to every map participant", () => {
  const field = { epoch: "field", characters: new Map() };
  const owner = { id: "owner", field };
  const peer = { id: "peer", field };
  field.characters.set(owner.id, owner);
  field.characters.set(peer.id, peer);
  const publications = [];
  publishNarrativeEvents(
    owner,
    { applied: true, events: [questReward()] },
    testWorld(publications),
  );
  expect(
    publications
      .filter(({ message }) => message.event.kind === "narrative.reward")
      .map(({ recipient }) => recipient),
  ).toEqual([owner.id]);
  expect(
    publications.filter(
      ({ message }) => message.event.kind === "combat.level-up",
    ),
  ).toEqual([
    {
      recipient: owner.id,
      message: {
        type: "event",
        fieldEpoch: field.epoch,
        event: { kind: "combat.level-up", actorId: owner.id },
      },
    },
    {
      recipient: peer.id,
      message: {
        type: "event",
        fieldEpoch: field.epoch,
        event: { kind: "combat.level-up", actorId: owner.id },
      },
    },
  ]);
});
