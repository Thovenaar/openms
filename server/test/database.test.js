import { expect, test } from "bun:test";
import { SQL } from "bun";
import { createHash, randomUUID } from "node:crypto";
import { openDatabase } from "../src/database.js";
import { loadContent } from "../src/content.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { protocolError } from "../../shared/protocol.js";
import { grantItem } from "../../client/src/items/inventory-model.js";
import { createMarketOrder } from "../src/market-orders.js";
import { marketSearch } from "../src/database-market.js";
import { mutateMarket } from "../src/interaction-market.js";

const databaseUrl = process.env.OPENMS_TEST_DATABASE_URL;

/** Separate database; never reset or mutate the supplied administrative database. */
async function withDatabase(run) {
  const name = `openms_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new SQL(databaseUrl, { max: 1 });
  let database = null;
  let created = false;
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(databaseUrl);
    url.pathname = `/${name}`;
    const content = await loadContent();
    database = await openDatabase({ url: url.href, items: content.items });
    await run(database, content);
  } finally {
    if (database) await database.close();
    if (created) await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.close();
  }
}

async function characterFixture(database, content, label = "Database1") {
  const account = await database.createAccount({
    name: `database_proof_${label}`,
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
    instanceId: "database-proof",
    fieldEpoch: "proof-field",
    mapId: Number(manifest.id),
  });
  return { actor, profile };
}

function operation(actor) {
  return {
    operationId: randomUUID(),
    digest: createHash("sha256").update("database-proof-credit").digest("hex"),
    expectedRevision: actor.inventoryRevision,
    domain: "inventory",
    kind: "proof.credit",
    fieldEpoch: "proof-field",
  };
}

async function provePersistence(database, content) {
  const { actor, profile } = await characterFixture(database, content);
  const credit = operation(actor);
  const receipt = await database.commit(actor, credit, (draft) => {
    draft.meso += 25;
  });
  expect(receipt.status).toBe("committed");
  expect(await database.receipt(actor, credit)).toEqual(receipt);
  const replay = await database.commit(actor, credit, () => {
    throw new Error("Committed mutation ran twice");
  });
  expect(replay.transactionId).toBe(receipt.transactionId);
  const conflict = await database.commit(
    actor,
    { ...credit, digest: "a".repeat(64) },
    () => {
      throw new Error("Conflicting mutation ran");
    },
  );
  expect(conflict.code).toBe("OPERATION_CONFLICT");
  const rejected = await database.commit(actor, operation(actor), (draft) => {
    draft.meso += 999;
    throw protocolError("NOT_ALLOWED");
  });
  expect(rejected.status).toBe("rejected");
  const loaded = await database.loadCharacter(actor.accountId, actor.id);
  expect(loaded.profile.meso).toBe(25);
  expect(new Set(loaded.profile.equipment)).toEqual(new Set(profile.equipment));
  const stale = { ...actor };
  await database.rotateLease(actor);
  await expect(
    database.commit(stale, operation(stale), (draft) => {
      draft.meso++;
    }),
  ).rejects.toMatchObject({ code: "STALE_CONNECTION" });
}

test.skipIf(!databaseUrl)(
  "native PostgreSQL preserves owned JSON, atomic receipts and writer fences",
  async () => {
    await withDatabase(provePersistence);
  },
  30000,
);

async function proveMarketSearch(database, content) {
  const { actor } = await characterFixture(database, content);
  actor.realm = "public";
  const request = {
    kind: "mts.list",
    quantity: 4,
    price: 100,
    hours: 24,
    mode: "sale",
    buyNow: 0,
  };
  const context = {
    actor,
    content,
    now: Date.now(),
    operationId: randomUUID(),
  };
  const receipt = await database.commit(actor, operation(actor), (draft) => {
    grantItem(draft, content.items[2000000], 10);
    request.uid = draft.inventory.find((item) => item.id === 2000000).uid;
    createMarketOrder(draft, request, context);
  });
  expect(receipt.status).toBe("committed");
  const query = {
    tab: "sale",
    query: "",
    page: 0,
    now: context.now,
    itemIds: [],
  };
  await proveMarketFilters(database, actor, query);
  const restored = await database.loadCharacter(actor.accountId, actor.id);
  expect(restored.profile.onlineState.market.escrow[0].item.count).toBe(4);
  expect(
    restored.profile.inventory.find((item) => item.id === 2000000).count,
  ).toBe(6);
}

async function proveMarketFilters(database, actor, query) {
  const rows = await marketSearch(database, actor, query);
  expect(rows).toHaveLength(1);
  expect(rows[0].item.count).toBe(4);
  expect(
    await marketSearch(database, actor, { ...query, category: 1 }),
  ).toHaveLength(0);
  expect(
    await marketSearch(database, actor, { ...query, category: 2 }),
  ).toHaveLength(1);
  expect(
    await marketSearch(database, actor, {
      ...query,
      query: "red",
      itemIds: [2000000],
    }),
  ).toHaveLength(1);
  expect(
    await marketSearch(database, actor, { ...query, query: "missing" }),
  ).toHaveLength(0);
  expect(
    await marketSearch(database, actor, { ...query, tab: "cart" }),
  ).toHaveLength(0);
  actor.profile.onlineState.market.cart = [rows[0].summary.id];
  expect(
    await marketSearch(database, actor, { ...query, tab: "cart" }),
  ).toHaveLength(1);
}

async function marketRaceFixture(database, content) {
  const actors = [];
  for (const name of ["Seller", "Buyer", "BuyerTwo"]) {
    const { actor } = await characterFixture(database, content, name);
    actor.realm = "public";
    await database.commit(actor, operation(actor), (draft) => {
      draft.cash.balances.prepaid = 10000;
      if (name === "Seller") grantItem(draft, content.items[2000000], 4);
    });
    actors.push(actor);
  }
  const seller = actors[0];
  const request = {
    kind: "mts.list",
    uid: seller.profile.inventory[0].uid,
    quantity: 4,
    price: 100,
    hours: 24,
    mode: "sale",
    buyNow: 0,
  };
  await database.commit(seller, operation(seller), (draft) =>
    createMarketOrder(draft, request, {
      actor: seller,
      content,
      now: Date.now(),
      operationId: randomUUID(),
    }),
  );
  return actors;
}

async function proveMarketRace(database, content) {
  const [seller, buyer, second] = await marketRaceFixture(database, content);
  const staleSeller = { ...seller, profile: structuredClone(seller.profile) };
  const listing = {
    ...seller.profile.onlineState.market.listings[0],
    ownerId: seller.id,
  };
  const request = { kind: "mts.buy", listingId: listing.id, price: 100 };
  const context = { content, request, now: Date.now(), ownerId: seller.id };
  const purchase = operation(buyer);
  const receipt = await database.commitMany(
    [buyer, seller],
    purchase,
    ([b, s]) =>
      mutateMarket(
        new Map([
          [buyer.id, b],
          [seller.id, s],
        ]),
        { ...context, actor: buyer },
        listing,
      ),
  );
  expect(receipt.status).toBe("committed");
  const duplicate = await database.commitMany(
    [second, staleSeller],
    operation(second),
    ([b, s]) =>
      mutateMarket(
        new Map([
          [second.id, b],
          [seller.id, s],
        ]),
        { ...context, actor: second },
        listing,
      ),
  );
  expect(duplicate).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
  const replay = await database.commitMany([buyer, seller], purchase, () => {
    throw new Error("Replayed purchase mutator executed");
  });
  expect(replay.transactionId).toBe(receipt.transactionId);
  await database.checkpoint(staleSeller);
  const loaded = await database.loadCharacter(seller.accountId, seller.id);
  expect(loaded.profile.onlineState.market.listings).toEqual([]);
  expect(loaded.profile.cash.balances.prepaid).toBe(10095);
  expect(
    (await database.loadCharacter(second.accountId, second.id)).profile.cash
      .balances.prepaid,
  ).toBe(10000);
  await database.releaseLease(buyer);
  await expect(
    database.deleteCharacter(buyer.accountId, buyer.id),
  ).rejects.toMatchObject({ code: "NOT_ALLOWED" });
}

test.skipIf(!databaseUrl)(
  "native PostgreSQL MTS stale owner snapshots and replay cannot duplicate a sold lot",
  async () => {
    await withDatabase(proveMarketRace);
  },
  30000,
);

async function proveQuestCycleIdentity(database, content) {
  const { actor } = await characterFixture(database, content);
  await database.commit(actor, operation(actor), (draft) => {
    draft.quests[3458] = { state: 1, kills: {} };
    draft.onlineState ??= { effects: [], cooldowns: {} };
    draft.onlineState.questLifecycle = {
      3458: { cycle: "first", deadline: 1, completedAt: null, repeatAt: null },
    };
  });
  const first = actor.profile.onlineState.questCycles[3458];
  await database.commit(actor, operation(actor), (draft) => {
    draft.onlineState.questLifecycle[3458] = {
      cycle: "second",
      deadline: Date.now() + 1800000,
      completedAt: null,
      repeatAt: null,
    };
  });
  expect(actor.profile.onlineState.questCycles[3458]).not.toBe(first);
  expect(actor.profile.quests[3458].kills).toEqual({});
}

test.skipIf(!databaseUrl)(
  "native PostgreSQL quest reacceptance after timeout stamps a new kill cycle before expiry publication",
  async () => {
    await withDatabase(proveQuestCycleIdentity);
  },
  30000,
);

test.skipIf(!databaseUrl)(
  "native PostgreSQL MTS indexes canonical escrow and handles empty and populated filters",
  async () => {
    await withDatabase(proveMarketSearch);
  },
  30000,
);

/** Soft deletion keeps append-only history valid, frees the name and refuses later play. */
async function proveDeletion(database, content) {
  const account = await database.createAccount({
    name: "delete_proof",
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
  profile.name = "Deleted1";
  const created = await database.createCharacter(account.id, profile);
  expect(
    (await database.listCharacters(account.id)).map((row) => row.id),
  ).toEqual([created.id]);

  // A live lease is refused rather than stolen from its owner.
  const actor = await database.acquireLease(account.id, created.id);
  await expect(
    database.deleteCharacter(account.id, created.id),
  ).rejects.toMatchObject({ code: "CHARACTER_BUSY" });
  await database.releaseLease(actor);

  await database.deleteCharacter(account.id, created.id);
  expect(await database.listCharacters(account.id)).toEqual([]);
  // The deleted character's name is free again and its lease can never be taken.
  const replacement = createProfile({
    mapId: manifest.id,
    x: arrival.x,
    y: arrival.y,
    facing: 1,
  });
  replacement.name = "Deleted1";
  const recreated = await database.createAccountCharacter(
    account.id,
    replacement,
    () => {},
  );
  expect(recreated.name).toBe("Deleted1");
  await expect(
    database.acquireLease(account.id, created.id),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await database.loadCharacter(account.id, created.id)).toBeNull();

  // Deletion is account-scoped, and append-only history survives with valid references.
  const stranger = await database.createAccount({
    name: "delete_stranger",
    passwordHash: await Bun.password.hash(randomUUID()),
    role: "player",
  });
  await expect(
    database.deleteCharacter(stranger.id, recreated.id),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const history =
    await database.sql`SELECT count(*)::int AS entries FROM character_op_log WHERE character_id=${created.id}`;
  expect(history[0].entries).toBeGreaterThan(0);
  const receipts =
    await database.sql`SELECT count(*)::int AS entries FROM operation_receipt WHERE character_id=${created.id}`;
  expect(receipts[0].entries).toBe(0);
}

test.skipIf(!databaseUrl)(
  "native PostgreSQL soft deletion frees the name and refuses deleted characters",
  async () => {
    await withDatabase(proveDeletion);
  },
  30000,
);
