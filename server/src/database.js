import { SQL } from "bun";
import {
  PROFILE_LIMITS,
  validateProfile,
} from "../../client/src/profile/profile-validation.js";
import { isRechargeable } from "../../client/src/items/inventory-model.js";

const MAX_ATTEMPTS = 3;
const MAX_EVENTS = 256;
const MAX_ITEMS = 4224;
const LEASE_SECONDS = 45;

function failure(code) {
  return Object.assign(new Error(code), { code });
}
function id() {
  return crypto.randomUUID();
}
function numeric(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw failure("SERVER_BUSY");
  return result;
}
function cacheProfile(profile) {
  const cache = structuredClone(profile);
  delete cache.inventory;
  delete cache.equipment;
  delete cache.meso;
  return cache;
}
function revision(actor, domain, hint = 0) {
  if (domain === "inventory") return actor.inventoryRevision;
  if (domain === "social") return actor.socialRevision;
  if (domain === "character") return actor.revision;
  if (!Number.isSafeInteger(hint) || hint < 0) throw failure("NOT_ALLOWED");
  return hint;
}
function rejected(code, domainRevision = 0) {
  return { status: "rejected", code, domainRevision, transactionId: null };
}
function actorFromRow(row, profile) {
  return {
    id: row.id,
    accountId: row.account_id,
    profile,
    fence: numeric(row.fencing_generation),
    revision: numeric(row.revision),
    inventoryRevision: numeric(row.inventory_revision),
    socialRevision: numeric(row.social_revision),
  };
}
function flatten(profile) {
  const result = new Map();
  for (const location of ["inventory", "equipment"]) {
    for (const item of profile[location]) {
      if (
        !/^[A-Za-z0-9_-]{1,64}$/.test(item.uid) ||
        item.count < 0 ||
        (item.count === 0 && !isRechargeable(item.id)) ||
        result.has(item.uid)
      ) {
        throw failure("NOT_ALLOWED");
      }
      result.set(item.uid, {
        item,
        location: location === "equipment" ? "equipped" : "inventory",
        tab: Math.floor(item.id / 1000000),
      });
    }
  }
  if (result.size > MAX_ITEMS) throw failure("INVENTORY_FULL");
  return result;
}

/** Kill counters belong only to a matching active quest lifecycle. */
function matchingQuestCycle(target, source, questId) {
  return (
    target.quests[questId]?.state === 1 &&
    source.quests[questId].state === 1 &&
    target.onlineState?.questCycles?.[questId] ===
      source.onlineState?.questCycles?.[questId]
  );
}

function mergeKillCounts(durable, kills) {
  for (const [mobId, count] of kills) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 4294967295) {
      throw failure("NOT_ALLOWED");
    }
    durable.kills[mobId] = Math.max(durable.kills[mobId] ?? 0, count);
  }
}

/** Merge server-observed kill counters, never quest lifecycle or reward authority. */
function mergeQuestKills(target, source) {
  const records = Object.entries(source.quests);
  if (records.length > PROFILE_LIMITS.quests) throw failure("NOT_ALLOWED");
  let total = 0;
  for (const [questId, progress] of records) {
    if (!matchingQuestCycle(target, source, questId)) continue;
    const kills = Object.entries(progress.kills);
    total += kills.length;
    if (
      kills.length > PROFILE_LIMITS.kills ||
      total > PROFILE_LIMITS.totalKills
    ) {
      throw failure("NOT_ALLOWED");
    }
    mergeKillCounts(target.quests[questId], kills);
  }
}

/** A new active lifecycle gets a transaction-stable identity, preventing stale kill carryover. */
function stampQuestCycles(before, after, transactionId) {
  const entries = Object.entries(after.quests);
  if (entries.length > PROFILE_LIMITS.quests) throw failure("NOT_ALLOWED");
  const cycles = {};
  for (const [questId, quest] of entries) {
    if (quest.state !== 1) continue;
    const prior = before.onlineState?.questCycles?.[questId];
    if (before.quests[questId]?.state === 1) {
      if (prior !== undefined) cycles[questId] = prior;
    } else cycles[questId] = transactionId;
  }
  after.onlineState ??= { effects: [], cooldowns: {} };
  after.onlineState.questCycles = cycles;
}

function mutationDraft(durable, live) {
  const draft = {
    ...structuredClone(live),
    inventory: structuredClone(durable.inventory),
    equipment: structuredClone(durable.equipment),
    meso: durable.meso,
    quests: structuredClone(durable.quests),
  };
  draft.onlineState ??= { effects: [], cooldowns: {} };
  draft.onlineState.questCycles = structuredClone(
    durable.onlineState?.questCycles ?? {},
  );
  mergeQuestKills(draft, live);
  return draft;
}

function assertSessions(owners) {
  for (const owner of owners) {
    if (
      owner.session &&
      (owner.session.revoked || owner.session.expiresAt <= Date.now())
    ) {
      throw failure("SESSION_EXPIRED");
    }
  }
}

/** Memoize the mutation and its RNG outcomes across SERIALIZABLE retries. */
async function planMutation(request, states) {
  const { owners, mutator, memo } = request;
  const baseline = JSON.stringify(states);
  if (memo.plan && memo.plan.baseline !== baseline) {
    throw failure("SERVER_BUSY");
  }
  if (memo.plan) return;
  const drafts = states.map((state, index) =>
    mutationDraft(state.profile, owners[index].profile),
  );
  let result;
  try {
    result = (await mutator(drafts)) ?? {};
  } catch (error) {
    if (!/^[A-Z_]+$/.test(error.code ?? "") || error.code === "SERVER_BUSY") {
      throw error;
    }
    result = { code: error.code };
  }
  memo.plan = { baseline, drafts, result, transactionId: id() };
}

/** PostgreSQL is the only storage authority; profile JSON excludes all owned items and money. */
export async function openDatabase({ url, items }) {
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error("PostgreSQL DATABASE_URL required");
  }
  const database = new Database(
    new SQL(url, { max: 8, connectionTimeout: 10, idleTimeout: 30 }),
    items,
  );
  await database.migrate();
  return database;
}

export class Database {
  constructor(sql, items) {
    this.sql = sql;
    this.items = items;
    this.owner = id();
  }
  async close() {
    await this.sql.close();
  }
  async readOutbox({ consumer, limit = 128 }) {
    if (
      !/^[A-Za-z0-9_-]{1,64}$/.test(consumer) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_EVENTS
    ) {
      throw failure("NOT_ALLOWED");
    }
    return this
      .sql`SELECT * FROM outbox WHERE seq>COALESCE((SELECT seq FROM outbox_delivery WHERE consumer=${consumer}),0) ORDER BY seq LIMIT ${limit}`;
  }
  async acknowledgeOutbox({ consumer, sequence }) {
    if (
      !/^[A-Za-z0-9_-]{1,64}$/.test(consumer) ||
      !Number.isSafeInteger(sequence) ||
      sequence < 0
    ) {
      throw failure("NOT_ALLOWED");
    }
    await this
      .sql`INSERT INTO outbox_delivery(consumer,seq) VALUES(${consumer},${sequence}) ON CONFLICT(consumer) DO UPDATE SET seq=GREATEST(outbox_delivery.seq,EXCLUDED.seq)`;
  }
  async receipt(actor, operation) {
    const rows = await this
      .sql`SELECT r.digest,r.receipt FROM operation_receipt r JOIN character c ON c.id=r.character_id WHERE r.character_id=${actor.id} AND r.operation_id=${operation.operationId} AND c.account_id=${actor.accountId} AND c.fencing_generation=${actor.fence} AND c.lease_owner=${this.owner} AND c.lease_until>clock_timestamp()`;
    if (!rows[0]) return null;
    return rows[0].digest === operation.digest
      ? rows[0].receipt
      : rejected(
          "OPERATION_CONFLICT",
          revision(actor, operation.domain, operation.domainRevision),
        );
  }
  async auditDevelopment(entry) {
    if (
      JSON.stringify(entry.action).length > 16384 ||
      !["requested", "committed", "rejected"].includes(entry.status)
    ) {
      throw failure("NOT_ALLOWED");
    }
    await this
      .sql`INSERT INTO development_audit(account_id,character_id,operation_id,action,status,code) VALUES(${entry.accountId},${entry.characterId},${entry.operationId},${entry.action},${entry.status},${entry.code})`;
  }
  async bindField(actor, membership) {
    const rows = await this
      .sql`UPDATE character SET field_instance=${membership.instanceId},field_epoch=${membership.fieldEpoch},map_id=${membership.mapId} WHERE id=${actor.id} AND fencing_generation=${actor.fence} AND lease_owner=${this.owner} AND lease_until>clock_timestamp() RETURNING id`;
    if (!rows.length) throw failure("STALE_CONNECTION");
  }
  async migrate() {
    const migration = await Bun.file(
      new URL("../sql/001-authority.sql", import.meta.url),
    ).text();
    await this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(742031091)`;
      await tx.unsafe(migration).simple();
    });
  }
  validate(profile) {
    const copy = structuredClone(profile);
    delete copy.onlineState;
    validateProfile(copy, this.items);
    if (
      profile.onlineState &&
      JSON.stringify(profile.onlineState).length > 65536
    ) {
      throw failure("NOT_ALLOWED");
    }
    flatten(profile);
  }
  async createAccount({ name, passwordHash, role }) {
    if (
      !/^[A-Za-z0-9_-]{1,32}$/.test(name) ||
      !["player", "developer"].includes(role) ||
      typeof passwordHash !== "string" ||
      passwordHash.length > 1024
    ) {
      throw failure("NOT_ALLOWED");
    }
    const rows = await this
      .sql`INSERT INTO account(id,name,password_hash,role) VALUES(${id()},${name},${passwordHash},${role}) RETURNING id,name,password_hash,role`;
    return { id: rows[0].id, name, passwordHash, role };
  }
  async accountByName(name) {
    const rows = await this
      .sql`SELECT id,name,password_hash,role FROM account WHERE name=${name}`;
    const row = rows[0];
    return row
      ? {
          id: row.id,
          name: row.name,
          passwordHash: row.password_hash,
          role: row.role,
        }
      : null;
  }
  async listCharacters(accountId) {
    const rows = await this
      .sql`SELECT id,profile FROM character WHERE account_id=${accountId} ORDER BY id LIMIT 65`;
    if (rows.length > 64) throw failure("SERVER_BUSY");
    return rows.map((row) => ({
      id: row.id,
      name: row.profile.name,
      level: row.profile.level,
      job: row.profile.job,
    }));
  }
  async createCharacter(accountId, profile) {
    this.validate(profile);
    const characterId = id();
    await this.transaction(async (tx) => {
      await tx`INSERT INTO character(id,account_id,profile,meso,map_id) VALUES(${characterId},${accountId},${cacheProfile(profile)},${profile.meso},${Number(profile.location.mapId)})`;
      const empty = { inventory: [], equipment: [], meso: 0 };
      const entry = {
        characterId,
        transactionId: characterId,
        reason: "bootstrap",
      };
      await this.materializeItems(tx, entry, empty, profile);
      await this.currencyLedger(tx, { ...entry, delta: profile.meso });
      await tx`INSERT INTO character_op_log(character_id,operation_id,transaction_id,kind,effect) VALUES(${characterId},${characterId},${characterId},'bootstrap',${{ kind: "bootstrap", profile: cacheProfile(profile) }})`;
    });
    return this.loadCharacter(accountId, characterId);
  }
  async hydrate(tx, row) {
    const rows =
      await tx`SELECT data,location FROM item_instance WHERE owner_id=${row.id} ORDER BY id LIMIT ${MAX_ITEMS + 1}`;
    if (rows.length > MAX_ITEMS) throw failure("SERVER_BUSY");
    const profile = {
      ...row.profile,
      meso: numeric(row.meso),
      inventory: [],
      equipment: [],
    };
    for (const item of rows) {
      profile[item.location === "equipped" ? "equipment" : "inventory"].push(
        item.data,
      );
    }
    this.validate(profile);
    return actorFromRow(row, profile);
  }
  async loadCharacter(accountId, characterId) {
    return this.transaction(async (tx) => {
      const rows =
        await tx`SELECT * FROM character WHERE id=${characterId} AND account_id=${accountId} FOR SHARE`;
      return rows[0] ? this.hydrate(tx, rows[0]) : null;
    });
  }
  async acquireLease(accountId, characterId) {
    return this.transaction(async (tx) => {
      const rows =
        await tx`UPDATE character SET fencing_generation=fencing_generation+1,lease_owner=${this.owner},lease_until=clock_timestamp()+${LEASE_SECONDS}*interval '1 second' WHERE id=${characterId} AND account_id=${accountId} AND (lease_until IS NULL OR lease_until<=clock_timestamp()) RETURNING *`;
      if (!rows[0]) throw failure("CHARACTER_BUSY");
      return this.hydrate(tx, rows[0]);
    });
  }
  async renewLease(actor) {
    const rows = await this
      .sql`UPDATE character SET lease_until=clock_timestamp()+${LEASE_SECONDS}*interval '1 second' WHERE id=${actor.id} AND fencing_generation=${actor.fence} AND lease_owner=${this.owner} AND lease_until>clock_timestamp() RETURNING id`;
    if (!rows.length) throw failure("STALE_CONNECTION");
  }
  async rotateLease(actor) {
    const rows = await this
      .sql`UPDATE character SET fencing_generation=fencing_generation+1,lease_until=clock_timestamp()+${LEASE_SECONDS}*interval '1 second' WHERE id=${actor.id} AND fencing_generation=${actor.fence} AND lease_owner=${this.owner} AND lease_until>clock_timestamp() RETURNING fencing_generation`;
    if (!rows.length) throw failure("STALE_CONNECTION");
    actor.fence = numeric(rows[0].fencing_generation);
  }
  async releaseLease(actor) {
    await this
      .sql`UPDATE character SET lease_owner=NULL,lease_until=NULL WHERE id=${actor.id} AND fencing_generation=${actor.fence} AND lease_owner=${this.owner}`;
  }
  async transaction(work) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.sql.begin(async (tx) => {
          await tx`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
          await tx`SET LOCAL lock_timeout='2s'`;
          await tx`SET LOCAL statement_timeout='5s'`;
          await tx`SET LOCAL idle_in_transaction_session_timeout='5s'`;
          return work(tx);
        });
      } catch (error) {
        const code = error.code ?? error.errno;
        if (!["40001", "40P01"].includes(code)) throw error;
        if (attempt === MAX_ATTEMPTS - 1) throw failure("SERVER_BUSY");
        await Bun.sleep(10 * (attempt + 1));
      }
    }
    throw failure("SERVER_BUSY");
  }
  async lockActors(tx, actors) {
    const ordered = actors.toSorted((a, b) => a.id.localeCompare(b.id));
    const locked = new Map();
    for (const actor of ordered) {
      const rows =
        await tx`SELECT *,lease_until>clock_timestamp() AS lease_valid FROM character WHERE id=${actor.id} FOR UPDATE`;
      const row = rows[0];
      if (
        !row ||
        row.account_id !== actor.accountId ||
        row.lease_owner !== this.owner ||
        !row.lease_valid ||
        numeric(row.fencing_generation) !== actor.fence
      ) {
        throw failure("STALE_CONNECTION");
      }
      locked.set(actor.id, await this.hydrate(tx, row));
    }
    return actors.map((actor) => locked.get(actor.id));
  }
  async checkpoint(actor) {
    const fence = actor.fence;
    const profile = structuredClone(actor.profile);
    this.validate(profile);
    await this.transaction(async (tx) => {
      const [durable] = await this.lockActors(tx, [{ ...actor, fence }]);
      const cache = cacheProfile(profile);
      // Only monotonic kills cross the class-2 boundary; lifecycle stays transactional.
      cache.quests = structuredClone(durable.profile.quests);
      cache.onlineState ??= { effects: [], cooldowns: {} };
      cache.onlineState.questCycles = structuredClone(
        durable.profile.onlineState?.questCycles ?? {},
      );
      mergeQuestKills(cache, profile);
      this.validate({
        ...cache,
        inventory: durable.profile.inventory,
        equipment: durable.profile.equipment,
        meso: durable.profile.meso,
      });
      await tx`UPDATE character SET profile=${cache},map_id=${Number(profile.location.mapId)},updated_at=clock_timestamp() WHERE id=${actor.id} AND fencing_generation=${fence}`;
      await tx`INSERT INTO character_snapshot(character_id,fencing_generation,profile) VALUES(${actor.id},${fence},${cache})`;
    });
  }
  async commit(actor, operation, mutator) {
    return this.commitMany([actor], operation, (profiles) =>
      mutator(profiles[0]),
    );
  }
  async commitMany(actors, operation, mutator) {
    if (
      !Array.isArray(actors) ||
      actors.length < 1 ||
      actors.length > 2 ||
      new Set(actors.map((actor) => actor.id)).size !== actors.length
    ) {
      throw failure("NOT_ALLOWED");
    }
    const owners = actors.map((actor) => ({
      ...actor,
      profile: structuredClone(actor.profile),
    }));
    const memo = { plan: null };
    const outcome = await this.transaction((tx) =>
      this.commitAttempt(tx, { owners, operation, mutator, memo }),
    );
    if (outcome.states) {
      for (let index = 0; index < actors.length; index += 1) {
        const state = outcome.states[index];
        mergeQuestKills(state.profile, actors[index].profile);
        actors[index].profile = state.profile;
        actors[index].revision = state.revision;
        actors[index].inventoryRevision = state.inventoryRevision;
        actors[index].socialRevision = state.socialRevision;
      }
    }
    return outcome.receipt;
  }
  async cohortReceipt(tx, owners, operation) {
    const found = [];
    for (const owner of owners) {
      const rows =
        await tx`SELECT digest,receipt FROM operation_receipt WHERE character_id=${owner.id} AND operation_id=${operation.operationId}`;
      if (rows[0]) found.push(rows[0]);
    }
    if (!found.length) return null;
    const first = found[0];
    if (
      found.length !== owners.length ||
      found.some(
        (row) =>
          row.digest !== operation.digest ||
          JSON.stringify(row.receipt) !== JSON.stringify(first.receipt),
      )
    ) {
      return rejected(
        "OPERATION_CONFLICT",
        revision(owners[0], operation.domain, operation.domainRevision),
      );
    }
    return first.receipt;
  }
  async commitAttempt(tx, request) {
    const { owners } = request;
    assertSessions(owners);
    const states = await this.lockActors(tx, owners);
    const receipt = await this.admitCommit(tx, request, states);
    if (receipt) return { receipt };
    await planMutation(request, states);
    const outcome = await this.persistPlan(tx, request, states);
    assertSessions(owners);
    return outcome;
  }
  async admitCommit(tx, request, states) {
    const { owners, operation } = request;
    const prior = await this.cohortReceipt(tx, owners, operation);
    if (prior) return prior;
    if (operation.fieldEpoch) {
      const membership =
        await tx`SELECT field_epoch FROM character WHERE id=${owners[0].id}`;
      if (
        membership[0].field_epoch &&
        membership[0].field_epoch !== operation.fieldEpoch
      ) {
        throw failure("STALE_FIELD");
      }
    }
    const current = revision(
      states[0],
      operation.domain,
      operation.domainRevision,
    );
    if (
      ["character", "inventory", "social"].includes(operation.domain) &&
      current !== operation.expectedRevision
    ) {
      const receipt = rejected("STALE_REVISION", current);
      await this.storeCohortReceipt(tx, owners, operation, receipt);
      return receipt;
    }
    return null;
  }
  async persistPlan(tx, request, states) {
    const { owners, operation, memo } = request;
    const { drafts, result, transactionId } = memo.plan;
    if (result.code && result.code !== "OK") {
      const receipt = rejected(
        result.code,
        revision(states[0], operation.domain, operation.domainRevision),
      );
      await this.storeCohortReceipt(tx, owners, operation, receipt);
      return { receipt };
    }
    if ((result.events?.length ?? 0) > MAX_EVENTS) throw failure("SERVER_BUSY");
    for (let index = 0; index < drafts.length; index += 1) {
      stampQuestCycles(states[index].profile, drafts[index], transactionId);
      this.validate(drafts[index]);
    }
    await this.entitlements(tx, transactionId, result);
    // Remove changed rows for both owners first: transfers/swaps retain unique identity atomically.
    for (let index = 0; index < states.length; index += 1) {
      await this.removeChangedItems(
        tx,
        states[index].id,
        states[index].profile,
        drafts[index],
      );
    }
    for (let index = 0; index < states.length; index += 1) {
      await this.persistMutation(tx, request, states[index], index);
    }
    return this.publishPlan(tx, request, states);
  }
  async persistMutation(tx, request, state, index) {
    const { owners, operation, memo } = request;
    const { drafts, result, transactionId } = memo.plan;
    const draft = drafts[index];
    const entry = {
      transactionId,
      characterId: state.id,
      reason: operation.kind,
    };
    await this.materializeItems(tx, entry, state.profile, draft);
    await this.currencyLedger(tx, {
      ...entry,
      delta: draft.meso - state.profile.meso,
    });
    state.profile = structuredClone(draft);
    state.revision += 1;
    state.inventoryRevision += 1;
    if (operation.domain === "social") state.socialRevision += 1;
    await this.persistCharacter(tx, state, owners[index], operation);
    await tx`INSERT INTO character_op_log(character_id,operation_id,transaction_id,kind,effect) VALUES(${state.id},${operation.operationId},${transactionId},${operation.kind},${{ kind: operation.kind, profile: cacheProfile(state.profile), inventory: state.profile.inventory, equipment: state.profile.equipment, meso: state.profile.meso, value: result.value ?? null }})`;
  }
  async publishPlan(tx, request, states) {
    const { owners, operation, memo } = request;
    const { result, transactionId } = memo.plan;
    const receipt = {
      status: "committed",
      code: "OK",
      domainRevision:
        result.domainRevision ??
        revision(states[0], operation.domain, operation.domainRevision),
      transactionId,
      events: result.events ?? [],
    };
    if (result.value !== undefined) receipt.value = result.value;
    await this.storeCohortReceipt(tx, states, operation, receipt);
    for (const event of result.events ?? []) {
      await tx`INSERT INTO outbox(id,transaction_id,character_id,event) VALUES(${id()},${transactionId},${owners[0].id},${event})`;
    }
    return { receipt, states };
  }
  async persistCharacter(tx, state, owner, operation) {
    const field = operation.membership ?? null;
    const rows =
      await tx`UPDATE character SET profile=${cacheProfile(state.profile)},meso=${state.profile.meso},revision=${state.revision},inventory_revision=${state.inventoryRevision},social_revision=${state.socialRevision},map_id=${Number(state.profile.location.mapId)},field_instance=COALESCE(${field?.instanceId ?? null},field_instance),field_epoch=COALESCE(${field?.fieldEpoch ?? null},field_epoch),updated_at=clock_timestamp() WHERE id=${state.id} AND fencing_generation=${owner.fence} AND lease_owner=${this.owner} AND lease_until>clock_timestamp() RETURNING id`;
    if (!rows.length) throw failure("STALE_CONNECTION");
  }
  async storeCohortReceipt(tx, owners, operation, receipt) {
    for (const owner of owners) {
      await this.storeReceipt(tx, owner.id, operation, receipt);
    }
  }
  async storeReceipt(tx, characterId, operation, receipt) {
    await tx`INSERT INTO operation_receipt(character_id,operation_id,digest,receipt) VALUES(${characterId},${operation.operationId},${operation.digest},${receipt})`;
  }
  async removeChangedItems(tx, characterId, before, after) {
    const next = flatten(after);
    for (const [uid, previous] of flatten(before)) {
      if (JSON.stringify(previous) !== JSON.stringify(next.get(uid))) {
        await tx`DELETE FROM item_instance WHERE id=${uid} AND owner_id=${characterId}`;
      }
    }
  }
  async materializeItems(tx, entry, before, after) {
    const { characterId, transactionId, reason } = entry;
    const previous = flatten(before);
    const next = flatten(after);
    for (const [uid, value] of next) {
      if (JSON.stringify(previous.get(uid)) === JSON.stringify(value)) continue;
      await tx`INSERT INTO item_instance(id,owner_id,template_id,quantity,location,tab,slot,revision,data) VALUES(${uid},${characterId},${value.item.id},${value.item.count},${value.location},${value.tab},${value.item.slot},(SELECT inventory_revision+1 FROM character WHERE id=${characterId}),${value.item})`;
    }
    const assets = new Map();
    for (const value of previous.values()) {
      assets.set(
        value.item.id,
        (assets.get(value.item.id) ?? 0) - value.item.count,
      );
    }
    for (const value of next.values()) {
      assets.set(
        value.item.id,
        (assets.get(value.item.id) ?? 0) + value.item.count,
      );
    }
    for (const [template, delta] of assets) {
      if (delta) {
        await this.ledgerPair(tx, {
          transactionId,
          characterId,
          asset: `item:${template}`,
          delta,
          reason,
        });
      }
    }
  }
  async currencyLedger(tx, entry) {
    const { transactionId, characterId, delta, reason } = entry;
    if (delta) {
      await this.ledgerPair(tx, {
        transactionId,
        characterId,
        asset: "meso",
        delta,
        reason,
      });
    }
  }
  async ledgerPair(tx, entry) {
    const { transactionId, characterId, asset, delta, reason } = entry;
    await tx`INSERT INTO ledger(transaction_id,account_key,asset,delta,reason) VALUES(${transactionId},${characterId},${asset},${delta},${reason}),(${transactionId},'system',${asset},${-delta},${reason})`;
  }
  async entitlements(tx, transactionId, result) {
    const grants = result.grantEntitlements ?? [];
    const consumes = result.consumeEntitlements ?? [];
    if (grants.length + consumes.length > MAX_EVENTS) {
      throw failure("SERVER_BUSY");
    }
    for (const entry of grants) {
      await tx`INSERT INTO entitlement(id,kind,granted_transaction) VALUES(${entry.id},${entry.kind},${transactionId})`;
    }
    for (const entry of consumes) {
      const rows =
        await tx`UPDATE entitlement SET consumed_transaction=${transactionId} WHERE id=${entry.id} AND kind=${entry.kind} AND consumed_transaction IS NULL RETURNING id`;
      if (!rows.length) throw failure("NOT_FOUND");
    }
  }
}
