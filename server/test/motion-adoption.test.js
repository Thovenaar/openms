import { expect, test } from "bun:test";
import { loadContent } from "../src/content.js";
import { OnlineWorld } from "../src/world.js";
import { prepareActorCombat } from "../src/field-combat.js";
import { prepareActorSkills, disposeActorSkills } from "../src/field-skills.js";
import { MotionWatchdog } from "../src/watchdog.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { createSimulation } from "../../client/src/physics/simulation.js";
import { stepMotion, captureMotion } from "../../shared/motion.js";
import {
  MOTION_PLAUSIBILITY,
  PROTOCOL,
  decodeServer,
  plausiblePositionPx,
} from "../../shared/protocol.js";
import { recordMotionDivert, takeMotionDiverts } from "../src/field-diverts.js";

const content = await loadContent();

/** Real field, real kernel and the real moveActor admission path; only persistence and
 *  mob population are isolated, so nothing about the wire contract is stubbed. */
async function fixture() {
  const publications = [];
  const events = [];
  const world = new OnlineWorld({
    content,
    database: {},
    publish(actor, message) {
      publications.push({ actor: actor.id, message });
    },
    log(event, detail) {
      events.push({ event, detail });
    },
  });
  const field = await world.fieldFor(100000000);
  field.mobs = [];
  const saved = { mapId: field.manifest.id, x: 0, y: 0, facing: 1 };
  const profile = createProfile(saved);
  profile.hp = 100;
  profile.maxHP = 100;
  profile.mp = 10;
  profile.maxMP = 10;
  recalculateVitals(profile, content.items);
  profile.onlineState = { effects: [], cooldowns: {} };
  const actor = {
    id: "watched",
    profile,
    revision: 0,
    session: { expiresAt: Date.now() + 60000 },
  };
  world.prepareEntry(actor, field);
  prepareActorCombat(world, actor);
  await prepareActorSkills(world, actor);
  actor.state = "active";
  field.characters.set(actor.id, actor);
  world.actors.set(actor.id, actor);
  return { world, field, actor, publications, events };
}

function recalculateVitals(profile, items) {
  profile.maxHP = 100;
  profile.maxMP = 10;
  profile.hp = Math.min(profile.hp, profile.maxHP);
  profile.mp = Math.min(profile.mp, profile.maxMP);
  void items;
}

/** Place the server's simulation at a known base so an adoption delta is exact. */
function place(actor, x, y) {
  const sim = actor.simulation;
  sim.x = x;
  sim.y = y;
  sim.previousX = x;
  sim.previousY = y;
  sim.vx = 0;
  sim.vy = 0;
  actor.lastAdoptedTick = actor.field.tick;
}

function faults(probe) {
  return probe.events.filter(
    (entry) =>
      entry.event === "watchdog.fault" || entry.event === "motion.fault",
  );
}

/** A kernel step from the client-reported base, using the input the server consumed. */
function stepFrom(probe, report) {
  const sim = createSimulation(probe.field.manifest.physics, {
    x: report.x,
    y: report.y,
    facing: 1,
  });
  sim.x = report.x;
  sim.y = report.y;
  sim.previousX = report.x;
  sim.previousY = report.y;
  sim.vx = report.vx;
  sim.vy = report.vy;
  stepMotion(sim, probe.actor.input);
  return captureMotion(sim);
}

function dispose(probe) {
  for (const actor of probe.world.actors.values()) {
    disposeActorSkills(actor, true);
  }
}

let sequence = 0;
function input(actor, motion) {
  sequence++;
  return {
    fieldEpoch: actor.field.epoch,
    inputSeq: sequence,
    targetTick: actor.field.tick + 1,
    horizontal: 0,
    vertical: 0,
    jump: false,
    attack: false,
    ...(motion ? { motion } : {}),
  };
}

function advance(probe, ticks) {
  for (let count = 0; count < ticks; count++) {
    probe.field.tick++;
    probe.world.moveActor(probe.actor);
  }
}

test("a client-reported position inside the envelope becomes the server's state", async () => {
  const probe = await fixture();
  try {
    const { world, field, actor } = probe;
    actor.simulation.x = 0;
    actor.simulation.y = 0;
    actor.simulation.vx = 0;
    actor.simulation.vy = 0;
    const report = { x: 3, y: -1, vx: 120, vy: 0 };
    world.input(actor, input(actor, report));
    advance(probe, 1);
    // The report is the base of this tick's step, not a target the kernel glides to.
    expect(actor.simulation.previousX).toBe(report.x);
    expect(actor.simulation.previousY).toBe(report.y);
    const expected = stepFrom(probe, report);
    expect(captureMotion(actor.simulation)).toEqual(expected);
    expect(faults(probe)).toEqual([]);
    expect(actor.lastAdoptedTick).toBe(field.tick);
  } finally {
    dispose(probe);
  }
});

test("a report without motion leaves the authoritative simulation untouched", async () => {
  const probe = await fixture();
  try {
    const { world, actor } = probe;
    actor.simulation.x = 12;
    actor.simulation.y = 0;
    world.input(actor, input(actor, null));
    advance(probe, 1);
    expect(actor.simulation.x).not.toBe(12 + 40);
    expect(actor.lastAdoptedTick).toBe(0);
  } finally {
    dispose(probe);
  }
});

test("a seat, a lock or a pending hit refuses adoption", async () => {
  const probe = await fixture();
  try {
    const { world, actor } = probe;
    const report = { x: 5, y: -2, vx: 100, vy: 0 };
    actor.simulation.movementLocked = true;
    world.input(actor, input(actor, report));
    advance(probe, 1);
    expect(actor.simulation.x).not.toBe(report.x);
    actor.simulation.movementLocked = false;
    actor.simulation.seat = { x: 0, y: 0 };
    world.input(actor, input(actor, { x: 9, y: -3, vx: 100, vy: 0 }));
    advance(probe, 1);
    expect(actor.simulation.previousX).not.toBe(9);
    expect(faults(probe)).toEqual([]);
    expect(actor.lastAdoptedTick).toBe(0);
  } finally {
    dispose(probe);
  }
});

test("an isolated deviation is adopted and only recorded, never punished", async () => {
  const probe = await fixture();
  try {
    const { world, actor } = probe;
    // 40 px in one tick: outside the gap envelope, far inside the absurd bound.
    place(actor, 0, 0);
    const report = { x: 40, y: 0, vx: 0, vy: 0 };
    world.input(actor, input(actor, report));
    advance(probe, 1);
    expect(actor.simulation.previousX).toBe(40);
    expect(faults(probe)).toEqual([]);
    expect(world.watchdog.snapshot().suspicious).toBe(1);
  } finally {
    dispose(probe);
  }
});

test("repeated deviations inside one window close the session", async () => {
  const probe = await fixture();
  try {
    const { world, field, actor } = probe;
    const limit = 6;
    for (let count = 0; count < limit && !actor.retiring; count++) {
      field.tick += 1;
      place(actor, 0, 0);
      world.input(actor, input(actor, { x: 40, y: 0, vx: 0, vy: 0 }));
      advance(probe, 1);
    }
    expect(faults(probe).length).toBeGreaterThanOrEqual(1);
    expect(actor.retiring).toBe(true);
    const closing = probe.publications.filter(
      (entry) => entry.message.type === "closing",
    );
    expect(closing.at(-1)?.message.code).toBe("NOT_ALLOWED");
  } finally {
    dispose(probe);
  }
});

test("one impossible report faults immediately and is not adopted", async () => {
  const probe = await fixture();
  try {
    const { world, actor } = probe;
    place(actor, 0, 0);
    const teleport = plausiblePositionPx(PROTOCOL.TICK_MS) * 10;
    world.input(actor, input(actor, { x: teleport, y: 0, vx: 0, vy: 0 }));
    advance(probe, 1);
    expect(actor.simulation.previousX).not.toBe(teleport);
    expect(actor.retiring).toBe(true);
    expect(probe.events.some((entry) => entry.event === "watchdog.fault")).toBe(
      true,
    );
  } finally {
    dispose(probe);
  }
});

test("the envelope scales with the gap so a reconnect keeps the client's position", async () => {
  const probe = await fixture();
  try {
    const { world, field, actor } = probe;
    // Three seconds of walking: 100 ticks at the kernel quantum.
    const gapTicks = 100;
    actor.lastAdoptedTick = 0;
    field.tick = gapTicks;
    const walked = { x: 600, y: 0, vx: 45, vy: 0 };
    expect(plausiblePositionPx(gapTicks * PROTOCOL.TICK_MS)).toBeGreaterThan(
      600,
    );
    world.adoptResumedMotion(actor, walked);
    expect(actor.simulation.x).toBe(walked.x);
    expect(actor.profile.location.x).toBe(walked.x);
    expect(faults(probe)).toEqual([]);
  } finally {
    dispose(probe);
  }
});

test("a resume beyond any possible motion is refused", async () => {
  const probe = await fixture();
  try {
    const { field, actor } = probe;
    field.tick = 100;
    actor.lastAdoptedTick = 0;
    const impossible = { x: 900000, y: 0, vx: 0, vy: 0 };
    expect(() => probe.world.adoptResumedMotion(actor, impossible)).toThrow(
      "NOT_ALLOWED",
    );
    expect(actor.simulation.x).not.toBe(impossible.x);
    expect(actor.retiring).toBe(true);
  } finally {
    dispose(probe);
  }
});

test("position tolerance scales with elapsed time and velocity does not", () => {
  expect(MOTION_PLAUSIBILITY.minimumPositionPx).toBe(32);
  expect(plausiblePositionPx(0)).toBe(32);
  expect(plausiblePositionPx(30)).toBe(32);
  expect(plausiblePositionPx(100)).toBeCloseTo(90, 6);
  expect(plausiblePositionPx(Number.NaN)).toBe(32);
  expect(plausiblePositionPx(-5)).toBe(32);
  expect(MOTION_PLAUSIBILITY.velocityPxPerSecond).toBe(700);
});

test("a recorded divert is published on the wire and validates as a server frame", async () => {
  const probe = await fixture();
  try {
    const { world, field, actor, publications } = probe;
    field.tick += 1;
    recordMotionDivert(actor, actor.simulation, {
      vx: 300,
      vy: -250,
      source: "hit",
    });
    const before = captureMotion(actor.simulation);
    field.tick += 1;
    world.publish(actor, {
      type: "motion",
      fieldEpoch: field.epoch,
      ackInputSeq: actor.ackInputSeq,
      motion: captureMotion(actor.simulation),
      paused: false,
      diverts: takeMotionDiverts(actor, field),
    });
    const motion = publications.find(
      (entry) => entry.message.type === "motion",
    );
    expect(motion).toBeDefined();
    const divert = motion.message.diverts[0];
    // The published tick is the one that first integrates the impulse, and `before`
    // is the checkpoint of the tick before it.
    expect(divert.tick).toBe(field.tick);
    expect(divert.vx).toBe(300);
    expect(divert.vy).toBe(-250);
    expect(divert.source).toBe("hit");
    expect(divert.before).toEqual(before);
    // An empty divert list is the ordinary tick, not an omitted field.
    world.publish(actor, {
      type: "motion",
      fieldEpoch: field.epoch,
      ackInputSeq: actor.ackInputSeq,
      motion: captureMotion(actor.simulation),
      paused: false,
      diverts: takeMotionDiverts(actor, field),
    });
    expect(publications.at(-1).message.diverts).toEqual([]);
    const frame = (message) =>
      decodeServer(
        JSON.stringify({
          v: 1,
          ...message,
          connectionEpoch: "epoch",
          serverTick: field.tick,
        }),
      );
    expect(frame(motion.message).diverts[0]).toEqual(divert);
    expect(frame(publications.at(-1).message).diverts).toEqual([]);
  } finally {
    dispose(probe);
  }
});

test("the watchdog counts deviations inside one window and forgets an actor", () => {
  const watchdog = new MotionWatchdog();
  const quiet = {
    position: 1,
    velocity: 1,
    allowedPosition: 32,
    allowedVelocity: 700,
  };
  expect(watchdog.review("a", 1, quiet)).toEqual({
    decision: "accept",
    suspicious: false,
    score: 0,
  });
  const edge = {
    position: 32,
    velocity: 700,
    allowedPosition: 32,
    allowedVelocity: 700,
  };
  expect(watchdog.review("a", 2, edge).suspicious).toBe(false);
  const justOutside = {
    position: 32.5,
    velocity: 700.5,
    allowedPosition: 32,
    allowedVelocity: 700,
  };
  expect(watchdog.review("a", 3, justOutside)).toEqual({
    decision: "accept",
    suspicious: true,
    score: 1,
  });
  for (let tick = 4; tick <= 8; tick++) {
    watchdog.review("a", tick, justOutside);
  }
  expect(watchdog.snapshot().faults).toBe(1);
  // Evidence ages out of its window, so an old deviation cannot convict forever.
  expect(watchdog.review("b", 4000, justOutside).decision).toBe("accept");
  expect(watchdog.review("b", 4000 + 900, justOutside).score).toBe(1);
  watchdog.forget("a");
  expect(watchdog.snapshot().actors.map((entry) => entry.id)).toEqual(["b"]);
});
