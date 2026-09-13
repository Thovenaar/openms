import { expect, test } from "bun:test";
import { Publications } from "../src/publication.js";
import { actorEntity } from "../src/field-views.js";
import { decodeServer, snapshotPartSchema } from "../../shared/protocol.js";
import { validate } from "../../shared/schema.js";

function fixture() {
  const sent = [];
  const actor = {
    field: { epoch: "field", tick: 123 },
    state: "active",
    eventSeq: 0,
  };
  const socket = {
    data: {
      actor,
      epoch: "connection",
      ready: true,
      ackSnapshotId: "old",
      baselines: new Map(),
    },
    getBufferedAmount: () => 0,
    send(text) {
      sent.push(text);
      return text.length;
    },
  };
  actor.connection = socket;
  const entities = Array.from({ length: 100 }, (_, index) =>
    actorEntity({
      id: crypto.randomUUID(),
      actionStartTick: 0,
      simulation: { x: index, y: 0, vx: 0, vy: 0, facing: 1, action: "stand1" },
      profile: {
        hp: 50,
        name: "界".repeat(32),
        gender: 0,
        appearance: { skin: 0, face: 20000, hair: 30000 },
        equipment: Array.from({ length: 12 }, (_, slot) => ({
          slot: -slot - 1,
          id: 1002000,
        })),
      },
    }),
  );
  const views = [{ kind: "entities", entities }];
  return {
    actor,
    socket,
    sent,
    entities,
    views,
    publications: new Publications({ snapshot: () => views }),
  };
}

test("valid crowded field snapshots split by UTF-8 wire bytes without losing entities", () => {
  const f = fixture();
  expect(validate(f.views[0], snapshotPartSchema)).toBe(f.views[0]);
  expect(Buffer.byteLength(JSON.stringify(f.views[0]))).toBeGreaterThan(65536);
  const frames = f.publications.snapshotFrames(f.actor, f.views, "snapshot", 1);
  expect(frames.length).toBeGreaterThan(1);
  const decoded = frames.map((frame) => {
    const text = JSON.stringify(f.publications.envelope(f.socket, frame));
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65536);
    return decodeServer(text);
  });
  expect(decoded.flatMap((frame) => frame.view.entities)).toEqual(f.entities);
  expect(decoded.map((frame) => frame.part)).toEqual(
    decoded.map((_, index) => index),
  );
  expect(decoded.every((frame) => frame.parts === decoded.length)).toBe(true);
});

test("oversized entity deltas fall back before advancing the baseline or sending partial state", () => {
  const f = fixture();
  f.publications.motion = () => {};
  f.publications.entities(f.actor, f.entities);
  expect(f.sent.length).toBeGreaterThan(1);
  expect(
    f.sent.map(decodeServer).every((frame) => frame.type === "snapshot"),
  ).toBe(true);
  expect(f.actor.eventSeq).toBe(1);
  expect(f.socket.data.baselines.size).toBe(1);
  expect(f.socket.data.knownEntities.size).toBe(100);
});

test("an indivisible oversized view and excessive aggregate snapshot remain explicit errors", () => {
  const f = fixture();
  const huge = { kind: "native-presentation", data: "x".repeat(65536) };
  expect(() =>
    f.publications.snapshotFrames(f.actor, [huge], "snapshot", 1),
  ).toThrow("SERVER_BUSY");
  const views = Array(64).fill({
    kind: "native-presentation",
    data: "x".repeat(20000),
  });
  expect(() =>
    f.publications.snapshotFrames(f.actor, views, "snapshot", 1),
  ).toThrow("SERVER_BUSY");
});
