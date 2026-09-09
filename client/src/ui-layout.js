import { layoutGauges } from "./ui-hud.js";
import { layoutKeys } from "./ui-keyconfig.js";
/** First original status-bar control row; windows must leave it unobstructed. */
export const HUD_TOP = 515;

// Recovered 008d2fc3..008d36ab control-create calls, reference screen coordinates (800 x 600).
const HUD_BUTTONS = [
  ["BtClaim", 573, HUD_TOP, "Alert GM"],
  ["EquipKey", 618, HUD_TOP, "Equip"],
  ["InvenKey", 648, HUD_TOP, "Item"],
  ["StatKey", 678, HUD_TOP, "Stat"],
  ["SkillKey", 708, HUD_TOP, "Skill"],
  ["KeySet", 738, HUD_TOP, "KeyConfig"],
  ["BtShop", 573, 543, "shop"],
  ["BtNPT", 629, 543, "NPT"],
  ["BtMenu", 685, 543, "GameMenu"],
  ["BtShort", 741, 543, "ShortCut"],
];
// 00849f3e and 0084a6bc: x=6, y=24+26*n. Only controls actually constructed there.
const MENUS = {
  GameMenu: [
    ["BtChannel", "Channel"],
    ["BtGameOpt", "GameOpt"],
    ["BtSysOpt", "SysOpt"],
    ["BtQuit", "Quit"],
  ],
  ShortCut: [
    ["BtItem", "Item"],
    ["BtEquip", "Equip"],
    ["BtStat", "Stat"],
    ["BtSkill", "Skill"],
    ["BtComm", "Community"],
    ["BtQuest", "Quest"],
    ["BtMobbook", "MonsterBook"],
    ["BtMessenger", "Messenger"],
  ],
};

/** Original 008d01b2 status controls and 008d850b gauge composition. */
export function layoutHud(panel, index) {
  panel.element.style.pointerEvents = "none";
  panel.image("base/backgrnd", 0, 529);
  layoutGauges(panel);
  for (const [path, x, y, target] of HUD_BUTTONS) {
    panel.button(path, x, y, {
      label:
        target === "Alert GM" ? target : index.help[target]?.title || target,
      action: () => panel.owner.activate(target),
    });
  }
  panel.quickControl = panel.button("QuickSlot", 768, HUD_TOP, {
    label: "Quick slots",
    action: () => panel.owner.activate("QuickSlot"),
  });
  panel.quickDownControl = panel.button("QuickSlotD", 768, HUD_TOP, {
    label: "Hide quick slots",
    action: () => panel.owner.activate("QuickSlot"),
  });
  panel.quickDownControl.setVisible(false);
}

export function layoutWindow(panel) {
  const name = panel.name;
  if (name === "UtilDlgEx" || name === "Quest") return layoutDialog(panel);
  if (name === "MiniMap") return layoutMinimap(panel);
  panel.image(`${name}/backgrnd`, 0, 0);
  if (MENUS[name]) return layoutMenu(panel);
  if (name === "KeyConfig") return layoutKeys(panel);
  if (name === "Item") return layoutInventory(panel);
  if (name === "Stat") return layoutStats(panel);
  if (name === "Skill") return layoutSkills(panel);
  if (name === "Equip") return layoutEquipment(panel);
  layoutOptions(panel);
}

function layoutMenu(panel) {
  const entries = MENUS[panel.name];
  for (let i = 0; i < entries.length; i++) {
    const [button, target] = entries[i];
    panel.button(`${panel.name}/${button}`, 6, 24 + i * 26, {
      label: target,
      action: () => panel.owner.activate(target),
    });
  }
}

/** Inventory type1: Tab2, width170, height19; 004dd790/004de15f/004dd903. */
function inventoryTabs(panel, branch, count, target = panel) {
  const tabs = [];
  panel.tabButtons = [];
  const left = tabParts(panel, "left", 3, 4);
  const span = branch === "Skill" ? 34 * count : 170;
  const width = Math.trunc((span - (count - 1) * 8 - 8) / count);
  const remainder = span - (width + 8) * count;
  let x = 7;
  const select = (selected, notify = true) => {
    showTabPart(left, selected === 0 ? 1 : 0);
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      tab.on.container.visible = i === selected;
      tab.off.container.visible = i !== selected;
      showTabPart(tab.fill, i === selected ? 1 : 0);
      showTabPart(tab.edge, i === selected ? 1 : i + 1 === selected ? 2 : 0);
      tab.button.setAttribute("aria-selected", String(i === selected));
    }
    if (target.selectedTab !== selected) {
      if (branch === "Item") target.inventoryStart = 0;
      else target.skillStart = 0;
    }
    target.selectedTab = selected;
    if (notify) target.owner.refreshProfilePanel(target);
  };
  for (let i = 0; i < count; i++) {
    const size = width + (i < remainder ? 1 : 0);
    const fill = tabParts(panel, "fill", x, size);
    const last = i === count - 1;
    const edge = tabParts(
      panel,
      last ? "right" : "middle",
      x + size,
      last ? 4 : 8,
    );
    const on = tabLabel(panel, `${branch}/Tab/enabled/${i}`, x, size);
    const off = tabLabel(panel, `${branch}/Tab/disabled/${i}`, x, size);
    const button = panel.localButton(`Tab ${i + 1}`, x, 23, () => select(i));
    button.className = "maple-ui-hit";
    button.setAttribute("aria-label", `${branch} tab ${i + 1}`);
    button.setAttribute("role", "tab");
    button.textContent = "";
    button.style.width = `${size}px`;
    button.style.height = "19px";
    tabs.push({ on, off, fill, edge, button });
    panel.tabButtons.push(button);
    x += size + 8;
  }
  target.tabButtons = panel.tabButtons;
  select(0, false);
}

function tabParts(panel, part, x, width) {
  const sprites = [];
  for (let state = 0; state < (part === "middle" ? 3 : 2); state++) {
    const path = `Tab2/${part}${state}`;
    const sprite = panel.image(path, x, 23);
    sprite.container.scale.x = width / panel.assets[path].width;
    sprites.push(sprite);
  }
  return sprites;
}

function showTabPart(sprites, state) {
  for (let i = 0; i < sprites.length; i++) {
    sprites[i].container.visible = i === state;
  }
}

function tabLabel(panel, path, x, width) {
  const asset = panel.assets[path];
  return panel.image(
    path,
    x + Math.trunc(width / 2) - Math.trunc(asset.width / 2),
    23 + 2 + 9 - Math.trunc(asset.height / 2),
  );
}

function layoutInventory(panel) {
  inventoryTabs(panel, "Item", 5);
  panel.inventoryStart = 0;
  panel.inventoryReady = true;
  // 0081dc20 draws formatted currency with its right edge at138, y266.
  panel.currencyValue = panel.text("", 26, 266, 112);
  panel.currencyValue.setAttribute("aria-label", "Mesos");
  panel.currencyValue.style.cssText +=
    "text-align:right;white-space:nowrap;overflow:hidden;line-height:13px;";
  panel.listen(panel.element, "wheel", (event) => {
    event.preventDefault();
    if (panel.fullSkin?.container.visible) return;
    const maximum = Math.max(0, (panel.inventoryCount || 0) - 24);
    panel.inventoryStart = Math.max(
      0,
      Math.min(maximum, panel.inventoryStart + (event.deltaY > 0 ? 4 : -4)),
    );
    panel.owner.refreshProfilePanel(panel);
  });
  // 0092c2e8 proves +0x590 is close-X, not width; 0081e3a6 uses close-X minus15.
  panel.gatherControl = panel.button("Item/BtGather", panel.width - 32, 6, {
    label: "Gather items — slot ordering is not available offline",
    action: null,
    disabled: true,
  });
  // 0081c6c9 places BtFull/BtSmall thirty pixels left of the close control.
  panel.fullControl = panel.button("Item/BtFull", panel.width - 47, 6, {
    label: "Expand inventory",
    action: () => panel.owner.toggleInventorySkin(panel),
  });
  panel.smallControl = panel.button("Item/BtSmall", panel.width - 47, 6, {
    label: "Compact inventory",
    action: () => panel.owner.toggleInventorySkin(panel),
  });
  panel.smallControl.setVisible(false);
}

function layoutStats(panel) {
  panel.basicStat = panel.image("Stat/basicStat", 8, 195);
  panel.basicStat.container.visible = false;
  panel.statControls = [];
  panel.statValues = new Map();
  panel.statOverlays = ["STR", "DEX", "INT", "LUK"].map((name, index) => {
    const sprite = panel.image(`Stat/Disabled/${name}`, 8, 244 + 18 * index);
    sprite.container.visible = false;
    return sprite;
  });
  // 008c79f5 exact AP increment controls: (153,117/135/247/265/283/301).
  for (const y of [117, 135, 247, 265, 283, 301]) {
    const control = panel.button("Stat/BtApUp", 153, y, {
      label:
        "AP allocation unavailable; local profile does not invent AP grants",
      action: null,
      disabled: true,
    });
    panel.statControls.push(control);
  }
  panel.button("Stat/BtDetail", 12, 318, {
    label: "Detailed derived statistics are unavailable in the local profile.",
    disabled: true,
  });
}

function layoutSkills(panel) {
  panel.tabButtons = [];
  panel.skillStart = 0;
  panel.skillsReady = true;
  panel.listen(panel.element, "wheel", (event) => {
    event.preventDefault();
    panel.skillStart = Math.max(
      0,
      Math.min(
        Math.max(0, (panel.skillCount || 0) - 4),
        panel.skillStart + (event.deltaY > 0 ? 1 : -1),
      ),
    );
    panel.owner.refreshProfilePanel(panel);
  });
}

export function updateSkillTabs(panel, books) {
  const signature = books.join(",");
  if (panel.skillBooksSignature === signature) return;
  panel.skillBooksSignature = signature;
  panel.skillTabLayer?.destroy();
  panel.tabButtons = [];
  panel.selectedTab = 0;
  panel.skillStart = 0;
  if (books.length === 0) return;
  const layer = panel.layer("Skill books");
  panel.skillTabLayer = layer;
  // This original normal-Skill window authors five tab glyphs; extended job UIs are separate consumers.
  inventoryTabs(layer, "Skill", Math.min(5, books.length), panel);
}

function layoutEquipment(panel) {
  panel.equipmentReady = true;
  panel.button("Equip/BtDetail", 12, 278, {
    label: "Additional equipment slots are unavailable in the local profile.",
    disabled: true,
  });
}

function layoutDialog(panel) {
  panel.image("UtilDlgEx/t", 0, 0);
  for (let i = 0; i < 6; i++) panel.image("UtilDlgEx/c", 0, 28 + i * 20);
  panel.image("UtilDlgEx/s", 0, 148);
  panel.content = panel.contentArea(24, 30, 480, 132);
  panel.content.classList.add("maple-ui-dialog-text");
  panel.button("UtilDlgEx/BtClose", 425, 176, {
    label: "Close dialogue",
    action: () => panel.owner.close(panel.name),
  });
}

/** Original nine-slice artwork, browser-policy size; map imagery is loaded separately if packaged. */
function layoutMinimap(panel) {
  const prefix = "MiniMap/MinMap/";
  const positions = [
    ["nw", 0, 0],
    ["n", 9, 0],
    ["ne", 251, 0],
    ["w", 0, 20],
    ["c", 9, 20],
    ["e", 251, 20],
    ["sw", 0, panel.height - 9],
    ["s", 9, panel.height - 9],
    ["se", 251, panel.height - 9],
  ];
  for (const [part, x, y] of positions) {
    const sprite = panel.image(prefix + part, x, y);
    const asset = panel.assets[prefix + part];
    if (["n", "c", "s"].includes(part)) {
      sprite.container.scale.x = 242 / asset.width;
    }
    if (["w", "c", "e"].includes(part)) {
      sprite.container.scale.y = (panel.height - 29) / asset.height;
    }
  }
  // 00858344 non-minimized button: x=windowWidth-42, y=6.
  panel.button("MiniMap/BtMap", panel.width - 42, 6, {
    label: "World-map routing unavailable",
    action: () =>
      panel.owner.notice(
        "World-map route and teleport authorization require the unavailable server.",
      ),
  });
  panel.mapLabel = panel.text("Original minimap skin", 12, 28, 235);
  panel.mapStatus = panel.text("Map image unavailable", 12, 168, {
    width: 235,
    className: "maple-ui-unavailable",
  });
}

function layoutOptions(panel) {
  panel.text(
    "Original options skin\n\nUnrecovered original controls are non-interactive. Browser audio controls are explicitly separate; no original preference persistence is claimed.",
    14,
    40,
    { width: panel.width - 28, className: "maple-ui-unavailable" },
  );
}
