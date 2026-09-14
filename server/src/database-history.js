import { flatten, flattenStorage } from "./database-items.js";

/** Bounded per-instance provenance policy; rows are written inside the mutating transaction. */
export const ITEM_HISTORY = Object.freeze({
  page: 128,
  events: 256,
  detailBytes: 8192,
  uid: /^[A-Za-z0-9_-]{1,64}$/,
});

const SOURCES = new Set([
  "monster",
  "reactor",
  "shop",
  "cash",
  "craft",
  "quest",
  "skill",
  "development",
  "trade",
  "market",
  "storage",
  "enhancement",
  "drop",
  "bootstrap",
  "system",
]);
const EVENTS = new Set([
  "created",
  "acquired",
  "transferred",
  "released",
  "enhanced",
  "consumed",
  "destroyed",
  "expired",
]);

function historyError(code = "NOT_ALLOWED") {
  return Object.assign(new Error(code), { code });
}

function readUid(value) {
  if (typeof value !== "string" || !ITEM_HISTORY.uid.test(value)) {
    throw historyError();
  }
  return value;
}

function readText(value, max = 64) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > max) {
    throw historyError();
  }
  return value;
}

function readMapId(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 999999998) {
    throw historyError();
  }
  return value;
}

function readDetail(value) {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw historyError();
  }
  if (JSON.stringify(value).length > ITEM_HISTORY.detailBytes) {
    throw historyError();
  }
  return value;
}

function readSource(value) {
  if (typeof value !== "string" || !SOURCES.has(value)) throw historyError();
  return value;
}

function readEvent(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !EVENTS.has(value)) throw historyError();
  return value;
}

function readHint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw historyError();
  }
  return {
    event: readEvent(value.event),
    source: readSource(value.source),
    sourceId: readText(value.sourceId),
    mapId: readMapId(value.mapId),
    detail: readDetail(value.detail),
  };
}

function readBirth(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw historyError();
  }
  if (
    !Number.isInteger(value.templateId) ||
    value.templateId < 1 ||
    value.templateId > 99999999 ||
    !Number.isInteger(value.quantity) ||
    value.quantity < 0 ||
    value.quantity > 2147483647
  ) {
    throw historyError();
  }
  return {
    itemId: readUid(value.itemId),
    event: "created",
    templateId: value.templateId,
    quantity: value.quantity,
    source: readSource(value.source),
    sourceId: readText(value.sourceId),
    mapId: readMapId(value.mapId),
    detail: readDetail(value.detail),
  };
}

/** Ground drops exist as entitlements before they are owned; label their birth explicitly. */
export function dropBirths(requests, options) {
  const rows = [];
  for (const drop of requests) {
    if (!drop.item) continue;
    rows.push({
      itemId: drop.item.uid,
      templateId: drop.item.id,
      quantity: drop.item.count,
      source: options.source,
      sourceId: options.sourceId ?? null,
      mapId: options.mapId ?? null,
      detail: {
        dropId: drop.id,
        questId: drop.questId ?? 0,
        ...(options.detail ?? {}),
      },
    });
  }
  return rows;
}

function readBirthList(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > ITEM_HISTORY.events) {
    throw historyError("SERVER_BUSY");
  }
  const births = [];
  for (const entry of value) births.push(readBirth(entry));
  return births;
}

function readHistoryHints(result) {
  const sources = new Map();
  const raw = result?.itemSources;
  if (raw !== undefined) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw historyError();
    }
    const uids = Object.keys(raw);
    if (uids.length > ITEM_HISTORY.events) throw historyError("SERVER_BUSY");
    for (const uid of uids) sources.set(readUid(uid), readHint(raw[uid]));
  }
  return { sources, births: readBirthList(result?.itemBirths) };
}

function ownerKey(owner) {
  return owner.characterId
    ? `character:${owner.characterId}`
    : `account:${owner.accountId}`;
}

function collectOwners(target, items, owner) {
  for (const [uid, value] of items) {
    target.set(uid, { ...owner, location: value.location, item: value.item });
  }
}

/** One merged ownership view across every participant, account storage and market escrow. */
export function itemOwnership(input) {
  const previous = new Map();
  const next = new Map();
  const names = new Map(input.names ?? []);
  for (let index = 0; index < input.drafts.length; index += 1) {
    const state = input.states[index];
    const owner = {
      characterId: state.id ?? null,
      accountId: state.accountId ?? null,
    };
    if (owner.characterId && state.profile?.name) {
      names.set(ownerKey(owner), state.profile.name);
    }
    collectOwners(previous, flatten(state.profile), owner);
    collectOwners(next, flatten(input.drafts[index]), owner);
  }
  if (input.storageAfter) {
    const owner = { characterId: null, accountId: input.accountId };
    collectOwners(previous, flattenStorage(input.storageBefore), owner);
    collectOwners(next, flattenStorage(input.storageAfter), owner);
  }
  return { previous, next, names };
}

/** Reason-only labels for events the producers did not annotate; never authority. */
function sourceFor(reason) {
  if (reason === "equipment.scroll") return "enhancement";
  if (reason === "item.drop" || reason === "mesos.drop") return "drop";
  if (reason.startsWith("shop.")) return "shop";
  if (reason.startsWith("trade.")) return "trade";
  if (reason.startsWith("mts.")) return "market";
  if (reason.startsWith("storage.")) return "storage";
  if (reason.startsWith("cash.")) return "cash";
  if (reason.startsWith("combat.") || reason === "reactor.reward") {
    return "monster";
  }
  return "system";
}

function lossEvent(reason) {
  if (reason === "item.drop" || reason === "mesos.drop") return "released";
  if (reason === "mts.expire" || reason === "market.expire") return "expired";
  return "consumed";
}

function accountScope(fromOwner, toOwner) {
  const scoped = [fromOwner, toOwner].find(
    (owner) => owner && !owner.characterId,
  );
  return scoped?.accountId ?? null;
}

function locationDetail(event, fromOwner, toOwner) {
  if (event === "transferred") {
    return {
      fromLocation: fromOwner?.location ?? null,
      toLocation: toOwner?.location ?? null,
    };
  }
  return toOwner ? { location: toOwner.location } : {};
}

function ownerName(owner, names) {
  if (!owner) return null;
  return names.get(ownerKey(owner)) ?? null;
}

function historyRow(uid, event, change, context) {
  const { before, after, hint } = change;
  const held = after ?? before;
  return {
    itemId: uid,
    event,
    templateId: held.item.id,
    quantity: held.item.count,
    fromOwnerId: before ? before.characterId : null,
    fromOwnerName: ownerName(before, context.names),
    toOwnerId: after ? after.characterId : null,
    toOwnerName: ownerName(after, context.names),
    accountId: accountScope(before, after),
    source: hint ? hint.source : sourceFor(context.reason),
    sourceId: hint ? hint.sourceId : null,
    mapId: hint ? hint.mapId : null,
    detail: {
      ...(hint ? hint.detail : {}),
      ...locationDetail(event, before, after),
    },
  };
}

/** Same owner, same scope: only a stack delta, an explicit label, or a scroll changes the ledger. */
function heldRow(uid, change, context) {
  const { before, after, hint } = change;
  const delta = after.item.count - before.item.count;
  if (delta > 0) {
    const event = hint && hint.event ? hint.event : "acquired";
    return historyRow(uid, event, change, context);
  }
  if (delta < 0) {
    const event = hint && hint.event ? hint.event : lossEvent(context.reason);
    return historyRow(uid, event, change, context);
  }
  if (hint && hint.event) {
    return historyRow(uid, hint.event, change, context);
  }
  if (context.reason === "equipment.scroll") {
    return historyRow(uid, "enhanced", change, context);
  }
  return null;
}

function changeEvent(uid, change, context) {
  const { before, after, hint } = change;
  if (after && !before) {
    const event = hint && hint.event ? hint.event : "created";
    return historyRow(uid, event, change, context);
  }
  if (before && !after) {
    const event = hint && hint.event ? hint.event : lossEvent(context.reason);
    return historyRow(uid, event, change, context);
  }
  if (ownerKey(before) !== ownerKey(after)) {
    return historyRow(uid, "transferred", change, context);
  }
  return heldRow(uid, change, context);
}

/** Classify one transaction's owned-instance delta into append-only provenance rows. */
export function classifyItemHistory(previous, next, hints, context) {
  const events = [];
  // The inspected set is bounded by the validated profile item limits, not by the
  // emitted-row cap: an ordinary commit owns far more unchanged items than events.
  const uids = new Set([...previous.keys(), ...next.keys()]);
  for (const uid of uids) {
    const row = changeEvent(
      uid,
      {
        before: previous.get(uid) ?? null,
        after: next.get(uid) ?? null,
        hint: hints.get(uid) ?? null,
      },
      context,
    );
    if (row) events.push(row);
  }
  return events;
}

async function insertHistory(tx, row, context) {
  await tx`INSERT INTO item_history(item_id,template_id,quantity,event,from_owner_id,from_owner_name,to_owner_id,to_owner_name,account_id,actor_id,transaction_id,reason,source,source_id,map_id,detail) VALUES(${row.itemId},${row.templateId},${row.quantity},${row.event},${row.fromOwnerId ?? null},${row.fromOwnerName ?? null},${row.toOwnerId ?? null},${row.toOwnerName ?? null},${row.accountId ?? null},${context.actorId ?? null},${context.transactionId},${context.reason},${row.source},${row.sourceId ?? null},${row.mapId ?? context.mapId ?? null},${row.detail ?? {}})`;
}

/** Write the provenance rows for one committed transaction; the caller owns the tx. */
export async function persistItemHistory(tx, input) {
  const hints = readHistoryHints(input.result);
  const { previous, next, names } = itemOwnership(input);
  const rows = classifyItemHistory(previous, next, hints.sources, {
    reason: input.reason,
    names,
  });
  if (rows.length + hints.births.length > ITEM_HISTORY.events) {
    throw historyError("SERVER_BUSY");
  }
  for (const row of rows) await insertHistory(tx, row, input);
  for (const birth of hints.births) await insertHistory(tx, birth, input);
  return rows.length + hints.births.length;
}

export function readHistoryQuery(value) {
  const request = value ?? {};
  const uid = readUid(request.uid);
  const limit = request.limit ?? 32;
  if (!Number.isInteger(limit) || limit < 1 || limit > ITEM_HISTORY.page) {
    throw historyError();
  }
  const before = request.before ?? null;
  if (before !== null && (!Number.isSafeInteger(before) || before < 1)) {
    throw historyError();
  }
  return { uid, limit, before };
}

function mapHistoryRow(row) {
  return {
    seq: Number(row.seq),
    itemId: row.item_id,
    templateId: Number(row.template_id),
    quantity: Number(row.quantity),
    event: row.event,
    fromOwnerId: row.from_owner_id,
    fromOwnerName: row.from_owner_name,
    toOwnerId: row.to_owner_id,
    toOwnerName: row.to_owner_name,
    accountId: row.account_id,
    actorId: row.actor_id,
    reason: row.reason,
    source: row.source,
    sourceId: row.source_id,
    mapId: row.map_id === null ? null : Number(row.map_id),
    detail: row.detail,
    createdAt: row.created_at,
  };
}

/** Newest-first page for one instance; no authorization policy lives here. */
export async function readItemHistory(sql, request) {
  const { uid, limit, before } = readHistoryQuery(request);
  const rows =
    await sql`SELECT seq,item_id,template_id,quantity,event,from_owner_id,from_owner_name,to_owner_id,to_owner_name,account_id,actor_id,reason,source,source_id,map_id,detail,created_at FROM item_history WHERE item_id=${uid} AND (${before}::bigint IS NULL OR seq<${before}::bigint) ORDER BY seq DESC LIMIT ${limit + 1}`;
  const page = rows.slice(0, limit).map(mapHistoryRow);
  return {
    itemId: uid,
    entries: page,
    more: rows.length > limit,
    next: page.length ? page[page.length - 1].seq : null,
  };
}
