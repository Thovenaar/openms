import { expect, test } from "bun:test";
import { loginCameraY } from "../src/online/login-motion.js";

test("native login keys overshoot, truncate negative coordinates and settle on arrival", () => {
  // 005f53c0: title→roster, D=1100, v0=-3818; Shape2D converts m0=-4199.8.
  expect(loginCameraY(-308, -1508, 0, 1100)).toBe(-308);
  expect(loginCameraY(-308, -1508, 550, 1100)).toBe(-1432);
  expect(loginCameraY(-308, -1508, 880, 1100)).toBe(-1517);
  expect(loginCameraY(-308, -1508, 1100, 1100)).toBe(-1508);
  expect(loginCameraY(-308, -1508, 2000, 1100)).toBe(-1508);
  expect(loginCameraY(-1508, -308, 550, 1100)).toBe(-383);
});
