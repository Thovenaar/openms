import { domainEventSchema, protocolError } from "../../shared/protocol.js";
import {
  decodeNativePresentation,
  NATIVE_CHUNK_SIZE,
  NATIVE_MAX_BYTES,
} from "../../shared/native-presentation.js";
import {
  stateOf,
  checkConditions,
} from "../../client/src/quests/quest-rules.js";
import { progressQuestViews } from "./interaction-quest.js";

const CAPABILITIES = Object.freeze({
  settings: true,
  keyBindings: true,
  skillMacros: true,
  questTracker: true,
  questNotice: true,
  inventory: true,
  quests: true,
  shop: true,
  trade: true,
  tradeChat: false,
  storage: false,
  cashShop: false,
  pets: false,
  socialManagement: false,
  medals: false,
  guild: false,
  spouseChat: false,
});

/** Unavailable records are unreachable in the native Quest window; their text stays server-side. */
function nativeQuestView(actor, record, progress) {
  const view = nativeQuest(actor, record, progress);
  return view.state === 0 && !view.available && !view.ready ? null : view;
}

export function nativeQuestViews(actor, world) {
  const records = Object.values(world.content.catalog.quests.records);
  if (records.length > 4096) throw protocolError("CONTENT_MISMATCH");
  const progress = new Map(
    progressQuestViews(actor, world).map((entry) => [entry.id, entry]),
  );
  const views = [];
  for (const record of records) {
    const view = nativeQuestView(actor, record, progress.get(record.id));
    if (view) views.push(view);
  }
  return views;
}

function nativeQuest(actor, record, progress) {
  const profile = actor.profile;
  const state = stateOf(profile, record.id);
  const admission = questAdmission(profile, record, state);
  const objectives = progress?.objectives ?? [];
  return {
    id: record.id,
    state,
    partition: state,
    available: state === 0 && admission.ok,
    ready: progress?.ready ?? false,
    supported: Boolean(record.supported),
    reason: admission.reason ?? "",
    tracker: trackerEligible(record, state, objectives),
    giveUp: giveUpEligible(record, state),
    noticeAcknowledged: noticeAcknowledged(profile, record.id),
    objectives,
  };
}

function questAdmission(profile, record, state) {
  if (state === 2) return { ok: false, reason: "Already completed" };
  if (!record.supported) {
    return {
      ok: false,
      reason: record.blockers?.[0]?.reason ?? "Unsupported quest",
    };
  }
  const stage = record.stages[Math.min(state, 1)];
  const context = {
    questId: record.id,
    npcId: stage.check.npc || stage.actionCheck.npc,
  };
  const admission = checkConditions(stage.check, profile, context);
  return admission.ok
    ? checkConditions(stage.actionCheck, profile, context)
    : admission;
}

function trackerEligible(record, state, objectives) {
  return (
    state === 1 &&
    !(record.id >= 1200 && record.id <= 1399) &&
    Number(record.info?.type) !== 51 &&
    objectives.length > 0
  );
}

function giveUpEligible(record, state) {
  return (
    state === 1 && record.supported && !(record.id >= 1200 && record.id <= 1399)
  );
}

function noticeAcknowledged(profile, id) {
  const notice = profile.onlineState?.questNotices?.[id];
  const cycle = profile.onlineState?.questCycles?.[id];
  return notice === cycle && Boolean(notice);
}

function interactionLease(actor, world, kind) {
  if (kind === "trade") return world.interactions?.trades.get(actor.tradeId);
  return kind === "shop" ? actor.shop : actor.conversation;
}

function matchesLease(event, lease) {
  const id = event.conversationId ?? event.shopSession ?? event.tradeId;
  const revision = event.step ?? event.revision;
  return id === lease.id && revision === (lease.step ?? lease.revision);
}

function interactionViews(actor, world) {
  const events = [];
  const now = Date.now();
  for (const [kind, pages] of actor.nativeInteractions ?? []) {
    const lease = interactionLease(actor, world, kind);
    if (
      !lease ||
      lease.expiresAt <= now ||
      lease.fieldEpoch !== actor.field.epoch
    ) {
      continue;
    }
    for (const event of pages) {
      if (matchesLease(event, lease)) events.push(event);
    }
  }
  return events;
}

function nativeProfile(actor) {
  const profile = structuredClone(actor.profile);
  delete profile.onlineState;
  profile.hp = Math.max(0, profile.hp - actor.pendingDamage);
  profile.mp = Math.max(0, profile.mp - (actor.pendingMpDamage ?? 0));
  profile.location = {
    mapId: String(actor.field.mapId).padStart(9, "0"),
    x: actor.simulation.x,
    y: actor.simulation.y,
    facing: actor.simulation.facing,
  };
  return profile;
}

function interactionRevisions(interactions) {
  const trade = interactions.find((event) => event.kind === "trade");
  const dialogue = interactions.find(
    (event) => event.kind === "dialogue" || event.kind === "shop",
  );
  return {
    conversation: dialogue?.step ?? dialogue?.revision ?? 0,
    trade: trade?.revision ?? 0,
    invitation: trade?.state === "invited" ? trade.revision : 0,
  };
}

function nativeChunks(source) {
  const chunks = [];
  for (let offset = 0; offset < source.length; ) {
    let end = Math.min(source.length, offset + NATIVE_CHUNK_SIZE);
    const unit = source.charCodeAt(end - 1);
    if (unit >= 0xd800 && unit <= 0xdbff) end--;
    chunks.push(source.slice(offset, end));
    offset = end;
  }
  return chunks.map((data, index) => ({
    kind: "native-presentation",
    index,
    total: chunks.length,
    data,
  }));
}

/** Private native data is byte-paged separately from core revision/inventory/progress pages. */
export function nativePresentationParts(actor, world) {
  const interactions = interactionViews(actor, world);
  const value = {
    profile: nativeProfile(actor),
    stats: { ...actor.stats },
    capabilities: CAPABILITIES,
    quests: nativeQuestViews(actor, world),
    interactions,
    revisions: interactionRevisions(interactions),
    paused: Boolean(actor.field.paused),
  };
  const source = JSON.stringify(value);
  if (Buffer.byteLength(source) > NATIVE_MAX_BYTES) {
    throw protocolError("SERVER_BUSY");
  }
  decodeNativePresentation(source, domainEventSchema);
  return nativeChunks(source);
}
