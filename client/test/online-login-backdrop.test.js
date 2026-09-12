import { expect, test } from "bun:test";
import { LoginBackdrop } from "../src/online/login-backdrop.js";

test("unpackaged map-name aliases cannot hide packaged login towns", () => {
  const backdrop = new LoginBackdrop({
    catalog: {
      maps: { 100000000: {}, 101000000: {} },
      mapNames: {
        100000000: "Henesys",
        101000000: "Ellinia",
        180000003: "Henesys",
        200090110: "Orbis",
      },
    },
  });
  try {
    expect(backdrop.mapIds()).toEqual(["100000000", "101000000"]);
  } finally {
    backdrop.destroy();
  }
});
