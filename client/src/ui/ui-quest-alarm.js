import { questObjectives as localQuestObjectives } from "../quests/quest-journal-model.js";

function questObjectives(quests, record) {
  return quests.journal
    ? quests.journal.objectives(record)
    : localQuestObjectives(quests, record);
}

/** Original 0088811a: 18px objective rows, title and inter-quest spacer; no fixed cap. */
export function questAlarmHeight(quests) {
  const ids = quests.store.profile.settings.questTracker.ids;
  if (quests.trackerMinimized || !ids.length) return 20;
  let rows = 0;
  for (const id of ids) {
    const record = quests.catalog.records[id];
    if (record && quests.isTrackerQuest(record, id, quests.store.profile)) {
      rows += 2 + questObjectives(quests, record).length;
    }
  }
  return rows ? 30 + (rows - 1) * 18 : 20;
}

async function act(view, action, id = null) {
  if (view.busy) return;
  view.busy = true;
  try {
    const result = await view.quests.changeTracker(action, id);
    if (view.destroyed) return;
    if (!result.ok) view.panel.owner.status(result.reason);
    else if (action === "close") view.panel.owner.close("QuestAlarm");
    else refresh(view);
  } catch (error) {
    if (!view.destroyed) view.panel.owner.report(error);
  } finally {
    view.busy = false;
  }
}

function controls(view, layer) {
  const { quests } = view;
  layer.button("BtClose", 203, 4, {
    label: "Close quest helper",
    action: () => act(view, "close"),
  });
  layer.button(quests.trackerMinimized ? "BtMax" : "BtMin", 190, 4, {
    label: quests.trackerMinimized
      ? "Expand quest helper"
      : "Minimize quest helper",
    action: () => {
      quests.trackerMinimized = !quests.trackerMinimized;
      refresh(view);
    },
  });
  const auto = layer.button("QuestAlarm/BtAuto", 140, 4, {
    label: "Automatic quest registration",
    action: () => act(view, "auto"),
  });
  auto.element.setAttribute(
    "aria-pressed",
    String(quests.store.profile.settings.questTracker.auto),
  );
  layer.button("QuestAlarm/BtQ", 5, 4, {
    label: "Quest journal",
    action: () => view.panel.owner.open("Quest"),
  });
}

function rows(view, layer) {
  let y = 25;
  for (const id of view.quests.store.profile.settings.questTracker.ids) {
    const record = view.quests.catalog.records[id];
    if (
      !record ||
      !view.quests.isTrackerQuest(record, id, view.quests.store.profile)
    ) {
      continue;
    }
    // 0088524a selects font37: black12 title; objective labels use black12 font1.
    const title = layer.text(record.name, 10, y, { width: 187 });
    title.style.cssText +=
      "color:#000;font:bold 12px/18px Arial,sans-serif;text-shadow:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    layer.button("BtClose", 203, y + 2, {
      label: `Remove ${record.name}`,
      action: () => act(view, "remove", id),
    });
    y += 18;
    for (const row of questObjectives(view.quests, record)) {
      objectiveRow(layer, row, y);
      y += 18;
    }
    y += 18;
  }
}

/** 00887ad2 selects fonts6/10/9/13 at integer completion percentages33/66/100. */
function progressColor(row) {
  if (row.done) return "#336600";
  const percentage =
    row.required > 0 ? Math.trunc((row.current * 100) / row.required) : 0;
  if (percentage < 33) return "#ff2020";
  return percentage < 66 ? "#ff3399" : "#ff9900";
}

/** 00886a7d truncates only the black label, preserving the independently colored count. */
function objectiveRow(layer, row, y) {
  const text = layer.text("", 10, y, { width: 185 });
  text.style.cssText +=
    "display:flex;gap:10px;color:#000;font:12px/18px Arial,sans-serif;text-shadow:none;white-space:nowrap;";
  const label = document.createElement("span");
  label.textContent = row.label;
  label.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;";
  text.append(label);
  if (row.kind === "quest") {
    // 00886629/6692 select original strings5262/5263 and fonts13/6.
    const status = document.createElement("span");
    status.textContent = row.done ? "Complete" : "Incomplete";
    status.style.cssText = `flex-shrink:0;color:${row.done ? "#336600" : "#ff2020"};`;
    text.append(status);
    return;
  }
  const count = document.createElement("span");
  count.style.flexShrink = "0";
  const current = document.createElement("span");
  current.textContent = String(row.current);
  current.style.color = progressColor(row);
  count.append(current, `/${Math.abs(row.required)}`);
  text.append(count);
}

function refresh(view) {
  if (view.destroyed) return;
  const { panel, quests } = view;
  const key = trackerKey(quests);
  if (key === view.renderedKey) return;
  view.renderedKey = key;
  const height = questAlarmHeight(quests);
  panel.height = height;
  panel.element.style.height = `${height}px`;
  view.layer?.destroy();
  const layer = panel.layer("Quest helper content");
  view.layer = layer;
  if (height === 20) layer.image("QuestAlarm/backgrndmin", 0, 0);
  else {
    layer.image("QuestAlarm/backgrndmax", 0, 0);
    for (let y = 25; y < height - 5; y += 18) {
      layer.image("QuestAlarm/backgrndcenter", 0, y);
    }
    layer.image("QuestAlarm/backgrndbottom", 0, height - 5);
    rows(view, layer);
  }
  controls(view, layer);
  panel.owner.resize?.();
}

/** Unrelated profile saves must not replace focused controls or completed objective artwork. */
function trackerKey(quests) {
  const tracker = quests.store.profile.settings.questTracker;
  const entries = [];
  for (const id of tracker.ids) {
    const record = quests.catalog.records[id];
    if (!record || !quests.isTrackerQuest(record, id, quests.store.profile)) {
      continue;
    }
    entries.push([id, record.name, questObjectives(quests, record)]);
  }
  return JSON.stringify([quests.trackerMinimized, tracker.auto, entries]);
}

/** Main supplies QuestAlarm and borrowed Basic buttons. Cleanup owns every rebuilt layer. */
export function layoutQuestAlarm(panel, quests) {
  const view = {
    panel,
    quests,
    layer: null,
    busy: false,
    destroyed: false,
    renderedKey: null,
  };
  refresh(view);
  const cleanup = () => {
    view.destroyed = true;
    view.layer?.destroy();
  };
  cleanup.refresh = () => refresh(view);
  return cleanup;
}
