import { expect, test } from "bun:test";
import { originalFixture, originalRef } from "./fixtures.js";
import { AssetRegistry } from "../src/index.js";
import { imageAppearance } from "../src/appearance.js";
import { inspectContentImage } from "../../server/src/content-authoring.js";
import { encodePNG } from "../../client/src/assets/png.js";
import { digest } from "../src/digest.js";

test("real catalog resolves names, templates, frame rectangles and original bundle/audio descriptors", async () => {
  const { original, registry } = await originalFixture();
  const found = registry.search({
    kind: "mob",
    query: "Blue Snail",
    offset: 0,
    limit: 10,
  });
  expect(found.matches.some((row) => row.id === "100101")).toBe(true);
  const mob = await registry.resolve(originalRef("mob", 100101));
  expect(mob.template.originalId).toBe("0100101");
  const part = mob.visual.entity.actions.stand[0].parts[0];
  const texture = mob.visual.textures[part.texture];
  expect(texture.source).toBe("Mob.wz:0100101.img/stand/0");
  expect(mob.visual.atlases[texture.atlas].url).toEndWith(".png");
  expect(
    (await registry.resolve(originalRef("item", 2000000))).record.name,
  ).toBe("Red Potion");
  expect(
    (await registry.resolve(originalRef("sound", "UI/BtMouseClick"))).descriptor
      .url,
  ).toEndWith(".mp3");
  expect(original.catalog.monsters[100101].name).toBe("Blue Snail");
});

test("monster detail aggregates original stats, drops and quest references", async () => {
  const { registry } = await originalFixture();
  const detail = await registry.monsterDetail(originalRef("mob", 100100));
  expect(detail.name).toBe("Snail");
  expect(detail.stats.maxHP).toBeGreaterThan(0);
  expect(detail.drops.length).toBeGreaterThan(0);
  expect(
    detail.drops.every(
      (row) => typeof row.itemName === "string" && row.itemName.length > 0,
    ),
  ).toBe(true);
  expect(detail.quests.length).toBeGreaterThan(0);
  expect(Array.isArray(detail.spawns)).toBe(true);
});

test("monster detail reads the spawn index and names every reference", async () => {
  const registry = new AssetRegistry({
    catalog: spawnCatalogFixture(),
    readJson: async () => spawnManifestFixture(),
  });
  const detail = await registry.monsterDetail({
    source: "original",
    kind: "mob",
    id: "900001",
  });
  expect(detail.stats).toEqual({ maxHP: 50, maxMP: 5, level: 2 });
  expect(detail.sourceMapId).toBe("000000001");
  expect(detail.drops).toEqual([
    {
      itemId: 2000000,
      itemName: "Red Potion",
      minimum: 1,
      maximum: 2,
      questId: 0,
      chance: 10000,
    },
  ]);
  expect(detail.spawns).toEqual([
    { mapId: "000000001", mapName: "Test Field", count: 3 },
  ]);
  expect(detail.quests).toEqual([{ id: "5", name: "Test Quest" }]);
});

test("missing and prototype-like identities fail explicitly", async () => {
  const { registry } = await originalFixture();
  await expect(
    registry.resolve(originalRef("mob", "__proto__")),
  ).rejects.toThrow();
  await expect(
    registry.resolve(originalRef("sound", "__proto__/constructor")),
  ).rejects.toThrow();
  await expect(
    registry.resolve(originalRef("mob", "999999999")),
  ).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
});

test("uploaded PNG frames preserve original RGBA identity and reject out-of-bounds rectangles", () => {
  const pixels = new Uint8Array([20, 40, 60, 0, 80, 100, 120, 255]);
  const bytes = encodePNG(2, 1, pixels);
  const decoded = inspectContentImage(bytes);
  const frame = {
    x: 1,
    y: 0,
    width: 1,
    height: 1,
    originX: 0,
    originY: 1,
    delay: 100,
  };
  const appearance = { source: "upload", actions: { stand: [frame] } };
  const visual = imageAppearance(appearance, {
    id: digest(bytes),
    bytes,
    ...decoded,
  });
  const expected = digest(
    Buffer.concat([Buffer.from("1x1:"), Buffer.from(pixels.subarray(4))]),
  );
  expect(Object.keys(visual.textures)).toEqual([expected]);
  expect(() =>
    imageAppearance(
      { ...appearance, actions: { stand: [{ ...frame, width: 2 }] } },
      { id: digest(bytes), bytes, ...decoded },
    ),
  ).toThrow("outside");
  const corrupt = Buffer.from(bytes);
  corrupt[corrupt.length - 1] ^= 1;
  expect(() => inspectContentImage(corrupt)).toThrow("CRC");
});

/** Minimal admitted catalog exercising the spawn index, original drops and quest references. */
function spawnCatalogFixture() {
  return {
    schemaVersion: 2,
    buildId: "a".repeat(64),
    defaultMap: "000000001",
    maps: {
      "000000001": {
        url: "/generated/maps/test.json",
        sha256: "b".repeat(64),
        bytes: 1,
      },
    },
    mapNames: { 1: "Test Field" },
    monsters: {
      900001: {
        id: 900001,
        name: "Test Mob",
        template: "mob:0900001",
        mapId: "000000001",
      },
    },
    spawns: {
      schemaVersion: 1,
      mobs: { 900001: [{ mapId: "000000001", count: 3 }] },
    },
    drops: {
      mobs: {
        900001: {
          rows: [
            {
              itemId: 2000000,
              chance: 10000,
              minimum: 1,
              maximum: 2,
              questId: 0,
            },
          ],
        },
      },
    },
    quests: {
      records: { 5: { id: 5, name: "Test Quest" } },
      content: { mobs: { 900001: [5] } },
    },
    ui: { items: { 2000000: { id: 2000000, name: "Red Potion" } } },
  };
}

function spawnManifestFixture() {
  return {
    id: "000000001",
    schemaVersion: 2,
    life: {
      templates: {
        "mob:0900001": {
          key: "mob:0900001",
          kind: "mob",
          originalId: "0900001",
          name: "Test Mob",
          info: { maxHP: 50, maxMP: 5, level: 2, elemAttr: "S3" },
        },
      },
      renderables: {
        "mob:0900001": {
          entity: {
            id: "e",
            kind: "mob",
            actions: { default: [{ parts: [] }] },
          },
        },
      },
    },
  };
}
