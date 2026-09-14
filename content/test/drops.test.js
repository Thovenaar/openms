import { expect, test } from "bun:test";
import { ContentService, validateDefinition } from "../src/index.js";
import { compileDrops } from "../src/compile-drops.js";
import { referenceKey } from "../src/definitions.js";
import { validateRuntimeContent } from "../../server/src/content-authoring.js";
import {
  draftRow,
  dropsDefinition,
  mobInput,
  originalFixture,
  originalRef,
} from "./fixtures.js";

const QUANTITY_ROW = { itemId: 2000000, chance: 1, minimum: 5, maximum: 2 };

test("drop definitions bound rows, chances, quantities and conditions", () => {
  const definition = dropsDefinition();
  expect(validateDefinition("drops", definition)).toEqual(definition);
  expect(() =>
    validateDefinition("drops", { ...definition, mode: "append" }),
  ).toThrow("Unsupported value");
  expect(() =>
    validateDefinition("drops", {
      ...definition,
      rows: [{ itemId: 2000000, chance: 1000000 }],
    }),
  ).toThrow("Integer outside allowed range");
  expect(() =>
    validateDefinition("drops", {
      ...definition,
      rows: [{ itemId: 2000000, chance: -1 }],
    }),
  ).toThrow("Integer outside allowed range");
  expect(() =>
    validateDefinition("drops", { ...definition, rows: [QUANTITY_ROW] }),
  ).toThrow("inverted");
  expect(() =>
    validateDefinition("drops", {
      ...definition,
      rows: Array.from({ length: 65 }, () => ({
        itemId: 2000000,
        chance: 1,
      })),
    }),
  ).toThrow("Array exceeds limit");
  expect(() =>
    validateDefinition("drops", { ...definition, rows: [{ chance: 1 }] }),
  ).toThrow("Missing required field");
  expect(() =>
    validateDefinition("drops", {
      ...definition,
      rows: [{ itemId: 2000000, chance: 1, effect: "mesos" }],
    }),
  ).toThrow("Unknown field");
  expect(() =>
    validateDefinition("drops", {
      ...definition,
      target: originalRef("item", 2000000),
    }),
  ).toThrow("Unsupported value");
  expect(() =>
    validateDefinition("drops", {
      ...definition,
      target: { ...originalRef("mob", 100100), id: "snail" },
    }),
  ).toThrow("numeric original monster identity");
  expect(() =>
    validateDefinition("drops", {
      ...definition,
      target: originalRef("mob", 100100, "100000000"),
    }),
  ).toThrow("Unexpected source map");
});

test("drop conditions require an explicit, ordered gate", () => {
  const condition = (value) =>
    validateDefinition("drops", {
      ...dropsDefinition(),
      rows: [{ itemId: 2000000, chance: 1, condition: value }],
    });
  expect(condition({ window: { start: 1000, end: 2000 } })).toBeTruthy();
  expect(() => condition({})).toThrow("no gate");
  expect(() => condition({ window: { start: 2000, end: 2000 } })).toThrow(
    "window",
  );
  expect(() => condition({ jobs: [] })).toThrow("Empty drop job filter");
  expect(() => condition({ jobs: [1, 1] })).toThrow("Duplicate");
  expect(() =>
    condition({ jobs: Array.from({ length: 7 }, (_, i) => i) }),
  ).toThrow("Array exceeds limit");
  expect(() => condition({ minLevel: 20, maxLevel: 10 })).toThrow("inverted");
  expect(() => condition({ minLevel: 0 })).toThrow(
    "Integer outside allowed range",
  );
});

test("drop rows compile with explicit defaults against admitted items", async () => {
  const { registry } = await originalFixture();
  const definition = dropsDefinition();
  const dependencies = new Map([
    [
      referenceKey(definition.target),
      await registry.resolve(definition.target),
    ],
  ]);
  const row = draftRow(
    mobInput(registry.buildId, { id: "snail", kind: "drops", definition }),
  );
  const runtime = compileDrops(row, dependencies, registry);
  expect(runtime).toEqual({
    kind: "drops",
    target: { source: "original", kind: "mob", id: "100100", mobId: 100100 },
    mode: "merge",
    rows: [
      {
        itemId: 2000000,
        minimum: 1,
        maximum: 1,
        questId: 0,
        chance: 20000,
        status: "supported",
      },
      {
        itemId: 4000019,
        minimum: 1,
        maximum: 1,
        questId: 0,
        chance: 600000,
        status: "supported",
        condition: { minLevel: 10, jobs: [0, 1] },
      },
    ],
  });
});

test("drop compilation rejects items outside the admitted catalog", async () => {
  const { registry } = await originalFixture();
  const definition = dropsDefinition(originalRef("mob", 100100), {
    rows: [{ itemId: 999999999, chance: 1 }],
  });
  const dependencies = new Map([
    [
      referenceKey(definition.target),
      await registry.resolve(definition.target),
    ],
  ]);
  const row = draftRow(
    mobInput(registry.buildId, { id: "snail", kind: "drops", definition }),
  );
  expect(() => compileDrops(row, dependencies, registry)).toThrow(
    "missing original template",
  );
});

test("drop compilation bounds the authored table against the pinned base", async () => {
  const { registry } = await originalFixture();
  const base = originalRef("mob", 100100);
  const dependencies = new Map([
    [referenceKey(base), await registry.resolve(base)],
  ]);
  const authored = (count, mode) =>
    draftRow(
      mobInput(registry.buildId, {
        id: "snail",
        kind: "drops",
        definition: dropsDefinition(base, {
          mode,
          rows: Array.from({ length: count }, () => ({
            itemId: 2000000,
            chance: 1,
          })),
        }),
      }),
    );
  const withBase = (rows) => ({
    catalog: {
      ui: registry.catalog.ui,
      drops: { schemaVersion: 1, mobs: { 100100: { rows } } },
    },
  });
  expect(
    compileDrops(authored(64, "merge"), dependencies, withBase(new Array(192))),
  ).toBeTruthy();
  expect(() =>
    compileDrops(authored(64, "merge"), dependencies, withBase(new Array(193))),
  ).toThrow("exceeds per-monster limit");
  // Replacement documents consume the same merged ceiling.
  expect(() =>
    compileDrops(
      authored(64, "replace"),
      dependencies,
      withBase(new Array(193)),
    ),
  ).toThrow("exceeds per-monster limit");
  // A build without a pinned base table starts from zero rows.
  expect(
    compileDrops(authored(64, "merge"), dependencies, {
      catalog: { ui: registry.catalog.ui },
    }).rows,
  ).toHaveLength(64);
});

test("content service publishes authored drop tables with the pinned registry", async () => {
  const { original, registry } = await originalFixture();
  const service = new ContentService({
    store: { build: async () => original.catalog },
    readJson: original.json.bind(original),
    validateRuntime: validateRuntimeContent,
    inspectImage: async () => ({
      width: 1,
      height: 1,
      pixels: new Uint8Array(4),
    }),
  });
  const definition = dropsDefinition();
  const runtime = await service.compile(
    "author",
    draftRow(
      mobInput(original.assetBuildId, {
        id: "snail",
        kind: "drops",
        definition,
      }),
      800000123,
    ),
  );
  expect(runtime.kind).toBe("drops");
  expect(runtime.schemaVersion).toBe(1);
  expect(runtime.identity.runtimeId).toBe(800000123);
  expect(runtime.dependencies).toEqual([]);
  expect(runtime.target.mobId).toBe(100100);
  expect(runtime.rows).toHaveLength(2);
  expect(registry.buildId).toBe(original.assetBuildId);
});
