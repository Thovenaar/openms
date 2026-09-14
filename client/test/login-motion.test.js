import { expect, test } from "bun:test";
import { loginCameraY, loginPageOffset } from "../src/online/login-motion.js";

test("native login keys overshoot, truncate negative coordinates and settle on arrival", () => {
  // 005f53c0: title→roster, D=1100, v0=-3818; Shape2D converts m0=-4199.8.
  expect(loginCameraY(-308, -1508, 0, 1100)).toBe(-308);
  expect(loginCameraY(-308, -1508, 550, 1100)).toBe(-1432);
  expect(loginCameraY(-308, -1508, 880, 1100)).toBe(-1517);
  expect(loginCameraY(-308, -1508, 1100, 1100)).toBe(-1508);
  expect(loginCameraY(-308, -1508, 2000, 1100)).toBe(-1508);
  expect(loginCameraY(-1508, -308, 550, 1100)).toBe(-383);
});

test("visible login pages are adjacent even when native World and race stages are skipped", () => {
  for (const [from, to] of [
    [-308, -1508],
    [-1508, -3308],
    [-3308, -308],
  ]) {
    const direction = Math.sign(to - from);
    expect(loginPageOffset(from, to, 0, 800)).toBe(direction * 600);
    expect(loginPageOffset(from, to, 800, 800)).toBe(0);
    expect(loginPageOffset(from, to, 800 - 1e-11, 800)).toBe(0);
    expect(loginPageOffset(from, to, 800 - 1e-13, 800)).toBe(0);
    let previous = 600;
    for (let ms = 0; ms <= 800; ms += 10) {
      const remaining = direction * loginPageOffset(from, to, ms, 800);
      // A clipped two-page slide must neither expose a gap nor reverse direction.
      expect(remaining).toBeGreaterThanOrEqual(0);
      expect(remaining).toBeLessThanOrEqual(previous);
      previous = remaining;
    }
  }
});
