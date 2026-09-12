import { expect, test } from "bun:test";
import { SQL } from "bun";
import { createHash, randomUUID } from "node:crypto";
import { openDatabase } from "../src/database.js";
import { loadContent } from "../src/content.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { protocolError } from "../../shared/protocol.js";

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

async function characterFixture(database, content) {
  const account = await database.createAccount({
    name: "database_proof",
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
