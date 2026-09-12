import { expect, test } from "bun:test";
import {
  applyItemVitals,
  inspectItemSpec,
  isPickupItem,
  prepareItemSpec,
} from "../src/items/item-effects.js";
import {
  TemporaryStats,
  temporaryState,
  configureTemporaryState,
} from "../src/skills/temporary-stats.js";
import { SkillDefenses } from "../src/skills/skill-defenses.js";
import { SkillSystem } from "../src/skills/skill-system.js";
import { OfflineField } from "../src/combat/offline-field.js";

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

test("defenseAtt cards reduce only matching typed damage while preserving conditional source arbitration", () => {
  const effects = new TemporaryStats();
  effects.refreshConditions({ mapId: 101030000, partyHunting: false });
  const fire = inspectItemSpec(
    card(2382003, {
      defenseAtt: "F",
      prob: 4,
      con: { 0: { type: 0, sMap: 101030000, eMap: 102039999 } },
    }),
  );
  const defense = new SkillDefenses({
    hooks: { derivedStats: () => effects.derived },
  });
  effects.start(fire.state);
  expect(fire.unavailable).toBeNull();
  expect(defense.itemDefense(101, 2)).toBe(97);
  expect(defense.itemDefense(1, 2)).toBe(1);
  expect(defense.itemDefense(101, 1)).toBe(101);
  expect(defense.itemDefense(101, 0)).toBe(101);
  expect(defense.itemDefense(101, 5)).toBe(101);
  const ice = inspectItemSpec(card(2382013, { defenseAtt: "I", prob: 3 }));
  effects.start(ice.state);
  expect(defense.itemDefense(101, 2)).toBe(101);
  expect(defense.itemDefense(101, 1)).toBe(98);
  effects.remove(ice.state.source);
  effects.recompute();
  expect(defense.itemDefense(101, 2)).toBe(97);
  effects.refreshConditions({ mapId: 200000000, partyHunting: false });
  expect(defense.itemDefense(101, 2)).toBe(101);
  effects.refreshConditions({ mapId: 101030000, partyHunting: false });
  expect(defense.itemDefense(101, 2)).toBe(97);
});

test("card reduction preserves pre-card Magic Guard MP spending and debits only remaining HP", () => {
  const effects = new TemporaryStats();
  effects.start(
    inspectItemSpec(card(2382003, { defenseAtt: "F", prob: 4 })).state,
  );
  const guard = temporaryState("skill", 2001002);
  configureTemporaryState(guard, { magicGuard: 80 }, 1000);
  effects.start(guard);
  const store = { profile: { hp: 1000, mp: 100 }, markDirty() {} };
  const skills = { store, derivedStats: effects.derived, destroyed: false };
  const field = {
    store,
    hooks: {
      derivedStats: () => effects.derived,
      absorbDamage: SkillSystem.prototype.absorbDamage.bind(skills),
    },
  };
  field.skillDefenses = new SkillDefenses(field);
  const hit = { amount: 101, element: 2 };
  OfflineField.prototype.applyHitDamage.call(field, hit, store.profile);
  expect(store.profile.mp).toBe(20);
  expect(store.profile.hp).toBe(983);
  expect(hit.hpDamage).toBe(17);
  expect(hit.amount).toBe(97);
});
