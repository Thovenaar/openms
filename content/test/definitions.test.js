import { expect, test } from "bun:test";
import { validateDefinition, validateSave } from "../src/index.js";
import { canonical } from "../src/digest.js";
import { jsonDocument } from "../src/validation.js";
import { mobInput, originalRef, questDefinition } from "./fixtures.js";

test("authoring rejects unknown authority fields and malformed stats", () => {
  const valid = mobInput("a".repeat(64));
  expect(validateSave(valid)).toEqual(valid);
  expect(() => validateSave({ ...valid, ownerId: "another-account" })).toThrow(
    "Unknown field",
  );
  expect(() =>
    validateDefinition("mob", { ...valid.definition, code: "run()" }),
  ).toThrow("Unknown field");
  expect(() =>
    validateDefinition("mob", { ...valid.definition, stats: { maxHP: 0 } }),
  ).toThrow();
  expect(() =>
    validateDefinition("mob", {
      ...valid.definition,
      stats: { maxHP: Infinity },
    }),
  ).toThrow();
});

test("bounded JSON rejects cycles, unsupported values and reserved keys", () => {
  const cycle = {};
  cycle.self = cycle;
  expect(() => jsonDocument(cycle)).toThrow();
  expect(() => jsonDocument({ value: () => 1 })).toThrow();
  expect(() => jsonDocument(JSON.parse('{"__proto__":{}}'))).toThrow();
  expect(canonical({ b: [10, 20], a: 1 })).toBe(
    canonical({ a: 1, b: [10, 20] }),
  );
});

test("map schema rejects duplicate spawns and broken foothold links", () => {
  const spawn = {
    id: "one",
    mob: originalRef("mob", 100101),
    x: 0,
    y: 0,
    foothold: 1,
    range: { left: -5, right: 5 },
    facing: 1,
  };
  const map = {
    base: originalRef("map", "100000000"),
    entities: [],
    spawns: [spawn],
  };
  expect(validateDefinition("map", map)).toEqual(map);
  expect(() =>
    validateDefinition("map", { ...map, spawns: [spawn, spawn] }),
  ).toThrow("Duplicate");
  const foothold = {
    id: 1,
    layer: 0,
    group: 0,
    x1: 0,
    y1: 0,
    x2: 100,
    y2: 0,
    prev: 0,
    next: 2,
  };
  expect(() =>
    validateDefinition("map", { ...map, footholds: [foothold] }),
  ).toThrow("Missing foothold");
});

test("quest definitions restrict objectives, rewards and authored dialogue", () => {
  const quest = questDefinition();
  expect(validateDefinition("quest", quest)).toEqual(quest);
  expect(() =>
    validateDefinition("quest", {
      ...quest,
      objectives: [quest.objectives[0], quest.objectives[0]],
    }),
  ).toThrow("Duplicate quest target");
  expect(() =>
    validateDefinition("quest", {
      ...quest,
      objectives: [{ kind: "script", target: {}, count: 1 }],
    }),
  ).toThrow();
  expect(() =>
    validateDefinition("quest", {
      ...quest,
      rewards: { ...quest.rewards, meso: -1 },
    }),
  ).toThrow();
  expect(() =>
    validateDefinition("quest", {
      ...quest,
      dialogue: { ...quest.dialogue, offer: "#L0#grant" },
    }),
  ).toThrow();
});
