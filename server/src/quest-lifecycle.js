import { protocolError } from "../../shared/schema.js";

const MAX_QUESTS = 4096;
const MAX_ROWS = 200000;
const MAX_INTERVAL = 365 * 24 * 60;
const CONTROL =
  /^Quest\.wz:(Check\.img\/(\d+)\/0\/interval|QuestInfo\.img\/(\d+)\/timeLimit)$/;

/** Separate executable server projection; the hash-verified original catalog stays untouched. */
export async function prepareOnlineQuests(content) {
  const original = content.catalog.quests;
  const inventory = await content.json(original.inventory);
  const rows = inventory.Check.rows;
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) {
    throw protocolError("CONTENT_MISMATCH");
  }
  const intervals = new Map();
  for (const row of rows) {
    const match = /^(\d+)\/0\/interval$/.exec(row.path);
    if (match) intervals.set(Number(match[1]), row.value);
  }
  const records = { ...original.records };
  if (Object.keys(records).length > MAX_QUESTS) {
    throw protocolError("CONTENT_MISMATCH");
  }
  const controls = new Map();
  for (const record of Object.values(records)) {
    if (
      !record.blockers.length ||
      !record.blockers.every((blocker) => CONTROL.test(blocker.source))
    ) {
      continue;
    }
    const control = readControl(record, intervals);
    if (!control) continue;
    controls.set(record.id, control);
    records[record.id] = {
      ...record,
      supported: true,
      blockers: [],
      serverLifecycle: true,
    };
  }
  content.questControls = controls;
  content.onlineQuests = { ...original, records };
}

function validControl(value, maximum) {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) && value >= 0 && value <= maximum)
  );
}

export function onlineQuestCatalog(content) {
  return content.onlineQuests ?? content.catalog.quests;
}

export function questState(profile, record, now = Date.now()) {
  if (!record) throw protocolError("CONTENT_MISMATCH");
  const state = profile.quests[record.id]?.state ?? 0;
  const rows = profile.onlineState?.questLifecycle ?? {};
  const run = rows[record.id];
  if (!run) return state;
  if (state === 1 && due(run, "deadline", now)) return 0;
  if (state === 2 && due(run, "repeatAt", now)) return 0;
  return state;
}

function due(run, field, now) {
  return run[field] !== null && run[field] <= now;
}

/** Deadline admission is repeated inside the transaction, independently of timer delivery. */
export function admitQuestLifecycle(profile, record, stage, now) {
  if (questState(profile, record, now) !== stage) {
    throw protocolError("REQUIREMENTS_NOT_MET");
  }
}

export function commitQuestLifecycle(profile, record, stage, context) {
  const control = context.content.questControls?.get(record.id);
  if (!control) return;
  const rows = (profile.onlineState.questLifecycle ??= {});
  if (!rows[record.id] && Object.keys(rows).length >= MAX_QUESTS) {
    throw protocolError("SERVER_BUSY");
  }
  rows[record.id] = lifecycleRow(control, stage, rows[record.id], context);
}

function lifecycleRow(control, stage, prior, context) {
  if (stage === 0) {
    return {
      cycle: context.operationId,
      deadline:
        control.durationMs === null ? null : context.now + control.durationMs,
      repeatAt: null,
      completedAt: prior?.completedAt ?? null,
    };
  } else {
    return {
      cycle: prior?.cycle ?? context.operationId,
      deadline: null,
      repeatAt:
        control.repeatMs === null ? null : context.now + control.repeatMs,
      completedAt: context.now,
    };
  }
}

/** Runtime wakes at the nearest authored deadline; persisted timestamps remain the authority. */
export function nextQuestWake(profile, now) {
  let deadline = Infinity;
  for (const [id, run] of Object.entries(
    profile.onlineState?.questLifecycle ?? {},
  )) {
    const time = profile.quests[id]?.state === 1 ? run.deadline : run.repeatAt;
    if (time !== null && (profile.quests[id]?.state === 1 || time > now)) {
      deadline = Math.min(deadline, time);
    }
  }
  return deadline;
}

export function expireQuestRuns(profile, now) {
  const expired = [];
  for (const [id, run] of Object.entries(
    profile.onlineState?.questLifecycle ?? {},
  )) {
    if (
      profile.quests[id]?.state !== 1 ||
      run.deadline === null ||
      run.deadline > now
    ) {
      continue;
    }
    profile.quests[id] = { state: 0, kills: {} };
    run.deadline = null;
    profile.settings.questTracker.ids =
      profile.settings.questTracker.ids.filter(
        (questId) => questId !== Number(id),
      );
    expired.push(Number(id));
  }
  return expired;
}

function readControl(record, intervals) {
  const interval = intervals.get(record.id),
    seconds = record.info.timeLimit;
  if (
    !validControl(interval, MAX_INTERVAL) ||
    !validControl(seconds, 86400 * 365)
  ) {
    return null;
  }
  return {
    // OpenMS repeat policy: WZ interval is minutes, with zero allowing another NPC acceptance immediately.
    repeatMs: interval === undefined ? null : interval * 60000,
    // WZ Quest3458 and3951: timeLimit1800, authored prose explicitly says30 minutes.
    durationMs: seconds === undefined ? null : seconds * 1000,
  };
}
