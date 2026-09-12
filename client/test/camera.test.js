import { expect, test } from "bun:test";
import { followCamera } from "../src/rendering/camera.js";

const VIEWPORT = { width: 800, height: 600 };

function field(map = {}) {
  return {
    map,
    footholds: [
      { x1: 0, y1: 0, x2: 2000, y2: 0 },
      { x1: 0, y1: 1000, x2: 2000, y2: 1000 },
    ],
  };
}

test("camera follows above the upper foothold using native physical margins", () => {
  const physics = field();
  const camera = { x: 0, y: 0 };
  followCamera(camera, { x: 1000, y: 50 }, physics, VIEWPORT);
  expect(camera).toEqual({ x: 600, y: -250 });
  followCamera(camera, { x: 1000, y: -500 }, physics, VIEWPORT);
  expect(camera.y).toBe(-360);
  followCamera(camera, { x: 1000, y: 1500 }, physics, VIEWPORT);
  expect(camera.y).toBe(510);
});

test("authored camera edges override physical fallback independently", () => {
  const physics = field({ VRTop: 0 });
  const camera = { x: 0, y: 0 };
  followCamera(camera, { x: 1000, y: -500 }, physics, VIEWPORT);
  expect(camera.y).toBe(0);
  followCamera(camera, { x: 1000, y: 1500 }, physics, VIEWPORT);
  expect(camera.y).toBe(510);
});
