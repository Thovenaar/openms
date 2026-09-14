import { test, expect, afterEach } from "bun:test";
import { Texture } from "pixi.js";
import { EntityAnimation } from "../src/rendering/animation.js";
import original from "../../docs/ghidra-physics-motion/wz-globals.json";
import { MELEE_ACTIONS } from "../src/combat/weapon-usage.js";
import { OfflineField, PLAYER_HIT } from "../src/combat/offline-field.js";
import { AudiovisualSystem } from "../src/audio/audiovisual-system.js";
import {
  createSimulation,
  advanceSimulation,
  setSimulationSeat,
  applyExternalImpulse,
} from "../src/physics/simulation.js";
import { attachGround } from "../src/physics/geometry.js";
import { createMobSkillStatus } from "../src/combat/mob-skill-status.js";

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
        {
          id: 2,
          layer: 1,
          group: 0,
          x1: 800,
          y1: -600,
          x2: 900,
          y2: -600,
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

function fixtureActor(actions = {}) {
  return new EntityAnimation(
    {
      id: "player",
      kind: "character",
      x: 0,
      y: 0,
      z: 0,
      action: "stand1",
      avatar: {
        combat: {
          schemaVersion: 2,
          weaponId: 1302000,
          weaponType: 30,
          equipment: { incPAD: 17, attack: 1, attackSpeed: 6, sfx: "swordL" },
          defaultAction: "swingO1",
          proneAction: "proneStab",
          attacks: Object.fromEntries(
            [...MELEE_ACTIONS[1], "proneStab"].map((name) => [
              name,
              {
                rectangle: { left: -88, top: -62, right: -18, bottom: -6 },
                timing: { duration: 150, release: 100 },
              },
            ]),
          ),
        },
      },
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
        ...actions,
      },
    },
    new Map([["pixel", Texture.EMPTY]]),
  );
}

async function fieldFixture(actions = {}) {
  const simulation = groundedSimulation();
  const scene = {
    simulation,
    actor: fixtureActor(actions),
    manifest: {
      physics: { map: {} },
      life: { placements: [], templates: {} },
      combat: {
        schemaVersion: 2,
        // Controlled zero defense baseline isolates hit admission, not WZ table values.
        standardPDD: Array.from({ length: 6 }, () => new Array(201).fill(0)),
      },
    },
  };
  // Synthetic action timing isolates admission/posture, not original artwork.
  for (const name of [...MELEE_ACTIONS[1], "proneStab"]) {
    scene.actor.actions.set(name, scene.actor.actions.get("stand1"));
  }
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
      inventory: [],
      equipment: [{ uid: "weapon", id: 1302000, count: 1, slot: -11 }],
    },
    markDirty() {},
  };
  const field = new OfflineField(scene, store, {
    items: { 1302000: { info: { incPAD: 17 } } },
    skillLevel: () => 0,
    skillInfo: () => null,
    nextUint32: () => 9999989,
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
  field.damageGenerator.nextUint32 = () => 89;
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
  field.hooks.derivedStats = () => ({ stance: 89 });
  field.tryReceiveHit(hit(5, false, -1));
  expect(simulation.state).toBe("air");
  expect(simulation.vx).toBe(-270);
  expect(simulation.vy).toBe(-270);
  expect(field.store.profile.hp).toBe(85);
  field.destroy();
});

test("resistance consumes the damage word stream only for admitted positive outcomes", async () => {
  const field = await fieldFixture();
  let draws = 0;
  field.damageGenerator.nextUint32 = () => 41 + draws++;
  field.random = () => {
    throw new Error("Resistance bypassed the gameplay word stream");
  };
  field.hooks.derivedStats = () => ({ stance: 42 });
  expect(field.tryReceiveHit(hit(5, true, -1))).toBe(true);
  expect(field.store.profile.hp).toBe(95);
  expect(field.simulation.state).toBe("ground");
  expect(field.simulation.foothold.id).toBe(1);
  expect(field.hitTimerMs).toBe(1500);
  expect(field.scene.actor.expression).toBe("hit");
  expect(field.tryReceiveHit(hit(5, true, -1))).toBe(false);
  expect(field.tryReceiveHit(hit(0, false, -1))).toBe(true);
  expect(draws).toBe(1);
  expect(field.store.profile.hp).toBe(95);
  expect(field.hitTimerMs).toBe(-1500);
  field.hooks.absorbDamage = () => 0;
  expect(field.tryReceiveHit(hit(5, false, -1))).toBe(true);
  expect(draws).toBe(2);
  expect(field.store.profile.hp).toBe(95);
  expect(field.hitTimerMs).toBe(1500);
  expect(field.simulation.state).toBe("air");
  expect(field.simulation.vx).toBe(-270);
  expect(field.simulation.vy).toBe(-270);
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
      info: { level: 1, acc: 10, bodyAttack: 1, PADamage: 50, MADamage: 50 },
    },
    sweptBody: rectangle,
    attackBody: { ...rectangle },
    pendingAttack: {
      properties: { attackAfter: 0, magic: 1 },
      rectangle,
    },
  };
  mob.skillStatus = createMobSkillStatus(mob.template.info);
  field.mobs.push(mob);
  field.contactDamage();
  expect(field.store.profile.hp).toBe(100);
  mob.fault = null;
  field.contactDamage();
  const afterContact = field.store.profile.hp;
  expect(afterContact).toBeLessThan(100);
  expect(afterContact).toBeGreaterThan(0);
  field.mobImpact(mob);
  expect(field.store.profile.hp).toBe(afterContact);
  field.tryReceiveHit(hit(0, false));
  mob.attackFired = false;
  field.mobImpact(mob);
  field.contactDamage();
  expect(field.store.profile.hp).toBe(afterContact);
  field.destroy();
});

test("authored notAttack tutorial mobs cannot initiate attacks or contact damage", async () => {
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
    fault: null,
    state: "idle",
    template: {
      info: {
        level: 1,
        acc: 30,
        bodyAttack: 1,
        notAttack: 1,
        PADamage: 20,
      },
    },
    sweptBody: rectangle,
  };
  mob.skillStatus = createMobSkillStatus(mob.template.info);
  field.mobs.push(mob);
  expect(field.mobAttackAllowed(mob)).toBe(false);
  field.contactDamage();
  expect(field.store.profile.hp).toBe(100);
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
  mob.skillStatus = createMobSkillStatus(mob.template.info);
  field.mobs.push(mob);
  Object.assign(field.hitboxes.body, { active: true, ...rectangle });
  field.contactDamage();
  const afterContact = field.store.profile.hp;
  expect(afterContact).toBeLessThan(100);
  expect(sounds).toEqual([]);
  field.hitTimerMs = 0; // Isolate three separately admitted outcomes without advancing AI.
  field.mobImpact(mob);
  const afterAttack = field.store.profile.hp;
  expect(afterAttack).toBeLessThan(afterContact);
  expect(sounds).toEqual(["CharDam1"]);
  field.hitTimerMs = 0;
  field.contactDamage();
  expect(field.store.profile.hp).toBeLessThan(afterAttack);
  expect(sounds).toEqual(["CharDam1"]);
  field.destroy();
});

test("temporary EVA admits physical MISS, expires, and does not consume protected proposals", async () => {
  const field = await fieldFixture();
  const words = [4000000, 0, 0, 0, 9000000, 0, 0, 0, 9000000, 0];
  let cursor = 0;
  field.damageGenerator.nextUint32 = () => words[cursor++];
  const temporary = { eva: 42 };
  field.hooks.derivedStats = () => temporary;
  const mob = {
    x: -10,
    alive: true,
    active: true,
    template: { info: { level: 1, acc: 20, PADamage: 50, MADamage: 50 } },
  };
  mob.skillStatus = createMobSkillStatus(mob.template.info);
  expect(field.proposeMobHit(mob, false)).toBe(true);
  expect(field.store.profile.hp).toBe(100);
  expect(field.lastDamage).toBe(0);
  expect(field.simulation.state).toBe("ground");
  expect(field.hitTimerMs).toBe(-1500);
  expect(cursor).toBe(4);
  temporary.eva = 0;
  expect(field.proposeMobHit(mob, false)).toBe(false);
  expect(cursor).toBe(4);
  field.hitTimerMs = 0;
  expect(field.proposeMobHit(mob, false)).toBe(true);
  expect(field.store.profile.hp).toBeLessThan(100);
  expect(field.store.profile.hp).toBeGreaterThan(0);
  expect(field.lastDamage).toBeGreaterThan(0);
  expect(cursor).toBe(10);
  field.destroy();
});

test("ordinary contact separates the offline recoil boundary from positive damage and true MISS", async () => {
  for (const [accuracyWord, recoilWord, hp, state, reason, timer] of [
    [9000000, 89, 79, "air", "ordinary", 1500],
    [9000000, 90, 79, "ground", "offline-recoil-resistance", 1500],
    [0, 90, 100, "ground", "nonpositive-damage", -1500],
  ]) {
    const field = await fieldFixture();
    const words = [accuracyWord, 0, 0, 0, 9000000, recoilWord];
    let cursor = 0;
    field.damageGenerator.nextUint32 = () => words[cursor++];
    const mob = {
      x: -10,
      alive: true,
      active: true,
      template: { info: { level: 1, acc: 20, PADamage: 50 } },
    };
    mob.skillStatus = createMobSkillStatus(mob.template.info);
    expect(field.proposeMobHit(mob, false)).toBe(true);
    expect(field.store.profile.hp).toBe(hp);
    expect(field.simulation.state).toBe(state);
    expect(field.lastKnockback).toBe(reason);
    expect(field.hitTimerMs).toBe(timer);
    expect(cursor).toBe(hp === 100 ? 4 : 6);
    if (state === "air") {
      expect(field.simulation.vx).toBe(270);
      expect(field.simulation.vy).toBe(-270);
    } else {
      expect(field.simulation.foothold.id).toBe(1);
      expect(field.simulation.vx).toBe(0);
      expect(field.simulation.vy).toBe(0);
    }
    expect(field.proposeMobHit(mob, false)).toBe(false);
    expect(field.store.profile.hp).toBe(hp);
    field.destroy();
  }
});

test("Guardian uses its reserved per-thousand boundary without turning normal hits into MISS", async () => {
  const field = await fieldFixture();
  field.store.profile.job = 112;
  field.store.profile.equipment.push({
    uid: "shield",
    id: 1092000,
    count: 1,
    slot: -10,
  });
  field.hooks.items[1092000] = { info: {} };
  field.hooks.skillLevel = (id) => (id === 1120005 ? 30 : 0);
  field.hooks.skillInfo = () => ({ prop: 150, time: 2 });
  const words = [9000000, 0, 0, 149, 9000000, 9000000, 0, 0, 150, 9000000, 89];
  let cursor = 0;
  field.damageGenerator.nextUint32 = () => words[cursor++];
  const mob = {
    x: -10,
    alive: true,
    active: true,
    template: { info: { level: 1, acc: 20, PADamage: 50, boss: 1 } },
  };
  mob.skillStatus = createMobSkillStatus(mob.template.info);
  expect(field.proposeMobHit(mob, false)).toBe(true);
  expect(field.store.profile.hp).toBe(100);
  expect(cursor).toBe(5);
  field.hitTimerMs = 0;
  expect(field.proposeMobHit(mob, false)).toBe(true);
  expect(field.store.profile.hp).toBe(79);
  expect(field.simulation.state).toBe("air");
  expect(cursor).toBe(11);
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
    movement: "ground-patrol",
    speed: 60,
    flight: null,
    aggro: {
      damageInstances: 0,
      expireStreak: 0,
      ticksRemaining: 0,
      updateMs: 0,
    },
    selectedSkills: [],
    template: { info: { pushed: 0 } },
  };
  mob.skillStatus = createMobSkillStatus(mob.template.info);
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

/** Controlled terminal-speed descent isolates the recovered admission boundary. */
function fallToFloor(field) {
  const simulation = field.simulation;
  applyExternalImpulse(simulation, 0, 670);
  simulation.y = -595;
  const input = held();
  for (let tick = 0; tick < 30; tick++) {
    advanceSimulation(simulation, input, 30, (ms) => field.step(ms, input));
  }
}

test("a high landing debits source-free HP once, even when its notification throws", async () => {
  const field = await fieldFixture();
  let dirty = false;
  field.store.markDirty = () => {
    dirty = true;
  };
  field.hooks.onPlayerHit = () => {
    throw new Error("presentation failure");
  };
  expect(() => fallToFloor(field)).toThrow("presentation failure");
  expect(field.store.profile.hp).toBe(92);
  expect(field.receiveFallLanding()).toBe(false);
  expect(field.store.profile.hp).toBe(92);
  expect(field.localHit.source).toBeNull();
  expect(field.hitTimerMs).toBe(1500);
  expect(dirty).toBe(true);
  field.destroy();
});

test("fall outcomes respect existing protection and retain ordinary lethal authority", async () => {
  const protectedField = await fieldFixture();
  protectedField.tryReceiveHit(hit(1));
  fallToFloor(protectedField);
  expect(protectedField.store.profile.hp).toBe(99);
  protectedField.hitTimerMs = 0;
  expect(protectedField.receiveFallLanding()).toBe(false);
  const lethal = await fieldFixture();
  lethal.store.profile.hp = 5;
  fallToFloor(lethal);
  expect(lethal.store.profile.hp).toBe(0);
  expect(lethal.dead).toBe(true);
  protectedField.destroy();
  lethal.destroy();
});

test("equipped bow launches at its authored release and a depleted arrow changes the next action to melee", async () => {
  // Non-alias frames release at the start of the last frame:100 of150ms.
  const field = await fieldFixture({
    shoot1: [100, 50].map((delay) => ({
      delay,
      parts: [{ texture: "pixel", x: 0, y: 0, z: 0 }],
    })),
  });
  const combat = structuredClone(field.combat);
  combat.weaponId = 1452000;
  combat.weaponType = 45;
  combat.equipment.attack = 3;
  combat.defaultAction = "swingT1";
  for (const name of ["swingT1", "swingT3", "shoot1"]) {
    combat.attacks[name] = structuredClone(combat.attacks.swingO1);
    if (name !== "shoot1") {
      field.scene.actor.actions.set(
        name,
        field.scene.actor.actions.get("stand1"),
      );
    }
  }
  field.store.profile.equipment[0].id = 1452000;
  field.hooks.items[1452000] = { info: { incPAD: 40 } };
  field.hooks.items[2060000] = { info: { reqLevel: 0, incPAD: 0 } };
  field.store.profile.inventory.push({
    uid: "arrow",
    id: 2060000,
    slot: 1,
    count: 1,
  });
  field.replaceCombat(combat);
  const shots = [];
  field.hooks.onProjectile = (shot) => shots.push({ ...shot });
  field.beginAttack();
  expect(field.action).toBe("shoot1");
  expect(field.store.profile.inventory).toEqual([]);
  const idle = held();
  for (let tick = 0; tick < 3; tick++) field.step(30, idle);
  expect(shots).toEqual([]);
  field.step(30, idle);
  expect(shots.map((shot) => shot.projectileId)).toEqual([2060000]);
  field.step(30, idle);
  field.beginAttack();
  expect(["swingT1", "swingT3"]).toContain(field.action);
  expect(field.weaponUse.ranged).toBe(false);
  field.destroy();
});
