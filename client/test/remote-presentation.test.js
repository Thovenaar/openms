import { expect, test } from "bun:test";
import { RemoteMotion } from "../src/online/remote-motion.js";
import { RemotePlayerPath } from "../src/online/remote-player-path.js";
import { RemoteAnimationClock } from "../src/online/remote-animation-clock.js";
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
      ladder: null,
    },
  };
}

function remote(entity) {
  return new RemoteMotion(entity, 1, 0, new RemotePlayerPath(geometry()));
}

test("a peer crosses a connected slope and blends the next packet without mutating it", () => {
  const entity = player(),
    before = structuredClone(entity);
  const motion = remote(entity);
  expect(motion.sample(300).x).toBeGreaterThan(65);
  expect(motion.y).toBeGreaterThan(5);
  const x = motion.sample(450).x;
  const next = player("ground", 65, 7.5, [89.4, 44.7]);
  next.foothold = 2;
  motion.observe(next, 4, 450, null);
  expect(motion.x).toBeCloseTo(x);
  expect(motion.sample(480).x).toBeGreaterThan(x - 1);
  expect(entity).toEqual(before);
  motion.observe(player("ground", -80), 2, 500, null);
  expect(motion.tick).toBe(4);
});

test("a peer jump reaches its apex and lands during a delayed update instead of continuing upwards", () => {
  const motion = remote(player("air", 0, -20, [0, -200]));
  expect(motion.sample(90).y).toBeLessThan(-29);
  expect(motion.sample(300).y).toBe(0);
  expect(motion.sample(10000).y).toBe(0);
  expect(motion.trajectory.fault).toBeNull();
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
  expect(motion.sample(1090).x).toBeGreaterThan(10);
  expect(motion.y).toBeGreaterThan(-200);
});

test("ladder, buoyant motion and death preserve their own movement modes", () => {
  const entity = player("ladder", 10, 50, [0, -100]);
  entity.playerMotion.ladder = { x: 10, top: 20, bottom: 100 };
  const ladder = remote(entity);
  expect(ladder.sample(500).y).toBe(20);
  const fly = remote(player("fly", 0, -20, [30, -40]));
  expect(fly.sample(300).y).toBeCloseTo(-32);
  const dead = player("air", 0, -20, [30, -40]);
  dead.combatState.phase = "dead";
  expect(remote(dead).sample(300).y).toBe(-20);
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
