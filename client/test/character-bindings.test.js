import { afterEach, expect, test } from "bun:test";
import { Texture } from "pixi.js";
import { EntityAnimation } from "../src/animation.js";
import { CharacterBindings } from "../src/character-bindings.js";

const actors = [];
afterEach(() => {
  for (const actor of actors) actor.container.destroy({ children: true });
  actors.length = 0;
});

function character(store, clock) {
  const actor = new EntityAnimation(
    {
      id: "player",
      kind: "character",
      x: 0,
      y: 0,
      z: 0,
      action: "stand1",
      actions: {
        stand1: [
          {
            delay: 150,
            parts: [
              { texture: "face", x: 0, y: 0, z: 0, expression: "default" },
              {
                texture: "face",
                x: 0,
                y: 0,
                z: 0,
                expression: "hit",
                expressionDuration: 5000,
              },
            ],
          },
        ],
      },
    },
    new Map([["face", Texture.WHITE]]),
  );
  actors.push(actor);
  const scene = { actor, manifest: { physics: { map: { $seats: {} } } } };
  const gameplay = { prepared: true, dead: false, destroyed: false };
  return new CharacterBindings(scene, store, gameplay, {
    now: () => clock.now,
    isBlocked: () => false,
    report: (reason) => {
      clock.rejection = reason;
    },
  });
}

test("expression cooldown follows the profile clock across travel, not a new scenario", () => {
  const store = {};
  const clock = { now: 10000 };
  const first = character(store, clock);
  expect(first.emote(1)).toBe(true);

  const destination = character(store, clock);
  destination.inherit(first);
  clock.now = 11999;
  expect(destination.emote(1)).toBe(false);
  clock.now = 12000;
  expect(destination.emote(1)).toBe(true);

  const temporary = character({}, { now: 0 });
  temporary.inherit(destination);
  expect(temporary.emote(1)).toBe(true);
  expect(temporary.scene.actor.expression).toBe("hit");
});

test("map seat admission waits for combat alert, not signed hit protection", () => {
  const clock = { now: 10000 };
  const bindings = character({}, clock);
  bindings.scene.simulation = {
    state: "ground",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    seat: null,
  };
  bindings.seats = [{ id: 0, x: 0, y: 0 }];
  bindings.gameplay.phase = "idle";
  bindings.gameplay.alertTimerMs = 3500;
  bindings.gameplay.hitTimerMs = 0;
  expect(bindings.sit()).toBe(false);
  expect(bindings.scene.simulation.seat).toBe(null);
  bindings.gameplay.alertTimerMs = 0;
  bindings.gameplay.hitTimerMs = -1500;
  expect(bindings.sit()).toBe(true);
  expect(bindings.scene.simulation.action).toBe("sit");
});
