import { expect, test } from "bun:test";
import { SkillChakra } from "../src/skills/skill-chakra.js";

function setup(hp = 49) {
  const profile = { hp, mp: 50 };
  const actor = { x: 0, y: 0, movementLocked: false };
  const field = {
    phase: "idle",
    attackDurationMs: 1500,
    simulation: actor,
    blocksMovement: false,
  };
  const system = {
    store: { profile, markDirty() {} },
    scene: { simulation: actor },
    derived: () => ({ maxHP: 100, luk: 10 }),
    hooks: {
      gameplay: () => field,
      random: () => 0,
      startAction() {
        field.phase = "cast";
      },
    },
    resources: {
      play() {
        return {};
      },
      stop() {},
    },
    costs: {
      error: () => null,
      consume() {
        profile.mp -= 15;
        return null;
      },
    },
    publishCast() {},
  };
  return { chakra: new SkillChakra(system), profile, actor };
}

const SKILL = { id: 4211001, actions: ["alert"] };
const INFO = { mpCon: 15, x: 99, y: 68, time: 1 };

test("Chakra admits below fifty percent but refuses the exact fifty-percent boundary", () => {
  expect(setup(49).chakra.admissionError()).toBeNull();
  expect(setup(50).chakra.admissionError()).not.toBeNull();
});

test("Movement interrupts Chakra preparation without HP or MP transaction", () => {
  const { chakra, profile } = setup();
  chakra.cast(SKILL, INFO, 1);
  chakra.step(1499);
  chakra.input({ left: true });
  chakra.step(1);
  expect(profile).toEqual({ hp: 49, mp: 50 });
  expect(chakra.damagePercent()).toBe(100);
});

test("Chakra completes only at the original actor-action deadline, not rank.time", () => {
  const { chakra, profile } = setup();
  chakra.cast(SKILL, INFO, 1);
  chakra.input({});
  chakra.step(1000);
  expect(profile).toEqual({ hp: 49, mp: 50 });
  expect(chakra.damagePercent()).toBe(99);
  chakra.step(500);
  expect(profile).toEqual({ hp: 64, mp: 35 });
  expect(chakra.damagePercent()).toBe(100);
  chakra.step(1500);
  expect(profile).toEqual({ hp: 64, mp: 35 });
});
