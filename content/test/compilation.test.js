import { expect, test } from "bun:test";
import { compileMob } from "../src/compile-mob.js";
import { compileMap } from "../src/compile-map.js";
import { compileQuest } from "../src/compile-quest.js";
import { referenceKey } from "../src/definitions.js";
import { imageAppearance, mergeVisual } from "../src/appearance.js";
import { digest } from "../src/digest.js";
import { encodePNG } from "../../client/src/assets/png.js";
import { validateRuntimeContent } from "../../server/src/content-authoring.js";
import {
  rewardItems,
  checkConditions,
} from "../../client/src/quests/quest-rules.js";
import {
  originalFixture,
  originalRef,
  mobInput,
  draftRow,
  questDefinition,
} from "./fixtures.js";

test("custom monster retains original artwork with separate gameplay identity and stats", async () => {
  const { registry } = await originalFixture();
  const input = mobInput(registry.buildId);
  const base = await registry.resolve(input.definition.base);
  const deps = new Map([[referenceKey(input.definition.base), base]]);
  const runtime = compileMob(draftRow(input), deps);
  validateRuntimeContent(runtime);
  expect(runtime.template.info.maxHP).toBe(120);
  expect(runtime.template.originalId).toBe("800000000");
  expect(runtime.template.sourceTemplateId).toBe("0100101");
  expect(runtime.visual).toEqual(base.visual);
  expect(base.template.name).toBe("Blue Snail");
});

test("uploaded monster sheets use explicit timing and collision bodies without changing their base", async () => {
  const { registry } = await originalFixture();
  const input = mobInput(registry.buildId);
  const base = await registry.resolve(input.definition.base);
  const pixels = new Uint8Array([40, 150, 80, 255]);
  const bytes = encodePNG(1, 1, pixels);
  const frame = {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    originX: 0,
    originY: 1,
    delay: 120,
    body: { left: -1, top: -1, right: 1, bottom: 1 },
  };
  const appearance = {
    source: "upload",
    assetId: digest(bytes),
    actions: Object.fromEntries(
      Object.keys(base.template.actions).map((name) => [name, [{ ...frame }]]),
    ),
  };
  input.definition.appearance = appearance;
  const visual = imageAppearance(appearance, {
    id: appearance.assetId,
    bytes,
    width: 1,
    height: 1,
    pixels,
  });
  const deps = new Map([[referenceKey(input.definition.base), base]]);
  const runtime = compileMob(draftRow(input), deps, visual);
  validateRuntimeContent(runtime);
  expect(runtime.template.actions.stand.frames[0].body).toEqual(frame.body);
  expect(runtime.visual.entity.actions.stand[0].delay).toBe(120);
  expect(runtime.template.artworkStatus).toBe("custom-action-artwork");
  expect(base.template.artworkStatus).not.toBe("custom-action-artwork");
  delete appearance.actions.stand[0].body;
  expect(() => compileMob(draftRow(input), deps, visual)).toThrow(
    "body rectangles",
  );
});

test("identical texture pixels can be reused from different atlas positions", () => {
  const target = {
    textures: {
      pixel: { width: 1, height: 1, atlas: "original", x: 10, y: 20 },
    },
    atlases: {},
  };
  mergeVisual(target, {
    textures: { pixel: { width: 1, height: 1, atlas: "upload", x: 0, y: 0 } },
    atlases: {},
  });
  expect(target.textures.pixel.atlas).toBe("original");
  expect(() =>
    mergeVisual(target, {
      textures: { pixel: { width: 2, height: 1 } },
      atlases: {},
    }),
  ).toThrow("dimensions");
});

test("map compilation reuses base resources and validates added mob geometry", async () => {
  const { registry } = await originalFixture();
  const mapRef = originalRef("map", "001010000");
  const mobRef = originalRef("mob", 100101);
  const base = await registry.resolve(mapRef);
  const mob = await registry.resolve(mobRef);
  const floor = base.manifest.physics.footholds.find((row) => row.x2 > row.x1);
  const x = Math.trunc((floor.x1 + floor.x2) / 2);
  const definition = {
    base: mapRef,
    entities: [],
    spawns: [
      {
        id: "snail",
        mob: mobRef,
        x,
        y: floor.y1,
        foothold: floor.id,
        range: { left: floor.x1, right: floor.x2 },
        facing: 1,
      },
    ],
  };
  const row = draftRow(
    mobInput(registry.buildId, { id: "clearing", kind: "map", definition }),
  );
  const dependencies = new Map([
    [referenceKey(mapRef), base],
    [referenceKey(mobRef), mob],
  ]);
  const runtime = await compileMap(row, { registry, dependencies });
  validateRuntimeContent(runtime);
  expect(runtime.manifest.regions).toEqual(base.manifest.regions);
  expect(runtime.manifest.id).toBe("800000000");
  expect(runtime.manifest.life.placements.at(-1).authored.f).toBe(0);
  expect(
    base.manifest.life.placements.some((spawn) => spawn.id === "custom:snail"),
  ).toBe(false);
  row.definition.spawns[0].foothold = 65535;
  await expect(compileMap(row, { registry, dependencies })).rejects.toThrow(
    "missing foothold",
  );
});

test("custom quest binds hunt credit to the custom monster and emits unconditional item rewards", () => {
  const ref = { source: "custom", kind: "mob", id: "mossback", revision: 1 };
  const definition = questDefinition(ref);
  const row = draftRow(
    mobInput("a".repeat(64), { kind: "quest", id: "hunt", definition }),
    800000001,
  );
  const { record } = compileQuest(
    row,
    new Map([[referenceKey(ref), { runtimeId: 800000000 }]]),
  );
  expect(record.stages[1].check.mobs[0].id).toBe(800000000);
  expect(rewardItems(record.stages[1].act, { job: 0 }, null).items).toEqual([
    { id: 2000000, count: 2, index: 0 },
  ]);
  const profile = {
    quests: { 800000001: { state: 1, kills: { 100101: 5 } } },
    inventory: [],
  };
  expect(
    checkConditions(record.stages[1].check, profile, {
      npcId: 1012108,
      questId: record.id,
    }).ok,
  ).toBe(false);
  profile.quests[800000001].kills[800000000] = 5;
  expect(
    checkConditions(record.stages[1].check, profile, {
      npcId: 1012108,
      questId: record.id,
    }).ok,
  ).toBe(true);
});
