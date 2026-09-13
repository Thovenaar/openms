import { expect, test } from "bun:test";
import {
  dropRotation,
  launchDrop,
  stepDropFlight,
} from "../src/world/drop-motion.js";
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

test("online artwork advances between90ms publications, wraps forward, freezes on pause and never rotates mesos", () => {
  const owner = { paused: false };
  const drops = new SceneDrops(owner);
  const animation = {
    container: { pivot: { set() {} } },
    frame: 0,
    current: { geometry: [{ x: -12, y: -24, width: 24, height: 24 }] },
    setPosition() {},
  };
  const view = {
    animation,
    observedAge: 15,
    entity: {
      templateId: 2000000,
      dropInfo: {},
      dropMotion: { state: "launching", age: 270, y: 0 },
    },
  };
  drops.observe(view, 0, 0);
  expect(animation.container.rotation).toBeCloseTo(Math.PI * 1.9);
  view.observedAge = 45;
  drops.observe(view, 0, 0);
  expect(animation.container.rotation).toBeCloseTo(Math.PI * 0.1);
  owner.paused = true;
  drops.observe(view, 0, 0);
  expect(animation.container.rotation).toBeCloseTo(Math.PI * 1.8);
  view.entity.templateId = 0;
  drops.observe(view, 0, 0);
  expect(animation.container.rotation).toBe(0);
});
