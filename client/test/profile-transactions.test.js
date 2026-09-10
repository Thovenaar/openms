import { expect, test } from "bun:test";
import { ProfileStore } from "../src/profile-store.js";
import {
  createProfile,
  migrateProfile,
  validateProfile,
} from "../src/profile-validation.js";
import {
  grantItem,
  consumeItem,
  consumeTemplate,
  firstItem,
  itemCount,
} from "../src/inventory-model.js";
import { LocalSocial } from "../src/local-social.js";
import { LocalTrade, LocalTradeSession } from "../src/local-trade.js";

const LOCATION = { mapId: "100000000", x: 0, y: 0, facing: 1 };
const ITEMS = {
  1040002: { id: 1040002, descriptor: {}, info: { islot: "Ma" } },
  1060002: { id: 1060002, descriptor: {}, info: { islot: "Pn" } },
  1072001: { id: 1072001, descriptor: {}, info: { islot: "So" } },
  1302000: { id: 1302000, descriptor: {}, info: { islot: "Wp" } },
  2000000: { id: 2000000, descriptor: {}, info: { slotMax: 100 } },
};

function legacyProfile(version) {
  const old = createProfile(LOCATION);
  old.schemaVersion = version;
  old.equipment = old.equipment.map((entry) => entry.id);
  delete old.inventorySlots;
  delete old.gender;
  delete old.appearance;
  delete old.baseMaxHP;
  delete old.baseMaxMP;
  delete old.cash;
  delete old.monsterBook;
  delete old.skillMacros;
  delete old.social;
  delete old.settings.questTracker;
  delete old.settings.gameOptions;
  delete old.settings.alerts;
  if (version < 4) delete old.remainingAp;
  if (version < 3) {
    delete old.remainingSp;
    delete old.skills;
    delete old.settings.chat;
  }
  if (version === 1) delete old.keyBindings;
  return old;
}

// Memory mode shares the whole-profile transaction owner, without opening a browser database.
test("atomic commit exposes lock transitions and publishes coherent values without draft aliases", async () => {
  const store = ProfileStore.memory(createProfile(LOCATION));
  const seen = [];
  const pendingStates = [];
  store.subscribe(() => {
    pendingStates.push(store.profileTransactionPending);
    if (!store.profileTransactionPending) {
      seen.push([store.profile.hp, store.profile.maxHP]);
    }
  });
  let retained;
  const pending = store.commitProfile((draft) => {
    draft.maxHP = 200;
    draft.hp = 150;
    retained = draft;
  });
  expect(store.profileTransactionPending).toBe(true);
  expect(() => {
    store.profile.hp = 1;
  }).toThrow();
  await pending;
  expect(seen).toEqual([[150, 200]]);
  expect(pendingStates[0]).toBe(true);
  expect(pendingStates.at(-1)).toBe(false);
  retained.hp = 0;
  expect(store.profile.hp).toBe(150);
  store.profile.hp = 149;
  store.markDirty();
  await store.destroy();
});

test("invalid transaction restores equal mutable data without advancing save revision", async () => {
  const store = ProfileStore.memory(createProfile(LOCATION));
  const before = structuredClone(store.profile);
  const revision = store.revision;
  await expect(
    store.commitProfile((draft) => {
      draft.hp = draft.maxHP + 1;
    }),
  ).rejects.toThrow();
  expect(store.profile).toEqual(before);
  expect(store.revision).toBe(revision);
  expect(store.profileTransactionPending).toBe(false);
  store.profile.hp = 10;
  store.markDirty();
  await store.flush();
  await store.destroy();
});

test("flush and teardown drain accepted transactions while concurrent edits are rejected", async () => {
  const store = ProfileStore.memory(createProfile(LOCATION));
  const pending = store.commitProfile((draft) => {
    draft.meso = 500;
  });
  await expect(
    store.commitProfile((draft) => {
      draft.meso = 1;
    }),
  ).rejects.toThrow();
  const flush = store.flush();
  const close = store.destroy();
  await pending;
  await flush;
  await close;
  expect(store.profile.meso).toBe(500);
  expect(store.status).toBe("closed");
});

for (const version of [1, 2, 3, 4]) {
  test(`schema${version} migration conserves legacy quantities beyond the ordinary capacity without aliases`, () => {
    const old = legacyProfile(version);
    old.hp = 12;
    old.meso = 9876;
    old.inventory = [
      { id: 2000000, count: 9601 },
      { id: 1302000, count: 2 },
    ];
    if (old.keyBindings) old.keyBindings.keys[18] = { type: 4, id: 0 };
    const before = structuredClone(old);
    const migrated = migrateProfile(old, ITEMS);
    expect(itemCount(migrated, 2000000)).toBe(9601);
    expect(itemCount(migrated, 1302000)).toBe(2);
    expect(migrated.inventorySlots[1]).toBe(97);
    expect(
      migrated.inventory.every(
        (entry) => entry.count <= (entry.id === 1302000 ? 1 : 100),
      ),
    ).toBe(true);
    expect(migrated.equipment.map((entry) => [entry.id, entry.slot])).toEqual([
      [1040002, -5],
      [1060002, -6],
      [1072001, -7],
      [1302000, -11],
    ]);
    for (const key of Object.keys(before)) {
      if (
        ["schemaVersion", "inventory", "equipment", "settings"].includes(key)
      ) {
        continue;
      }
      expect(migrated[key]).toEqual(before[key]);
    }
    migrated.inventory[0].count = 1;
    expect(old).toEqual(before);
  });
}

test("migration refuses unrepresentable quantities and missing equipped metadata without altering its input", () => {
  const old = legacyProfile(4);
  old.inventory = [{ id: 2000000, count: 409601 }];
  const before = structuredClone(old);
  expect(() => migrateProfile(old, ITEMS)).toThrow();
  expect(old).toEqual(before);
  old.inventory = [];
  expect(() => migrateProfile(old, { 2000000: ITEMS[2000000] })).toThrow();
  expect(old.equipment).toEqual(before.equipment);
});

test("chat bounds reject an invalid atomic edit while valid saved settings survive", async () => {
  const store = ProfileStore.memory(createProfile(LOCATION));
  await store.commitProfile((draft) => {
    draft.settings.chat = { state: 3, height: 507 };
  });
  const revision = store.revision;
  await expect(
    store.commitProfile((draft) => {
      draft.settings.chat.height = 508;
    }),
  ).rejects.toThrow();
  expect(store.profile.settings.chat).toEqual({ state: 3, height: 507 });
  expect(store.revision).toBe(revision);
  await store.commitProfile((draft) => {
    draft.settings.chat = { state: 1, height: 26 };
  });
  await store.destroy();
});

test("two-character commit publishes both roots before either observer and drains close", async () => {
  const a = ProfileStore.memory(createProfile(LOCATION), { id: "a" });
  const b = ProfileStore.memory(createProfile(LOCATION), { id: "b" });
  a.profile.meso = 100;
  a.markDirty();
  const observed = [];
  const observe = () => {
    if (!a.profileTransactionPending && !b.profileTransactionPending) {
      observed.push([a.profile.meso, b.profile.meso]);
    }
  };
  a.subscribe(observe);
  b.subscribe(observe);
  let retained;
  const operation = ProfileStore.commitCharacters([b, a], ([to, from]) => {
    from.meso -= 40;
    to.meso += 40;
    retained = from;
  });
  expect([a.profileTransactionPending, b.profileTransactionPending]).toEqual([
    true,
    true,
  ]);
  expect(() => b.markDirty()).toThrow();
  const closing = b.destroy();
  await operation;
  retained.meso = 0;
  expect([a.profile.meso, b.profile.meso]).toEqual([60, 40]);
  expect(observed[0]).toEqual([60, 40]);
  expect([a.revision, b.revision]).toEqual([1, 1]);
  expect(observed.every((pair) => pair[0] === 60 && pair[1] === 40)).toBe(true);
  await closing;
  await a.destroy();
});

test("two-character cross-owner UID collision rejects the whole transfer and restores mutable roots", async () => {
  const a = ProfileStore.memory(createProfile(LOCATION), { id: "a" });
  const b = ProfileStore.memory(createProfile(LOCATION), { id: "b" });
  const before = [structuredClone(a.profile), structuredClone(b.profile)];
  await expect(
    ProfileStore.commitCharacters([a, b], ([left, right]) => {
      left.meso = 500;
      right.equipment[0].uid = left.equipment[0].uid;
    }),
  ).rejects.toThrow();
  expect([a.profile, b.profile]).toEqual(before);
  expect([a.revision, b.revision]).toEqual([0, 0]);
  a.profile.meso = 1;
  b.profile.meso = 2;
  a.markDirty();
  b.markDirty();
  await Promise.all([a.flush(), b.flush()]);
  await Promise.all([a.destroy(), b.destroy()]);
});

test("grants never merge incompatible instances and a whole transfer retains its UID", async () => {
  const a = ProfileStore.memory(createProfile(LOCATION), { id: "a" });
  const b = ProfileStore.memory(createProfile(LOCATION), { id: "b" });
  await a.commitProfile((draft) => {
    grantItem(draft, ITEMS[2000000], 100, {
      owner: "A",
      flags: 1,
      expiresAt: 42,
    });
    grantItem(draft, ITEMS[2000000], 3);
  });
  await b.commitProfile((draft) => grantItem(draft, ITEMS[2000000], 3));
  const offered = { ...firstItem(a.profile, 2000000) };
  await ProfileStore.commitCharacters([a, b], ([left, right]) => {
    consumeItem(left, offered.uid, offered.count);
    grantItem(right, ITEMS[offered.id], offered.count, offered);
  });
  expect(
    b.profile.inventory.find((entry) => entry.uid === offered.uid),
  ).toEqual({ ...offered, slot: 2 });
  expect(itemCount(a.profile, 2000000) + itemCount(b.profile, 2000000)).toBe(
    106,
  );
  await Promise.all([a.destroy(), b.destroy()]);
});

test("capacity failure and invalid slot identities cannot publish partial item mutations", async () => {
  const store = ProfileStore.memory(createProfile(LOCATION));
  await store.commitProfile((draft) => {
    draft.inventorySlots[1] = 1;
    grantItem(draft, ITEMS[2000000], 99);
  });
  const before = structuredClone(store.profile);
  await expect(
    store.commitProfile((draft) => {
      grantItem(draft, ITEMS[2000000], 2);
    }),
  ).rejects.toThrow();
  expect(store.profile).toEqual(before);
  await store.commitProfile((draft) => {
    consumeTemplate(draft, 2000000, 99);
    grantItem(draft, ITEMS[2000000], 1);
  });
  expect(itemCount(store.profile, 2000000)).toBe(1);
  const duplicate = structuredClone(store.profile);
  duplicate.inventory.push({ ...duplicate.inventory[0], uid: "another" });
  expect(() => validateProfile(duplicate)).toThrow();
  duplicate.inventory = [];
  duplicate.equipment[0].slot = -14;
  expect(() => validateProfile(duplicate)).toThrow();
  await store.destroy();
});

test("all32 participant roots publish together and a33rd handle cannot enter the transaction", async () => {
  const stores = Array.from({ length: 32 }, (_, index) =>
    ProfileStore.memory(createProfile(LOCATION), { id: `member-${index}` }),
  );
  stores[0].profile.meso = 320;
  stores[0].markDirty();
  const observed = [];
  const observe = () => {
    if (stores.every((store) => !store.profileTransactionPending)) {
      observed.push(stores.map((store) => store.profile.meso));
    }
  };
  for (const store of stores) store.subscribe(observe);
  await ProfileStore.commitCharacters(stores, (drafts) => {
    drafts[0].meso -= 310;
    for (let index = 1; index < drafts.length; index++) {
      drafts[index].meso += 10;
    }
  });
  expect(observed[0]).toEqual(Array(32).fill(10));
  for (const balances of observed) expect(balances).toEqual(Array(32).fill(10));
  const extra = ProfileStore.memory(createProfile(LOCATION), { id: "extra" });
  expect(() =>
    ProfileStore.commitCharacters([...stores, extra], () => {}),
  ).toThrow();
  await Promise.all([...stores, extra].map((store) => store.destroy()));
});

test("gift envelopes and gift items cannot duplicate another participant's owned UID", async () => {
  const stores = ["left", "middle", "right"].map((id) =>
    ProfileStore.memory(createProfile(LOCATION), { id }),
  );
  const before = stores.map((store) => structuredClone(store.profile));
  await expect(
    ProfileStore.commitCharacters(stores, (drafts) => {
      const item = { ...drafts[0].equipment[0], uid: "gift-item", slot: 1 };
      drafts[2].cash.gifts.push({
        uid: drafts[1].equipment[0].uid,
        senderId: stores[0].id,
        senderName: "Maple",
        message: "",
        sn: 10000001,
        items: [item],
      });
      drafts[0].meso = 90;
    }),
  ).rejects.toThrow();
  expect(stores.map((store) => store.profile)).toEqual(before);
  await expect(
    ProfileStore.commitCharacters(stores, (drafts) => {
      const item = { ...drafts[0].equipment[0], slot: 1 };
      const safeItem = { ...item, uid: "safe-package-item", slot: 2 };
      drafts[2].cash.gifts.push({
        uid: "gift-envelope",
        senderId: stores[0].id,
        senderName: "Maple",
        message: "",
        sn: 10000001,
        items: [safeItem, item],
      });
    }),
  ).rejects.toThrow();
  expect(stores.map((store) => store.revision)).toEqual([0, 0, 0]);
  await Promise.all(
    stores.map((store) =>
      expect(store.destroy()).rejects.toMatchObject({
        code: "corrupt-profile",
      }),
    ),
  );
});

test("the pending gift item budget is shared across package envelopes", async () => {
  const profile = createProfile(LOCATION);
  const items = Array.from({ length: 96 }, (_, index) => ({
    ...profile.equipment[0],
    uid: `gift-piece-${index}`,
    slot: index + 1,
  }));
  profile.cash.gifts.push({
    uid: "package-envelope",
    senderId: "sender",
    senderName: "Sender",
    message: "",
    sn: 10000001,
    items,
  });
  const store = ProfileStore.memory(profile);
  const before = structuredClone(store.profile);
  await expect(
    store.commitProfile((draft) => {
      draft.cash.gifts.push({
        uid: "extra-envelope",
        senderId: "sender",
        senderName: "Sender",
        message: "",
        sn: 10000002,
        items: [{ ...items[0], uid: "extra-piece" }],
      });
    }),
  ).rejects.toThrow();
  expect(store.profile).toEqual(before);
  expect(store.revision).toBe(0);
  await expect(store.destroy()).rejects.toMatchObject({
    code: "corrupt-profile",
  });
});

test("a mirrored social group cannot be edited through only one participant's profile", async () => {
  const stores = ["left", "right", "third"].map((id) =>
    ProfileStore.memory(createProfile(LOCATION), { id }),
  );
  await ProfileStore.commitCharacters(stores, (drafts) => {
    const party = {
      id: "party",
      leaderId: "left",
      members: stores.map((store) => store.id),
    };
    for (const draft of drafts) draft.social.party = structuredClone(party);
  });
  await expect(
    stores[0].commitProfile((draft) => {
      draft.social.party.leaderId = "right";
    }),
  ).rejects.toThrow();
  expect(stores.map((store) => store.profile.social.party.leaderId)).toEqual([
    "left",
    "left",
    "left",
  ]);
  await ProfileStore.commitCharacters(stores, (drafts) => {
    for (const draft of drafts) draft.social.party.leaderId = "right";
  });
  expect(stores.map((store) => store.profile.social.party.leaderId)).toEqual([
    "right",
    "right",
    "right",
  ]);
  await Promise.all(stores.map((store) => store.destroy()));
});

async function socialParticipants() {
  const store = ProfileStore.memory(createProfile(LOCATION));
  const social = new LocalSocial(store, {});
  await social.prepare();
  const alpha = await social.createParticipant("Alpha");
  const bravo = await social.createParticipant("Bravo");
  for (const id of [store.id, alpha.id, bravo.id]) {
    await social.getParticipant(id).commitProfile((draft) => {
      draft.level = 12;
    });
  }
  return { store, social, alpha, bravo };
}

test("local peer consent, invitation settings and party leadership cannot be impersonated", async () => {
  const { store, social, alpha, bravo } = await socialParticipants();
  await social.getParticipant(alpha.id).commitProfile((draft) => {
    draft.settings.gameOptions.allowParty = false;
  });
  expect(
    (await social.execute("party.invite", { targetId: alpha.id })).code,
  ).toBe("invitation-disabled");
  expect(store.profile.social.party).toBeNull();
  await social.getParticipant(alpha.id).commitProfile((draft) => {
    draft.settings.gameOptions.allowParty = true;
  });
  const request = await social.execute("party.invite", { targetId: alpha.id });
  expect(request.ok).toBe(true);
  expect(
    (
      await social.execute("invitation.accept", {
        actorId: bravo.id,
        invitationId: request.invitationId,
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await social.execute("invitation.accept", {
        actorId: alpha.id,
        invitationId: request.invitationId,
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await social.execute("invitation.accept", {
        actorId: alpha.id,
        invitationId: request.invitationId,
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await social.execute("party.leader", {
        actorId: alpha.id,
        targetId: alpha.id,
      })
    ).code,
  ).toBe("leader-required");
  expect(
    (await social.execute("party.leader", { targetId: alpha.id })).ok,
  ).toBe(true);
  expect(social.snapshot().party.leaderId).toBe(alpha.id);
  expect((await social.execute("party.leave", { actorId: alpha.id })).ok).toBe(
    true,
  );
  expect(store.profile.social.party).toBeNull();
  expect(social.getParticipant(alpha.id).profile.social.party).toBeNull();
  await social.destroy();
  await store.destroy();
});

test("reset detaches a family root atomically without deleting peers' earned state", async () => {
  const { store, social, alpha, bravo } = await socialParticipants();
  const a = social.getParticipant(alpha.id),
    b = social.getParticipant(bravo.id);
  const first = await social.execute("family.invite", { targetId: a.id });
  expect(
    (
      await social.execute("invitation.accept", {
        actorId: a.id,
        invitationId: first.invitationId,
      })
    ).ok,
  ).toBe(true);
  const second = await social.execute("family.invite", {
    actorId: a.id,
    targetId: b.id,
  });
  expect(
    (
      await social.execute("invitation.accept", {
        actorId: b.id,
        invitationId: second.invitationId,
      })
    ).ok,
  ).toBe(true);
  await a.commitProfile((draft) => {
    draft.meso = 800;
    grantItem(draft, ITEMS[2000000], 7);
  });
  await ProfileStore.commitCharacters([store, a, b], (drafts) => {
    for (const draft of drafts) {
      draft.social.family.members.find(
        (entry) => entry.id === a.id,
      ).reputation = 900;
    }
  });
  const inventory = structuredClone(a.profile.inventory);
  await expect(store.reset()).rejects.toMatchObject({
    code: "social-reset-required",
  });
  expect((await social.resetParticipant()).ok).toBe(true);
  expect(store.profile.social.family).toBeNull();
  expect(store.profile.level).toBe(1);
  expect(a.profile.inventory).toEqual(inventory);
  expect(a.profile.meso).toBe(800);
  expect(a.profile.social.family.leaderId).toBe(a.id);
  expect(
    a.profile.social.family.members.find((entry) => entry.id === a.id)
      .reputation,
  ).toBe(900);
  expect(
    b.profile.social.family.members.find((entry) => entry.id === b.id).parentId,
  ).toBe(a.id);
  await social.destroy();
  await store.destroy();
});

function tradeFixture() {
  const left = createProfile(LOCATION);
  const right = createProfile(LOCATION);
  left.name = "TradeLeft";
  right.name = "TradeRight";
  left.meso = 100;
  const stores = [
    ProfileStore.memory(left, { id: "trade-left" }),
    ProfileStore.memory(right, { id: "trade-right" }),
  ];
  const catalog = {
    ui: {
      items: {
        ...ITEMS,
        2000001: { id: 2000001, descriptor: {}, info: { slotMax: 100 } },
      },
    },
  };
  const hooks = { session: new LocalTradeSession(), prompt: async () => true };
  const room = new LocalTrade(stores, catalog, hooks);
  return { stores, catalog, hooks, room };
}

test("completed trade releases input admission before terminal observers open the next room", async () => {
  const { stores, catalog, hooks, room } = tradeFixture();
  const next = new LocalTrade(stores, catalog, {
    ...hooks,
    isBusy: () => Boolean(room.pending),
  });
  let invitation;
  room.subscribe(() => {
    if (room.state === "completed" && next.state === "created") {
      invitation = next.invite();
    }
  });
  expect(room.invite().ok).toBe(true);
  expect(room.accept(1).ok).toBe(true);
  expect(room.offerMesos(0, 10).ok).toBe(true);
  expect((await room.confirm(0)).ok).toBe(true);
  expect(stores.map((store) => store.profile.meso)).toEqual([100, 0]);
  expect((await room.confirm(1)).ok).toBe(true);
  expect(stores.map((store) => store.profile.meso)).toEqual([90, 10]);
  expect(invitation.ok).toBe(true);
  expect(next.accept(1).ok).toBe(true);
  expect(next.offerMesos(1, 1).ok).toBe(true);
  expect((await next.confirm(0)).ok).toBe(true);
  expect((await next.confirm(1)).ok).toBe(true);
  expect(stores.map((store) => store.profile.meso)).toEqual([91, 9]);
  await hooks.session.destroy();
  await Promise.all(stores.map((store) => store.destroy()));
});

test("capacity-rejected trade preserves both inventories and admits a subsequent meso exchange", async () => {
  const { stores, catalog, hooks, room } = tradeFixture();
  for (const store of stores) store.profile.inventorySlots[1] = 1;
  grantItem(stores[0].profile, catalog.ui.items[2000000], 1);
  grantItem(stores[1].profile, catalog.ui.items[2000001], 1);
  for (const store of stores) store.markDirty();
  const inventories = stores.map((store) =>
    structuredClone(store.profile.inventory),
  );
  expect(room.invite().ok).toBe(true);
  expect(room.accept(1).ok).toBe(true);
  expect(
    room.offerItem(0, {
      uid: firstItem(stores[0].profile, 2000000).uid,
      count: 1,
      slot: 1,
    }).ok,
  ).toBe(true);
  expect((await room.confirm(0)).ok).toBe(true);
  expect((await room.confirm(1)).ok).toBe(false);
  expect(room.snapshot().state).toBe("failed");
  expect(stores.map((store) => store.profile.inventory)).toEqual(inventories);
  expect(stores.map((store) => store.profile.meso)).toEqual([100, 0]);
  const next = new LocalTrade(stores, catalog, {
    ...hooks,
    isBusy: () => Boolean(room.pending),
  });
  expect(next.invite().ok).toBe(true);
  expect(next.accept(1).ok).toBe(true);
  expect(next.offerMesos(0, 5).ok).toBe(true);
  expect((await next.confirm(0)).ok).toBe(true);
  expect((await next.confirm(1)).ok).toBe(true);
  expect(stores.map((store) => store.profile.meso)).toEqual([95, 5]);
  expect(stores.map((store) => store.profile.inventory)).toEqual(inventories);
  await hooks.session.destroy();
  await Promise.all(stores.map((store) => store.destroy()));
});
