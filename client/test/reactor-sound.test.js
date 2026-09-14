import { expect, test } from "bun:test";
import { reactorHitSound } from "../tools/reactor-data.js";
import { NativeWorldActions } from "../src/online/native-world-actions.js";

function root() {
  const hit = { type: "Sound_DX8", children: {} };
  const state = { type: "Property", children: { Hit: hit } };
  const family = { type: "Property", children: { 0: state, 3: state } };
  return { children: { 2000: family, 1012000: family } };
}

test("authored and linked reactor hits retain their source; missing families/states have explicit box fallback", () => {
  const sound = root();
  expect(reactorHitSound(sound, "1012000", "1012000", 0)).toMatchObject({
    source: "Sound.wz:Reactor.img/1012000/0/Hit",
    assignment: "authored",
  });
  expect(reactorHitSound(sound, "9999999", "1012000", 3).assignment).toBe(
    "linked-artwork",
  );
  expect(reactorHitSound(sound, "0002001", "0002001", 3)).toMatchObject({
    source: "Sound.wz:Reactor.img/2000/3/Hit",
    assignment: "fallback-box",
  });
  expect(reactorHitSound(sound, "9999999", "9999999", 90).source).toBe(
    "Sound.wz:Reactor.img/2000/0/Hit",
  );
  expect(() => reactorHitSound({ children: {} }, "1", "1", 0)).toThrow(
    "fallback hit sound is missing",
  );
});

test("received reactor transition plays the previous state's sound through the live field owner", async () => {
  const descriptor = { source: "Sound.wz:Reactor.img/2000/0/Hit" };
  const signal = new AbortController().signal;
  const calls = [];
  const actions = new NativeWorldActions({
    scene: {
      simulation: { x: 0, y: 0 },
      manifest: {
        reactors: {
          placements: [{ id: "reactor:0", templateId: "0002001", x: 20, y: 0 }],
          templates: { "0002001": { sounds: { 0: descriptor } } },
        },
      },
    },
    hooks: { scene: () => ({ controller: { signal } }) },
    audio: { audio: { playSound: async (...args) => calls.push(args) } },
  });
  await actions.event({
    event: {
      kind: "world.reactor",
      placementId: "reactor:0",
      fromState: 0,
      state: 1,
    },
  });
  expect(calls).toEqual([[descriptor, signal, 100]]);
});
