import { expect, test } from "bun:test";
import {
  dropRotation,
  launchDrop,
  stepDropFlight,
} from "../src/world/drop-motion.js";
import { DropPresentationMotion } from "../src/online/drop-presentation-motion.js";
import { SceneDrops } from "../src/online/scene-drops.js";

test("original clockwise300ms cycle remains continuous across fall and resets at landing", () => {
  const drop = { itemId: 2000000 };
  launchDrop(drop, { x: 0, y: 0 }, { x: 25, y: 120 });
  drop.state = "launching";
  drop.age = drop.phaseAge = 90;
  stepDropFlight(drop);
  expect(drop.rotation).toBeCloseTo(Math.PI * 0.6);
  expect(dropRotation(drop, 60)).toBeCloseTo(Math.PI);
  drop.age = drop.phaseAge = 1020;
  stepDropFlight(drop);
  expect(drop.state).toBe("falling");
  expect(dropRotation(drop)).toBeCloseTo(Math.PI * 0.8);
  drop.phaseAge = 330;
  stepDropFlight(drop);
  expect(drop.state).toBe("grounded");
  expect(dropRotation(drop, 10)).toBe(0);
});

test("online artwork uses its advancing visual clock, wraps forward and freezes when that clock holds", () => {
  const owner = { paused: false };
  const drops = new SceneDrops(owner);
  const animation = {
    container: { pivot: { set() {} } },
    frame: 0,
    current: { geometry: [{ x: -12, y: -24, width: 24, height: 24 }] },
    setPosition() {},
  };
  const slot = { itemId: 2000000 };
  launchDrop(slot, { x: 0, y: 0 }, { x: 25, y: 0 });
  slot.state = "launching";
  slot.age = slot.phaseAge = 270;
  stepDropFlight(slot);
  const entity = {
    kind: "drop",
    templateId: 2000000,
    dropInfo: {},
    position: { x: slot.x, y: slot.y },
    dropMotion: slot,
  };
  const view = {
    animation,
    entity,
    motion: new DropPresentationMotion(entity, 1, 0),
  };
  // This slot is already in flight when it is first seen (a late join), so it anchors to the
  // published age instead of replaying its launch from the start.
  view.motion.replay = false;
  view.motion.anchorAge = slot.age;
  view.motion.age = slot.age;
  view.motion.sample(0);
  view.motion.sample(15);
  drops.observe(view);
  expect(animation.container.rotation).toBeCloseTo(Math.PI * 1.9);
  view.motion.sample(45);
  drops.observe(view);
  expect(animation.container.rotation).toBeCloseTo(Math.PI * 0.1);
  const rotation = animation.container.rotation;
  owner.paused = true;
  drops.observe(view);
  expect(animation.container.rotation).toBe(rotation);
  // Mesos never spin; the drawn motion owns its own entity copy.
  view.motion.entity.templateId = 0;
  view.motion.sample(60);
  drops.observe(view);
  expect(animation.container.rotation).toBe(0);
});
