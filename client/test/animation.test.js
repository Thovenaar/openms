import { test, expect } from "bun:test";
import { Texture } from "pixi.js";
import { EntityAnimation } from "../src/rendering/animation.js";
import { extractLife } from "../tools/life-data.js";

function entity(additional = {}) {
  return new EntityAnimation(
    {
      id: "timing",
      kind: "character",
      x: 0,
      y: 0,
      z: 0,
      visible: true,
      flip: false,
      opacity: 1,
      action: "walk",
      actions: {
        walk: [
          { delay: 80, parts: [{ texture: "pixel", x: 0, y: 0, z: 0 }] },
          { delay: 120, parts: [{ texture: "pixel", x: 2, y: 0, z: 0 }] },
        ],
        still: [{ delay: 0, parts: [{ texture: "pixel", x: 4, y: 0, z: 0 }] }],
        fade: [
          {
            delay: 100,
            alphaEnd: 0,
            parts: [{ texture: "pixel", x: 0, y: 0, z: 0, opacity: 1 }],
          },
          {
            delay: 100,
            alphaEnd: 1,
            parts: [{ texture: "pixel", x: 0, y: 0, z: 0, opacity: 0 }],
          },
        ],
        ...additional,
      },
    },
    new Map([["pixel", Texture.EMPTY]]),
  );
}
test("variable elapsed time crosses exact boundaries, wraps cycles and resets actions", () => {
  const e = entity();
  e.advance(79.75);
  expect(e.frame).toBe(0);
  e.advance(0.25);
  expect(e.frame).toBe(1);
  expect(e.sprites[0].x).toBe(2);
  e.advance(720);
  expect(e.frame).toBe(0);
  expect(e.sprites[0].x).toBe(0);
  e.setAction("still");
  e.advance(1e6);
  expect(e.sprites[0].x).toBe(4);
  e.setAction("walk");
  expect(e.frame).toBe(0);
  expect(e.actionTimeMs).toBe(0);
  e.container.destroy({ children: true });
});
test("60 and 144 refresh-rate partitions keep the same game-time frame", () => {
  const a = entity(),
    b = entity();
  for (let i = 0; i < 600; i++) a.advance(1000 / 60);
  for (let i = 0; i < 1440; i++) b.advance(1000 / 144);
  a.advance(81);
  b.advance(81);
  expect(a.frame).toBe(1);
  expect(b.frame).toBe(1);
  expect(Math.abs(a.actionTimeMs - b.actionTimeMs)).toBeLessThan(1e-7);
  a.container.destroy({ children: true });
  b.container.destroy({ children: true });
});
test("alpha uses signed integer interpolation and switches endpoints without a stale frame", () => {
  const e = entity();
  e.setAction("fade");
  e.advance(50);
  expect(e.sprites[0].alpha).toBe(128 / 255);
  e.advance(50);
  expect(e.frame).toBe(1);
  expect(e.sprites[0].alpha).toBe(0);
  e.advance(50);
  expect(e.sprites[0].alpha).toBe(127 / 255);
  e.advance(50);
  expect(e.frame).toBe(0);
  expect(e.sprites[0].alpha).toBe(1);
  e.container.destroy({ children: true });
});

test("one-shot completion holds its last frame and repeated selection cannot restart it", () => {
  const e = entity();
  e.setAction("walk", "once");
  e.advance(199);
  expect(e.completed).toBe(false);
  e.setAction("walk", "once");
  e.advance(1);
  expect(e.completed).toBe(true);
  expect(e.sprites[0].x).toBe(2);
  e.advance(1000);
  expect(e.sprites[0].x).toBe(2);
  e.setAction("still", "once");
  expect(e.completed).toBe(true);
  expect(e.sprites[0].x).toBe(4);
  e.setAction("walk", "loop");
  e.advance(200);
  expect(e.completed).toBe(false);
  expect(e.sprites[0].x).toBe(0);
  e.container.destroy({ children: true });
});

test("stationary climb holds its authored frame while consuming only the remaining delay", () => {
  const e = entity();
  e.advance(90);
  e.holdFrame = true;
  e.advance(30);
  expect(e.sprites[0].x).toBe(2);
  e.holdFrame = false;
  e.advance(79);
  expect(e.sprites[0].x).toBe(2);
  e.advance(1);
  expect(e.sprites[0].x).toBe(0);
  e.advance(90);
  e.holdFrame = true;
  e.advance(900);
  expect(e.sprites[0].x).toBe(2);
  e.holdFrame = false;
  e.advance(30);
  expect(e.sprites[0].x).toBe(0);
  e.container.destroy({ children: true });
});

test("hit face survives body transitions and expires without restarting locomotion", () => {
  const face = [
    { texture: "pixel", x: 0, y: 0, z: 0, expression: "default" },
    { texture: "pixel", x: 1, y: 0, z: 1, expression: "hit" },
  ];
  const e = entity({
    faceWalk: [
      { delay: 80, parts: face },
      { delay: 120, parts: face },
    ],
    faceStill: [{ delay: 0, parts: face }],
  });
  e.setAction("faceWalk");
  e.advance(90);
  e.setExpression("hit", 1500);
  expect(e.actionTimeMs).toBe(90);
  expect(e.sprites[0].visible).toBe(false);
  expect(e.sprites[1].visible).toBe(true);
  e.advance(1000);
  e.setAction("faceStill", "once");
  e.advance(499);
  expect(e.sprites[1].visible).toBe(true);
  e.setAction("faceWalk");
  e.advance(1);
  expect(e.actionTimeMs).toBe(1);
  expect(e.sprites[0].visible).toBe(true);
  expect(e.sprites[1].visible).toBe(false);
  e.container.destroy({ children: true });
});

test("zero-delay boundaries skip immediately and terminal alpha applies without division", () => {
  const frames = [0, 100, 0, 100, 0].map((delay, index) => ({
    delay,
    alphaEnd: index === 4 ? 0 : 1,
    parts: [{ texture: "pixel", x: index, y: 0, z: 0 }],
  }));
  const e = entity({ instant: frames });
  e.setAction("instant", "once");
  expect(e.sprites[0].x).toBe(1);
  e.advance(100);
  expect(e.sprites[0].x).toBe(3);
  e.advance(100);
  expect(e.sprites[0].x).toBe(4);
  expect(e.sprites[0].alpha).toBe(0);
  expect(e.completed).toBe(true);
  e.setAction("instant", "loop");
  e.advance(200);
  expect(e.sprites[0].x).toBe(1);
  e.seek(100);
  expect(e.sprites[0].x).toBe(3);
  e.container.destroy({ children: true });
});

test("dead ghost circles independently of its footpoint, facing and completed body frame", () => {
  const e = entity({
    dead: [
      {
        delay: 0,
        parts: [{ texture: "pixel", x: -13, y: -27, z: 0 }],
      },
    ],
  });
  e.setPosition(120, 240);
  e.setAction("dead", "once");
  expect([e.sprites[0].x, e.sprites[0].y]).toEqual([-23, -47]);
  e.advance(500);
  expect([e.sprites[0].x, e.sprites[0].y]).toEqual([-13, -57]);
  e.advance(500);
  expect([e.sprites[0].x, e.sprites[0].y]).toEqual([-3, -47]);
  e.advance(500);
  expect([e.sprites[0].x, e.sprites[0].y]).toEqual([-13, -37]);
  e.advance(500);
  expect([e.sprites[0].x, e.sprites[0].y]).toEqual([-23, -47]);
  expect([e.container.x, e.container.y]).toEqual([120, 240]);
  e.container.scale.x = -1;
  e.seek(1000);
  expect(e.sprites[0].x).toBe(-23);
  expect([e.baseX, e.baseY]).toEqual([120, 240]);
  e.setAction("still");
  expect([e.sprites[0].x, e.sprites[0].y]).toEqual([4, 0]);
  e.setAction("dead", "once");
  e.advance(0);
  expect([e.sprites[0].x, e.sprites[0].y]).toEqual([-3, -47]);
  e.container.destroy({ children: true });
});

test("ghost phase survives same-action selection and refresh partitioning", () => {
  const frames = [
    { delay: 150, parts: [{ texture: "pixel", x: 0, y: 0, z: 0 }] },
  ];
  const a = entity({ dead: frames });
  const b = entity({ dead: frames });
  a.setAction("dead", "once");
  b.setAction("dead", "once");
  a.advance(1230);
  for (let tick = 0; tick < 41; tick++) {
    b.setAction("dead", "once");
    b.advance(30);
  }
  expect([b.sprites[0].x, b.sprites[0].y]).toEqual([
    a.sprites[0].x,
    a.sprites[0].y,
  ]);
  a.container.destroy({ children: true });
  b.container.destroy({ children: true });
});

function lifeProperties(values) {
  return {
    type: "Property",
    children: Object.fromEntries(
      Object.entries(values).map(([name, value]) => [
        name,
        { name, type: "Property", value, children: {} },
      ]),
    ),
  };
}

function lifeCanvas(delay, alpha = {}) {
  return {
    ...lifeProperties({ delay, origin: { x: 0, y: 0 }, ...alpha }),
    type: "Canvas",
    width: 1,
    height: 1,
  };
}

test("life extraction preserves rendered death alpha and resets it for another action", async () => {
  const root = {
    type: "Property",
    children: {
      info: lifeProperties({}),
      stand: { type: "Property", children: { 0: lifeCanvas(180) } },
      die1: {
        type: "Property",
        children: {
          // Original Blue Snail death timing/alpha, followed by an inheritance probe.
          0: lifeCanvas(180),
          1: lifeCanvas(180),
          2: lifeCanvas(300, { a0: 255, a1: 0 }),
          3: lifeCanvas(180),
        },
      },
    },
  };
  const context = {
    image: (archive) => (archive === "Mob" ? root : lifeProperties({})),
    part: async () => ({ texture: "pixel", x: 0, y: 0, z: 0 }),
  };
  const map = {
    children: {
      life: {
        children: {
          0: {
            ...lifeProperties({ type: "m", id: "100101", x: 0, y: 0 }),
            name: "0",
          },
        },
      },
    },
  };
  const { entities } = await extractLife(context, map, "104040000");
  const animation = new EntityAnimation(
    entities[0],
    new Map([["pixel", Texture.EMPTY]]),
  );
  try {
    animation.setAction("die1", "once");
    animation.advance(360);
    expect(animation.sprites[0].alpha).toBe(1);
    animation.advance(150);
    expect(animation.sprites[0].alpha).toBe(128 / 255);
    animation.advance(240);
    expect(animation.sprites[0].alpha).toBe(0);
    animation.setAction("stand");
    expect(animation.sprites[0].alpha).toBe(1);
  } finally {
    animation.container.destroy({ children: true });
  }
});
