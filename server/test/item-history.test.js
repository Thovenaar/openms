import { expect, test } from "bun:test";
import { SQL } from "bun";
import { createHash, randomUUID } from "node:crypto";
import { migrateDatabase } from "../../tools/migrate.js";
import { openDatabase } from "../src/database.js";
import { loadContent } from "../src/content.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { grantItem } from "../../client/src/items/inventory-model.js";
import {
  ITEM_HISTORY,
  classifyItemHistory,
  itemOwnership,
  persistItemHistory,
} from "../src/database-history.js";
import { enhancementHistory } from "../src/action-inventory.js";

const databaseUrl = process.env.OPENMS_TEST_DATABASE_URL;

/** Separate database; never reset or mutate the supplied administrative database. */
async function withDatabase(run) {
  const name = `openms_history_${randomUUID().replaceAll("-", "")}`;
  const admin = new SQL(databaseUrl, { max: 1 });
  let database = null;
  let created = false;
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(databaseUrl);
    url.pathname = `/${name}`;
    await migrateDatabase({ databaseUrl: url.href });
    const content = await loadContent();
    database = await openDatabase({ url: url.href, items: content.items });
    await run(database, content);
  } finally {
    if (database) await database.close();
    if (created) await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.close();
  }
}

async function characterFixture(database, content, label) {
  const account = await database.createAccount({
    name: `history_proof_${label}`,
    passwordHash: await Bun.password.hash(randomUUID()),
    role: "player",
  });
  const manifest = await content.map(content.catalog.defaultMap);
  const arrival = nearestSavedArrival(manifest, { x: 0, y: 0, facing: 1 });
  const profile = createProfile({
    mapId: manifest.id,
    x: arrival.x,
    y: arrival.y,
    facing: 1,
  });
  profile.name = label;
  const created = await database.createCharacter(account.id, profile);
  const actor = await database.acquireLease(account.id, created.id);
  await database.bindField(actor, {
    instanceId: "history-proof",
    fieldEpoch: "history-field",
    mapId: Number(manifest.id),
  });
  return { actor, profile };
}

function operation(actor, kind = "proof.credit") {
  return {
    operationId: randomUUID(),
    digest: createHash("sha256").update(`history-proof-${kind}`).digest("hex"),
    expectedRevision: actor.inventoryRevision,
    domain: "inventory",
    kind,
    fieldEpoch: "history-field",
  };
}

function item(uid, id, count, slot = 1) {
  return { uid, id, count, slot, owner: "", flags: 0, expiresAt: null };
}

/** Minimal validated profile shape for the pure ownership diff. */
function state(id, name, inventory) {
  return {
    id,
    accountId: `account-${id}`,
    profile: {
      name,
      inventory,
      equipment: [],
      cash: { locker: [], gifts: [] },
    },
  };
}

function classify(states, drafts, hints = new Map(), reason = "proof.credit") {
  const ownership = itemOwnership({
    states,
    drafts,
    storageBefore: null,
    storageAfter: null,
    accountId: null,
  });
  return {
    ownership,
    rows: classifyItemHistory(ownership.previous, ownership.next, hints, {
      reason,
      names: ownership.names,
    }),
  };
}

function emptyInput(result) {
  return {
    transactionId: "tx-history",
    reason: "proof.credit",
    actorId: "character-a",
    mapId: 100000000,
    states: [],
    drafts: [],
    storageBefore: null,
    storageAfter: null,
    accountId: null,
    result,
  };
}

/** Fake transaction tag so producer-hint validation is testable without a database. */
function recordingTx(inserts) {
  return (strings, ...values) => {
    inserts.push({ sql: strings.join("?"), values });
    return Promise.resolve([]);
  };
}

test("ownership diff records a labelled creation", () => {
  const owner = state("character-a", "Alpha", []);
  const { rows } = classify(
    [owner],
    [{ ...owner.profile, inventory: [item("owned-1", 2000000, 5)] }],
    new Map([
      [
        "owned-1",
        {
          event: null,
          source: "shop",
          sourceId: "1000000",
          mapId: null,
          detail: {},
        },
      ],
    ]),
    "shop.buy",
  );
  expect(rows).toEqual([
    expect.objectContaining({
      itemId: "owned-1",
      event: "created",
      source: "shop",
      quantity: 5,
      toOwnerId: "character-a",
      toOwnerName: "Alpha",
    }),
  ]);
});

test("ownership diff records a cross-character transfer", () => {
  const seller = state("character-a", "Alpha", [item("owned-1", 2000000, 5)]);
  const buyer = state("character-b", "Beta", []);
  const { rows } = classify(
    [seller, buyer],
    [
      seller.profile,
      { ...buyer.profile, inventory: [item("owned-1", 2000000, 5)] },
    ],
    new Map(),
    "trade.confirm",
  );
  expect(rows).toEqual([
    expect.objectContaining({
      event: "transferred",
      fromOwnerId: "character-a",
      fromOwnerName: "Alpha",
      toOwnerId: "character-b",
      toOwnerName: "Beta",
      source: "trade",
    }),
  ]);
});

test("ownership diff records consumption, release and expiry", () => {
  const held = state("character-a", "Alpha", [item("owned-1", 2000000, 5)]);
  const partial = { ...held.profile, inventory: [item("owned-1", 2000000, 3)] };
  const empty = { ...held.profile, inventory: [] };
  expect(classify([held], [partial], new Map(), "item.use").rows).toEqual([
    expect.objectContaining({ event: "consumed", quantity: 3 }),
  ]);
  expect(classify([held], [empty], new Map(), "item.drop").rows).toEqual([
    expect.objectContaining({ event: "released", quantity: 5 }),
  ]);
  expect(classify([held], [empty], new Map(), "mts.expire").rows).toEqual([
    expect.objectContaining({ event: "expired", source: "market" }),
  ]);
});

test("ownership diff labels enhancement and ignores slot-only movement", () => {
  const before = item("equip-1", 1302000, 1, 1);
  before.upgrade = { slots: 7, level: 0, stats: {} };
  const after = item("equip-1", 1302000, 1, 1);
  after.upgrade = { slots: 6, level: 1, stats: { pad: 3 } };
  const scroll = classify(
    [state("character-a", "Alpha", [before])],
    [{ ...state("character-a", "Alpha", []).profile, inventory: [after] }],
    new Map([
      [
        "equip-1",
        {
          event: "enhanced",
          source: "enhancement",
          sourceId: null,
          mapId: null,
          detail: { outcome: "success", scrollTemplateId: 2043000 },
        },
      ],
    ]),
    "equipment.scroll",
  );
  expect(scroll.rows).toEqual([
    expect.objectContaining({
      event: "enhanced",
      source: "enhancement",
      detail: expect.objectContaining({ outcome: "success" }),
    }),
  ]);

  const moved = item("equip-1", 1302000, 1, 1);
  moved.upgrade = { slots: 7, level: 0, stats: {} };
  const elsewhere = { ...moved, slot: 2 };
  const quiet = classify(
    [state("character-a", "Alpha", [moved])],
    [
      {
        ...state("character-a", "Alpha", []).profile,
        inventory: [elsewhere],
      },
    ],
    new Map(),
    "inventory.move",
  );
  expect(quiet.rows).toEqual([]);
});

test("producer hints are validated and births persist as created rows", async () => {
  const inserts = [];
  const tx = recordingTx(inserts);
  const births = [
    {
      itemId: "drop-1",
      templateId: 2000000,
      quantity: 3,
      source: "monster",
      sourceId: "100100",
      mapId: 100000000,
      detail: { dropId: "drop-1" },
    },
  ];
  const written = await persistItemHistory(
    tx,
    emptyInput({ itemBirths: births }),
  );
  expect(written).toBe(1);
  expect(inserts).toHaveLength(1);
  expect(inserts[0].values[0]).toBe("drop-1");
  expect(inserts[0].values[2]).toBe(3);
  expect(inserts[0].values[3]).toBe("created");
  expect(inserts[0].values[12]).toBe("monster");

  await expect(
    persistItemHistory(
      recordingTx([]),
      emptyInput({ itemSources: { "bad uid!": { source: "shop" } } }),
    ),
  ).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  await expect(
    persistItemHistory(
      recordingTx([]),
      emptyInput({ itemSources: { "uid-1": { source: "teleport" } } }),
    ),
  ).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  await expect(
    persistItemHistory(
      recordingTx([]),
      emptyInput({
        itemBirths: Array.from({ length: ITEM_HISTORY.events + 1 }, () => ({
          itemId: "drop-1",
          templateId: 2000000,
          quantity: 1,
          source: "monster",
        })),
      }),
    ),
  ).rejects.toMatchObject({ code: "SERVER_BUSY" });
});

test("enhancement labels a curse as destruction", () => {
  expect(
    enhancementHistory({
      value: { kind: "equipment.enhancement", outcome: "curse" },
      history: { equipmentId: "equip-1" },
    }),
  ).toEqual({
    "equip-1": expect.objectContaining({
      event: "destroyed",
      source: "enhancement",
    }),
  });
  expect(
    enhancementHistory({
      value: { kind: "equipment.enhancement", outcome: "failure" },
      history: { equipmentId: "equip-1" },
    }),
  ).toEqual({
    "equip-1": expect.objectContaining({ event: "enhanced" }),
  });
});

async function grantWithSource(database, actor, content, source) {
  let uid = null;
  const receipt = await database.commit(actor, operation(actor), (draft) => {
    grantItem(draft, content.items[2000000], 5);
    uid = draft.inventory.find((entry) => entry.id === 2000000).uid;
    return { itemSources: { [uid]: { source } } };
  });
  expect(receipt.status).toBe("committed");
  return uid;
}

/** Bun SQL tag results are thenables; assert rejection explicitly rather than via expect().rejects. */
async function rejected(work) {
  try {
    await work();
  } catch {
    return true;
  }
  return false;
}

async function proveLedgerPersistence(database, content) {
  const { actor } = await characterFixture(database, content, "Ledger");
  const starter = actor.profile.equipment[0].uid;
  const origin = await database.itemHistory(actor, { uid: starter });
  expect(origin.entries.at(-1)).toMatchObject({
    event: "created",
    source: "bootstrap",
    toOwnerId: actor.id,
    toOwnerName: "Ledger",
  });

  const uid = await grantWithSource(database, actor, content, "shop");
  const trail = await database.itemHistory(actor, { uid, limit: 1 });
  expect(trail.entries).toHaveLength(1);
  expect(trail.entries[0]).toMatchObject({
    event: "created",
    source: "shop",
    templateId: 2000000,
    quantity: 5,
    toOwnerId: actor.id,
    toOwnerName: "Ledger",
    actorId: actor.id,
    reason: "proof.credit",
  });
  expect(trail.more).toBe(false);

  expect(
    await rejected(
      () =>
        database.sql`UPDATE item_history SET reason='tampered' WHERE item_id=${uid}`,
    ),
  ).toBe(true);
  expect(
    await rejected(
      () => database.sql`DELETE FROM item_history WHERE item_id=${uid}`,
    ),
  ).toBe(true);

  const stored = await database.sql`
    SELECT count(*)::int AS n FROM item_history
    WHERE item_id=${uid} AND event='created' AND source='shop'`;
  expect(stored[0].n).toBe(1);

  const { actor: other } = await characterFixture(database, content, "Other");
  await expect(database.itemHistory(other, { uid })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    database.itemHistory(actor, { uid: "bad uid" }),
  ).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  await expect(
    database.itemHistory(other, { uid, limit: 1000 }),
  ).rejects.toMatchObject({ code: "NOT_ALLOWED" });
}

async function proveTransferTrail(database, content) {
  const { actor: seller } = await characterFixture(database, content, "Seller");
  const { actor: buyer } = await characterFixture(database, content, "Buyer");
  const uid = await grantWithSource(database, seller, content, "monster");
  const receipt = await database.commitMany(
    [buyer, seller],
    operation(buyer, "trade.confirm"),
    ([target, source]) => {
      const index = source.inventory.findIndex((entry) => entry.uid === uid);
      const [moved] = source.inventory.splice(index, 1);
      target.inventory.push({ ...moved, slot: 1 });
    },
  );
  expect(receipt.status).toBe("committed");

  const buyerTrail = await database.itemHistory(buyer, { uid });
  expect(buyerTrail.entries.map((row) => row.event)).toEqual([
    "transferred",
    "created",
  ]);
  expect(buyerTrail.entries[0]).toMatchObject({
    fromOwnerId: seller.id,
    fromOwnerName: "Seller",
    toOwnerId: buyer.id,
    toOwnerName: "Buyer",
    source: "trade",
  });
  expect(buyerTrail.entries[1]).toMatchObject({
    source: "monster",
    toOwnerName: "Seller",
  });

  const sellerTrail = await database.itemHistory(seller, { uid });
  expect(sellerTrail.entries).toHaveLength(2);

  const page = await database.itemHistoryTrail({ uid, limit: 1 });
  expect(page.entries).toHaveLength(1);
  expect(page.more).toBe(true);
  const next = await database.itemHistoryTrail({
    uid,
    limit: 1,
    before: page.next,
  });
  expect(next.entries[0].event).toBe("created");
  expect(next.more).toBe(false);
}

test.skipIf(!databaseUrl)(
  "item history records bootstrap, labelled grants, append-only rows and read policy",
  async () => {
    await withDatabase(proveLedgerPersistence);
  },
  30000,
);

test.skipIf(!databaseUrl)(
  "item history follows a cross-character transfer and pages newest first",
  async () => {
    await withDatabase(proveTransferTrail);
  },
  30000,
);
