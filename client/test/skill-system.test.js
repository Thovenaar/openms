import { expect, test } from "bun:test";
import { SkillSystem } from "../src/skill-system.js";
import { createProfile, validateProfile } from "../src/profile-validation.js";

/** Rank values are the original Skill.wz:100.img level/1 rows, not damage-policy fixtures. */
function skill(id, levels, options = {}) {
  return {
    id,
    bookId: Math.floor(id / 10000),
    levels,
    maxLevel: Object.keys(levels).length,
    masterLevel: null,
    prerequisites: [],
    actions: [],
    flags: {},
    properties: {},
    allocationCost: { kind: "sp", amount: 1 },
    visuals: {},
    sounds: { leaves: {} },
    classification: { activation: "melee", supported: true },
    ...options,
  };
}

function skillStore() {
  const profile = createProfile({ mapId: "100000000", x: 0, y: 0, facing: 1 });
  Object.assign(profile, {
    job: 100,
    level: 30,
    hp: 40,
    mp: 20,
    maxHP: 50,
    maxMP: 30,
  });
  profile.remainingSp[0] = 10;
  const listeners = new Set();
  const store = {
    profile,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markDirty() {
      for (const listener of listeners) listener();
    },
    async commitProfile(transform) {
      const draft = structuredClone(this.profile);
      transform(draft);
      validateProfile(draft);
      this.profile = draft;
      for (const listener of listeners) listener();
    },
  };
  return store;
}

function fixture(extra = {}) {
  const store = skillStore();
  const catalog = {
    ui: {
      skills: {
        1001003: skill(
          1001003,
          { 1: { time: 75, mpCon: 8, pdd: 2 } },
          {
            actions: ["alert2"],
            classification: { activation: "self-buff", supported: true },
          },
        ),
        1001004: skill(1001004, { 1: { mpCon: 4, damage: 165 } }),
        1001005: skill(1001005, {
          1: { hpCon: 8, mpCon: 6, damage: 72, range: 130, mobCount: 6 },
        }),
        ...extra,
      },
    },
  };
  const scene = {
    simulation: { x: 0, y: 0, facing: 1 },
    presentation: { x: 0, y: 0 },
  };
  const authority = { blocked: false, denied: null, action: true };
  const system = new SkillSystem(scene, store, catalog, {
    now: () => 1000,
    isBlocked: () => authority.blocked,
    validateCast: () => authority.denied,
    supportsAction: () => authority.action,
    validateAttack: () => authority.denied,
    admitAttack() {},
    startAction() {},
    report(error) {
      throw error;
    },
  });
  return { system, store, authority, catalog };
}

function grant(store, id, expiresAt = null) {
  store.profile.skills[id] = { level: 1, masterLevel: 1, expiresAt };
  store.markDirty();
}

test("unprepared, resource-boundary and field refusals preserve all gameplay state", async () => {
  const { system, store, authority } = fixture();
  grant(store, 1001005);
  const unprepared = structuredClone(store.profile);
  expect(system.activate(1001005).ok).toBe(false);
  expect(store.profile).toEqual(unprepared);
  await system.prepare();
  store.profile.hp = 8;
  const boundary = structuredClone(store.profile);
  expect(system.activate(1001005).ok).toBe(false);
  expect(store.profile).toEqual(boundary);
  store.profile.hp = 9;
  authority.denied = "Map forbids skill attacks";
  const blocked = structuredClone(store.profile);
  expect(system.activate(1001005).ok).toBe(false);
  expect(store.profile).toEqual(blocked);
  authority.denied = null;
  expect(system.activate(1001005).ok).toBe(true);
  expect(store.profile.hp).toBe(1);
  expect(store.profile.mp).toBe(14);
  system.destroy();
});

test("Iron Body expires once at authored duration and does not stack on recast", async () => {
  const { system, store } = fixture();
  grant(store, 1001003);
  await system.prepare();
  expect(system.activate(1001003).ok).toBe(true);
  expect(system.derived().pdd).toBe(2);
  system.step(30000);
  expect(system.activate(1001003).ok).toBe(true);
  expect(system.derived().pdd).toBe(2);
  system.step(60000);
  system.step(14999);
  expect(system.derived().pdd).toBe(2);
  system.step(1);
  expect(system.derived().pdd).toBe(0);
  expect(store.profile.mp).toBe(4);
  system.destroy();
});

test("learned expiration and cooldown boundaries prevent resource consumption", async () => {
  const entry = skill(1001004, { 1: { mpCon: 4, cooltime: 2 } });
  const { system, store } = fixture({ 1001004: entry });
  grant(store, 1001004, 4000);
  await system.prepare();
  expect(system.activate(1001004).ok).toBe(true);
  system.step(1999);
  expect(system.activate(1001004).ok).toBe(false);
  expect(store.profile.mp).toBe(16);
  system.step(1);
  expect(system.activate(1001004).ok).toBe(true);
  system.step(1000);
  expect(system.level(1001004)).toBe(0);
  expect(system.activate(1001004).ok).toBe(false);
  expect(store.profile.mp).toBe(12);
  system.destroy();
});

test("prerequisites, mastery and beginner entitlement are atomic allocation boundaries", async () => {
  const extra = {
    1000001: skill(
      1000001,
      { 1: { x: 4, y: 3 } },
      { prerequisites: [{ skillId: 1000000, rank: 5 }] },
    ),
    1121008: skill(1121008, { 1: { damage: 150 } }),
    1000: skill(
      1000,
      { 1: {}, 2: {}, 3: {} },
      { allocationCost: { kind: "beginner-entitlement", amount: 1 } },
    ),
  };
  const { system, store } = fixture(extra);
  const before = structuredClone(store.profile);
  expect((await system.learn(1000001)).ok).toBe(false);
  expect(store.profile).toEqual(before);
  store.profile.skills[1000000] = {
    level: 5,
    masterLevel: 10,
    expiresAt: null,
  };
  expect((await system.learn(1000001)).ok).toBe(true);
  expect(store.profile.remainingSp[0]).toBe(9);
  store.profile.job = 112;
  expect((await system.learn(1121008)).ok).toBe(false);
  store.profile.job = 0;
  store.profile.level = 2;
  store.markDirty();
  expect((await system.learn(1000)).ok).toBe(true);
  expect((await system.learn(1000)).ok).toBe(false);
  expect(store.profile.remainingSp[0]).toBe(9);
  system.destroy();
});

test("destroying a preparing owner cancels publication of learned resources", async () => {
  const { system, store } = fixture();
  grant(store, 1001004);
  const preparing = system.prepare();
  system.destroy();
  await expect(preparing).rejects.toHaveProperty("name", "AbortError");
  expect(system.activate(1001004).ok).toBe(false);
});

test("Evan early books spend their own SP while late books require existing mastery", async () => {
  const extra = {
    22121000: skill(22121000, { 1: {}, 2: {} }),
    22171000: skill(22171000, { 1: {}, 2: {} }),
    22181000: skill(22181000, { 1: {}, 2: {} }),
  };
  const { system, store } = fixture(extra);
  store.profile.job = 2218;
  store.profile.remainingSp[3] = 1;
  store.profile.remainingSp[8] = 2;
  store.profile.remainingSp[9] = 1;
  expect((await system.learn(22121000)).ok).toBe(true);
  expect(store.profile.remainingSp[3]).toBe(0);
  const before = structuredClone(store.profile);
  expect((await system.learn(22171000)).ok).toBe(false);
  expect((await system.learn(22181000)).ok).toBe(false);
  expect(store.profile).toEqual(before);
  store.profile.skills[22171000] = {
    level: 0,
    masterLevel: 1,
    expiresAt: null,
  };
  expect((await system.learn(22171000)).ok).toBe(true);
  expect(store.profile.remainingSp[8]).toBe(1);
  expect((await system.learn(22171000)).ok).toBe(false);
  expect(store.profile.skills[22171000].level).toBe(1);
  expect(store.profile.remainingSp[8]).toBe(1);
  system.destroy();
});

test("beginner entitlement cannot be regained by changing job families", async () => {
  const entry = skill(
    20011000,
    { 1: {}, 2: {}, 3: {} },
    {
      allocationCost: { kind: "beginner-entitlement", amount: 1 },
    },
  );
  const { system, store } = fixture({ 20011000: entry });
  store.profile.job = 2001;
  store.profile.level = 7;
  store.profile.skills[1000] = { level: 3, masterLevel: 3, expiresAt: null };
  store.profile.skills[10001000] = {
    level: 3,
    masterLevel: 3,
    expiresAt: null,
  };
  const before = structuredClone(store.profile);
  expect((await system.learn(20011000)).ok).toBe(false);
  expect(store.profile).toEqual(before);
  system.destroy();
});

test("missing authored rank and expired prerequisites refuse allocation atomically", async () => {
  const { system, store } = fixture({
    1000000: skill(1000000, { 1: {}, 3: {} }),
    1000001: skill(
      1000001,
      { 1: {} },
      {
        prerequisites: [{ skillId: 1000000, rank: 1 }],
      },
    ),
  });
  store.profile.skills[1000000] = { level: 1, masterLevel: 3, expiresAt: null };
  const missing = structuredClone(store.profile);
  expect((await system.learn(1000000)).ok).toBe(false);
  expect(store.profile).toEqual(missing);
  store.profile.skills[1000000].expiresAt = 1000;
  const expired = structuredClone(store.profile);
  expect((await system.learn(1000001)).ok).toBe(false);
  expect(store.profile).toEqual(expired);
  system.destroy();
});

test("ordinary allocation does not manufacture mastery or treat it as the rank cap", async () => {
  const { system, store } = fixture({
    1000000: skill(1000000, { 1: {}, 2: {}, 3: {} }),
  });
  expect((await system.learn(1000000)).ok).toBe(true);
  expect((await system.learn(1000000)).ok).toBe(true);
  expect(store.profile.skills[1000000]).toEqual({
    level: 2,
    masterLevel: 0,
    expiresAt: null,
  });
  // A legacy save's explicit mastery survives; it still does not cap this book.
  store.profile.skills[1000000].masterLevel = 2;
  expect((await system.learn(1000000)).ok).toBe(true);
  expect(store.profile.skills[1000000]).toEqual({
    level: 3,
    masterLevel: 2,
    expiresAt: null,
  });
  const atCap = structuredClone(store.profile);
  expect((await system.learn(1000000)).ok).toBe(false);
  expect(store.profile).toEqual(atCap);
  system.destroy();
});
