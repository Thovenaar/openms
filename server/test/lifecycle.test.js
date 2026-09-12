import { expect, test } from "bun:test";
import { GameplayGateway } from "../src/gateway.js";
import { OnlineWorld } from "../src/world.js";
import { transitionActor } from "../src/field-transition.js";

function fixture() {
  const persisted = [];
  const released = [];
  const database = {
    async checkpoint(actor) {
      persisted.push(structuredClone(actor.profile));
    },
    async releaseLease(actor) {
      released.push(actor.id);
    },
  };
  const world = new OnlineWorld({ content: {}, database, publish() {} });
  const gateway = new GameplayGateway({
    config: {},
    auth: {},
    database,
    world,
  });
  const session = { id: "session", accountId: "account", revoked: false };
  const field = {
    epoch: "source",
    characters: new Map(),
    mobs: [],
    npcs: new Map(),
    drops: new Map(),
    manifest: {},
  };
  const actor = {
    id: "character",
    accountId: session.accountId,
    sessionId: session.id,
    session,
    field,
    state: "active",
    portalUntil: 0,
    pending: false,
    profile: { hp: 100, mp: 20, location: { mapId: "100000000", x: 0, y: 0 } },
    simulation: {},
  };
  field.characters.set(actor.id, actor);
  world.actors.set(actor.id, actor);
  gateway.accounts.set(actor.accountId, actor);
  gateway.characters.set(actor.id, actor);
  return { actor, field, gateway, world, session, persisted, released };
}

test("logout removes combat lookup and snapshots before an in-flight transition settles", async () => {
  const probe = fixture();
  const destination = Promise.withResolvers();
  probe.world.fieldFor = () => destination.promise;
  probe.actor.pending = true;
  const transfer = transitionActor(
    probe.world,
    probe.actor,
    { mapId: 100000001 },
    {},
  );
  const settled = transfer
    .catch((error) => error.code)
    .finally(() => {
      probe.actor.pending = false;
    });
  probe.session.revoked = true;
  const logout = probe.gateway.logout(probe.session);
  expect(probe.world.entities(probe.actor)).toEqual([]);
  expect(() =>
    probe.world.nearby(probe.actor, probe.actor.id, "player", 100),
  ).toThrow();
  expect(probe.released).toEqual([]);
  destination.resolve({ characters: new Map() });
  expect(await settled).toBe("SESSION_EXPIRED");
  await logout;
  expect(probe.actor.state).toBe("retired");
  expect(probe.field.characters.has(probe.actor.id)).toBe(false);
  expect(probe.gateway.accounts.has(probe.actor.accountId)).toBe(false);
  expect(probe.persisted[0].hp).toBe(100);
  expect(probe.released).toEqual([probe.actor.id]);
});

test("transfer drains only its known old field and baselines before destination ready", () => {
  const { gateway, actor } = fixture();
  actor.field.epoch = "destination";
  const data = {
    actor,
    ready: false,
    baselines: new Map([["new", 8]]),
    transfer: { sourceEpoch: "source", baselines: new Map([["old", 4]]) },
  };
  actor.eventSeq = 8;
  expect(
    gateway.admitField(data, { type: "input", fieldEpoch: "source" }),
  ).toBe(false);
  expect(
    gateway.admitField(data, {
      type: "ack",
      fieldEpoch: "source",
      snapshotId: "old",
      eventSeq: 4,
    }),
  ).toBe(false);
  expect(() =>
    gateway.admitField(data, {
      type: "ack",
      fieldEpoch: "source",
      snapshotId: "invented",
      eventSeq: 4,
    }),
  ).toThrow();
  gateway.ready({ data }, { snapshotId: "new" });
  expect(() =>
    gateway.admitField(data, { type: "input", fieldEpoch: "source" }),
  ).toThrow();
});

test("transient socket close retains authoritative presence for reconnect", () => {
  const { gateway, actor, world } = fixture();
  const socket = { data: { actor } };
  actor.connection = socket;
  gateway.closed(socket);
  expect(world.actors.get(actor.id)).toBe(actor);
  expect(actor.field.characters.get(actor.id)).toBe(actor);
  expect(actor.disconnectedAt).toBeGreaterThan(0);
});

test("dead logout checkpoints authored return-map arrival and restored HP before releasing", async () => {
  const probe = fixture();
  probe.actor.profile.hp = 0;
  probe.actor.profile.maxHP = 100;
  probe.field.manifest = {
    id: "100000000",
    physics: { map: { returnMap: 101000000 } },
  };
  probe.world.content.map = async () => ({
    id: "101000000",
    physics: { portals: [{ id: 0, x: 125, y: 300 }] },
  });
  probe.session.revoked = true;
  await probe.gateway.logout(probe.session);
  expect(probe.persisted[0].hp).toBe(50);
  expect(probe.persisted[0].location).toEqual({
    mapId: "101000000",
    x: 125,
    y: 290,
    facing: 1,
  });
  expect(probe.released).toEqual([probe.actor.id]);
});
