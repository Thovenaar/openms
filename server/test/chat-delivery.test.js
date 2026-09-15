import { expect, test } from "bun:test";
import { executeChat } from "../src/interaction-chat.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";

function fixture() {
  const field = { epoch: "field", characters: new Map() };
  const actors = new Map();
  for (const id of ["sender", "near", "far", "other-map"]) {
    const profile = createProfile({
      mapId: "000050000",
      x: 0,
      y: 0,
      facing: 1,
    });
    profile.name = id;
    const actor = {
      id,
      profile,
      field,
      socialRevision: 1,
      state: "active",
      session: { expiresAt: Date.now() + 60000 },
    };
    actors.set(id, actor);
    field.characters.set(id, actor);
  }
  actors.get("other-map").field = { epoch: "elsewhere" };
  field.characters.delete("other-map");
  const deliveries = [];
  const world = {
    actors,
    entities: () => [{ id: "near", kind: "player" }],
    publish: (actor, message) =>
      deliveries.push({ id: actor.id, event: message.event }),
    participants: {
      load: async (ids) =>
        new Map(ids.map((id) => [id, actors.get(id).profile])),
    },
  };
  return { world, actor: actors.get("sender"), deliveries };
}

function send(probe, channel, extra = {}) {
  return executeChat(
    probe.actor,
    {
      operationId: "chat-operation",
      expectedRevision: 1,
      fieldEpoch: "field",
      action: { kind: "chat.send", channel, text: "hello", ...extra },
    },
    probe.world,
  );
}

test("map history reaches sender and the whole map, independent of visibility, never other maps", async () => {
  const probe = fixture();
  await send(probe, "map");
  expect(probe.deliveries.map((entry) => entry.id)).toEqual([
    "sender",
    "near",
    "far",
  ]);
  expect(probe.deliveries[0].event.messageId).toBe("chat-operation");
  expect(
    new Set(probe.deliveries.map((entry) => entry.event.messageId)).size,
  ).toBe(1);
});

test("guild mirrors tolerate JSONB key ordering, reject changed membership and honor receiving preferences", async () => {
  const probe = fixture();
  probe.actor.profile.social.guild = {
    id: "guild",
    members: ["sender", "near"],
  };
  const peer = probe.world.actors.get("near");
  peer.profile.social.guild = { members: ["sender", "near"], id: "guild" };
  await send(probe, "guild");
  expect(probe.deliveries.map((entry) => entry.id)).toEqual(["sender", "near"]);
  probe.deliveries.length = 0;
  peer.profile.settings.gameOptions.allowGuildChat = false;
  await expect(send(probe, "guild")).rejects.toMatchObject({
    code: "NOT_ALLOWED",
  });
  expect(probe.deliveries).toHaveLength(0);
  peer.profile.social.guild.members = ["near"];
  await expect(send(probe, "guild")).rejects.toMatchObject({
    code: "NOT_ALLOWED",
  });
});

test("whispers never leak to map peers; blacklist and mute checks precede delivery", async () => {
  const probe = fixture();
  await send(probe, "whisper", { recipientId: "near" });
  expect(probe.deliveries.map((entry) => entry.id)).toEqual(["sender", "near"]);
  probe.deliveries.length = 0;
  probe.world.actors.get("near").profile.social.blacklist.push("sender");
  await expect(
    send(probe, "whisper", { recipientId: "near" }),
  ).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  probe.actor.profile.onlineState = { mutedUntil: Date.now() + 60000 };
  await expect(send(probe, "map")).rejects.toMatchObject({
    code: "NOT_ALLOWED",
  });
  expect(probe.deliveries).toHaveLength(0);
});
