import { test, expect } from "bun:test";
import { Texture } from "pixi.js";
import { CombatPresentation } from "../src/combat/combat-presentation.js";
import {
  DAMAGE_LIMIT,
  COMBAT_VALUE_LIMIT,
} from "../../shared/combat-formulas.js";

test("damage glyphs retain every digit through the modern cap and reject unsafe integers", () => {
  const presentation = new CombatPresentation(null, {});
  const textures = Array.from({ length: 10 }, () => new Texture());
  presentation.owner = { destroy() {} };
  presentation.scene = { addWorldContainer() {}, removeWorldContainer() {} };
  presentation.glyphs = Array.from({ length: 4 }, () =>
    Array.from({ length: 2 }, () =>
      Array.from({ length: 11 }, (_, digit) => ({
        texture: textures[digit % 10],
        width: 10,
        height: 10,
        x: 0,
      })),
    ),
  );
  try {
    for (const amount of [
      DAMAGE_LIMIT,
      DAMAGE_LIMIT * 5.25,
      COMBAT_VALUE_LIMIT,
    ]) {
      const slot = presentation.show(amount, 0, {
        x: 0,
        y: 0,
        delay: 0,
        target: null,
      });
      const digits = slot.sprites
        .filter((sprite) => sprite.visible)
        .map((sprite) => textures.indexOf(sprite.texture))
        .join("");
      expect(digits).toBe(String(amount));
    }
    expect(
      presentation.show(COMBAT_VALUE_LIMIT + 1, 0, {
        x: 0,
        y: 0,
        delay: 0,
        target: null,
      }),
    ).toBeNull();
  } finally {
    presentation.destroy();
    for (const texture of textures) texture.destroy();
  }
});
