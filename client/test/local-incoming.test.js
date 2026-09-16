import { expect, test } from "bun:test";
import { LocalIncoming } from "../src/online/local-incoming.js";
import { animationId } from "../../shared/motion-schema.js";

const MOB_BODY = { left: -90, top: -60, right: 90, bottom: 0 };

function mobLife(overrides = {}) {
  return {
    info: {
      level: 10,
      PADamage: 120,
      MADamage: 0,
      acc: 40,
      noFlip: 0,
      ...overrides.info,
    },
    combat: {
      attacks: overrides.attacks ?? [
        {
          action: "attack1",
          supported: true,
          rectangle: MOB_BODY,
          properties: { type: 0, attackAfter: 600, PADamage: 120 },
        },
      ],
    },
  };
}

function mobView(options = {}) {
  const x = options.x ?? 60;
  const y = options.y ?? 0;
  return {
    entity: {
      id: options.id ?? "mob-a",
      kind: "mob",
      position: { x, y },
      facing: options.facing ?? -1,
      action: animationId(options.action ?? "attack1"),
      actionStartTick: options.actionStartTick ?? 3,
      mobState: {
        hp: 400,
        phase: options.phase ?? "attack",
        elapsedMs: options.elapsedMs ?? 0,
        generation: 0,
      },
    },
    animation: {
      action: options.action ?? "attack1",
      frame: 0,
      current: { geometry: [{ y: -20 }] },
    },
    drawX: x,
    drawY: y,
    life: options.life ?? mobLife(),
  };
}

function selfView(x = 20) {
  const expressions = new Set(["hit", "default"]);
  const faces = [];
  return {
    entity: {
      id: "self",
      kind: "player",
      position: { x, y: 0 },
      facing: 1,
      combatState: { phase: "idle" },
    },
    animation: {
      current: { geometry: [{ y: -20 }] },
      frame: 0,
      expressions,
      setExpression: (name, duration) => faces.push({ name, duration }),
    },
    faces,
    drawX: x,
    drawY: 0,
  };
}

function stats(overrides = {}) {
  return {
    level: 10,
    str: 100,
    dex: 40,
    luk: 10,
    pdd: 40,
    evasionPercent: 0,
    ...overrides,
  };
}

function fixture(options = {}) {
  const shown = [];
  const views = new Map();
  const self = options.self ?? selfView();
  views.set("self", self);
  const view = options.view ?? mobView();
  views.set(view.entity.id, view);
  const scene = {
    selfId: "self",
    views,
    scene: { simulation: { state: "ground", crouching: false } },
    events: {
      reserveNumber: () => {},
      combat: {
        snapshot: () => ({ active: 0, pending: 0, hardCapacity: 200 }),
        fixedNumberPlacement: (x, y) => ({ x, y }),
        show: (amount, family, placement) =>
          shown.push({ amount, family, placement }),
      },
    },
  };
  const host = {
    scene,
    owner: { hooks: { characterStats: () => options.stats ?? stats() } },
  };
  let now = 1000;
  const incoming = new LocalIncoming(
    host,
    () => now,
    options.random ?? (() => 0.5),
  );
  return {
    incoming,
    view,
    self,
    shown,
    time: (ms) => {
      now = ms;
    },
  };
}

test("a released mob swing against the local player shows its digit at the authored frame", () => {
  const f = fixture();
  f.incoming.observe(f.view, 500);
  expect(f.shown.length).toBe(0);
  f.incoming.observe(f.view, 200);
  expect(f.shown.length).toBe(1);
  expect(f.shown[0].family).toBe(2);
  expect(f.shown[0].amount).toBeGreaterThan(0);
  // The authored flinch face starts on the same frame.
  expect(f.self.faces).toEqual([{ name: "hit", duration: 1500 }]);
  // The same attack instance cannot be resolved twice.
  f.incoming.observe(f.view, 100);
  expect(f.shown.length).toBe(1);
});

test("a swing whose authored area misses the local player predicts nothing", () => {
  const view = mobView();
  view.drawX = 400;
  view.drawY = -400;
  const f = fixture({ view });
  f.incoming.observe(f.view, 800);
  expect(f.shown.length).toBe(0);
});

test("the authoritative incoming impact consumes exactly one local prediction", () => {
  const f = fixture();
  f.incoming.observe(f.view, 700);
  expect(f.shown.length).toBe(1);
  expect(
    f.incoming.consume({
      cause: "mob-attack",
      actorId: "mob-a",
      targetId: "self",
      damage: 55,
    }),
  ).toBe(true);
  expect(
    f.incoming.consume({
      cause: "mob-attack",
      actorId: "mob-a",
      targetId: "self",
      damage: 55,
    }),
  ).toBe(false);
  // Another actor's impact and a missed authoritative outcome are never consumed.
  expect(
    f.incoming.consume({
      cause: "mob-attack",
      actorId: "mob-b",
      targetId: "self",
      damage: 55,
    }),
  ).toBe(false);
  expect(
    f.incoming.consume({
      cause: "mob-attack",
      actorId: "mob-a",
      targetId: "self",
      damage: 0,
    }),
  ).toBe(false);
});

test("an expired prediction is no longer consumed by a late confirmation", () => {
  const f = fixture();
  f.incoming.observe(f.view, 700);
  f.time(9000);
  expect(
    f.incoming.consume({
      cause: "mob-attack",
      actorId: "mob-a",
      targetId: "self",
      damage: 12,
    }),
  ).toBe(false);
});
