import { itemCount, isEquipped } from "./inventory-model.js";

/** Original 00a2a0be partitions; an NPC endpoint is ignored only for list eligibility. */
export function questPartition(quests, record) {
  const state = quests.store.profile.quests[record.id]?.state ?? 0;
  if (state) return state;
  const npc = record.stages[0].check.npc || record.stages[0].actionCheck.npc;
  return quests.status(record, npc).ok ? 0 : -1;
}

/** Native objective families supported by the compiled Check projection. */
export function questObjectives(
  quests,
  record,
  profile = quests.store.profile,
) {
  const rows = [];
  appendMobObjectives(rows, quests, record, profile);
  appendItemObjectives(rows, quests, record, profile);
  appendQuestObjectives(rows, quests, record, profile);
  return rows;
}

function appendMobObjectives(rows, quests, record, profile) {
  const check = record.stages[1].check;
  for (const mob of check.mobs) {
    const actual = profile.quests[record.id]?.kills[mob.id] ?? 0;
    rows.push({
      text: `${quests.catalog.strings.mob[mob.id] ?? `#o${mob.id}#`}: ${actual}/${mob.count}`,
      current: actual,
      required: mob.count,
      done: actual >= mob.count,
      progress: actual > 0,
    });
  }
}

function appendItemObjectives(rows, quests, record, profile) {
  const check = record.stages[1].check;
  for (const item of check.items) {
    const actual =
      itemCount(profile, item.id) + (isEquipped(profile, item.id) ? 1 : 0);
    const done =
      item.count > 0
        ? actual >= item.count
        : item.count < 0
          ? actual <= -item.count
          : actual === 0;
    rows.push({
      text: `${quests.catalog.strings.item[item.id] ?? `#t${item.id}#`}: ${actual}/${Math.abs(item.count)}`,
      current: actual,
      required: item.count,
      done,
      progress: done,
    });
  }
}

function appendQuestObjectives(rows, quests, record, profile) {
  const check = record.stages[1].check;
  for (const quest of check.quests) {
    const done = (profile.quests[quest.id]?.state ?? 0) === quest.state;
    rows.push({
      text: quests.catalog.records[quest.id]?.name ?? `#u${quest.id}#`,
      current: profile.quests[quest.id]?.state ?? 0,
      required: quest.state,
      done,
      progress: done,
    });
  }
}

/** Authored area, parent and order survive grouping; no invented category dictionary. */
export function questGroups(quests, partition) {
  const groups = new Map();
  for (const record of quests.records) {
    if (questPartition(quests, record) !== partition) continue;
    const area = String(record.info?.area ?? "");
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(record);
  }
  const result = [];
  for (const [area, records] of groups) {
    records.sort(compareQuestOrder);
    result.push({
      area,
      name: quests.catalog.categories?.labels[area] ?? null,
      records,
    });
  }
  result.sort(
    (a, b) => Number(a.area) - Number(b.area) || a.area.localeCompare(b.area),
  );
  return result;
}

function questOrderNumber(record, key) {
  return Number(record.info?.[key] ?? 0);
}

function questParent(record) {
  return String(record.info?.parent ?? record.name);
}

function compareQuestOrder(a, b) {
  return (
    questOrderNumber(a, "sortkey") - questOrderNumber(b, "sortkey") ||
    questParent(a).localeCompare(questParent(b)) ||
    questOrderNumber(a, "order") - questOrderNumber(b, "order") ||
    a.id - b.id
  );
}

/** Title criteria are projections of real quest checks, never synthesized achievement counters. */
export function medalCriteria(quests, record) {
  return questObjectives(quests, record).map((row) => ({
    text: row.text,
    current: row.current,
    required: row.required,
    complete: row.done,
  }));
}
