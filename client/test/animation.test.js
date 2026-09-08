import { test, expect } from "bun:test";
import { Texture } from "pixi.js";
import { EntityAnimation } from "../src/animation.js";

function entity() {
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
      },
    },
    new Map([["pixel", Texture.EMPTY]]),
    0,
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
