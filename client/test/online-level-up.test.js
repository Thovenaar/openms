import { expect, test } from "bun:test";
import { OnlineUI } from "../src/online/ui.js";

test("a foreign level-up follows the leveled field actor", async () => {
  const target = { x: 120, y: 240 };
  const calls = [];
  const owner = {
    store: { id: "self" },
    hooks: {
      scene: () => ({
        effectTarget: (actorId) => (actorId === "peer" ? target : null),
      }),
    },
    audio: {
      async playGameplayEffect(name, effectTarget) {
        calls.push({ name, target: effectTarget });
      },
    },
  };
  const accepted = await OnlineUI.prototype.combatEvent.call(owner, {
    kind: "combat.level-up",
    actorId: "peer",
  });
  expect(accepted).toBe(true);
  expect(calls).toEqual([{ name: "LevelUp", target }]);
});
