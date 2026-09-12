import { expect, test } from "bun:test";
import original from "../../docs/ghidra-physics-motion/wz-globals.json";
import { createSimulation } from "../src/physics/simulation.js";
import { createMobs, damageMob, stepMob } from "../src/combat/offline-mobs.js";
import { Texture } from "pixi.js";
import { EntityAnimation } from "../src/rendering/animation.js";
import { OfflineMobRenderer } from "../src/combat/offline-mob-renderer.js";

// Isolating floor geometry; Shroom's mobType=4, speed=-30 and maxHP=20
// are original 0120100.img scalars, not an invented movement classification.
function mobWorld(slope = 0) {
  const footholds = [
    {
      id: 1,
      layer: 1,
      group: 0,
      x1: 0,
      y1: 0,
      x2: 32,
      y2: 32 * slope,
      prev: 0,
      next: 2,
      properties: {},
    },
    {
      id: 2,
      layer: 1,
      group: 0,
      x1: 32,
      y1: 32 * slope,
      x2: 64,
      y2: 64 * slope,
      prev: 1,
      next: 0,
      properties: {},
    },
  ];
  return {
    schemaVersion: 1,
    globals: original.globals,
    map: {},
    footholds,
    ladders: [],
  };
}

function groundedMob(info = {}, hitDuration = 0, slope = 0, moving = true) {
  const simulation = createSimulation(mobWorld(slope), {
    x: 10,
    y: 10 * slope,
  });
  const action = {
    timingKnown: true,
    frames: [
      { delayMs: 180, body: { left: -4, top: -8, right: 6, bottom: 0 } },
    ],
  };
  const template = {
    kind: "mob",
    originalId: "0120100",
    defaultAction: "stand",
    info: { maxHP: 20, speed: -30, mobType: 4, ...info },
    actions: { stand: action, move: action },
  };
  if (!moving) delete template.actions.move;
  if (hitDuration > 0) {
    template.actions.hit1 = {
      timingKnown: true,
      frames: [{ delayMs: hitDuration, body: action.frames[0].body }],
    };
  }
  const life = {
    templates: { "mob:0120100": template },
    placements: [
      {
        id: "life:0",
        kind: "mob",
        template: "mob:0120100",
        authored: { x: 10, y: -30, cy: 0, fh: 1, rx0: 0, rx1: 64, f: 0 },
      },
    ],
  };
  return createMobs(life, simulation)[0];
}

function flyingMob() {
  const world = mobWorld();
  world.footholds[1].x2 = 1000;
  const simulation = createSimulation(world, { x: 100, y: -100 });
  // Flyeye4230107 original flySpeed0/timing/body; optional stand probes precedence.
  const fly = {
    timingKnown: true,
    frames: [
      { delayMs: 130, body: { left: -19, top: -40, right: 19, bottom: 0 } },
      { delayMs: 100, body: { left: -26, top: -45, right: 31, bottom: -17 } },
      { delayMs: 130, body: { left: -35, top: -51, right: 48, bottom: -16 } },
    ],
  };
  const template = {
    kind: "mob",
    originalId: "4230107",
    defaultAction: "stand",
    info: { maxHP: 1600, flySpeed: 0, pushed: 500 },
    actions: { fly, stand: fly },
  };
  return createMobs(
    {
      templates: { "mob:4230107": template },
      placements: [
        {
          id: "life:0",
          kind: "mob",
          template: "mob:4230107",
          authored: { x: 100, y: -100, fh: 2, cy: 0, rx0: 0, rx1: 1000, f: 0 },
        },
      ],
    },
    simulation,
  )[0];
}

test("fly artwork admits zero-modifier free flight, while flySpeed alone cannot detach ground artwork", () => {
  const flyer = flyingMob();
  expect(flyer.y).toBe(-100);
  advance(flyer, 1);
  expect(flyer.foothold).toBeNull();
  advance(flyer, 4);
  expect(flyer.action).toBe("fly");
  expect(flyer.frame).toBe(1);
  const ground = groundedMob({ flySpeed: 100 });
  damageMob(ground, 1, 1);
  advance(ground, 80, { x: 50, y: -100 });
  expect(ground.x).toBe(50);
  expect(ground.y).toBe(0);
});

function advance(mob, ticks, target = null) {
  for (let tick = 0; tick < ticks; tick++) stepMob(mob, 30, target);
}

test("nonzero mobType does not strand a grounded Shroom before the next foothold", () => {
  const mob = groundedMob();
  advance(mob, 33);
  expect(mob.x).toBeCloseTo(51.58, 8);
  expect(mob.y).toBe(0);
  expect(mob.foothold.id).toBe(2);
  expect(mob.body.bottom).toBe(0);
  expect(mob.fault).toBeNull();
  advance(mob, 20);
  expect(mob.x).toBeCloseTo(51.4, 8);
  expect(mob.y).toBe(0);
});

test("noFlip fixes body mirroring without fixing the movement direction", () => {
  const mob = groundedMob({ noFlip: 1 });
  advance(mob, 33);
  expect(mob.x).toBeCloseTo(51.58, 8);
  expect(mob.body.left).toBeCloseTo(mob.x - 4, 8);
  expect(mob.body.right).toBeCloseTo(mob.x + 6, 8);
  advance(mob, 20);
  expect(mob.x).toBeCloseTo(51.4, 8);
  expect(mob.body.left).toBeCloseTo(mob.x - 4, 8);
  expect(mob.body.right).toBeCloseTo(mob.x + 6, 8);
});

test("admitted subthreshold and zero hits pursue either side without overshooting the player or rx limits", () => {
  const mob = groundedMob({ pushed: 10, noFlip: 1 });
  mob.record.authored.rx0 = 8;
  mob.record.authored.rx1 = 56;
  const target = Object.freeze({ x: 50, y: 0 });
  damageMob(mob, 1, 1);
  advance(mob, 40, target);
  expect(mob.x).toBe(50);
  expect(mob.foothold.id).toBe(2);
  expect(mob.action).toBe("stand");
  expect(mob.body.left).toBe(46);
  advance(mob, 40, { x: -100, y: 0 });
  expect(mob.x).toBe(8);
  expect(mob.facing).toBe(-1);
  damageMob(mob, 0, -1);
  advance(mob, 80, { x: 100, y: 0 });
  expect(mob.x).toBe(56);
  expect(mob.facing).toBe(1);
  expect(mob.fault).toBeNull();
});

test("pursuit stops at disconnected floor ends and resumes inward without crossing a gap", () => {
  const mob = groundedMob();
  mob.foothold.next.x1 = 40;
  damageMob(mob, 0, 1);
  advance(mob, 80, { x: 100, y: 0 });
  expect(mob.x).toBe(32);
  expect(mob.y).toBe(0);
  expect(mob.foothold.id).toBe(1);
  expect(mob.action).toBe("stand");
  expect(mob.facing).toBe(1);
  advance(mob, 30, { x: 0, y: 0 });
  expect(mob.x).toBe(0);
  expect(mob.fault).toBeNull();
});

test("the first miss starts aggro but later misses cannot postpone its coordinator expiry", () => {
  const mob = groundedMob();
  const target = { x: 50, y: 0 };
  damageMob(mob, 0, 1);
  advance(mob, 3999, target);
  expect(mob.x).toBe(50);
  damageMob(mob, 0, 1);
  stepMob(mob, 30, target);
  expect(mob.x).toBeGreaterThan(50);
  advance(mob, 100, target);
  damageMob(mob, 0, -1);
  advance(mob, 80, target);
  expect(mob.x).toBe(50);
  expect(mob.action).toBe("stand");
});

test("positive hits renew damage instances and expire using Cosmic's decaying instance schedule", () => {
  const mob = groundedMob();
  const target = { x: 50, y: 0 };
  damageMob(mob, 1, 1);
  advance(mob, 1000, target);
  damageMob(mob, 1, 1);
  // Two instances: 12 coordinator ticks then 3 ticks; 75s from renewal.
  advance(mob, 2499, target);
  expect(mob.x).toBe(50);
  stepMob(mob, 30, target);
  expect(mob.x).toBeGreaterThan(50);
});

test("controller loss, mob death and respawn clear pursuit instead of restoring stale targets", () => {
  const mob = groundedMob();
  const target = { x: 50, y: 0 };
  damageMob(mob, 0, 1);
  advance(mob, 40, target);
  stepMob(mob, 30, null);
  advance(mob, 100, target);
  expect(mob.x).not.toBe(50);
  damageMob(mob, 20, 1);
  advance(mob, 334, target);
  expect(mob.x).toBe(mob.spawnX);
  advance(mob, 80, target);
  expect(mob.x).not.toBe(50);
});

test("recoil and pending attacks finish before pursuit and offscreen residency never clears the target", () => {
  const mob = groundedMob({ maxHP: 100 }, 180);
  const target = { x: 0, y: 0 };
  mob.state = "attack";
  mob.pendingAttack = { properties: { attackAfter: 300 } };
  const pending = mob.pendingAttack;
  damageMob(mob, 1, 1);
  advance(mob, 6, target);
  const recoiled = mob.x;
  expect(recoiled).toBeCloseTo(26.92, 8);
  advance(mob, 4, target);
  expect(mob.x).toBe(recoiled);
  expect(mob.pendingAttack).toBe(pending);
  mob.visible = false;
  advance(mob, 30, target);
  expect(mob.x).toBe(0);
  expect(mob.pendingAttack).toBeNull();
});

test("rejected attacks and authored stationary controllers do not acquire pursuit", () => {
  const rejected = groundedMob({ invincible: 1 });
  damageMob(rejected, 0, 1);
  advance(rejected, 80, { x: 50, y: 0 });
  expect(rejected.x).not.toBe(50);
  const special = groundedMob({ flySpeed: 0 }, 0, 0, false);
  damageMob(special, 1, 1);
  advance(special, 80, { x: 50, y: 0 });
  expect(special.x).toBe(special.spawnX);
  expect(special.y).toBe(special.spawnY);
});

test("pushed separates HP loss from recoil, while an active attack keeps its pose and impact", () => {
  const mob = groundedMob({ pushed: 10 }, 180);
  mob.state = "attack";
  const attack = { properties: { attackAfter: 90 } };
  mob.pendingAttack = attack;
  damageMob(mob, 9, 1);
  expect(mob.hp).toBe(11);
  expect(mob.state).toBe("attack");
  expect(mob.pendingAttack).toBe(attack);
  damageMob(mob, 10, 1);
  expect(mob.hp).toBe(1);
  expect(mob.state).toBe("attack");
  expect(mob.pendingAttack).toBe(attack);
  stepMob(mob, 30);
  // Native midpoint integration: (130 + 118)/2 * .03, not constant-speed 120.
  expect(mob.x).toBeCloseTo(13.72, 8);
  expect(mob.body.bottom).toBe(0);
  advance(mob, 5);
  expect(mob.x).toBeCloseTo(26.92, 8);
  expect(mob.knockbackMs).toBe(0);
});

test("a hit deadline prevents repeated recoil without preventing damage, and weapon chance selects stronger motion", () => {
  const mob = groundedMob({ maxHP: 100, pushed: 10 }, 180);
  const attack = { skillId: 0, knockbackChance: 30, roll: 30 };
  damageMob(mob, 10, 1, attack);
  stepMob(mob, 30);
  expect(mob.x).toBeCloseTo(13.72, 8);
  damageMob(mob, 10, -1, attack);
  expect(mob.hp).toBe(80);
  stepMob(mob, 30);
  expect(mob.x).toBeGreaterThan(13.72);
  advance(mob, 4);
  attack.roll = 29;
  damageMob(mob, 10, -1, attack);
  const before = mob.x;
  stepMob(mob, 30);
  expect(before - mob.x).toBeCloseTo(((300 + 294) / 2) * 0.03, 8);
});

test("long authored reactions keep their entire deadline rather than readmitting after one second", () => {
  const mob = groundedMob({ maxHP: 100, pushed: 10 }, 1500);
  damageMob(mob, 10, 1);
  advance(mob, 34);
  const before = mob.x;
  damageMob(mob, 10, -1);
  stepMob(mob, 30);
  expect(mob.hp).toBe(80);
  expect(mob.x).toBe(before);
  advance(mob, 15);
  damageMob(mob, 10, -1);
  stepMob(mob, 30);
  expect(mob.x).toBeLessThan(before);
});

test("grounded recoil travels along sloped footholds instead of multiplying travel by slope length", () => {
  const flat = groundedMob({ maxHP: 100 }, 600);
  const slope = groundedMob({ maxHP: 100 }, 600, 1);
  damageMob(flat, 1, 1);
  damageMob(slope, 1, 1);
  stepMob(flat, 30);
  stepMob(slope, 30);
  const tangentDistance = Math.hypot(slope.x - 10, slope.y - 10);
  expect(tangentDistance).toBeCloseTo(flat.x - 10, 8);
  expect(slope.x - 10).toBeCloseTo(3.72 / Math.sqrt(2), 8);
});

test("knockback crosses patrol limits but respects connected floor ends without teleporting back", () => {
  const mob = groundedMob({}, 360);
  mob.record.authored.rx1 = 12;
  damageMob(mob, 1, 1);
  advance(mob, 12);
  expect(mob.x).toBeGreaterThan(12);
  const before = mob.x;
  stepMob(mob, 30);
  expect(mob.x).toBeCloseTo(before - 1.26, 8);
  expect(mob.x).toBeGreaterThan(12);
  damageMob(mob, 1, -1);
  advance(mob, 12);
  damageMob(mob, 1, -1);
  advance(mob, 12);
  expect(mob.x).toBe(0);
  expect(mob.foothold.id).toBe(1);
  expect(mob.body.bottom).toBe(0);
  expect(mob.fault).toBeNull();
});

test("selected-skill admission and a missing hit pose do not fabricate immunity or reaction", () => {
  const mob = groundedMob();
  mob.selectedSkills = [1001004];
  const attack = { skillId: 1001004, knockbackChance: 0, roll: 0 };
  damageMob(mob, 5, 1);
  expect(mob.hp).toBe(20);
  damageMob(mob, 5, 1, attack);
  expect(mob.hp).toBe(15);
  expect(mob.state).toBe("idle");
  expect(mob.knockbackMs).toBe(0);
  expect(damageMob(mob, 15, 1, attack)).toBe(true);
  expect(damageMob(mob, 15, 1, attack)).toBe(false);
  expect(mob.deaths).toBe(1);
  expect(mob.body.active).toBe(false);
});

test("zero lines cannot trigger recoil even at pushed zero or reset an active hit deadline", () => {
  const mob = groundedMob({ pushed: 0 }, 180);
  damageMob(mob, 0, 1);
  expect(mob.hp).toBe(20);
  expect(mob.state).toBe("idle");
  expect(mob.knockbackMs).toBe(0);
  damageMob(mob, 1, 1);
  stepMob(mob, 30);
  damageMob(mob, 0, -1);
  expect(mob.hp).toBe(19);
  expect(mob.lastDamage).toBe(0);
  expect(mob.hitRemainingMs).toBe(150);
  stepMob(mob, 30);
  expect(mob.x).toBeCloseTo(17.08, 8);
});

test("respawn fades on the mob clock while field re-entry is immediately opaque", () => {
  const mob = groundedMob();
  expect(mob.opacity).toBe(1);
  damageMob(mob, 20, 1);
  advance(mob, 334);
  expect(mob.alive).toBe(true);
  expect(mob.opacity).toBe(0);
  expect(mob.actionMs).toBe(0);
  advance(mob, 13);
  expect(mob.opacity).toBe(124 / 255);
  advance(mob, 14);
  expect(mob.opacity).toBe(1);
  // A new field record is an existing-enter, not a replay of the old spawn/death.
  expect(groundedMob().opacity).toBe(1);
});

function renderMobFixture(mob) {
  const renderer = Object.create(OfflineMobRenderer.prototype);
  renderer.scene = { setEntityDepth() {} };
  const part = { texture: "pixel", x: 0, y: 0, z: 0 };
  const entity = new EntityAnimation(
    {
      id: mob.id,
      kind: "mob",
      action: "stand",
      actions: {
        stand: [{ delay: 180, parts: [part] }],
        move: [{ delay: 180, parts: [part] }],
        // Blue Snail0100101 die1 timing/alpha, isolated one-pixel artwork.
        die1: [
          { delay: 180, parts: [part] },
          { delay: 180, parts: [part] },
          { delay: 300, parts: [part], alphaEnd: 0 },
        ],
      },
    },
    new Map([["pixel", Texture.EMPTY]]),
  );
  mob.presentation = entity;
  return renderer;
}

test("death preserves authored alpha and respawn clears it on reacquired presentation", () => {
  const mob = groundedMob();
  mob.actions.die1 = {
    ends: new Float64Array([180, 360, 660]),
    duration: 660,
    frames: [{}, {}, {}],
  };
  const renderer = renderMobFixture(mob);
  const entity = mob.presentation;
  try {
    damageMob(mob, 20, 1);
    advance(mob, 17);
    renderer.synchronizeMob(mob);
    expect(entity.container.visible).toBe(true);
    expect(entity.sprites[0].alpha).toBe(128 / 255);
    advance(mob, 5);
    renderer.synchronizeMob(mob);
    expect(entity.container.visible).toBe(false);
    advance(mob, 312);
    advance(mob, 13);
    renderer.synchronizeMob(mob);
    expect(entity.container.visible).toBe(true);
    expect(entity.container.alpha).toBe(124 / 255);
    expect(entity.sprites[0].alpha).toBe(1);
    entity.container.destroy({ children: true });
    const reacquired = renderMobFixture(mob);
    reacquired.synchronizeMob(mob);
    expect(mob.presentation.container.alpha).toBe(124 / 255);
    damageMob(mob, mob.maxHP, 1);
    reacquired.synchronizeMob(mob);
    expect(mob.presentation.container.alpha).toBe(1);
    expect(mob.presentation.sprites[0].alpha).toBe(1);
  } finally {
    mob.presentation.container.destroy({ children: true });
  }
});

test("authored regen replaces the ordinary new-spawn fade and plays only once", () => {
  const mob = groundedMob();
  mob.actions.regen = {
    duration: 180,
    ends: new Float64Array([180]),
    frames: mob.actions.stand.frames,
  };
  damageMob(mob, 20, 1);
  advance(mob, 334);
  expect(mob.action).toBe("regen");
  expect(mob.opacity).toBe(1);
  advance(mob, 5);
  expect(mob.action).toBe("regen");
  advance(mob, 1);
  expect(mob.state).toBe("idle");
  expect(mob.action).toBe("move");
});
