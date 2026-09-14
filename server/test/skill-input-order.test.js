import { expect, test } from "bun:test";
import { awaitSkillInput } from "../src/skill-input-order.js";

function fixture() {
  return {
    field: { tick: 10 },
    connection: {},
    inputQueue: new Map([[11, { jump: true }]]),
  };
}

test("airborne skill admission waits for the preceding scheduled jump input", async () => {
  const actor = fixture();
  let admitted = false;
  const pending = awaitSkillInput({}, actor).then(() => {
    admitted = true;
  });
  await Promise.resolve();
  expect(admitted).toBe(false);
  actor.field.tick = 11;
  await pending;
  expect(admitted).toBe(true);
});

test("a field change during input admission cannot cast in the new field", async () => {
  const actor = fixture();
  const pending = awaitSkillInput({}, actor);
  actor.field = { tick: 12 };
  await expect(pending).rejects.toThrow("STALE_FIELD");
});

test("stopped field clocks reject instead of leaving a movement cast pending", async () => {
  const actor = fixture();
  actor.field.paused = true;
  await expect(awaitSkillInput({}, actor)).rejects.toThrow("SERVER_BUSY");
  actor.field.paused = false;
  await expect(awaitSkillInput({}, actor)).rejects.toThrow("SERVER_BUSY");
});
