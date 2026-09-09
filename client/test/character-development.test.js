import { expect, test } from "bun:test";
import { CharacterDevelopment } from "../src/character-development.js";
import { createProfile } from "../src/profile-validation.js";
import { experienceRequired } from "../src/offline-progression.js";

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
  store.profile.inventory.push({ id: 2000000, count: 3 });
  const before = structuredClone(store.profile);
  const patch = {
    name: "Editor",
    level: 10,
    job: 100,
    exp: experienceRequired(10) - 1,
    hp: 80,
    mp: 60,
    maxHP: 100,
    maxMP: 70,
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
  expect(store.profile).toEqual({ ...before, ...patch });
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

test("edit waits for durability and owns nested patch values throughout and after commit", async () => {
  const { store, storage, service } = fixture();
  let release;
  storage.persist = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const before = structuredClone(store.profile);
  const patch = { remainingSp: Array(10).fill(2), skills: learned(3) };
  const expected = structuredClone(patch);
  let settled = false;
  const commit = service.edit(patch).then(() => {
    settled = true;
  });
  patch.remainingSp[0] = 999;
  patch.skills[1001000].level = 19;
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(store.profile).toEqual(before);
  release();
  await commit;
  patch.remainingSp[1] = 888;
  patch.skills[1001000].masterLevel = 1;
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
  ["HP above the edited maximum", { hp: 51, maxHP: 50 }],
  ["MP above the edited maximum", { mp: 31, maxMP: 30 }],
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

test("max-level zero EXP and safe SP boundary values remain editable", async () => {
  const { store, service } = fixture();
  const remainingSp = Array(10).fill(0);
  remainingSp[9] = Number.MAX_SAFE_INTEGER;
  await service.edit({ level: 200, exp: 0, hp: 0, mp: 0, remainingSp });
  expect(store.profile.level).toBe(200);
  expect(store.profile.exp).toBe(0);
  expect(store.profile.hp).toBe(0);
  expect(store.profile.mp).toBe(0);
  expect(store.profile.remainingSp).toEqual(remainingSp);
});
