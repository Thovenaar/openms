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
  expect(motion.sample(300).x).toBeCloseTo(30);
  const before = motion.sample(400).x;
  motion.observe(mob(31), 3, 400, null);
  expect(motion.x).toBe(before);
  expect(motion.sample(580).x).toBeCloseTo(49);
  motion.observe(mob(-100), 2, 600, null);
  expect(motion.tick).toBe(3);
  expect(motion.entity.position.x).toBe(31);
});

test("jitter recovery retains finite progress and bounded correction at every drawn frame", () => {
  const motion = new RemoteMotion(mob(0), 0, 0);
  let previous = 0,
    maxStep = 0,
    stalls = 0;
  for (let ms = 15; ms <= 1500; ms += 15) {
    if (ms % 300 === 0) motion.observe(mob(ms / 10 - 8), ms / 30, ms, null);
    const x = motion.sample(ms).x;
    maxStep = Math.max(maxStep, Math.abs(x - previous));
    if (x === previous) stalls++;
    previous = x;
  }
  expect(stalls).toBe(0);
  expect(maxStep).toBeLessThan(3);
});

test("prediction brakes after a bounded gap, clamps to slopes, and resets on respawn", () => {
  const motion = new RemoteMotion(mob(0), 0, 0);
  expect(remoteTravelMs(600)).toBe(525);
  expect(motion.sample(10000).x).toBe(52.5);
  motion.observe(mob(40), 1, 10000, { x1: 0, x2: 50, y1: 0, y2: 25 });
  expect(motion.sample(11000).x).toBe(50);
  expect(motion.y).toBe(25);
  motion.observe(mob(-200, 0, 1), 2, 11000, null);
  expect(motion.x).toBe(-200);
  expect(motion.sample(12000).x).toBe(-200);
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
