import { itemCount, isEquipped } from "../items/inventory-model.js";
import { JOB_LABELS } from "../ui/ui-job-labels.js";

/** Quest Check/Act endpoint identity, using the active/completed stage after acceptance. */
export function questEndpointNpc(record, partition) {
  const stage = record.stages[Math.min(partition, 1)];
  return stage.check.npc || stage.actionCheck.npc || 0;
}

/** Original Quest/icon0,1,2,4 are available, unfinished, ready and completed artwork. */
export function questListIcon(quests, record, partition) {
  if (partition === 0) return "Quest/icon0";
  if (partition === 2) return "Quest/icon4";
  return quests.status(record, questEndpointNpc(record, partition)).ok
    ? "Quest/icon2/0"
    : "Quest/icon1";
}

/** Original 00a2a0be partitions; an NPC endpoint is ignored only for list eligibility. */
export function questPartition(quests, record) {
  const state = quests.store.profile.quests[record.id]?.state ?? 0;
  if (state) return state;
  const npc = record.stages[0].check.npc || record.stages[0].actionCheck.npc;
  return quests.status(record, npc).ok ? 0 : -1;
}

/** A journal selection belongs to its current tab, including after profile/catalog replacement. */
export function questJournalSelection(quests, selected, partition) {
  const record = quests.catalog.records[selected];
  return record && questPartition(quests, record) === partition ? record : null;
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
    const label = quests.catalog.strings.mob[mob.id] ?? `#o${mob.id}#`;
    rows.push({
      kind: "mob",
      label,
      text: `${label}: ${actual}/${mob.count}`,
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
    const label = quests.catalog.strings.item[item.id] ?? `#t${item.id}#`;
    rows.push({
      kind: "item",
      label,
      text: `${label}: ${actual}/${Math.abs(item.count)}`,
      current: actual,
      required: item.count,
      done,
      progress: item.count > 0 ? actual > 0 : done,
    });
  }
}

function appendQuestObjectives(rows, quests, record, profile) {
  const check = record.stages[1].check;
  for (const quest of check.quests) {
    const done = (profile.quests[quest.id]?.state ?? 0) === quest.state;
    const label = quests.catalog.records[quest.id]?.name ?? `#u${quest.id}#`;
    rows.push({
      kind: "quest",
      label,
      text: label,
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

/** 00881261 selects Info/0,1,2; 008818df builds the active-only summary child. */
export function questDetailContent(quests, record, partition) {
  const info = record.info ?? {};
  const summary = [];
  if (partition === 1) {
    if (info.summary) summary.push(info.summary);
    if (info.demandSummary) summary.push(info.demandSummary);
    else {
      for (const row of questObjectives(quests, record)) {
        summary.push(`${row.done ? "#g" : "#k"}${row.text}#k`);
      }
    }
    if (info.rewardSummary) summary.push(`#Wreward#\n${info.rewardSummary}`);
  }
  return {
    narrative: info[partition] ?? "",
    summary: summary.length ? `#Wsummary#\n${summary.join("\n")}` : "",
    information: questInformation(quests, record, partition),
  };
}

/** Declarative requirements/rewards are inspection, not an admission or a reward receipt. */
function questInformation(quests, record, partition) {
  const lines = [];
  appendQuestRequirements(lines, record.stages[0].check, quests);
  appendQuestRequirements(lines, record.stages[0].actionCheck, quests);
  if (partition !== 1 && record.info?.rewardSummary) {
    lines.push(`#Wreward#\n${record.info.rewardSummary}`);
  } else if (!record.info?.rewardSummary) {
    appendQuestRewards(lines, record.stages[1].act);
  }
  return lines.join("\n");
}

function appendQuestRequirements(lines, check, quests) {
  if (check.lvmin) lines.push(`Over Level ${check.lvmin}`);
  if (check.lvmax) lines.push(`Under Level ${check.lvmax}`);
  if (check.jobs.length) {
    const jobs = check.jobs.map(
      (id) => JOB_LABELS[id] ?? `Unknown job (${id})`,
    );
    lines.push(`Jobs: ${jobs.join(", ")}`);
  }
  if (check.pop) lines.push(`Fame: ${check.pop}`);
  if (check.endmeso) lines.push(`Meso: ${check.endmeso}`);
  for (const item of check.items) {
    lines.push(`#i${item.id}# #t${item.id}#: ${item.count}`);
  }
  for (const requirement of check.quests) {
    const name = quests.catalog.records[requirement.id]?.name ?? requirement.id;
    lines.push(
      `${name}: ${["Available", "In progress", "Completed"][requirement.state]}`,
    );
  }
}

function appendQuestRewards(lines, act) {
  const rewards = [];
  if (act.exp > 0) rewards.push(`EXP: ${act.exp}`);
  if (act.money > 0) rewards.push(`Meso: ${act.money}`);
  if (act.pop) rewards.push(`Fame: ${act.pop}`);
  for (const item of act.items) {
    if (item.count <= 0) continue;
    const banner =
      item.prop === -1 ? "#Wselect#" : item.prop > 0 ? "#Wprob#" : "#Wbasic#";
    rewards.push(`${banner}\n#i${item.id}# #t${item.id}#: ${item.count}`);
  }
  if (rewards.length) lines.push(`#Wreward#\n${rewards.join("\n")}`);
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
