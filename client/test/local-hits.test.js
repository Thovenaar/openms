import { expect, test } from "bun:test";
import { LocalHits } from "../src/online/local-hits.js";
import { OnlineScene } from "../src/online/scene.js";
import { animationId } from "../../shared/motion-schema.js";

const MOB_BODY = Object.freeze({
  left: -20,
  top: -40,
  right: 20,
  bottom: 0,
});

function life(info = {}) {
  return {
    info: {
      level: 10,
      maxHP: 400,
      PDDamage: 0,
      PDRate: 0,
      eva: 0,
      pushed: 1,
      undead: 0,
      boss: 0,
      invincible: 0,
      ...info,
    },
    actions: {
      stand: { frames: [{ body: MOB_BODY }] },
      hit1: { frames: [{ body: MOB_BODY }] },
    },
  };
}

function mobView(id, options = {}) {
  const x = options.x ?? 40;
  const y = options.y ?? 0;
  const view = {
    entity: {
      id,
      kind: "mob",
      position: { x, y },
      facing: options.facing ?? -1,
      action: 0,
      mobState: {
        hp: options.hp ?? 400,
        phase: options.phase ?? "idle",
        generation: 0,
      },
    },
    animation: {
      action: "stand",
      frame: 0,
      actions: new Map([
        ["stand", { duration: 600 }],
        ["hit1", { duration: options.hitDuration ?? 480 }],
      ]),
    },
    drawX: x,
    drawY: y,
    motion: { x, y },
    life: options.life ?? life(),
  };
  return view;
}

function stats(overrides = {}) {
  return {
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
    ignoreDefensePercent: 0,
    damagePercent: 0,
    finalDamagePercent: 0,
    normalDamagePercent: 0,
    bossDamagePercent: 0,
    ...overrides,
  };
}

function fixture(options = {}) {
  const shown = [];
  const numbers = [];
  const views = new Map();
  for (const view of options.views ?? []) views.set(view.entity.id, view);
  const scene = {
    selfId: "self",
    views,
    scene: {
      presentation: { x: 0, y: 0, facing: 1 },
      actor: { avatar: { combat: options.combat ?? weaponCombat() } },
    },
    events: {
      reserveNumber: () => numbers.push(1),
      target: (view) => ({
        x: view.drawX,
        y: view.drawY,
        presentation: view.animation,
      }),
      combat: {
        onMobHit: (target, amount, critical) =>
          shown.push({ target, amount, critical }),
        onSkillDamageLine: (target, amount, line) =>
          shown.push({ target, amount, line }),
      },
    },
  };
  let now = 0;
  const host = {
    scene,
    owner: { hooks: { characterStats: () => options.stats ?? stats() } },
  };
  const hits = new LocalHits(host, () => now, options.random ?? (() => 0.5));
  return {
    hits,
    scene,
    shown,
    numbers,
    time: (ms) => {
      now = ms;
    },
  };
}

function weaponCombat() {
  return {
    defaultAction: "swingO1",
    attacks: {
      swingO1: {
        rectangle: { left: -88, top: -62, right: -18, bottom: -6 },
      },
    },
  };
}

function releaseNow(f, record) {
  if (record.hitTimer) clearTimeout(record.hitTimer);
  record.hitTimer = null;
  f.hits.resolve(record);
}

function basic(release = 100) {
  return {
    action: "swingO1",
    release,
    skillId: null,
    info: null,
    spec: null,
    use: null,
  };
}

test("a released basic attack draws its own number and starts the authored hit pose", async () => {
  const view = mobView("mob-a", { x: 50 });
  const f = fixture({ views: [view] });
  const record = basic(0);
  f.hits.begin(record);
  expect(record.hitScheduled).toBe(true);
  await Bun.sleep(5);
  expect(f.shown.length).toBe(1);
  expect(f.shown[0].amount).toBeGreaterThan(0);
  expect(f.shown[0].target.x).toBe(50);
  expect(f.hits.reaction(view)).toBe("hit1");
  expect(f.hits.pending.get("mob-a").length).toBe(1);
});

test("a mob outside the authored rectangle receives no local reaction", () => {
  const near = mobView("mob-near", { x: 50 });
  const behind = mobView("mob-behind", { x: -200 });
  const far = mobView("mob-far", { x: 400 });
  const f = fixture({ views: [near, behind, far] });
  const record = basic(0);
  f.hits.begin(record);
  releaseNow(f, record);
  expect(f.shown.length).toBe(1);
  expect(f.hits.reaction(near)).toBe("hit1");
  expect(f.hits.reaction(behind)).toBe(null);
  expect(f.hits.reaction(far)).toBe(null);
});

test("the local prediction is consumed by exactly one matching authoritative hit", () => {
  const view = mobView("mob-a", { x: 50 });
  const f = fixture({ views: [view] });
  const record = basic(0);
  f.hits.begin(record);
  releaseNow(f, record);
  expect(
    f.hits.consume({ actorId: "peer", targetId: "mob-a", damage: 12 }),
  ).toBe(false);
  expect(
    f.hits.consume({ actorId: "self", targetId: "mob-a", damage: 0 }),
  ).toBe(false);
  expect(
    f.hits.consume({ actorId: "self", targetId: "mob-a", damage: 12 }),
  ).toBe(true);
  expect(
    f.hits.consume({ actorId: "self", targetId: "mob-a", damage: 12 }),
  ).toBe(false);
});

test("a stale prediction is dropped instead of suppressing a later authoritative hit", () => {
  const view = mobView("mob-a", { x: 50 });
  const f = fixture({ views: [view] });
  const record = basic(0);
  f.hits.begin(record);
  releaseNow(f, record);
  f.time(10000);
  expect(
    f.hits.consume({ actorId: "self", targetId: "mob-a", damage: 12 }),
  ).toBe(false);
});

test("the local hit pose yields after its authored duration if authority never confirms it", () => {
  const view = mobView("mob-a", { x: 50, hitDuration: 480 });
  const f = fixture({ views: [view] });
  const record = basic(0);
  f.hits.begin(record);
  releaseNow(f, record);
  expect(f.hits.reaction(view)).toBe("hit1");
  f.time(479);
  expect(f.hits.reaction(view)).toBe("hit1");
  f.time(481);
  expect(f.hits.reaction(view)).toBe(null);
});

test("authority reclaims the pose as soon as the observed action is the reaction", () => {
  const view = mobView("mob-a", { x: 50 });
  const f = fixture({ views: [view] });
  const record = basic(0);
  f.hits.begin(record);
  releaseNow(f, record);
  view.entity.action = animationId("hit1");
  expect(f.hits.reaction(view)).toBe(null);
});

test("a waiting-to-confirm reaction yields the moment authority reports a new action", () => {
  const view = mobView("mob-a", { x: 50 });
  const f = fixture({ views: [view] });
  const record = basic(0);
  f.hits.begin(record);
  releaseNow(f, record);
  expect(f.hits.reaction(view)).toBe("hit1");
  view.entity.action = animationId("die1");
  view.entity.mobState.hp = 0;
  expect(f.hits.reaction(view)).toBe(null);
});

test("a hit below the authored push threshold shows a number but no reaction", () => {
  const view = mobView("mob-a", { x: 50, life: life({ pushed: 4000000 }) });
  const f = fixture({ views: [view] });
  const record = basic(0);
  f.hits.begin(record);
  releaseNow(f, record);
  expect(f.shown.length).toBe(1);
  expect(f.hits.reaction(view)).toBe(null);
});

test("an attacking mob keeps its attack pose while still showing the local number", () => {
  const view = mobView("mob-a", { x: 50, phase: "attack" });
  const f = fixture({ views: [view] });
  const record = basic(0);
  f.hits.begin(record);
  releaseNow(f, record);
  expect(f.shown.length).toBe(1);
  expect(f.hits.reaction(view)).toBe(null);
});

test("a refused or dead target draws nothing the server did not ask for", () => {
  const dead = mobView("mob-dead", { x: 50, hp: 0 });
  const spawning = mobView("mob-spawn", { x: 50, phase: "spawning" });
  const invincible = mobView("mob-inv", {
    x: 50,
    life: life({ invincible: 1 }),
  });
  const f = fixture({ views: [dead, spawning, invincible] });
  const record = basic(0);
  f.hits.begin(record);
  releaseNow(f, record);
  expect(f.shown.length).toBe(0);
  expect(f.hits.pending.size).toBe(0);
});

test("a mob that dies while a ray is in flight receives no corpse number", async () => {
  const view = mobView("mob-a", { x: 200 });
  const f = fixture({ views: [view] });
  const record = {
    action: "swingO1",
    release: 0,
    skillId: null,
    info: null,
    spec: null,
    use: null,
    projectile: { range: 400, templateId: 2060000 },
  };
  f.hits.begin(record);
  releaseNow(f, record);
  const queued = f.hits.pending.get("mob-a");
  view.entity.mobState.hp = 0;
  await Bun.sleep(queued[0].at + 30);
  expect(f.shown.length).toBe(0);
  expect(f.hits.reaction(view)).toBe(null);
});

test("a mob without authored frames is skipped instead of failing the whole swing", () => {
  const framed = mobView("mob-framed", { x: 50 });
  const frameless = mobView("mob-frameless", {
    x: 50,
    life: { info: life().info, actions: {} },
  });
  const f = fixture({ views: [frameless, framed] });
  const record = basic(0);
  f.hits.begin(record);
  releaseNow(f, record);
  expect(f.shown.length).toBe(1);
  expect(f.hits.pending.has("mob-frameless")).toBe(false);
  expect(f.hits.pending.has("mob-framed")).toBe(true);
});

test("a skill attack draws one authored line per hit and is cancelled with its record", () => {
  const view = mobView("mob-a", { x: 50 });
  const f = fixture({ views: [view] });
  const record = {
    action: "swingO1",
    release: 0,
    skillId: 1001004,
    info: { damage: 120, attackCount: 3, mobCount: 4 },
    spec: { kind: "melee" },
    use: null,
  };
  f.hits.begin(record);
  releaseNow(f, record);
  expect(f.shown.length).toBe(3);
  expect(f.shown.map((entry) => entry.line.line)).toEqual([0, 1, 2]);
  expect(f.shown[0].line.skillId).toBe(1001004);
  f.hits.cancel(record);
  expect(record.hits).toBe(null);
  // The pose already played, so cancelling the record must not retract the reaction.
  expect(f.hits.reaction(view)).toBe("hit1");
});

test("a ray waits for its projectile before drawing or reacting", async () => {
  const view = mobView("mob-a", { x: 200 });
  const f = fixture({ views: [view] });
  const record = {
    action: "swingO1",
    release: 0,
    skillId: null,
    info: null,
    spec: null,
    use: null,
    projectile: { range: 400, templateId: 2060000 },
  };
  f.hits.begin(record);
  releaseNow(f, record);
  expect(f.shown.length).toBe(0);
  expect(f.hits.reaction(view)).toBe(null);
  const queued = f.hits.pending.get("mob-a");
  expect(queued.length).toBe(1);
  await Bun.sleep(queued[0].at + 30);
  expect(f.shown.length).toBe(1);
  expect(f.hits.reaction(view)).toBe("hit1");
});

test("a rejected release never resolves its own hit", async () => {
  const view = mobView("mob-a", { x: 50 });
  const f = fixture({ views: [view] });
  const record = basic(0);
  f.hits.begin(record);
  f.hits.cancel(record);
  record.rejected = true;
  releaseNow(f, record);
  await Bun.sleep(5);
  expect(f.shown.length).toBe(0);
});

test("the drawn pose follows the local reaction and hands the mob back to its observed clock", () => {
  const view = mobView("mob-a", { x: 50 });
  const f = fixture({ views: [view] });
  const record = basic(0);
  f.hits.begin(record);
  releaseNow(f, record);
  let action = null;
  let sought = null;
  const host = {
    app: { renderer: { resolution: 1 } },
    localCombat: { hits: f.hits },
    poseAction: () => "stand",
    posePlayback: () => "loop",
    observeLocalReaction: OnlineScene.prototype.observeLocalReaction,
    seekActionStart: () => {
      sought = true;
    },
  };
  view.animation = {
    action: "stand",
    frame: 0,
    actions: new Map([
      ["stand", { duration: 600 }],
      ["hit1", { duration: 480 }],
    ]),
    setAction: (name, playback) => {
      action = [name, playback];
    },
    setPosition: () => {},
    container: { scale: { x: 1 } },
  };
  OnlineScene.prototype.pose.call(host, view, 0, 0);
  expect(action).toEqual(["hit1", "once"]);
  f.time(481);
  OnlineScene.prototype.pose.call(host, view, 0, 0);
  expect(action).toEqual(["stand", "loop"]);
  expect(sought).toBe(true);
});

test("a local hit recoils the mob on the release frame and releases as authority catches up", () => {
  const view = mobView("mob-a", { x: 50 });
  const f = fixture({ views: [view] });
  f.hits.present({ rejected: false, hitFacing: 1, skillId: null }, view, [
    { amount: 25, critical: false },
  ]);
  expect(view.recoil).toBeTruthy();
  expect(view.recoil.facing).toBe(1);
  // The first frames move the drawn pose before the authority has applied anything.
  f.time(100);
  const first = f.hits.recoilOffset(view, 30);
  expect(first.x).toBeGreaterThan(0);
  const advanced = f.hits.recoilOffset(view, 30);
  expect(advanced.x).toBeGreaterThanOrEqual(first.x);
  // Once the authoritative position has covered the whole predicted displacement, nothing
  // is added: the same trajectory is not counted twice.
  // Let the authored reaction finish, then let the authority cover the displacement.
  for (let frame = 0; frame < 20; frame++) f.hits.recoilOffset(view, 30);
  expect(view.recoil.ms).toBe(0);
  view.motion = {
    x: view.recoil.originX + view.recoil.distance * view.recoil.facing,
    y: 0,
  };
  expect(f.hits.recoilOffset(view, 16)).toBeNull();
});

test("a refused or missed hit cannot leave a mob permanently displaced", () => {
  const view = mobView("mob-a", { x: 50 });
  const f = fixture({ views: [view] });
  f.hits.present({ rejected: false, hitFacing: -1, skillId: null }, view, [
    { amount: 25, critical: false },
  ]);
  expect(view.recoil.facing).toBe(-1);
  f.time(100);
  expect(f.hits.recoilOffset(view, 30).x).toBeLessThan(0);
  // No authoritative confirmation arrives; after the reaction window the offset is freed.
  f.time(view.recoil.releaseAfterMs + 200);
  let offset = f.hits.recoilOffset(view, 100);
  for (let frame = 0; frame < 60 && offset; frame++) {
    offset = f.hits.recoilOffset(view, 100);
  }
  expect(view.recoil).toBeNull();
});

test("the authoritative impact marks the predicted recoil confirmed", () => {
  const view = mobView("mob-a", { x: 50 });
  const f = fixture({ views: [view] });
  f.hits.present({ rejected: false, hitFacing: 1, skillId: null }, view, [
    { amount: 25, critical: false },
  ]);
  f.hits.remember(view, 25, 0);
  const record = f.hits.pending.get("mob-a")[0];
  expect(record).toBeTruthy();
  expect(view.recoil.confirmed).toBe(false);
  expect(
    f.hits.consume({
      actorId: "self",
      targetId: "mob-a",
      damage: 25,
      cause: "basic",
    }),
  ).toBe(true);
  expect(view.recoil.confirmed).toBe(true);
});
