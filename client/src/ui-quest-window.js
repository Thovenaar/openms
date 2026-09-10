import { NativeScrollbar } from "./ui-scrollbar.js";
import { renderQuestText } from "./quest-ui.js";
import {
  questGroups,
  questObjectives,
  questPartition,
} from "./quest-journal-model.js";

const TAB_NAMES = ["Available", "In progress", "Completed"];

function text(layer, value, x, geometry) {
  const node = layer.text(value, x, geometry.y, { width: geometry.width });
  node.style.cssText +=
    "font-size:12px;line-height:18px;color:#222;white-space:pre-wrap;";
  return node;
}

function listRows(view) {
  const rows = [];
  for (const group of questGroups(view.quests, view.tab)) {
    const chains = new Map();
    if (group.area) {
      rows.push({
        key: `area:${group.area}`,
        name: group.name ?? group.area,
        header: true,
      });
    }
    if (view.collapsed.has(`area:${group.area}`)) continue;
    collectQuestChains(group.records, rows, chains);
    for (const [parent, records] of chains) {
      const key = `chain:${group.area}:${parent}`;
      rows.push({ key, name: parent, header: true });
      if (!view.collapsed.has(key)) {
        for (const record of records) {
          rows.push({ record, name: record.name, child: true });
        }
      }
    }
  }
  return rows;
}

function collectQuestChains(records, rows, chains) {
  for (const record of records) {
    const parent = String(record.info?.parent ?? "");
    if (!parent) rows.push({ record, name: record.name });
    else {
      if (!chains.has(parent)) chains.set(parent, []);
      chains.get(parent).push(record);
    }
  }
}

function drawRows(view) {
  view.rowsLayer?.destroy();
  const layer = view.list.layer("Quest list rows");
  view.rowsLayer = layer;
  const start = view.scroll.position;
  const end = Math.min(view.rows.length, start + 14);
  for (let index = start; index < end; index++) {
    const row = view.rows[index];
    const y = 49 + (index - start) * 22;
    const label = text(layer, row.name, row.child ? 32 : 19, {
      y,
      width: row.child ? 178 : 192,
    });
    label.style.whiteSpace = "nowrap";
    label.style.overflow = "hidden";
    if (row.header) label.style.fontWeight = "bold";
    if (row.record?.id === view.selected) label.style.color = "#2159bd";
    layer.hit(
      row.name,
      { x: 12, y, width: 209, height: 22 },
      {
        click: () => {
          if (row.header) {
            if (view.collapsed.has(row.key)) view.collapsed.delete(row.key);
            else view.collapsed.add(row.key);
            rebuildList(view);
          } else {
            view.selected = row.record.id;
            drawRows(view);
            detail(view);
          }
        },
      },
    );
  }
}

function rebuildList(view) {
  view.rows = listRows(view);
  view.scroll.setRange(Math.max(1, view.rows.length - 13 + 1));
  drawRows(view);
}

function tabs(view) {
  const positions = [17, 84, 155];
  for (let index = 0; index < 3; index++) {
    const enabled = view.list.image(
      `Quest/Tab/enabled/${index}`,
      positions[index],
      28,
    );
    const disabled = view.list.image(
      `Quest/Tab/disabled/${index}`,
      positions[index],
      28,
    );
    view.tabs.push({ enabled, disabled });
    view.list.hit(
      TAB_NAMES[index],
      { x: positions[index] - 3, y: 24, width: 65, height: 22 },
      {
        click: () => {
          view.tab = index;
          view.selected = null;
          view.scroll.setPosition(0);
          refresh(view);
        },
      },
    );
  }
}

function pane(view, layer, value, geometry) {
  const { y, height, index } = geometry;
  const region = layer.layer("Quest detail scroll pane");
  region.position(0, y);
  region.height = height;
  region.element.style.height = `${height}px`;
  const content = region.contentArea(17, 0, 259, height);
  content.style.cssText +=
    "overflow:hidden;font-size:12px;line-height:18px;white-space:pre-wrap;";
  renderQuestText(content, value, view.quests);
  const scroll = new NativeScrollbar(
    region,
    { x: 283, y: 0, extent: height, style: 3 },
    (position) => {
      view.detailPositions[index] = position;
      content.scrollTop = position * 8;
    },
  );
  scroll.setRange(
    Math.max(1, Math.floor((content.scrollHeight - height) / 8) + 2),
    view.detailPositions[index],
  );
  content.scrollTop = scroll.position * 8;
}

function objectiveText(view, record) {
  const rows = questObjectives(view.quests, record);
  const lines = [];
  for (const row of rows) lines.push(`${row.done ? "#g" : "#k"}${row.text}#k`);
  const act = record.stages[Math.min(view.tab, 1)].act;
  if (record.info?.rewardSummary) lines.push(record.info.rewardSummary);
  if (act.exp) lines.push(`EXP: ${act.exp}`);
  if (act.money) lines.push(`Meso: ${act.money}`);
  if (act.pop) lines.push(`Fame: ${act.pop}`);
  for (const item of act.items) {
    lines.push(
      `#t${item.id}#: ${item.count}${item.prop === -1 ? " (choose one)" : ""}`,
    );
  }
  return lines.join("\n");
}

async function confirmGiveUp(view, id) {
  if (!view.quests.giveUpAdmission(id).ok) return false;
  const confirmed = await view.panel.owner.hooks.confirmQuestGiveUp(
    id,
    view.quests.catalog.records[id].name,
  );
  return confirmed && !view.destroyed && view.selected === id;
}

async function action(view, kind) {
  if (view.busy) return;
  view.busy = true;
  const id = view.selected;
  try {
    if (kind === "giveup" && !(await confirmGiveUp(view, id))) return;
    const result =
      kind === "giveup"
        ? await view.quests.giveUp(id, true)
        : await view.quests.changeTracker("add", id);
    if (view.destroyed) return;
    if (!result.ok) view.panel.owner.report(new Error(result.reason));
    else {
      if (kind === "alert") await view.panel.owner.open("QuestAlarm");
      if (!view.destroyed) refresh(view);
    }
  } catch (error) {
    if (!view.destroyed) view.panel.owner.report(error);
  } finally {
    view.busy = false;
  }
}

async function markNpc(view, record) {
  try {
    await view.panel.owner.hooks.markQuestNpc(record.id);
  } catch (error) {
    if (!view.destroyed) view.panel.owner.report(error);
  }
}

function detailControls(view, layer, record) {
  layer.button("BtClose", 285, 6, {
    label: "Close quest detail",
    action: () => {
      view.selected = null;
      detail(view);
      drawRows(view);
    },
  });
  if (view.tab === 0) {
    layer.button("Quest/BtMarkNpc", 217, 372, {
      label: "Mark NPC on World Map",
      action: () => markNpc(view, record),
    });
    return;
  }
  layer.button("BtQGiveup", 242, 372, {
    label: "Give up quest",
    disabled: !view.quests.giveUpAdmission(record.id).ok,
    action: () => action(view, "giveup"),
  });
  layer.button("Quest/BtAlert", 150, 372, {
    label: "Register quest helper",
    disabled: !view.quests.trackerAdmission(record.id).ok,
    action: () => action(view, "alert"),
  });
}

function detail(view) {
  view.detail?.destroy();
  view.detail = null;
  const record = view.quests.catalog.records[view.selected];
  if (!record) return;
  if (view.detailId !== record.id) {
    view.detailId = record.id;
    view.detailPositions = [0, 0];
  }
  const layer = view.panel.layer("Quest attached detail");
  view.detail = layer;
  layer.width = 305;
  layer.element.style.width = "305px";
  layer.position(240, 0);
  layer.image("Quest/backgrnd2", 0, 0);
  text(layer, record.name, 17, { y: 31, width: 267 });
  const stateText = record.info?.[view.tab] ?? "";
  text(layer, record.info?.summary ?? "", 17, { y: 63, width: 267 });
  pane(view, layer, `${stateText}\n${record.info?.demandSummary ?? ""}`, {
    y: 122,
    height: 120,
    index: 0,
  });
  pane(view, layer, objectiveText(view, record), {
    y: 248,
    height: 110,
    index: 1,
  });
  detailControls(view, layer, record);
  view.panel.owner.positionWindow(view.panel, view.panel.x, view.panel.y);
}

function refresh(view) {
  if (view.destroyed) return;
  if (
    view.selected &&
    questPartition(view.quests, view.quests.catalog.records[view.selected]) !==
      view.tab
  ) {
    view.selected = null;
  }
  for (let index = 0; index < 3; index++) {
    view.tabs[index].enabled.container.visible = index === view.tab;
    view.tabs[index].disabled.container.visible = index !== view.tab;
  }
  rebuildList(view);
  detail(view);
}

/** Owns the native list and its attached child; Main supplies native confirmation/WorldMap routes. */
export function mountQuestJournal(panel, quests) {
  const list = panel.layer("Quest list");
  list.image("Quest/backgrnd", 0, 0);
  const view = {
    panel,
    quests,
    list,
    tab: 0,
    selected: null,
    tabs: [],
    rows: [],
    collapsed: new Set(),
    detail: null,
    detailId: null,
    detailPositions: [0, 0],
    rowsLayer: null,
    destroyed: false,
    busy: false,
  };
  list.button("BtClose", 225, 6, {
    label: "Close quest journal",
    action: () => panel.owner.close("Quest"),
  });
  tabs(view);
  view.scroll = new NativeScrollbar(
    list,
    { x: 225, y: 50, extent: 309, style: 3 },
    () => drawRows(view),
  );
  refresh(view);
  const cleanup = () => {
    view.destroyed = true;
    view.detail?.destroy();
    list.destroy();
  };
  cleanup.refresh = () => refresh(view);
  return cleanup;
}
