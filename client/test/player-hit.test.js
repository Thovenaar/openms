import { test, expect, afterEach } from "bun:test";
import { Texture } from "pixi.js";
import { EntityAnimation } from "../src/animation.js";
import original from "../../docs/ghidra-physics-motion/wz-globals.json";
import { OfflineField, PLAYER_HIT } from "../src/offline-field.js";
import { AudiovisualSystem } from "../src/audiovisual-system.js";
import {
  createSimulation,
  advanceSimulation,
  setSimulationSeat,
} from "../src/physics/simulation.js";
import { attachGround } from "../src/physics/geometry.js";

const actors = [];
afterEach(() => {
  for (const actor of actors) actor.container.destroy({ children: true });
  actors.length = 0;
});

// Isolating field/geometry fixtures; these are not original recorded outcomes.
function groundedSimulation() {
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
  advanceSimulation(simulation, held(), 30);
  return simulation;
}

function fixtureActor() {
  return new EntityAnimation(
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
              { texture: "pixel", x: 0, y: 0, z: 0 },
              { texture: "pixel", x: 0, y: -24, z: 1, expression: "default" },
              { texture: "pixel", x: 1, y: -24, z: 1, expression: "hit" },
            ],
          },
        ],
      },
    },
    new Map([["pixel", Texture.EMPTY]]),
  );
}

async function fieldFixture() {
  const simulation = groundedSimulation();
  const scene = {
    simulation,
    actor: fixtureActor(),
    manifest: {
      physics: { map: {} },
      life: { placements: [], templates: {} },
      combat: {
        schemaVersion: 1,
        weaponId: 1302000,
        equipment: { incPAD: 17 },
        defaultAction: "swingO1",
        proneAction: "swingO1",
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
  // Synthetic action timing isolates admission/posture, not original artwork.
  scene.actor.actions.set("swingO1", scene.actor.actions.get("stand1"));
  scene.actor.actions.set("alert", scene.actor.actions.get("stand1"));
  actors.push(scene.actor);
  const store = {
    profile: {
      job: 0,
      level: 1,
      str: 12,
      dex: 5,
      int: 4,
      luk: 4,
      hp: 100,
      maxHP: 100,
      mp: 0,
      maxMP: 0,
      equipment: [{ uid: "weapon", id: 1302000, count: 1, slot: -11 }],
    },
    markDirty() {},
  };
  const field = new OfflineField(scene, store, {
    items: { 1302000: { info: { incPAD: 17 } } },
    skillLevel: () => 0,
    skillInfo: () => null,
    nextUint32: () => 9999999,
  });
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
  expect(field.simulation.vx).toBe(270);
  expect(field.simulation.vy).toBe(-270);
  expect(field.tryReceiveHit(hit(1, true, -1))).toBe(false);
  expect(field.tryReceiveHit(hit(0, false, -1))).toBe(true);
  expect(field.simulation.vx).toBe(270);
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

test("miss, no-direction and resisted damage retain ground contact; failed stance admits impulse", async () => {
  const field = await fieldFixture();
  const simulation = field.simulation;
  field.random = () => 99 / 0x100000000;
  field.tryReceiveHit(hit(0, false, -1));
  expect(simulation.state).toBe("ground");
  expect(simulation.foothold.id).toBe(1);
  field.tryReceiveHit(hit(5, false));
  expect(simulation.state).toBe("ground");
  expect(field.store.profile.hp).toBe(95);
  field.hooks.derivedStats = () => ({ stance: 100 });
  field.tryReceiveHit(hit(5, false, -1));
  expect(simulation.state).toBe("ground");
  expect(field.store.profile.hp).toBe(90);
  field.hooks.derivedStats = () => ({ stance: 99 });
  field.tryReceiveHit(hit(5, false, -1));
  expect(simulation.state).toBe("air");
  expect(simulation.vx).toBe(-270);
  expect(simulation.vy).toBe(-270);
  expect(field.store.profile.hp).toBe(85);
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
    template: {
      info: { level: 1, acc: 10, bodyAttack: 1, PADamage: 200, MADamage: 400 },
    },
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
    template: { info: { level: 1, acc: 10, bodyAttack: 1, PADamage: 20 } },
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

test("temporary EVA admits physical MISS, expires, and does not consume protected proposals", async () => {
  const field = await fieldFixture();
  const words = [4000000, 0, 0, 0, 9000000, 0, 0, 0];
  let cursor = 0;
  field.damageGenerator.nextUint32 = () => words[cursor++];
  const temporary = { eva: 42 };
  field.hooks.derivedStats = () => temporary;
  const mob = {
    x: -10,
    alive: true,
    active: true,
    template: { info: { level: 1, acc: 20, PADamage: 200, MADamage: 400 } },
  };
  expect(field.proposeMobHit(mob, false)).toBe(true);
  expect(field.store.profile.hp).toBe(100);
  expect(field.lastDamage).toBe(0);
  expect(field.simulation.state).toBe("ground");
  expect(field.hitTimerMs).toBe(-1500);
  temporary.eva = 0;
  expect(field.proposeMobHit(mob, false)).toBe(false);
  field.hitTimerMs = 0;
  expect(field.proposeMobHit(mob, false)).toBe(true);
  expect(field.store.profile.hp).toBe(90);
  // Magical proposals do not silently reuse the physical EVA formula or stream.
  field.hitTimerMs = 0;
  temporary.eva = 999;
  expect(field.proposeMobHit(mob, true)).toBe(true);
  expect(field.store.profile.hp).toBe(70);
  field.destroy();
});

test("alert starts on the next idle selector and expires before the 167th recovery update", async () => {
  const field = await fieldFixture();
  const idle = held();
  const profile = field.store.profile;
  profile.hp = 20;
  profile.maxMP = 100;
  for (let tick = 0; tick < 333; tick++) field.step(30, idle);
  field.tryReceiveHit(hit(1));
  expect(field.action).toBe(null);
  field.step(30, idle);
  expect(field.action).toBe("alert");
  expect(field.blocksMovement).toBe(false);
  expect(profile.mp).toBe(3);
  expect(field.recovery.hpMs).toBe(0);
  for (let tick = 1; tick < 166; tick++) field.step(30, idle);
  expect(field.hitTimerMs).toBe(0);
  expect(field.alertTimerMs).toBe(20);
  expect(field.action).toBe("alert");
  expect(profile.hp).toBe(19);
  field.step(30, idle);
  expect(field.action).toBe(null);
  expect(field.alertTimerMs).toBe(0);
  expect(field.recovery.hpMs).toBe(30);
  for (let tick = 0; tick < 332; tick++) field.step(30, idle);
  expect(profile.hp).toBe(19);
  field.step(30, idle);
  expect(profile.hp).toBe(29);
  field.destroy();
});

test("absorbed positive damage refreshes alert; refused, zero and miss outcomes do not", async () => {
  const field = await fieldFixture();
  const idle = held();
  field.hooks.absorbDamage = () => 0;
  field.tryReceiveHit(hit(10));
  for (let tick = 0; tick < 10; tick++) field.step(30, idle);
  expect(field.alertTimerMs).toBe(4700);
  expect(field.tryReceiveHit(hit(10))).toBe(false);
  expect(field.alertTimerMs).toBe(4700);
  expect(field.tryReceiveHit(hit(10, false))).toBe(true);
  expect(field.alertTimerMs).toBe(5000);
  field.step(30, idle);
  field.tryReceiveHit(hit(0, false));
  expect(field.alertTimerMs).toBe(4970);
  field.tryReceiveHit(hit(-1, false));
  expect(field.alertTimerMs).toBe(4970);
  expect(field.action).toBe("alert");
  expect(field.blinkTint).toBe(PLAYER_HIT.normalTint);
  expect(field.store.profile.hp).toBe(100);
  field.destroy();
});

test("admitted attacks and casts refresh alert without changing hit protection", async () => {
  const field = await fieldFixture();
  const idle = held();
  field.tryReceiveHit(hit(1));
  for (let tick = 0; tick < 60; tick++) field.step(30, idle);
  field.beginAttack();
  expect(field.action).toBe("swingO1");
  expect(field.alertTimerMs).toBe(5000);
  expect(field.hitTimerMs).toBe(0);
  for (let tick = 0; tick < 5; tick++) field.step(30, idle);
  expect(field.action).toBe("alert");
  expect(field.blocksMovement).toBe(false);
  field.store.profile.equipment.length = 0;
  field.beginAttack();
  expect(field.alertTimerMs).toBe(4850);
  expect(field.action).toBe("alert");
  field.beginSkillPose("swingO1");
  expect(field.action).toBe("swingO1");
  expect(field.alertTimerMs).toBe(5000);
  expect(field.hitTimerMs).toBe(0);
  field.destroy();
});

test("walking and jumping override alert without clearing its countdown", async () => {
  const field = await fieldFixture();
  field.tryReceiveHit(hit(1));
  field.step(30, held());
  expect(field.action).toBe("alert");
  const walking = held({ right: true });
  advanceSimulation(field.simulation, walking, 30);
  field.step(30, walking);
  expect(field.action).toBe(null);
  expect(field.simulation.action).toBe("walk1");
  expect(field.alertTimerMs).toBe(4940);
  const jumping = held({ jump: true, jumpPressed: true });
  advanceSimulation(field.simulation, jumping, 30);
  field.step(30, jumping);
  expect(field.action).toBe(null);
  expect(field.simulation.action).toBe("jump");
  expect(field.alertTimerMs).toBe(4910);
  expect(field.recovery.hpMs).toBe(0);
  field.destroy();
});

test("a retained seat can recover HP during alert countdown when no impulse removes it", async () => {
  const field = await fieldFixture();
  setSimulationSeat(field.simulation, { id: 0, x: 0, y: 0 });
  field.tryReceiveHit(hit(10));
  field.step(30, held());
  expect(field.alertTimerMs).toBe(4970);
  expect(field.action).toBe(null);
  expect(field.simulation.action).toBe("sit");
  expect(field.recovery.hpMs).toBe(30);
  expect(field.recovery.hpEligible).toBe(true);
  field.destroy();
});

test("a negative generated sword line commits zero and emits MISS without a skill hit effect", async () => {
  const field = await fieldFixture();
  const mob = {
    alive: true,
    active: true,
    hp: 20,
    selectedSkills: [],
    template: { info: { pushed: 0 } },
  };
  let presented = null;
  let effects = 0;
  field.hooks.onMobHit = (_mob, amount) => {
    presented = amount;
  };
  field.attackSkill = { id: 1001004 };
  field.attackOnHit = () => {
    effects++;
  };
  field.damageTarget(mob, -52);
  expect(mob.hp).toBe(20);
  expect(mob.lastDamage).toBe(0);
  expect(presented).toBe(0);
  expect(effects).toBe(0);
  field.destroy();
});
