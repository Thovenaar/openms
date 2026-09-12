import { expect, test } from "bun:test";
import { CharacterDevelopment } from "../src/character/character-development.js";
import { createProfile } from "../src/profile/profile-validation.js";
import { experienceRequired } from "../src/character/offline-progression.js";
import { ProfileStore } from "../src/profile/profile-store.js";
import { grantItem } from "../src/items/inventory-model.js";
import { keyIndexForCode } from "../src/input/keymap.js";

const LOCATION = { mapId: "100000000", x: 0, y: 0, facing: 1 };

function fixture() {
  const storage = { persist: async () => {} };
  const store = {
    profile: createProfile(LOCATION),
    profileTransactionPending: false,
    async commitProfile(transform) {
      if (this.profileTransactionPending) {
        throw new Error("transaction pending");
      }
      this.profileTransactionPending = true;
      try {
        const draft = structuredClone(this.profile);
        transform(draft);
        await storage.persist();
        this.profile = structuredClone(draft);
      } finally {
        this.profileTransactionPending = false;
      }
    },
  };
  const catalog = {
    ui: {
      coverage: { skillCoverage: { playerBooks: [0, 100, 200, 900] } },
      items: {
        1040002: { id: 1040002, descriptor: {}, info: { islot: "Ma" } },
        1060002: { id: 1060002, descriptor: {}, info: { islot: "Pn" } },
        1072001: { id: 1072001, descriptor: {}, info: { islot: "So" } },
        1302000: { id: 1302000, descriptor: {}, info: { islot: "Wp" } },
      },
      skills: {
        1001000: {
          id: 1001000,
          bookId: 100,
          jobId: 100,
          maxLevel: 20,
          masterLevel: null,
          properties: {},
          levels: {},
          prerequisites: [],
        },
        1121000: {
          id: 1121000,
          bookId: 112,
          maxLevel: 30,
        },
      },
    },
  };
  return { store, storage, service: new CharacterDevelopment(store, catalog) };
}

function learned(level = 1, masterLevel = 20, expiresAt = null) {
  return { 1001000: { level, masterLevel, expiresAt } };
}

test("one coherent complete edit changes development fields without touching other domains", async () => {
  const { store, service } = fixture();
  grantItem(store.profile, { id: 2000000, descriptor: {}, info: {} }, 3);
  const before = structuredClone(store.profile);
  const patch = {
    name: "Editor",
    level: 10,
    job: 100,
    exp: experienceRequired(10) - 1,
    hp: 80,
    mp: 60,
    baseMaxHP: 100,
    baseMaxMP: 70,
    str: 30,
    dex: 25,
    int: 20,
    luk: 15,
    meso: 12345,
    fame: -5,
    remainingSp: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    skills: learned(4, 10, 1700000000000),
  };
  await service.edit(patch);
  expect(store.profile).toEqual({ ...before, ...patch, maxHP: 100, maxMP: 70 });
});

test("all original books are editable jobs without gifts or erasing learned records", async () => {
  const { store, service } = fixture();
  await service.edit({
    job: 100,
    skills: learned(),
    remainingSp: Array(10).fill(3),
  });
  const before = structuredClone(store.profile);
  // Book 900 has no retained skill row in this fixture and is not derived from quests.
  await service.edit({ job: 900 });
  expect(store.profile).toEqual({ ...before, job: 900 });
});

test("preset skills and bindings commit together, but a cross-job shortcut rejects the whole edit", async () => {
  const { store, service } = fixture();
  const key = keyIndexForCode("KeyA");
  const keyBindings = structuredClone(store.profile.keyBindings);
  keyBindings.keys[key] = { type: 1, id: 1001000 };
  await service.edit({ job: 100, skills: learned(20), keyBindings });
  expect(store.profile.job).toBe(100);
  expect(store.profile.skills[1001000].level).toBe(20);
  expect(store.profile.keyBindings.keys[key]).toEqual({ type: 1, id: 1001000 });
  const committed = structuredClone(store.profile);
  await expect(
    service.edit({ name: "Wrong job", job: 200, keyBindings }),
  ).rejects.toThrow();
  expect(store.profile).toEqual(committed);
});

test("edit waits for durability and owns nested patch values throughout and after commit", async () => {
  const { store, storage, service } = fixture();
  let release;
  storage.persist = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const before = structuredClone(store.profile);
  const key = keyIndexForCode("KeyA");
  const keyBindings = structuredClone(store.profile.keyBindings);
  keyBindings.keys[key] = { type: 1, id: 1001000 };
  const patch = {
    job: 100,
    remainingSp: Array(10).fill(2),
    skills: learned(3),
    keyBindings,
  };
  const expected = structuredClone(patch);
  let settled = false;
  const commit = service.edit(patch).then(() => {
    settled = true;
  });
  patch.remainingSp[0] = 999;
  patch.skills[1001000].level = 19;
  patch.keyBindings.keys[key].id = 1121000;
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(store.profile).toEqual(before);
  release();
  await commit;
  patch.remainingSp[1] = 888;
  patch.skills[1001000].masterLevel = 1;
  patch.keyBindings.keys[key].type = 0;
  expect(store.profile).toEqual({ ...before, ...expected });
});

test("a durable failure rejects the edit without publishing any valid draft field", async () => {
  const { store, storage, service } = fixture();
  const before = structuredClone(store.profile);
  storage.persist = async () => {
    throw new Error("quota");
  };
  await expect(
    service.edit({ name: "Uncommitted", skills: learned() }),
  ).rejects.toThrow("quota");
  expect(store.profile).toEqual(before);
});

const INVALID_PATCHES = [
  ["unknown development field", { inventory: [] }],
  ["unknown job", { job: 999 }],
  ["level above progression cap", { level: 201 }],
  ["EXP at the next level threshold", { exp: experienceRequired(1) }],
  ["nonzero EXP at level 200", { level: 200, exp: 1 }],
  ["HP above the edited maximum", { hp: 51, baseMaxHP: 50 }],
  ["MP above the edited maximum", { mp: 31, baseMaxMP: 30 }],
  ["derived maximum is not an editable base stat", { maxHP: 100 }],
  ["missing SP pool", { remainingSp: Array(9).fill(0) }],
  [
    "unsafe SP points",
    { remainingSp: Array(10).fill(Number.MAX_SAFE_INTEGER + 1) },
  ],
  ["negative SP points", { remainingSp: Array(10).fill(-1) }],
  [
    "unknown skill",
    { skills: { 9999999: { level: 1, masterLevel: 1, expiresAt: null } } },
  ],
  ["level above catalog rank cap", { skills: learned(21, 21) }],
  ["mastery above catalog rank cap", { skills: learned(1, 21) }],
  [
    "mastery-gated learned rank above current mastery",
    { skills: { 1121000: { level: 2, masterLevel: 1, expiresAt: null } } },
  ],
  ["invalid skill expiration", { skills: learned(1, 20, -1) }],
  [
    "unknown skill record field",
    {
      skills: {
        1001000: { level: 1, masterLevel: 20, expiresAt: null, rank: 1 },
      },
    },
  ],
];

for (const [description, patch] of INVALID_PATCHES) {
  test(`${description} rejects the entire edit without publishing valid fields`, async () => {
    const { store, service } = fixture();
    const before = structuredClone(store.profile);
    await expect(
      service.edit({ name: "Not published", ...patch }),
    ).rejects.toThrow();
    expect(store.profile).toEqual(before);
  });
}

test("a scalar-only patch cannot bypass validation of an existing learned record", async () => {
  const { store, service } = fixture();
  store.profile.skills = learned(1, 21);
  const before = structuredClone(store.profile);
  await expect(service.edit({ name: "Not published" })).rejects.toThrow();
  expect(store.profile).toEqual(before);
});

test("ordinary skills preserve independently stored mastery below learned rank", async () => {
  const { store, service } = fixture();
  await service.edit({ skills: learned(3, 0) });
  expect(store.profile.skills).toEqual(learned(3, 0));
  await service.edit({ name: "Still valid" });
  expect(store.profile.skills).toEqual(learned(3, 0));
});

test("unknown nonenumerable rank fields are rejected before cloning can erase them", async () => {
  const { store, service } = fixture();
  const before = structuredClone(store.profile);
  const skills = learned();
  Object.defineProperty(skills[1001000], "rank", { value: 5 });
  await expect(service.edit({ skills })).rejects.toThrow();
  expect(store.profile).toEqual(before);
});

test("max-level EXP, generic vital maxima and safe SP boundaries remain editable beyond AP caps", async () => {
  const { store, service } = fixture();
  const remainingSp = Array(10).fill(0);
  remainingSp[9] = Number.MAX_SAFE_INTEGER;
  await service.edit({
    level: 200,
    exp: 0,
    hp: 0,
    mp: 0,
    remainingSp,
    baseMaxHP: 50000,
    baseMaxMP: 45000,
  });
  expect(store.profile.level).toBe(200);
  expect(store.profile.exp).toBe(0);
  expect(store.profile.hp).toBe(0);
  expect(store.profile.mp).toBe(0);
  expect(store.profile.remainingSp).toEqual(remainingSp);
  expect([store.profile.baseMaxHP, store.profile.baseMaxMP]).toEqual([
    50000, 45000,
  ]);
});

function apFixture(options = {}) {
  const store = ProfileStore.memory(createProfile(LOCATION));
  const catalog = fixture().service.catalog;
  catalog.ui.coverage.skillCoverage.playerBooks = [
    0, 100, 1100, 2100, 200, 1200, 300, 1300, 400, 1400, 500, 510, 1500, 1510,
    2200,
  ];
  for (const [id, bookId] of [
    [1000001, 100],
    [11000000, 1100],
    [2000001, 200],
    [12000000, 1200],
    [5100000, 510],
    [15100000, 1510],
  ]) {
    catalog.ui.skills[id] = {
      id,
      bookId,
      maxLevel: 10,
      levels: { 1: { y: 7 } },
    };
  }
  return { store, service: new CharacterDevelopment(store, catalog, options) };
}

test("AP authority debits one point per primary stat and refuses repeated pending input", async () => {
  const { store, service } = apFixture();
  store.profile.remainingAp = 4;
  const before = structuredClone(store.profile);
  for (const target of ["str", "dex", "int", "luk"]) {
    const spending = service.spendAp(target);
    expect((await service.spendAp(target)).code).toBe("save-busy");
    expect((await spending).ok).toBe(true);
    expect(store.profile[target]).toBe(before[target] + 1);
  }
  expect(store.profile.remainingAp).toBe(0);
  expect((await service.spendAp("str")).code).toBe("insufficient-ap");
  await store.destroy();
});

test("native HP warning is a separate admission and cap-clamped growth never heals current HP", async () => {
  const { store, service } = apFixture({ random: () => 0 });
  store.profile.level = 20;
  store.profile.job = 100;
  store.profile.remainingAp = 2;
  store.profile.maxHP = 29999;
  store.profile.baseMaxHP = 29999;
  const before = structuredClone(store.profile);
  expect((await service.spendAp("hp")).code).toBe("ap-confirmation-required");
  expect(store.profile).toEqual(before);
  expect(await service.spendAp("hp", { confirmed: true })).toMatchObject({
    ok: true,
    gain: 1,
  });
  expect([
    store.profile.baseMaxHP,
    store.profile.maxHP,
    store.profile.hp,
    store.profile.remainingAp,
  ]).toEqual([30000, 30000, before.hp, 1]);
  expect((await service.spendAp("hp", { confirmed: true })).code).toBe(
    "ap-cap",
  );
  await store.destroy();
});

const AP_GROWTH = [
  [0, 12, 8, null],
  [100, 22, 6, 1000001],
  [1100, 22, 6, 11000000],
  [2100, 30, 6, null],
  [200, 9, 17, 2000001],
  [1200, 9, 17, 12000000],
  [300, 18, 10, null],
  [1300, 18, 10, null],
  [400, 18, 10, null],
  [1400, 18, 10, null],
  [500, 20, 11, null],
  [510, 20, 11, 5100000],
  [1500, 20, 11, null],
  [1510, 20, 11, 15100000],
  [2200, 12, 8, null],
];
for (const [job, hp, mp, skill] of AP_GROWTH) {
  test(`Cosmic AP job ${job} uses inclusive RNG ranges and authored growth skill bonus`, async () => {
    const { store, service } = apFixture({ random: () => 1 - Number.EPSILON });
    store.profile.job = job;
    store.profile.level = 20;
    store.profile.int = 20;
    store.profile.remainingAp = 4;
    expect((await service.spendAp("hp", { confirmed: true })).gain).toBe(hp);
    expect((await service.spendAp("mp", { confirmed: true })).gain).toBe(mp);
    if (skill) {
      store.profile.skills[skill] = {
        level: 1,
        masterLevel: 1,
        expiresAt: null,
      };
      const target = job === 200 || job === 1200 ? "mp" : "hp";
      expect((await service.spendAp(target, { confirmed: true })).gain).toBe(
        (target === "hp" ? hp : mp) + 7,
      );
    }
    await store.destroy();
  });
}

test("fresh-draft busy admission, invalid RNG and primary cap preserve AP and stats", async () => {
  let busy = false;
  const { store, service } = apFixture({ random: () => 1, isBusy: () => busy });
  store.profile.remainingAp = 1;
  store.profile.level = 20;
  const before = structuredClone(store.profile);
  const spending = service.spendAp("str");
  busy = true;
  expect((await spending).code).toBe("save-busy");
  expect(store.profile).toEqual(before);
  busy = false;
  expect((await service.spendAp("hp", { confirmed: true })).code).toBe(
    "invalid-random-source",
  );
  expect(store.profile).toEqual(before);
  store.profile.str = 32767;
  expect((await service.spendAp("str")).code).toBe("ap-cap");
  store.profile.hp = 0;
  expect((await service.spendAp("dex")).code).toBe("character-dead");
  store.profile.hp = before.hp;
  store.markDirty();
  await store.flush();
  await store.destroy();
});

test("native low-level HP/MP refusal cannot be bypassed with a confirmation flag", async () => {
  const { store, service } = apFixture({ random: () => 0 });
  store.profile.level = 19;
  store.profile.remainingAp = 1;
  const before = structuredClone(store.profile);
  expect((await service.spendAp("mp", { confirmed: true })).code).toBe(
    "ap-level-required",
  );
  expect(store.profile).toEqual(before);
  await store.destroy();
});

test("AP retains its base increase when equipped effective HP is already capped", async () => {
  const { store, service } = apFixture({ random: () => 0 });
  store.profile.level = 20;
  store.profile.job = 100;
  store.profile.remainingAp = 1;
  store.profile.baseMaxHP = 29900;
  store.profile.maxHP = 30000;
  service.catalog.ui.items[1040002].info.incMHP = 200;
  const hp = store.profile.hp;
  expect((await service.spendAp("hp", { confirmed: true })).gain).toBe(18);
  expect([
    store.profile.baseMaxHP,
    store.profile.maxHP,
    store.profile.hp,
    store.profile.remainingAp,
  ]).toEqual([29918, 30000, hp, 0]);
  await store.destroy();
});
