import { expect, test } from "bun:test";
import { itemTooltip } from "../src/ui/ui-tooltip.js";

const template = { id: 1302000, name: "Sword", info: { incPAD: 17, tuc: 7 } };

test("owned scroll stats show total, original base, signed bonus and remaining slots", () => {
  const owner = {
    store: {
      profile: {
        equipment: [
          {
            uid: "sword",
            id: 1302000,
            upgrade: { level: 2, slots: 5, stats: { incPAD: 21, incSTR: 2 } },
          },
        ],
        inventory: [],
      },
    },
  };
  const tooltip = itemTooltip(owner, template, template.id, {
    uid: "sword",
    equipped: true,
  });
  expect(tooltip.title).toBe("Sword (+2)");
  expect(tooltip.lines.map((row) => row.text)).toContain(
    "WEAPON ATTACK : +21 (17 + 4)",
  );
  expect(tooltip.lines.map((row) => row.text)).toContain("STR : +2 (0 + 2)");
  expect(tooltip.lines.map((row) => row.text)).toContain(
    "NUMBER OF UPGRADES AVAILABLE : 5",
  );
  owner.store.profile.equipment[0].upgrade.stats.incPAD = 15;
  expect(
    itemTooltip(owner, template, template.id, { uid: "sword" }).lines.map(
      (row) => row.text,
    ),
  ).toContain("WEAPON ATTACK : +15 (17 − 2)");
});

test("a template preview cannot inherit a same-template owned item's scroll modifiers", () => {
  const tooltip = itemTooltip({}, template, template.id, { possession: false });
  expect(tooltip.title).toBe("Sword");
  expect(tooltip.lines.map((row) => row.text)).toEqual([
    "WEAPON ATTACK : +17",
    "NUMBER OF UPGRADES AVAILABLE : 7",
  ]);
});
