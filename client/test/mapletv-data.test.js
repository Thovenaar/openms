import { expect, test } from "bun:test";
import { extractMapleTV } from "../tools/mapletv-data.js";

function televisionContext() {
  const animation = { children: { 0: { children: {} } } };
  const root = {
    children: {
      TVmedia: { children: { 0: animation } },
      TVoff: animation,
    },
  };
  return {
    image: () => root,
    part: () => ({ x: 3, y: 7, texture: "screen" }),
  };
}

const coordinates = {
  MapleTVmsgX: -118,
  MapleTVmsgY: -376,
  MapleTVadX: -118,
  MapleTVadY: "-266",
};
const actor = { id: "npc:television", order: 0, x: 0, y: 0 };

test("original numeric-string TV coordinates place screens identically to numeric coordinates", async () => {
  const context = televisionContext();
  const authored = await extractMapleTV(context, actor, coordinates);
  const numeric = await extractMapleTV(context, actor, {
    ...coordinates,
    MapleTVadY: -266,
  });
  expect(authored.entities).toEqual(numeric.entities);
  expect(authored.entities[0].actions[0][0].parts[0].y).toBe(-79);
});

test("a malformed TV coordinate cannot become a zero or parsed-prefix screen position", async () => {
  await expect(
    extractMapleTV(televisionContext(), actor, {
      ...coordinates,
      MapleTVadY: "-266px",
    }),
  ).rejects.toBeInstanceOf(Error);
});
