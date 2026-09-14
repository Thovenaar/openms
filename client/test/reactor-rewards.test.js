import { expect, test } from "bun:test";
import { compileReactorReward } from "../tools/reactor-reward-compiler.js";
import {
  reactorReward,
  rollReactorRewards,
} from "../src/world/reactor-rewards.js";

const program = compileReactorReward({
  text: "function act() { rm.dropItems(true, 2, 8, 15, 1); }",
});
const rows = [
  { itemId: 4031161, chance: 1, questId: 1008 },
  { itemId: 4031162, chance: 1, questId: 1008 },
];
const reward = { program, rows };
const items = { 4031161: {}, 4031162: {} };

test("Pio's items require the active quest, and the empty roll retains the authored minimum meso pile", () => {
  const unavailable = rollReactorRewards(
    reward,
    { quests: {} },
    items,
    () => 0.99,
  );
  expect(unavailable.rolls).toEqual([{ itemId: 0, questId: 0 }]);
  expect(unavailable.quantities).toEqual([14]);
  const active = rollReactorRewards(
    reward,
    { quests: { 1008: { state: 1 } } },
    items,
    () => 0.99,
  );
  expect(active.rolls.map((row) => row.itemId)).toEqual([4031161, 4031162]);
  expect(active.quantities).toEqual([1, 1]);
  expect(
    rollReactorRewards(
      reward,
      { quests: { 1008: { state: 2 } } },
      items,
      () => 0.99,
    ).rolls,
  ).toEqual(unavailable.rolls);
});

test("script compilation rejects executable branches, unknown calls and invalid reward amounts", () => {
  for (const text of [
    "function act(){if(rm.haveItem(1)) rm.dropItems();}",
    "function act(){rm.dropItems(); rm.gainMeso(999);}",
    "function act(){rm.dropItems(true,2,9,8);}",
    "function act(){rm.dropItems(true,2,8,15,999);}",
  ]) {
    expect(compileReactorReward({ text }).status).toBe("unsupported-script");
  }
  expect(program.status).toBe("drops");
});

test("original template loot rows are kept when linked artwork supplies the reward program", () => {
  const data = { programs: { 2000: program }, rows: { 2001: rows } };
  expect(reactorReward(data, { id: "0002001", resolvedId: "0002000" })).toEqual(
    reward,
  );
  expect(() =>
    rollReactorRewards(reward, { quests: {} }, items, () => 1),
  ).toThrow("random source");
});
