import { expect, test } from "bun:test";
import { SkillEvents } from "../src/skills/skill-events.js";

function events(mapId = 925020100, job = 112) {
  return new SkillEvents({
    scene: { manifest: { id: mapId, physics: { map: { fieldType: 14 } } } },
    store: { profile: { job } },
  });
}
const BAMBOO = { id: 1009 };

test("Dojo meter counts each attack once and consumes the full secret-skill charge", () => {
  const state = events();
  expect(state.error(BAMBOO)).not.toBeNull();
  for (let sequence = 0; sequence < 99; sequence++) {
    state.onAttack(null, null, sequence);
    state.onAttack(null, null, sequence);
  }
  expect(state.error(BAMBOO)).not.toBeNull();
  for (let received = 0; received < 5; received++) state.onDamage();
  expect(state.error(BAMBOO)).toBeNull();
  state.consume(BAMBOO);
  state.onAttack(BAMBOO, null, 99);
  expect(state.energy).toBe(0);
  expect(state.error(BAMBOO)).not.toBeNull();
});

test("Event rank is local-map/job entitlement and Dojo entrance resets inherited energy", () => {
  const previous = events();
  previous.onDamage();
  const stage = events(925020200);
  stage.inherit(previous);
  expect(stage.energy).toBe(20);
  expect(stage.rank(1009)).toBe(1);
  expect(stage.rank(10001009)).toBe(0);
  expect(events(100000000).rank(1009)).toBe(0);
  const entrance = events(925020000);
  entrance.inherit(stage);
  expect(entrance.energy).toBe(0);
});
