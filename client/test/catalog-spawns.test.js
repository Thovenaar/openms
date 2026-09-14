import { expect, test } from "bun:test";
import { catalog } from "../src/rendering/stream-validation.js";

function fixture(spawns) {
  return {
    schemaVersion: 2,
    buildId: "b".repeat(64),
    defaultMap: "000000001",
    maps: {
      "000000001": {
        url: "/generated/maps/map.json",
        sha256: "a".repeat(64),
        bytes: 1,
        neighbors: [],
      },
    },
    mapNames: { 1: "Test Field" },
    ...(spawns === undefined ? {} : { spawns }),
  };
}

test("the optional spawn index admits only maps inside the selected closure", () => {
  const spawns = {
    schemaVersion: 1,
    mobs: { 900001: [{ mapId: "000000001", count: 3 }] },
  };
  expect(catalog(fixture(spawns)).spawns).toEqual(spawns);
  expect(catalog(fixture(undefined)).spawns).toBeUndefined();
});

test("malformed spawn indexes fail before allocation", () => {
  const bad = (spawns) => () => catalog(fixture(spawns));
  expect(
    bad({
      schemaVersion: 2,
      mobs: { 900001: [{ mapId: "000000001", count: 1 }] },
    }),
  ).toThrow("spawn catalog version");
  expect(
    bad({
      schemaVersion: 1,
      mobs: { 900001: [{ mapId: "000000002", count: 1 }] },
    }),
  ).toThrow("spawn map entry");
  expect(
    bad({
      schemaVersion: 1,
      mobs: { 900001: [{ mapId: "000000001", count: 0 }] },
    }),
  ).toThrow("spawn map entry");
  expect(
    bad({ schemaVersion: 1, mobs: { 0: [{ mapId: "000000001", count: 1 }] } }),
  ).toThrow("spawn monster identity");
});
