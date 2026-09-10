import { expect, test } from "bun:test";
import {
  applyItemVitals,
  inspectItemSpec,
  isPickupItem,
  prepareItemSpec,
} from "../src/item-effects.js";
import { TemporaryStats } from "../src/temporary-stats.js";

function card(id, spec) {
  return {
    id,
    category: "Consume",
    info: { monsterBook: 1, mob: 100100 },
    spec: { consumeOnPickup: 1, time: 1200000, ...spec },
    properties: {},
  };
}

// Cosmic's mask value4 is not the WZ selector/probability. Ranking those raw fields
// would retain the older narrower card and award the wrong generated drop chance.
test("conditional card rates arbitrate native flags, retain latent sources and restore on cancellation", () => {
  const effects = new TemporaryStats();
  effects.refreshConditions({ mapId: 100000000, partyHunting: false });
  const older = inspectItemSpec(
    card(2382001, { itemupbyitem: 3, itemRange: 400, prob: 20 }),
  ).state;
  effects.start(older);
  const newer = inspectItemSpec(
    card(2382002, {
      itemupbyitem: 1,
      prob: 10,
      con: { 0: { type: 0, sMap: 200000000, eMap: 200000010 } },
    }),
  ).state;
  effects.start(newer);
  expect(effects.cardRate(4000000)).toBe(Math.fround(1.2));
  expect(effects.cardRate(2000000)).toBe(1);
  expect(effects.visible[0]).toBe(older);
  effects.refreshConditions({ mapId: 200000000, partyHunting: false });
  expect(effects.cardRate(2000000)).toBe(Math.fround(1.1));
  expect(effects.cardRate(4000000)).toBe(Math.fround(1.1));
  expect(effects.visible[0]).toBe(newer);
  effects.remove(newer.source);
  effects.recompute();
  expect(effects.cardRate(4000000)).toBe(Math.fround(1.2));
  expect(effects.cardRate(2000000)).toBe(1);
  expect(effects.visible[0]).toBe(older);
});

test("specEx replaces rather than merges spec while either branch reserves pickup ownership", () => {
  const item = {
    id: 2000000,
    category: "Consume",
    info: {},
    spec: { hp: 50, consumeOnPickup: 1 },
    properties: { specEx: { mp: 30 } },
  };
  expect(isPickupItem(item)).toBe(true);
  expect(prepareItemSpec(item)).toBeNull();
  const effect = inspectItemSpec(item);
  const profile = { hp: 10, maxHP: 100, mp: 2, maxMP: 100 };
  applyItemVitals(profile, effect.values);
  expect(profile.hp).toBe(10);
  expect(profile.mp).toBe(32);
  item.spec = { hp: 50 };
  item.properties.specEx = { mp: 30, consumeOnPickup: "1" };
  expect(isPickupItem(item)).toBe(true);
  expect(prepareItemSpec(item)).toBeNull();
  expect(isPickupItem(undefined)).toBe(false);
});
