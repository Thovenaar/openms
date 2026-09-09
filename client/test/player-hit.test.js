import { test, expect } from "bun:test";
import original from "../../docs/ghidra-physics-motion/wz-globals.json";
import { OfflineField, PLAYER_HIT } from "../src/offline-field.js";
import { AudiovisualSystem } from "../src/audiovisual-system.js";
import {
  createSimulation,
  advanceSimulation,
} from "../src/physics/simulation.js";
import { attachGround } from "../src/physics/geometry.js";

// Isolating field/geometry fixtures; these are not original recorded outcomes.
async function fieldFixture() {
  const simulation = createSimulation(
    {
      schemaVersion: 1,
      globals: original.globals,
      footholds: [
        {
          id: 1,
          layer: 1,
          group: 0,
          x1: -1000,
          y1: 0,
          x2: 1000,
          y2: 0,
          prev: 0,
          next: 0,
          properties: {},
        },
      ],
      ladders: [],
      map: {},
    },
    { x: 0, y: 0 },
  );
  attachGround(simulation, simulation.geometry.byId.get(1));
  const scene = {
    simulation,
    actor: { actions: new Map() },
    manifest: {
      life: { placements: [], templates: {} },
      combat: {
        schemaVersion: 1,
        weaponId: 1302000,
        equipment: { incPAD: 17 },
        attacks: {
          swingO1: {
            rectangle: {
              left: -88,
              top: -62,
              right: -18,
              bottom: -6,
              source: "fixture",
            },
          },
        },
      },
    },
  };
  const store = {
    profile: { hp: 100, maxHP: 100, mp: 0, maxMP: 0 },
    markDirty() {},
  };
  const field = new OfflineField(scene, store);
  await field.prepare(new AbortController().signal);
  return field;
}

function hit(
  amount,
  locallyInitiated = true,
  direction = PLAYER_HIT.noDirection,
) {
  return { amount, locallyInitiated, direction };
}

function held(overrides = {}) {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    attack: false,
    jumpPressed: false,
    ...overrides,
  };
}

test("nonpositive outcomes block local admission for fifty updates without damage or blink", async () => {
  const field = await fieldFixture();
  const idle = held();
  expect(field.tryReceiveHit(hit(-1))).toBe(true);
  for (let tick = 0; tick < 49; tick++) {
    expect(field.tryReceiveHit(hit(10))).toBe(false);
    field.step(30, idle);
    expect(field.blinkTint).toBe(0xffffff);
  }
  expect(field.hitTimerMs).toBe(-30);
  expect(field.store.profile.hp).toBe(100);
  field.step(30, idle);
  expect(field.hitTimerMs).toBe(0);
  expect(field.tryReceiveHit(hit(10))).toBe(true);
  expect(field.store.profile.hp).toBe(90);
  field.destroy();
});

test("positive blink decrements first and retains its two-of-four phase across authorized hits", async () => {
  const field = await fieldFixture();
  const idle = held();
  field.tryReceiveHit(hit(1));
  for (const tint of [0x808080, 0xffffff, 0xffffff]) {
    field.step(30, idle);
    expect(field.blinkTint).toBe(tint);
  }
  expect(field.tryReceiveHit(hit(1))).toBe(false);
  expect(field.tryReceiveHit(hit(1, false))).toBe(true);
  for (const tint of [0x808080, 0x808080, 0xffffff, 0xffffff]) {
    field.step(30, idle);
    expect(field.blinkTint).toBe(tint);
  }
  for (let tick = 4; tick < 49; tick++) field.step(30, idle);
  expect(field.hitTimerMs).toBe(30);
  expect(field.blinkTint).toBe(0x808080);
  field.step(30, idle);
  expect(field.hitTimerMs).toBe(0);
  expect(field.blinkTint).toBe(0xffffff);
  field.tryReceiveHit(hit(1));
  field.step(30, idle);
  expect(field.blinkTint).toBe(0x808080);
  field.tryReceiveHit(hit(0, false));
  expect(field.blinkTint).toBe(0xffffff);
  expect(field.store.profile.hp).toBe(97);
  field.destroy();
  expect(field.blinkTint).toBe(0xffffff);
});

test("hits preserve movement, lethal impulse, and the authorized death-admission distinction", async () => {
  const field = await fieldFixture();
  field.tryReceiveHit(hit(10, true, 1));
  expect(field.blocksMovement).toBe(false);
  expect(field.action).toBe(null);
  advanceSimulation(field.simulation, held({ left: true }), 30);
  expect(field.simulation.horizontalInput).toBe(-1);
  expect(field.simulation.x).toBeGreaterThan(0);
  expect(field.simulation.y).toBeLessThan(0);
  field.step(30, held());
  expect(field.blinkTint).toBe(0x808080);
  expect(field.tryReceiveHit(hit(100, false, 1))).toBe(true);
  expect(field.dead).toBe(true);
  expect(field.blinkTint).toBe(0xffffff);
  expect(field.simulation.vx).toBe(200);
  expect(field.simulation.vy).toBe(-200);
  expect(field.tryReceiveHit(hit(1, true, -1))).toBe(false);
  expect(field.tryReceiveHit(hit(0, false, -1))).toBe(true);
  expect(field.simulation.vx).toBe(0);
  expect(field.store.profile.hp).toBe(0);
  field.destroy();
});

test("an ordinary attack pose does not confer incoming-hit immunity", async () => {
  const field = await fieldFixture();
  field.phase = "attack";
  expect(field.tryReceiveHit(hit(10))).toBe(true);
  expect(field.store.profile.hp).toBe(90);
  field.destroy();
});

test("contact and authored attack impacts share signed admission and source eligibility", async () => {
  const field = await fieldFixture();
  field.step(30, held());
  const rectangle = {
    active: true,
    left: -20,
    top: -60,
    right: 20,
    bottom: 0,
  };
  const mob = {
    alive: true,
    active: true,
    fault: "fixture-unavailable-motion",
    x: 0,
    y: 0,
    facing: 1,
    stateMs: 0,
    attackFired: false,
    template: { info: { bodyAttack: 1, PADamage: 200, MADamage: 400 } },
    sweptBody: rectangle,
    attackBody: { ...rectangle },
    pendingAttack: {
      properties: { attackAfter: 0, magic: 1 },
      rectangle,
    },
  };
  field.mobs.push(mob);
  field.contactDamage();
  expect(field.store.profile.hp).toBe(100);
  mob.fault = null;
  field.contactDamage();
  expect(field.store.profile.hp).toBe(90);
  field.mobImpact(mob);
  expect(field.store.profile.hp).toBe(90);
  field.tryReceiveHit(hit(0, false));
  mob.attackFired = false;
  field.mobImpact(mob);
  field.contactDamage();
  expect(field.store.profile.hp).toBe(90);
  field.destroy();
});

test("contact during an authored attack does not inherit its impact sound", async () => {
  const field = await fieldFixture();
  const sounds = [];
  const audio = Object.create(AudiovisualSystem.prototype);
  audio.combatSound = (_group, _id, name) => sounds.push(name);
  field.hooks.onPlayerHit = (outcome, simulation) =>
    audio.onPlayerHit(outcome, simulation);
  const rectangle = { left: -1, top: -1, right: 1, bottom: 1 };
  const mob = {
    x: 0,
    alive: true,
    active: true,
    y: 0,
    facing: 1,
    templateId: 1,
    template: { info: { bodyAttack: 1, PADamage: 20 } },
    action: "attack1",
    pendingAttack: {
      action: "attack1",
      rectangle,
      properties: { attackAfter: 0, magic: 0 },
    },
    attackBody: {},
    stateMs: 0,
    sweptBody: { active: true, ...rectangle },
  };
  field.mobs.push(mob);
  Object.assign(field.hitboxes.body, { active: true, ...rectangle });
  field.contactDamage();
  expect(field.store.profile.hp).toBe(99);
  expect(sounds).toEqual([]);
  field.hitTimerMs = 0; // Isolate three separately admitted outcomes without advancing AI.
  field.mobImpact(mob);
  expect(field.store.profile.hp).toBe(98);
  expect(sounds).toEqual(["CharDam1"]);
  field.hitTimerMs = 0;
  field.contactDamage();
  expect(field.store.profile.hp).toBe(97);
  expect(sounds).toEqual(["CharDam1"]);
  field.destroy();
});
