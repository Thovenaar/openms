import { expect, test } from "bun:test";
import { RemoteMotion, remoteTravelMs } from "../src/online/remote-motion.js";
import { LocalCombat } from "../src/online/local-combat.js";
import { createProfile } from "../src/profile/profile-validation.js";

function mob(x, vx = 100, generation = 0) {
  return {
    id: "mob",
    position: { x, y: 0 },
    velocity: { x: vx, y: 0 },
    mobState: { hp: 10, generation, movementType: 1 },
  };
}

test("remote motion continues across delayed publications and corrects without a position jump", () => {
  const motion = new RemoteMotion(mob(0), 0, 0);
  const first = motion.sample(300).x;
  expect(first).toBeGreaterThan(15);
  expect(first).toBeLessThan(20);
  const before = motion.sample(400).x;
  motion.observe(mob(31), 3, 400, null);
  expect(motion.x).toBe(before);
  expect(motion.sample(580).x).toBeGreaterThan(before);
  motion.observe(mob(-100), 2, 600, null);
  expect(motion.tick).toBe(3);
  expect(motion.entity.position.x).toBe(31);
});

test("jitter recovery retains finite progress and bounded correction at every drawn frame", () => {
  const motion = new RemoteMotion(mob(0), 0, 0);
  let previous = null,
    maxStep = 0,
    stalls = 0;
  for (let ms = 15; ms <= 1500; ms += 15) {
    if (ms % 300 === 0) motion.observe(mob(ms / 10 - 8), ms / 30, ms, null);
    const x = motion.sample(ms).x;
    // The first playout windows legitimately hold while the buffer fills.
    if (ms >= 300) {
      maxStep = Math.max(maxStep, Math.abs(x - previous));
      if (x === previous) stalls++;
    }
    previous = x;
  }
  expect(stalls).toBe(0);
  // One publication of travel is 1.5 px; the drawn pose may also spend its correction
  // budget, which is bounded by the module's rate over one drawn frame (1.2 px/ms).
  expect(maxStep).toBeLessThan(1.2 * 15 + 2);
});

test("a bounded gap coasts to rest, clamps to slopes and resets on respawn", () => {
  const motion = new RemoteMotion(mob(0), 0, 0);
  // The coast is bounded: it never slides for the whole gap, it eases to a stop.
  expect(remoteTravelMs(600)).toBeGreaterThan(300);
  expect(remoteTravelMs(600)).toBeLessThan(305);
  // The drawn pose converges onto that bounded forecast instead of sliding past it:
  // 320 ms of travel at 100 px/s is 32 px, and it never exceeds it.
  const coasted = motion.sample(10000).x;
  expect(coasted).toBeGreaterThan(31);
  expect(coasted).toBeLessThan(33);
  const settled = motion.sample(20000).x;
  expect(settled).toBeCloseTo(32);
  expect(motion.sample(25000).x).toBeCloseTo(settled);
  // A reported ground contact clamps the forecast onto the authored slope.
  const slope = { x1: 0, x2: 50, y1: 0, y2: 25 };
  motion.observe(mob(40), 1, 26000, slope);
  motion.observe(mob(45), 2, 26100, slope);
  const clamped = motion.sample(27000);
  expect(clamped.x).toBeLessThanOrEqual(50);
  expect(clamped.y).toBeGreaterThan(0);
  // A new generation is a respawn: the new state is presented outright.
  motion.observe(mob(-200, 0, 1), 3, 27000, null);
  expect(motion.x).toBe(-200);
  expect(motion.sample(28000).x).toBe(-200);
});

async function fixture() {
  const catalog = await Bun.file(
    new URL("../public/generated/catalog.json", import.meta.url),
  ).json();
  const profile = createProfile({ mapId: "000050000", x: 0, y: 0, facing: 1 });
  profile.skills[1001004] = { level: 1 };
  const frame = { delay: 400, attackDelay: 400 };
  const action = { duration: 800, frames: [frame, frame] };
  const calls = [];
  const actor = {
    avatar: { combat: catalog.ui.avatar.entries[1302000].combat },
    actions: new Map(
      ["swingO1", "swingO2", "swingO3", "stabO1", "stabO2"].map((name) => [
        name,
        action,
      ]),
    ),
    current: action,
    setAction: (...args) => calls.push(args),
    seek: (ms) => calls.push(ms),
  };
  const containers = new Set();
  const scene = {
    selfId: "self",
    views: new Map(),
    controller: new AbortController(),
  };
  scene.events = { combat: { cancelProjectilePreview() {} } };
  const owner = {
    scene: {
      actor,
      simulation: { state: "ground", facing: 1 },
      presentation: { x: 0, y: 0, facing: 1 },
      addWorldContainer: (node) => containers.add(node),
      removeWorldContainer: (node) => containers.delete(node),
    },
    store: { profile },
    catalog,
    ui: {},
    hooks: { scene: () => scene },
    audio: { onPlayerAttack: (sfx) => calls.push(sfx) },
  };
  scene.scene = owner.scene;
  let now = 0;
  const local = new LocalCombat(owner, () => now);
  return {
    local,
    owner,
    actor,
    calls,
    containers,
    time: (ms) => {
      now = ms;
    },
  };
}

test("basic attacks start on the local edge and delayed echoes never restart their animation or sound", async () => {
  const f = await fixture();
  const before = structuredClone(f.owner.store.profile);
  f.local.input({ attack: true }, 1);
  const record = f.local.current();
  expect(record.action).toBe("swingO1");
  expect(f.calls).toContain("swordL");
  f.local.input({ attack: true }, 2);
  expect(f.local.records.size).toBe(1);
  f.time(300);
  expect(f.local.draw(f.actor)).toBe(true);
  f.time(1200);
  expect(f.local.current()).toBeNull();
  const entity = { id: "self", combatState: { inputSeq: 1, phase: "attack" } };
  f.local.observe(entity);
  expect(f.local.owns(entity)).toBe(true);
  expect(f.local.soundEcho({ actorId: "self", inputSeq: 1 })).toBe(true);
  expect(f.local.soundEcho({ actorId: "other", inputSeq: 1 })).toBe(false);
  expect(f.local.draw(f.actor)).toBe(false);
  expect(f.owner.store.profile).toEqual(before);
});

test("skill poses use the local clock; refusal and field replacement cannot cancel a newer action", async () => {
  const f = await fixture();
  const first = f.local.begin(1001004, "first");
  expect(first.action).toBe("swingO1");
  f.time(1000);
  const second = f.local.begin(1001004, "second");
  f.local.reject(first);
  expect(f.local.current()).toBe(second);
  expect(f.local.owns({ id: "self", combatState: { phase: "dead" } })).toBe(
    false,
  );
  f.local.destroy();
  expect(f.local.current()).toBeNull();
  expect(f.local.records.size).toBe(0);
});

test("local action locks end on their own clock; unrelated server locks remain authoritative", async () => {
  const f = await fixture();
  f.local.begin(1001004, "skill");
  const message = {
    authoritative: false,
    motion: { movementLocked: false },
    combat: { feedbackId: "skill", locked: false },
  };
  expect(f.local.movementLock(message)).toBe(true);
  f.time(1000);
  message.motion.movementLocked = message.combat.locked = true;
  expect(f.local.movementLock(message)).toBe(false);
  message.combat.feedbackId = "unpredicted";
  expect(f.local.movementLock(message)).toBe(true);
  message.combat.feedbackId = "skill";
  message.authoritative = true;
  expect(f.local.movementLock(message)).toBe(true);
});

function emptyBall() {
  return {
    manifest: {
      entities: [
        {
          id: "ball",
          kind: "effect",
          order: 0,
          x: 0,
          y: 0,
          z: 0,
          action: "play",
          actions: { play: [{ delay: 100, parts: [] }] },
        },
      ],
    },
    textures: new Map(),
    destroy() {
      throw new Error("Borrowed warm lease must remain owned by the field");
    },
  };
}

test("a warmed magic projectile launches before authority, suppresses only its own echo and releases on refusal", async () => {
  const f = await fixture();
  f.owner.store.profile.skills[2001004] = { level: 1 };
  f.owner.store.profile.mp = 100;
  const lease = emptyBall();
  f.owner.skillVisuals = { warmup: { get: () => lease } };
  const record = f.local.begin(2001004, "bolt");
  expect(record.projectile.descriptor.bundle).toBeDefined();
  clearTimeout(record.timer);
  await f.local.projectiles.launch(record);
  expect(f.containers.size).toBe(1);
  expect(record.confirmed).toBe(false);
  const event = {
    actorId: "self",
    visual: {
      feedbackId: "bolt",
      id: "flight",
      playbackId: "one",
      bundle: record.projectile.descriptor.bundle,
    },
  };
  expect(f.local.projectiles.visualEcho({ ...event, actorId: "peer" })).toBe(
    false,
  );
  expect(f.local.projectiles.visualEcho(event)).toBe(true);
  expect(f.local.projectiles.visualEcho(event)).toBe(true);
  f.local.projectiles.draw(100);
  expect([...f.containers][0].x).toBeGreaterThan(50);
  f.local.reject(record);
  expect(f.containers.size).toBe(0);
  expect(f.local.projectiles.flights.size).toBe(0);
  f.local.destroy();
});

test("a field change cancels an authored release even when projectile preparation is pending", async () => {
  const f = await fixture();
  f.owner.store.profile.skills[2001004] = { level: 1 };
  f.owner.store.profile.mp = 100;
  const pending = Promise.withResolvers();
  f.local.projectiles.prepare = () => pending.promise;
  const record = f.local.begin(2001004, "pending");
  clearTimeout(record.timer);
  const launch = f.local.projectiles.launch(record);
  f.owner.hooks.scene = () => null;
  f.local.bind();
  pending.resolve(emptyBall());
  await launch;
  expect(f.containers.size).toBe(0);
  expect(record.rejected).toBe(true);
});

const MOB_HIT_BODY = { left: -20, top: -40, right: 20, bottom: 0 };

function mobView(id, x) {
  return {
    entity: {
      id,
      kind: "mob",
      position: { x, y: 0 },
      facing: -1,
      action: 0,
      mobState: { hp: 400, phase: "idle", generation: 0 },
    },
    animation: {
      action: "stand",
      frame: 0,
      actions: new Map([
        ["stand", { duration: 600 }],
        ["hit1", { duration: 480 }],
      ]),
    },
    drawX: x,
    drawY: 0,
    life: {
      info: { level: 10, maxHP: 400, pushed: 1, invincible: 0 },
      actions: {
        stand: { frames: [{ body: MOB_HIT_BODY }] },
        hit1: { frames: [{ body: MOB_HIT_BODY }] },
      },
    },
  };
}

test("an admitted basic attack resolves its own hit on the local release frame", async () => {
  const f = await fixture();
  const view = mobView("mob-a", 50);
  const scene = f.owner.hooks.scene();
  scene.views.set("mob-a", view);
  f.owner.hooks.characterStats = () => ({
    level: 10,
    job: 100,
    weaponType: 30,
    damageSupported: true,
    str: 200,
    dex: 40,
    pad: 60,
    padWithoutProjectile: 60,
    projectilePAD: 0,
    mastery: 0,
    masteryPercent: 20,
    criticalChance: 0,
    criticalDamage: 0,
  });
  const shown = [];
  scene.events = {
    reserveNumber() {},
    target: (target) => ({ x: target.drawX, y: target.drawY }),
    combat: {
      onMobHit: (target, amount, critical) =>
        shown.push({ target, amount, critical }),
      onSkillDamageLine() {},
      cancelProjectilePreview() {},
    },
  };
  const record = f.local.begin(null, "attack");
  expect(record.hitRectangle).toEqual({
    source: "Character.wz:Afterimage/swordOL.img/0/swingO1",
    left: -88,
    top: -62,
    right: -18,
    bottom: -6,
    properties: { lt: { x: -88, y: -62 }, rb: { x: -18, y: -6 } },
  });
  expect(record.hitScheduled).toBe(true);
  clearTimeout(record.hitTimer);
  f.local.hits.resolve(record);
  expect(shown.length).toBe(1);
  expect(shown[0].amount).toBeGreaterThan(0);
  expect(f.local.hits.reaction(view)).toBe("hit1");
  // The authoritative copy of this hit never draws a second number.
  expect(
    f.local.hits.consume({ actorId: "self", targetId: "mob-a", damage: 5 }),
  ).toBe(true);
  f.local.destroy();
});
