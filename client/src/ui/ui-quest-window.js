import { NativeScrollbar } from "./ui-scrollbar.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";
import { renderQuestText } from "./quest-ui.js";
import { renderDialogArtwork } from "./ui-dialog-art.js";
import { tabParts, showTabPart, tabLabel } from "./ui-layout.js";
import {
  questGroups as localQuestGroups,
  questDetailContent as localQuestDetailContent,
  questJournalSelection as localQuestJournalSelection,
  questEndpointNpc,
  questListIcon as localQuestListIcon,
} from "../quests/quest-journal-model.js";

const TAB_NAMES = ["Available", "In progress", "Completed"];

function questGroups(quests, partition) {
  return quests.journal
    ? quests.journal.groups(partition)
    : localQuestGroups(quests, partition);
}

function questDetailContent(quests, record, partition) {
  return quests.journal
    ? quests.journal.detail(record, partition)
    : localQuestDetailContent(quests, record, partition);
}

function questJournalSelection(quests, selected, partition) {
  return quests.journal
    ? quests.journal.selection(selected, partition)
    : localQuestJournalSelection(quests, selected, partition);
}

function questListIcon(quests, record, partition) {
  return quests.journal
    ? quests.journal.icon(record, partition)
    : localQuestListIcon(quests, record, partition);
}

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
        key: `area:${view.tab}:${group.area}`,
        name: group.name ?? group.area,
        header: true,
      });
    }
    if (view.collapsed.has(`area:${view.tab}:${group.area}`)) continue;
    collectQuestChains(group.records, rows, chains);
    for (const [parent, records] of chains) {
      const key = `chain:${view.tab}:${group.area}:${parent}`;
      rows.push({ key, name: parent, header: true });
      if (!view.collapsed.has(key)) {
        for (const record of records) {
          rows.push({ record, name: record.name });
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
  const layer = view.list.layer("Quest list rows", { isolated: true });
  view.rowsLayer = layer;
  const start = view.scroll.position;
  const end = Math.min(view.rows.length, start + 14);
  if (!view.rows.length) {
    // 008831df selects notice%d; notice/%d contains region banners, not empty states.
    const path = `Quest/notice${view.tab}`;
    const asset = layer.assets[path];
    layer.image(
      path,
      Math.trunc((210 - asset.width) / 2) - 2,
      50 + Math.trunc((309 - asset.height) / 2),
    );
  }
  for (let index = start; index < end; index++) {
    drawQuestRow(view, layer, view.rows[index], 49 + (index - start) * 22);
  }
}

function drawQuestRowBackground(layer, row, y, selected) {
  // 008834c9: category ff9fb5ce at10,49,208x19; 00883cce: selection ff396093 at28,50,192x19.
  const background = layer.text(
    "",
    row.header ? 10 : 28,
    y + (row.header ? 0 : 1),
    row.header ? 208 : 192,
  );
  background.style.height = "19px";
  // UISurface isolates stacking; the native fill stays behind its artwork canvas.
  background.style.zIndex = "-1";
  background.style.background = row.header
    ? "#9fb5ce"
    : selected
      ? "#396093"
      : "transparent";
}

function drawQuestRow(view, layer, row, y) {
  const selected = row.record?.id === view.selected;
  drawQuestRowBackground(layer, row, y, selected);
  if (row.record) {
    layer.stateImage(
      questListIcon(view.quests, row.record, view.tab),
      13,
      y + 2,
    );
  } else {
    layer.button(view.collapsed.has(row.key) ? "BtMax" : "BtMin", 13, y + 3, {
      label: `${view.collapsed.has(row.key) ? "Expand" : "Collapse"} ${row.name}`,
      action: () => toggleCategory(view, row.key),
    });
  }
  const label = text(layer, row.name, 30, { y: y + 3, width: 188 });
  label.style.cssText += `font-size:11px;line-height:13px;white-space:nowrap;overflow:hidden;color:${selected ? "white" : "#222"};`;
  label.title = row.name;
  const hit = layer.hit(
    row.name,
    { x: 28, y, width: 192, height: 22 },
    {
      pointerdown: (event) => event.stopPropagation(),
      click: () => {
        if (row.header) toggleCategory(view, row.key);
        else {
          view.selected = row.record.id;
          drawRows(view);
          detail(view);
        }
      },
    },
  );
  hit.setAttribute(
    row.header ? "aria-expanded" : "aria-selected",
    String(row.header ? !view.collapsed.has(row.key) : selected),
  );
}

function toggleCategory(view, key) {
  if (view.collapsed.has(key)) view.collapsed.delete(key);
  else view.collapsed.add(key);
  rebuildList(view);
}

function rebuildList(view) {
  view.rows = listRows(view);
  view.scroll.setRange(Math.max(1, view.rows.length - 13));
  drawRows(view);
}

function tabs(view) {
  // 0087ec3f creates native type1 Tab2 at3,23 with width239 and three labels.
  view.tabLeft = tabParts(view.list, "left", 3, 4);
  let x = 7;
  for (let index = 0; index < 3; index++) {
    const width = index < 2 ? 72 : 71;
    const fill = tabParts(view.list, "fill", x, width);
    const edge = tabParts(
      view.list,
      index === 2 ? "right" : "middle",
      x + width,
      index === 2 ? 4 : 8,
    );
    const enabled = tabLabel(view.list, `Quest/Tab/enabled/${index}`, x, width);
    const disabled = tabLabel(
      view.list,
      `Quest/Tab/disabled/${index}`,
      x,
      width,
    );
    const hit = view.list.hit(
      TAB_NAMES[index],
      { x, y: 23, width: width + 4, height: 19 },
      {
        pointerdown: (event) => event.stopPropagation(),
        click: () => {
          view.tab = index;
          view.panel.owner.rememberTab("Quest", index);
          view.selected = null;
          view.detailId = null;
          view.scroll.setPosition(0);
          refresh(view);
        },
      },
    );
    hit.setAttribute("role", "tab");
    view.tabs.push({ enabled, disabled, fill, edge, hit });
    x += width + 8;
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
  region.listen(content, "pointerdown", (event) => event.stopPropagation());
  renderQuestText(content, value, view.quests);
  const scroll = new NativeScrollbar(
    region,
    { x: 283, y: 0, extent: height, style: 3 },
    (position) => {
      view.detailPositions[index] = position;
      content.scrollTop = position * 8;
    },
  );
  const sync = () => {
    if (region.disposed) return;
    scroll.setRange(
      Math.max(1, Math.ceil((content.scrollHeight - height) / 8) + 1),
      view.detailPositions[index],
    );
    content.scrollTop = scroll.position * 8;
  };
  sync();
  const request = new AbortController();
  region.cleanups.push(() => request.abort());
  renderDialogArtwork(
    { content, owner: view.panel.owner, resource: view.panel.resource },
    request.signal,
  )
    .then(sync)
    .catch((error) => {
      if (!request.signal.aborted && !view.destroyed) {
        view.panel.owner.report(error);
      }
    });
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
    if (!result.ok) view.panel.owner.status(result.reason);
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

async function loadQuestPortrait(view, layer, npcId) {
  const name = view.quests.catalog.strings.npc[npcId] ?? String(npcId);
  // Keep the caption inside the WZ header's y30..117 interior, centered on portrait x242.
  const label = text(layer, name, 191, { y: 104, width: 102 });
  label.style.cssText +=
    "font-size:12px;line-height:14px;height:14px;white-space:nowrap;text-align:center;color:white;";
  label.title = name;
  const entry = view.panel.owner.index.npcPortraits?.[npcId];
  if (!entry?.available) return;
  const request = new AbortController();
  layer.cleanups.push(() => request.abort());
  let resource;
  try {
    resource = await loadVisualBundle(
      entry.descriptor,
      view.panel.owner.services,
      request.signal,
    );
    if (request.signal.aborted || layer.disposed) return;
    layer.borrow(resource);
    layer.dependencies.push(resource);
    resource = null;
    // Original detail portrait layer is anchored at (242,110), 0087c7a9.
    layer.image("NpcPortrait", 242, 110, true);
    view.panel.renderArtwork();
  } catch (error) {
    if (!request.signal.aborted && !view.destroyed) {
      view.panel.owner.report(error);
    }
  } finally {
    resource?.destroy();
  }
}

function detailHeader(view, layer, record) {
  // 0087bb26 limits the title to150px; 0087bb93 draws at35,40 beside the baked green marker.
  const title = text(layer, "", 35, { y: 40, width: 150 });
  title.style.cssText +=
    "color:white;height:48px;overflow:auto;pointer-events:auto;";
  layer.listen(title, "pointerdown", (event) => event.stopPropagation());
  renderQuestText(title, record.name, view.quests, { color: "white" });
  title.title = record.name;
  const npcId = questEndpointNpc(record, view.tab);
  if (npcId) loadQuestPortrait(view, layer, npcId);
  const information = layer.button("Quest/BtDetail", 125, 94, {
    label: "More information",
    action: () => {
      view.moreInfo = !view.moreInfo;
      view.detailPositions[0] = 0;
      detail(view);
    },
  });
  information.element.setAttribute("aria-expanded", String(view.moreInfo));
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
      label: "Find NPC",
      disabled: !questEndpointNpc(record, view.tab),
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
  const record = questJournalSelection(view.quests, view.selected, view.tab);
  if (!record) {
    view.selected = null;
    view.detailId = null;
    view.detailPositions = [0, 0];
    view.moreInfo = false;
    view.panel.owner.positionWindow(view.panel, view.panel.x, view.panel.y);
    view.panel.renderArtwork();
    return;
  }
  if (view.detailId !== record.id) {
    view.detailId = record.id;
    view.detailPositions = [0, 0];
    view.moreInfo = false;
  }
  const layer = view.panel.layer("Quest attached detail");
  view.detail = layer;
  layer.width = 305;
  layer.element.style.width = "305px";
  layer.position(240, 0);
  const content = questDetailContent(view.quests, record, view.tab);
  // 0087c388 selects backgrnd4 only when the active summary child exists.
  layer.image(content.summary ? "Quest/backgrnd4" : "Quest/backgrnd2", 0, 0);
  detailHeader(view, layer, record);
  const body = view.moreInfo
    ? `${content.narrative}\n\n${content.information}`
    : content.narrative;
  pane(view, layer, body, {
    y: 122,
    height: content.summary ? 120 : 243,
    index: 0,
  });
  if (content.summary) {
    pane(view, layer, content.summary, { y: 248, height: 110, index: 1 });
  }
  detailControls(view, layer, record);
  view.panel.owner.positionWindow(view.panel, view.panel.x, view.panel.y);
}

function refresh(view) {
  if (view.destroyed) return;
  view.selected =
    questJournalSelection(view.quests, view.selected, view.tab)?.id ?? null;
  showTabPart(view.tabLeft, view.tab === 0 ? 1 : 0);
  for (let index = 0; index < 3; index++) {
    view.tabs[index].enabled.container.visible = index === view.tab;
    view.tabs[index].disabled.container.visible = index !== view.tab;
    showTabPart(view.tabs[index].fill, index === view.tab ? 1 : 0);
    showTabPart(
      view.tabs[index].edge,
      index === view.tab ? 1 : index + 1 === view.tab ? 2 : 0,
    );
    view.tabs[index].hit.setAttribute(
      "aria-selected",
      String(index === view.tab),
    );
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
    tab: panel.owner.restoreTab("Quest", [0, 1, 2]),
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
    moreInfo: false,
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
