import { expect, test } from "bun:test";
import { actorCombatFields } from "../src/field-combat.js";

test("peer publication tolerates destroyed skills while logout is checkpointing", () => {
  const actor = {
    state: "retiring",
    retiring: true,
    pending: true,
    skillField: { diseases: { remaining: new Float64Array(256) } },
    skills: null,
  };
  // The actor remains a field member until durable logout/lease release finishes.
  expect(actorCombatFields(actor)).toEqual({});
});
