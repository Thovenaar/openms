import { expect, test } from "bun:test";
import { originalFixture, originalRef } from "./fixtures.js";
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
