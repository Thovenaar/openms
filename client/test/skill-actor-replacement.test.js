import { expect, test } from "bun:test";
import { SkillAttack } from "../src/skills/skill-attack.js";

test("weapon replacement preserves external summon records and rebuilds player attack timing", () => {
  const attack = Object.create(SkillAttack.prototype);
  attack.prepared = new Map();
  attack.field = {
    combat: { attacks: {} },
    scene: { actor: { actions: new Map() } },
  };
  const summon = { id: 5211001, properties: { summon: true } };
  const summonInfo = { damage: 150 };
  attack.prepareExternal(summon, summonInfo, 30);
  attack.prepare(
    { id: 1001004, properties: {}, visuals: {} },
    { action: "swingO1" },
    20,
  );
  const before = attack.prepared;
  const candidate = attack.prepareActor(
    { actions: new Map([["swingO1", { duration: 480 }]]) },
    { attacks: {} },
  );
  expect(candidate.get(summon.id)).toEqual(before.get(summon.id));
  expect(candidate.get(summon.id).spec).toBeNull();
  expect(candidate.get(1001004).duration).toBe(480);
  expect(before.get(1001004).duration).toBe(0);
  expect(attack.prepared).toBe(before);
});
