import { expect, test } from "bun:test";
import { RemoteMotion } from "../src/online/remote-motion.js";
import { RemotePlayerPath } from "../src/online/remote-player-path.js";
import { RemoteAnimationClock } from "../src/online/remote-animation-clock.js";
import { OnlineScene } from "../src/online/scene.js";
import {
  DropPresentationMotion,
  projectDrop,
} from "../src/online/drop-presentation-motion.js";
import { prepareSegments } from "../src/physics/geometry.js";
import {
  launchDrop,
  stepDropFlight,
  hoverDrop,
  DROP_MOTION,
} from "../src/world/drop-motion.js";

function geometry() {
  const result = prepareSegments([
    {
      id: 1,
      x1: -100,
      y1: 0,
      x2: 50,
      y2: 0,
      prev: 0,
      next: 2,
      layer: 1,
      group: 1,
    },
    {
      id: 2,
      x1: 50,
      y1: 0,
      x2: 100,
      y2: 25,
      prev: 1,
      next: 0,
      layer: 1,
      group: 1,
    },
  ]);
  result.bounds = { left: -1000, right: 1000, top: -1000, bottom: 1000 };
  return result;
}

function player(state = "ground", x = 40, y = 0, [vx, vy] = [100, 0]) {
  return {
    id: "peer",
    kind: "player",
    position: { x, y },
    velocity: { x: vx, y: vy },
    foothold: state === "ground" ? 1 : null,
    action: 1,
    actionStartTick: 1,
    combatState: { phase: "idle", phaseMs: 0 },
    playerMotion: {
      state,
      gravity: 2000,
      fallSpeed: 600,
      ignoredFoothold: 0,
      contactLayer: 1,
      contactGroup: 4,
      ladder: null,
    },
  };
}

function remote(entity) {
  return new RemoteMotion(entity, 1, 0, new RemotePlayerPath(geometry()));
}

/** A flat, velocity-consistent peer: samples are exactly what 100 px/s produces. */
function flatPeer(x) {
  const entity = player("ground", x, 0, [100, 0]);
  entity.foothold = null;
  return entity;
}

test("a peer is interpolated between two publications without mutating the source", () => {
  const entity = flatPeer(40),
    before = structuredClone(entity);
  const motion = remote(entity);
  motion.observe(flatPeer(49), 2, 90, null);
  const drawn = [120, 150, 180, 210, 240, 270].map((ms) => motion.sample(ms).x);
  for (let index = 1; index < drawn.length; index++) {
    expect(drawn[index]).toBeGreaterThanOrEqual(drawn[index - 1]);
  }
  expect(drawn[drawn.length - 1]).toBeGreaterThan(drawn[0]);
  expect(entity).toEqual(before);
  motion.observe(flatPeer(-80), 1, 300, null);
  expect(motion.tick).toBe(2);
});

test("a jump coasts to rest instead of extrapolating through the floor", () => {
  const motion = remote(player("air", 0, -20, [0, -200]));
  let lowest = 0;
  for (let ms = 120; ms <= 4000; ms += 20) {
    lowest = Math.min(lowest, motion.sample(ms).y);
  }
  expect(lowest).toBeLessThan(-28);
  const held = motion.sample(20000).y;
  expect(held).toBeGreaterThan(-20);
  expect(motion.sample(60000).y).toBeCloseTo(held);
  expect(motion.trajectory.fault).toBeNull();
});

test("a jittery publication stream never draws a backward step", () => {
  const motion = remote(flatPeer(40));
  let previous = null,
    maxBack = 0,
    next = 0;
  for (let ms = 0; ms <= 4000; ms += 15) {
    if (ms >= next) {
      motion.observe(flatPeer(40 + ms * 0.1), ms / 30, ms, null);
      next = ms + 60 + ((ms * 7) % 61);
    }
    const x = motion.sample(ms).x;
    if (previous !== null) maxBack = Math.max(maxBack, previous - x);
    previous = x;
  }
  expect(maxBack).toBeLessThan(2);
});

test("a falling peer stays on its own arc instead of trailing a hundred pixels behind", () => {
  // Original globals: walkSpeed125, jumpSpeed555, fallSpeed670, gravityAcc2000.
  const motion = remote(player("air", 0, 0, [125, 670]));
  let tick = 1,
    next = 90,
    worst = 0,
    previous = null,
    risen = 0;
  for (let ms = 0; ms <= 2000; ms += 15) {
    while (ms >= next) {
      motion.observe(
        player("air", (125 * next) / 1000, (670 * next) / 1000, [125, 670]),
        ++tick,
        next,
        null,
      );
      next += 90;
    }
    const drawn = motion.sample(ms).y;
    const target = motion.evaluate(motion.renderTime(ms)).y;
    if (ms >= 300) worst = Math.max(worst, Math.abs(drawn - target));
    if (previous !== null) risen = Math.max(risen, previous - drawn);
    previous = drawn;
    motion.advance(15);
  }
  expect(worst).toBeLessThan(2);
  expect(risen).toBe(0);
});

test("a drifted pose is bent back into the path, and only a discontinuity is presented", () => {
  const motion = remote(player("ground", 0, 0, [0, 0]));
  motion.sample(200);
  // A walk-sized offset is chased over a few frames, never snapped.
  motion.x = 60;
  const first = motion.sample(205).x;
  expect(first).toBeLessThan(60);
  expect(first).toBeGreaterThan(0);
  expect(motion.sample(600).x).toBe(0);
  // An offset no reconstruction can explain is presented in one frame.
  motion.x = 150;
  expect(motion.sample(1600).x).toBe(0);
});

test("a peer teleport holds its destination until new movement arrives without retaining the old floor", () => {
  const source = player(),
    original = structuredClone(source),
    motion = remote(source);
  motion.sample(200);
  motion.relocate(10, -200, 200);
  expect([motion.sample(1000).x, motion.y]).toEqual([10, -200]);
  expect(source).toEqual(original);
  motion.observe(player("air", 10, -200, [100, 0]), 2, 1000, null);
  expect([motion.x, motion.y]).toEqual([10, -200]);
  expect(motion.sample(1200).x).toBeGreaterThan(10);
  expect(motion.y).toBeGreaterThan(-200);
});

test("ladder, buoyant motion and death preserve their own movement modes", () => {
  const entity = player("ladder", 10, 50, [0, -100]);
  entity.playerMotion.ladder = { x: 10, top: 20, bottom: 100 };
  const ladder = remote(entity);
  let climbing = 50;
  for (let ms = 150; ms <= 700; ms += 15) climbing = ladder.sample(ms).y;
  expect(climbing).toBeLessThan(50);
  expect(climbing).toBeGreaterThanOrEqual(20);
  const fly = remote(player("fly", 0, -20, [30, -40]));
  expect(fly.sample(1200).y).toBeLessThan(-25);
  const dead = player("air", 0, -20, [30, -40]);
  dead.combatState.phase = "dead";
  expect(remote(dead).sample(1200).y).toBe(-20);
});

test("a climbing peer keeps the published contact plane instead of the foothold it left", () => {
  const depths = [];
  const host = {
    footholds: new Map([[1, { layer: 1, group: 4 }]]),
    scene: {
      setEntityDepth: (animation, z) => depths.push([animation.id, z]),
    },
  };
  const climbing = player("ladder", 10, 50, [0, -100]);
  climbing.foothold = null;
  climbing.playerMotion.contactLayer = 2;
  climbing.playerMotion.contactGroup = 0;
  OnlineScene.prototype.updateViewDepth.call(host, {
    entity: climbing,
    animation: { id: "climb" },
  });
  expect(depths.pop()).toEqual(["climb", 29997 + (2 * 3000 - 0) * 10]);
  // A grounded peer without a published plane still follows its foothold.
  const grounded = player("ground", 40, 0, [100, 0]);
  delete grounded.playerMotion;
  grounded.foothold = 1;
  OnlineScene.prototype.updateViewDepth.call(host, {
    entity: grounded,
    animation: { id: "walk" },
  });
  expect(depths.pop()).toEqual(["walk", 29997 + (1 * 3000 - 4) * 10]);
});

test("remote attack phase does not rewind on delayed copies and resets for a new action", () => {
  const clock = new RemoteAnimationClock(),
    entity = player();
  clock.observe(entity);
  clock.advance(450);
  entity.combatState.phaseMs = 90;
  clock.observe(entity);
  expect(clock.phase).toBe(450);
  entity.actionStartTick++;
  entity.combatState.phaseMs = 0;
  clock.observe(entity);
  expect(clock.phase).toBe(0);
});

function drop(groundY = 0) {
  const slot = { itemId: 2000000 };
  launchDrop(slot, { x: 0, y: 0 }, { x: 25, y: groundY });
  return slot;
}
function entity(slot) {
  return {
    kind: "drop",
    templateId: slot.itemId,
    position: { x: slot.x, y: slot.y },
    dropInfo: { disappearing: false },
    dropMotion: { ...slot },
  };
}
function advance(slot) {
  slot.age += DROP_MOTION.quantumMs;
  slot.phaseAge += DROP_MOTION.quantumMs;
  if (slot.state === "waiting") {
    slot.state = "launching";
    slot.phaseAge = 0;
  } else if (slot.state === "grounded") hoverDrop(slot);
  else stepDropFlight(slot);
}

test("drop prediction matches original flight, falling, landing and hover at every native quantum", () => {
  for (const height of [-80, 0, 120]) {
    const slot = drop(height),
      source = entity(slot),
      projected = {};
    for (let ms = 0; ms <= 3000; ms += 30) {
      projectDrop(projected, source, ms);
      expect([
        projected.state,
        projected.phaseAge,
        projected.x,
        projected.y,
      ]).toEqual([slot.state, slot.phaseAge, slot.x, slot.y]);
      advance(slot);
    }
  }
});

test("drop flight/rotation and hover keep moving through long gaps; late packets do not rewind their clocks", () => {
  const slot = drop(),
    source = entity(slot),
    original = structuredClone(source);
  const motion = new DropPresentationMotion(source, 1, 0);
  motion.sample(270);
  const y = motion.y;
  expect(motion.rotation).not.toBe(motion.sample(300).rotation);
  expect(motion.y).toBeLessThan(y);
  motion.sample(1800);
  const hover = motion.renderY(12),
    age = motion.age;
  expect(motion.lower.state).toBe("grounded");
  for (let i = 0; i < 10; i++) advance(slot);
  motion.observe(entity(slot), 11, 1800);
  expect(motion.age).toBe(age);
  expect(motion.renderY(12)).toBeCloseTo(hover);
  expect(motion.sample(1900).renderY(12)).not.toBe(hover);
  expect(source).toEqual(original);
  motion.observe(original, 2, 2000);
  expect(motion.tick).toBe(11);
});

test("disappearing items finish their original fade locally while mesos never spin", () => {
  const source = entity(drop());
  source.dropInfo.disappearing = true;
  const fading = new DropPresentationMotion(source, 1, 0);
  expect(fading.sample(1200).alpha).toBe(0);
  expect(fading.visible).toBe(false);
  source.templateId = 0;
  const mesos = new DropPresentationMotion(source, 1, 0);
  expect(mesos.sample(450).rotation).toBe(0);
});

test("a publication exactly at the fall transition keeps its original endpoint before advancing", () => {
  const slot = drop(120);
  for (let i = 0; i < 40 && slot.state !== "falling"; i++) advance(slot);
  expect(slot.state).toBe("falling");
  const source = entity(slot),
    projected = {};
  projectDrop(projected, source, 0);
  expect(projected.y).toBe(slot.y);
  for (let i = 0; i < 10; i++) advance(slot);
  projectDrop(projected, source, 300);
  expect([
    projected.state,
    projected.phaseAge,
    projected.x,
    projected.y,
  ]).toEqual([slot.state, slot.phaseAge, slot.x, slot.y]);
});

test("a drop first seen at its spawn replays the whole launch, not the second half", () => {
  const slot = drop();
  // The authority has already flown for a while before the acknowledged entity frame reaches
  // an observer; the old anchor started the observer at that elapsed age.
  let advanced = 0;
  while (slot.state !== "launching" && advanced < 40) {
    advance(slot);
    advanced++;
  }
  for (let i = 0; i < 5; i++) {
    advance(slot);
    advanced++;
  }
  expect(slot.state).toBe("launching");
  expect(slot.age).toBeGreaterThan(60);
  const source = entity(slot);
  const motion = new DropPresentationMotion(source, 1, 0);
  // The projection itself is rewound to the authored origin, not merely the clock: the first
  // drawn frame is the start of the launch rather than the received mid-arc phase.
  expect(motion.lower.state).toBe("waiting");
  expect(motion.lower.phaseAge).toBe(0);
  expect(motion.lower.sourceX).toBe(slot.sourceX);
  expect(motion.lower.sourceY).toBe(slot.sourceY);
  expect(motion.age).toBeLessThan(slot.age);
  // It then advances through the same authored phases from that origin.
  motion.sample(60);
  expect(
    motion.lower.state === "waiting" || motion.lower.state === "launching",
  ).toBe(true);
  expect(motion.lower.phaseAge).toBeLessThan(60);
  let steps = 0;
  while (motion.lower.state === "launching" && steps < 200) {
    steps++;
    motion.sample(60 + (steps + 1) * 30);
  }
  expect(
    motion.lower.state === "falling" || motion.lower.state === "grounded",
  ).toBe(true);
});
