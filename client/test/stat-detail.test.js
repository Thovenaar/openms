import { expect, test } from "bun:test";
import { updateStatDetail } from "../src/ui/ui-stat.js";

test("Stat detail formats original damage bounds from immutable server statistics", () => {
  const stats = Object.freeze({
    weaponType: 30,
    mastery: 0,
    pad: 17,
    str: 12,
    dex: 5,
    speed: 100,
  });
  const labels = new Map();
  const damage = { setAttribute: (key, value) => labels.set(key, value) };
  const speed = { setAttribute() {} };
  updateStatDetail({
    owner: { hooks: { characterStats: () => stats } },
    statDetail: {
      statValues: new Map([
        ["damage", damage],
        ["speed", speed],
      ]),
    },
  });
  expect(damage.textContent).toBe("1 ~ 9");
  expect(labels.get("aria-label")).toBe("damage: 1 ~ 9");
  expect(speed.textContent).toBe("100%");
  expect(Object.hasOwn(stats, "damageMin")).toBe(false);
});
