import { unsupported } from "./native-source.js";
import { JOB_LABELS } from "../ui/ui-job-labels.js";

function orderValue(record, key) {
  return Number(record.info?.[key] ?? 0);
}
function questParent(record) {
  return String(record.info?.parent ?? record.name);
}
function compareQuests(a, b) {
  return (
    orderValue(a, "sortkey") - orderValue(b, "sortkey") ||
    questParent(a).localeCompare(questParent(b)) ||
    orderValue(a, "order") - orderValue(b, "order") ||
    a.id - b.id
  );
}

/** Metadata supplies artwork/prose; partitions, readiness and progress come only from the server. */
export class NativeQuests {
  constructor(owner) {
    this.owner = owner;
    this.store = owner.store;
    this.catalog = owner.catalog.quests;
    this.records = Object.values(this.catalog.records);
    this.trackerMinimized = false;
    this.journal = this;
    this.readySeen = new Set();
  }
  views() {
    return this.owner.state.presentation.quests;
  }
  view(id) {
    return this.views().find((entry) => entry.id === Number(id));
  }
  knownJobs() {
    return Object.keys(JOB_LABELS).map(Number);
  }
  mapName(id) {
    return this.owner.catalog.mapNames[id] ?? "Map name unavailable";
  }
  npcEntries(npcId) {
    const progress = [],
      available = [];
    for (const view of this.views()) {
      if (view.state === 2 || (view.state === 0 && !view.available)) continue;
      const record = this.catalog.records[view.id];
      const stage = record?.stages[view.state];
      if (
        !stage ||
        (stage.check.npc !== Number(npcId) &&
          stage.actionCheck.npc !== Number(npcId))
      ) {
        continue;
      }
      const entry = { record, state: view.state, ready: view.ready };
      (view.state === 1 ? progress : available).push(entry);
    }
    return progress.concat(available);
  }
  status(record) {
    const view = this.view(record.id);
    return {
      ok: Boolean(view && (view.state === 0 ? view.available : view.ready)),
      reason: view?.reason ?? "Quest is unavailable on this server.",
    };
  }
  selection(id, partition) {
    const view = this.view(id);
    return view?.partition === partition ? this.catalog.records[id] : null;
  }
  groups(partition) {
    const groups = new Map();
    for (const view of this.views()) {
      if (
        view.partition !== partition ||
        (partition === 0 && !view.available)
      ) {
        continue;
      }
      const record = this.catalog.records[view.id];
      if (!record) continue;
      const area = String(record.info?.area ?? "");
      if (!groups.has(area)) {
        groups.set(area, {
          area,
          name: this.catalog.categories?.labels[area],
          records: [],
        });
      }
      groups.get(area).records.push(record);
    }
    for (const group of groups.values()) {
      group.records.sort(compareQuests);
    }
    return [...groups.values()].sort(
      (a, b) => Number(a.area) - Number(b.area) || a.area.localeCompare(b.area),
    );
  }
  icon(record, partition) {
    if (partition === 0) return "Quest/icon0";
    if (partition === 2) return "Quest/icon4";
    return this.isReady(record) ? "Quest/icon2/0" : "Quest/icon1";
  }
  objectives(record) {
    return (this.view(record.id)?.objectives ?? []).map((row) => {
      const label =
        this.catalog.strings[row.kind === "kill" ? "mob" : "item"][
          row.templateId
        ] ?? String(row.templateId);
      const done = row.current >= row.required;
      return {
        ...row,
        label,
        count: row.current,
        total: row.required,
        done,
        text: `${label}: ${row.current}/${row.required}`,
      };
    });
  }
  detail(record, partition) {
    const info = record.info ?? {};
    const rows = partition === 1 ? this.objectives(record) : [];
    return {
      narrative: info[partition] ?? "",
      summary: rows.length
        ? `#Wsummary#\n${rows.map((row) => `${row.done ? "#g" : "#k"}${row.text}#k`).join("\n")}`
        : "",
      information: this.view(record.id)?.reason ?? "",
    };
  }
  isReady(record) {
    return Boolean(this.view(record.id)?.ready);
  }
  isTrackerQuest(record) {
    return Boolean(this.view(record.id)?.tracker);
  }
  trackerAdmission(id) {
    return this.admission(id, "tracker");
  }
  giveUpAdmission(id) {
    return this.admission(id, "giveUp");
  }
  admission(id, key) {
    const entry = this.view(id);
    return {
      ok: Boolean(entry?.[key]),
      reason: entry?.reason ?? "Quest action is unavailable.",
    };
  }
  giveUp(id) {
    return this.owner.request({ kind: "quest.abandon", questId: Number(id) });
  }
  async changeTracker(action, id) {
    if (action === "add" || action === "remove") {
      return this.owner.request({
        kind: "quest.track",
        questId: Number(id),
        tracked: action === "add",
      });
    }
    const settings = structuredClone(this.store.profile.settings);
    if (action === "auto") {
      settings.questTracker.auto = !settings.questTracker.auto;
    } else if (action === "open" || action === "close") {
      settings.questTracker.open = action === "open";
    } else return unsupported(`quest tracker action ${action}`);
    return this.owner.request({ kind: "settings.save", settings });
  }
  resetReadiness() {
    this.readySeen = new Set(
      this.views()
        .filter((entry) => entry.ready)
        .map((entry) => entry.id),
    );
  }
  readinessChanges() {
    const ready = [],
      removed = [],
      current = new Set();
    for (const entry of this.views()) {
      if (!entry.ready || entry.noticeAcknowledged) continue;
      current.add(entry.id);
      if (!this.readySeen.has(entry.id) && this.catalog.records[entry.id]) {
        ready.push(this.catalog.records[entry.id]);
      }
    }
    for (const id of this.readySeen) if (!current.has(id)) removed.push(id);
    this.readySeen = current;
    return { ready, removed };
  }
  acknowledgeReady(id) {
    return this.owner.request({ kind: "quest.notice", questId: id });
  }
}
