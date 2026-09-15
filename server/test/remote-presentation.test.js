import { expect, test } from "bun:test";
import { actorEntity } from "../src/field-views.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { decodeServer } from "../../shared/protocol.js";

function message(entity) {
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

test("peer projection publishes detached effective gravity and ladder limits in a compact validated view", () => {
  const profile = createProfile({ mapId: "000050000", x: 0, y: 0, facing: 1 });
  const sim = {
    x: 20,
    y: 30,
    vx: 0,
    vy: -100,
    facing: 1,
    action: "ladder",
    state: "ladder",
    effectiveSettings: { gravityAcc: 2000, gravity: 0.5, fallSpeed: 600 },
    ignoredFootholdId: 2,
    ladder: { x: 20, y1: 0, y2: 90 },
  };
  const view = actorEntity({
    id: "player",
    profile,
    simulation: sim,
    actionStartTick: 1,
  });
  const projection = decodeServer(JSON.stringify(message(view))).changes[0]
    .entity.playerMotion;
  expect(projection).toEqual({
    state: "ladder",
    gravity: 1000,
    fallSpeed: 300,
    ignoredFoothold: 2,
    ladder: { x: 20, top: 0, bottom: 90 },
  });
  expect(JSON.stringify(projection).length).toBeLessThan(200);
  sim.ladder.x = 999;
  expect(view.playerMotion.ladder.x).toBe(20);
  view.playerMotion.gravity = -1;
  expect(() => decodeServer(JSON.stringify(message(view)))).toThrow(
    "INVALID_MESSAGE",
  );
  view.playerMotion.gravity = 1000;
  view.kind = "mob";
  view.appearance = null;
  expect(() => decodeServer(JSON.stringify(message(view)))).toThrow(
    "INVALID_MESSAGE",
  );
});
