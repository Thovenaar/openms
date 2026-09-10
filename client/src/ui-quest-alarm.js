import { questObjectives } from "./quest-journal-model.js";

/** Original 0088811a: 18px objective rows, title and inter-quest spacer; no fixed cap. */
export function questAlarmHeight(quests) {
  const ids = quests.store.profile.settings.questTracker.ids;
  if (quests.trackerMinimized || !ids.length) return 20;
  let rows = 0;
  for (const id of ids) {
    const record = quests.catalog.records[id];
    if (record) rows += 2 + questObjectives(quests, record).length;
  }
  return 30 + (rows - 1) * 18;
}

async function act(view, action, id = null) {
  if (view.busy) return;
  view.busy = true;
  try {
    const result = await view.quests.changeTracker(action, id);
    if (view.destroyed) return;
    if (!result.ok) view.panel.owner.report(new Error(result.reason));
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
  let y = 29;
  for (const id of view.quests.store.profile.settings.questTracker.ids) {
    const record = view.quests.catalog.records[id];
    if (!record) continue;
    const title = layer.text(record.name, 12, y, { width: 187 });
    title.style.cssText +=
      "color:#ffff00;font-size:12px;white-space:nowrap;overflow:hidden;";
    layer.button("BtClose", 203, y + 2, {
      label: `Remove ${record.name}`,
      action: () => act(view, "remove", id),
    });
    y += 18;
    for (const row of questObjectives(view.quests, record)) {
      const text = layer.text(row.text, 12, y, { width: 195 });
      text.style.cssText += `color:${row.done ? "#00ff00" : "#ffffff"};font-size:12px;white-space:nowrap;overflow:hidden;`;
      y += 18;
    }
    y += 18;
  }
}

function refresh(view) {
  if (view.destroyed) return;
  const { panel, quests } = view;
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

/** Main supplies QuestAlarm and borrowed Basic buttons. Cleanup owns every rebuilt layer. */
export function layoutQuestAlarm(panel, quests) {
  const view = { panel, quests, layer: null, busy: false, destroyed: false };
  refresh(view);
  const cleanup = () => {
    view.destroyed = true;
    view.layer?.destroy();
  };
  cleanup.refresh = () => refresh(view);
  return cleanup;
}
