import { NativeScrollbar } from "./ui-scrollbar.js";
import { replaceIcons } from "./ui-icons.js";
import { itemTooltip } from "./ui-tooltip.js";
import {
  socialView,
  replaceSocialLayer,
  socialTabs,
  socialText,
  socialButton,
  confirmSocial,
  admitted,
  runSocialAction,
  refreshSocialSelection,
} from "./ui-social-controls.js";
import { renderQuestText } from "./quest-ui.js";

const TABS = ["Basic", "Job", "General", "Challenge", "Event"];
const ROW_HEIGHT = 49;
const VISIBLE_ROWS = 5;

/** 00841ae1: Basic maps to category100, the other four tabs map to categories0..3. */
export function layoutTitle(panel, social) {
  const state = socialView(panel, social, drawTitle);
  state.tab = 0;
  state.detailQuestId = null;
  state.refresh();
}

function drawTitle(state) {
  const quests = state.view.medalQuests;
  const detail = quests.find((entry) => entry.questId === state.detailQuestId);
  const width = detail ? 565 : 260;
  state.panel.width = width;
  state.panel.element.style.width = `${width}px`;
  replaceSocialLayer(state, "Title/backgrnd");
  socialTabs(state, {
    path: "Title/Tab",
    x: 4,
    y: 24,
    width: 50,
    selected: state.tab,
    labels: TABS,
    select: (tab) => {
      state.tab = tab;
      state.position = 0;
      state.detailQuestId = null;
      state.selected = null;
      state.refresh();
    },
  });
  const rows =
    state.tab === 0
      ? state.view.medals
      : quests.filter((entry) => entry.category === state.tab - 1);
  drawMedalRows(state, rows);
  if (detail) drawMedalDetail(state, detail);
  state.restoreFocus();
}

function drawMedalRows(state, rows) {
  if (rows.length > 4096) {
    throw new Error("Medal catalog exceeds native UI row budget");
  }
  const count = Math.max(1, rows.length - VISIBLE_ROWS + 1);
  state.position = Math.min(state.position, count - 1);
  let body;
  const paint = () => {
    body?.destroy();
    body = state.layer.layer("Medal rows");
    paintMedalRows(state, rows, body);
    state.panel.renderArtwork();
  };
  // 00843a93: Basic scrollbar239,93 extent245; quest categories239,48 extent290.
  const scroll = new NativeScrollbar(
    state.layer,
    { x: 239, y: state.tab ? 48 : 93, extent: state.tab ? 290 : 245, style: 3 },
    (position) => {
      state.position = position;
      paint();
    },
  );
  scroll.setRange(count, state.position);
  paint();
}

function paintMedalRows(state, rows, body) {
  const records = [];
  if (!rows.length) {
    socialText(
      body,
      state.tab ? "No medals in this category." : "No medals owned.",
      { x: 15, y: state.tab ? 62 : 107, width: 219, height: 38 },
      { wrap: true },
    );
  }
  for (
    let index = state.position;
    index < Math.min(rows.length, state.position + VISIBLE_ROWS);
    index++
  ) {
    const entry = rows[index];
    const y = (state.tab ? 48 : 93) + (index - state.position) * ROW_HEIGHT;
    records.push(paintMedalRow(state, body, entry, y));
  }
  replaceIcons(body, records, (layer, entry) => {
    if (entry.template?.iconPath && layer.assets[entry.template.iconPath]) {
      layer.image(entry.template.iconPath, 13, entry.y + 37, true);
    }
  }).catch((error) => state.panel.owner.report(error));
}

function paintMedalRow(state, body, entry, y) {
  const id = state.tab === 0 ? entry.id : entry.itemId;
  const template = state.panel.owner.index.items[id];
  body.image("Title/backgrnd4", 9, y);
  socialText(body, entry.name, { x: 50, y: y + 5, width: 182 });
  socialText(
    body,
    entry.equipped
      ? "Equipped"
      : ["Available", "In progress", "Completed"][entry.state] || "",
    { x: 50, y: y + 23, width: 182 },
    { color: "#777777" },
  );
  const hit = body.hit(
    entry.name,
    { x: 9, y, width: 227, height: ROW_HEIGHT },
    {
      click: () => {
        state.selected = entry.uid || entry.questId;
        refreshSocialSelection(state);
        if (state.tab) {
          state.detailQuestId = entry.questId;
          state.refresh();
        }
      },
      dblclick: () => {
        if (!state.tab && !entry.equipped) {
          runSocialAction(state, () =>
            state.social.execute("medal.equip", { uid: entry.uid }),
          );
        }
      },
    },
    {
      tooltip: () =>
        itemTooltip(state.panel.owner, template, id, { uid: entry.uid }),
    },
  );
  hit.dataset.socialRow = entry.uid || entry.questId;
  if (entry.uid === state.selected || entry.questId === state.selected) {
    hit.style.background = "rgba(99,143,184,0.28)";
  }
  return { id, uid: entry.uid, template, y };
}

function drawMedalDetail(state, entry) {
  // Detail owner0083f512 creates CHALLENGE at184,350 and FORFEIT at243,350.
  const x = 260;
  const layer = state.layer.layer("Medal detail");
  layer.listen(layer.element, "wheel", (event) => event.stopPropagation());
  layer.image("Title/backgrnd3", x, 0);
  socialText(
    layer,
    entry.name,
    { x: x + 13, y: 11, width: 272 },
    { bold: true },
  );
  const description = layer.contentArea(x + 15, 35, 268, 82);
  description.style.cssText +=
    ";overflow:hidden;white-space:pre-wrap;font:11px Tahoma,sans-serif;line-height:16px";
  renderQuestText(
    description,
    entry.description || "",
    state.panel.owner.quests,
  );
  drawMedalCriteria(state, entry, layer, x);
  drawMedalControls(state, entry, x);
}

function drawMedalCriteria(state, entry, layer, x) {
  const criteria = entry.criteria || [];
  if (criteria.length > 128) throw new Error("Medal criteria budget exceeded");
  const content = layer.contentArea(x + 15, 130, 264, 195);
  content.style.cssText +=
    ";overflow:hidden;font:11px Tahoma,sans-serif;line-height:16px;";
  for (const criterion of criteria) {
    const row = document.createElement("div");
    renderQuestText(
      row,
      `${criterion.complete ? "#g" : "#k"}${criterion.text}`,
      state.panel.owner.quests,
    );
    content.append(row);
  }
  if (entry.reason) {
    const reason = document.createElement("div");
    reason.textContent = entry.reason;
    content.append(reason);
  }
  const scrollbar = new NativeScrollbar(
    layer,
    { x: x + 286, y: 130, extent: 195 },
    (position) => {
      content.scrollTop = position * 16;
    },
  );
  scrollbar.setRange(
    Math.max(
      1,
      Math.ceil((content.scrollHeight - content.clientHeight) / 16) + 1,
    ),
  );
}

function drawMedalControls(state, entry, x) {
  socialButton(state, {
    path: "BtClose",
    x: x + 288,
    y: 6,
    label: "Close medal details",
    action: () => {
      state.detailQuestId = null;
    },
  });
  const questAction = entry.canClaim ? "medal.claim" : "medal.challenge";
  socialButton(state, {
    path: "Title/BtOK",
    x: x + 184,
    y: 350,
    label: "Challenge medal",
    enabled: () =>
      Boolean(entry.canChallenge || entry.canClaim) &&
      admitted(state, questAction),
    tooltip: entry.reason || "Continue this medal's original quest dialogue.",
    action: () => state.social.execute(questAction, { questId: entry.questId }),
  });
  socialButton(state, {
    path: "Title/BtGiveup",
    x: x + 243,
    y: 350,
    label: "Forfeit medal challenge",
    enabled: () =>
      Boolean(entry.canForfeit) && admitted(state, "medal.forfeit"),
    action: () =>
      confirmSocial(state, "medal.forfeit", "Forfeit this medal challenge?", {
        questId: entry.questId,
        confirmed: true,
      }),
  });
}
