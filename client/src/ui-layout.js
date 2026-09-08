// Recovered 008d01b2 control-create calls, reference screen coordinates (800 x 600).
const HUD_BUTTONS = [
  ["EquipKey", 618, 515, "Equip"],
  ["InvenKey", 648, 515, "Item"],
  ["StatKey", 678, 515, "Stat"],
  ["SkillKey", 708, 515, "Skill"],
  ["KeySet", 738, 515, "KeyConfig"],
  ["BtShop", 573, 543, "shop"],
  ["BtShort", 629, 543, "ShortCut"],
  ["BtMenu", 685, 543, "GameMenu"],
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

/** HUD unknown values are unavailable, not zero-valued gauges or invented character text. */
export function layoutHud(panel, index) {
  panel.element.style.pointerEvents = "none";
  panel.image("base/backgrnd", 0, 529);
  const block = panel.text(
    "OFFLINE RECONSTRUCTION — HP / MP / EXP / level / mesos unavailable",
    8,
    564,
    { width: 545, className: "maple-ui-status" },
  );
  block.style.pointerEvents = "auto";
  for (const [path, x, y, target] of HUD_BUTTONS) {
    panel.button(path, x, y, {
      label: index.help[target]?.title || target,
      action: () => panel.owner.activate(target),
    });
  }
  const quick = panel.image("base/quickSlot", 649, 435);
  quick.container.visible = false;
  panel.button("QuickSlot", 768, 515, {
    label: "Quick slots — assignments unavailable",
    action: () => {
      quick.container.visible = !quick.container.visible;
      panel.owner.showTooltip(
        "Original quick-slot skin; no server key assignments",
        590,
        420,
      );
    },
  });
  panel.localButton("UI help", 8, 535, () =>
    panel.owner.notice(
      "Browser presentation controls: I inventory, E equipment, S stats, K skills, M minimap, F10 key config, Escape close/menu. Server data is unavailable.",
    ),
  );
}

export function layoutWindow(panel) {
  const name = panel.name;
  if (name === "UtilDlgEx") return layoutDialog(panel);
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
function inventoryTabs(panel, branch, count) {
  const tabs = [];
  const left = tabParts(panel, "left", 3, 4);
  const width = Math.trunc((170 - (count - 1) * 8 - 8) / count);
  const remainder = 170 - (width + 8) * count;
  let x = 7;
  const select = (selected) => {
    showTabPart(left, selected === 0 ? 1 : 0);
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      tab.on.container.visible = i === selected;
      tab.off.container.visible = i !== selected;
      showTabPart(tab.fill, i === selected ? 1 : 0);
      showTabPart(tab.edge, i === selected ? 1 : i + 1 === selected ? 2 : 0);
      tab.button.setAttribute("aria-selected", String(i === selected));
    }
    panel.selectedTab = selected;
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
    x += size + 8;
  }
  select(0);
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
  panel.text(
    "Inventory unavailable\n\nSlots and quantities require a server session. No empty-inventory claim is made.",
    12,
    65,
    { width: 150, className: "maple-ui-unavailable" },
  );
  // 0092c2e8 proves +0x590 is close-X, not width; 0081e3a6 uses close-X minus15.
  panel.gatherControl = panel.button("Item/BtGather", panel.width - 32, 6, {
    label: "Gather requires server inventory",
    action: null,
    disabled: true,
  });
  // 0081c6c9 places BtFull/BtSmall thirty pixels left of the close control.
  panel.fullControl = panel.button("Item/BtFull", panel.width - 47, 6, {
    label: "Preview full inventory skin",
    action: () => panel.owner.toggleInventorySkin(panel),
  });
  panel.smallControl = panel.button("Item/BtSmall", panel.width - 47, 6, {
    label: "Preview small inventory skin",
    action: () => panel.owner.toggleInventorySkin(panel),
  });
  panel.smallControl.setVisible(false);
}

function layoutStats(panel) {
  panel.text(
    "Character statistics unavailable\n\nNo HP, MP, AP, level, job or ability values are inferred from artwork.",
    12,
    48,
    { width: 150, className: "maple-ui-unavailable" },
  );
  // 008c79f5 exact AP increment controls: (153,117/135/247/265/283/301).
  for (const y of [117, 135, 247, 265, 283, 301]) {
    panel.button("Stat/BtApUp", 153, y, {
      label: "AP allocation requires server state",
      action: null,
      disabled: true,
    });
  }
  panel.button("Stat/BtDetail", 12, 318, {
    label: "Static detail skin",
    action: () => panel.owner.showDetail(panel, "Stat/backgrnd2"),
  });
}

function layoutSkills(panel) {
  inventoryTabs(panel, "Skill", 5);
  panel.text(
    "Skills / SP unavailable\n\nJob advancement, learned skills, ranks and cooldowns require server state.",
    12,
    70,
    { width: 150, className: "maple-ui-unavailable" },
  );
  panel.button("Skill/BtSpUp", 150, 120, {
    label: "Skill allocation requires server state",
    action: null,
    disabled: true,
  });
}

function layoutEquipment(panel) {
  panel.text("Live equipment unavailable", 10, 30, {
    width: 155,
    className: "maple-ui-unavailable",
  });
  panel.localButton("Inspect avatar artwork", 9, 245, () =>
    panel.owner.equipmentPreview(panel),
  );
  panel.button("Equip/BtDetail", 12, 278, {
    label: "Static detail skin",
    action: () => panel.owner.showDetail(panel, "Equip/FullBackgrnd"),
  });
}

/** Archive gallery is intentionally not presented as a recovered keyboard assignment layout. */
function layoutKeys(panel) {
  panel.text(
    "KEY CONFIG PRESENTATION — archive glyphs, not live bindings",
    14,
    26,
    { width: 600, className: "maple-ui-unavailable" },
  );
  panel.text(
    "Remap / defaults / delete / quick-slot assignment cannot be committed without recovered session state. I/E/S/K labels are static help; browser F10/M/Escape controls are not claimed original defaults.",
    18,
    165,
    { width: 590, className: "maple-ui-unavailable" },
  );
  const icons = Object.keys(panel.assets).filter((path) =>
    /^KeyConfig\/icon\/\d+$/.test(path),
  );
  const keys = Object.keys(panel.assets).filter((path) =>
    /^KeyConfig\/key\/\d+$/.test(path),
  );
  glyphGallery(panel, icons, {
    x: 20,
    y: 58,
    columns: 16,
    stepX: 36,
    stepY: 32,
  });
  glyphGallery(panel, keys, {
    x: 20,
    y: 264,
    columns: 16,
    stepX: 35,
    stepY: 17,
  });
  // Original 00832a43/ac6/b4c/bd5/c5e: x=8,58,112,177,260; y=236, including Basic/BtCancel2.
  panel.button("KeyConfig/BtOK", 8, 236, {
    label: "Close presentation; no keymap sent",
    action: () => panel.owner.close(panel.name),
  });
  panel.button("BtCancel2", 58, 236, {
    label: "Cancel presentation",
    action: () => panel.owner.close(panel.name),
  });
  panel.button("KeyConfig/BtDefault", 112, 236, {
    label: "Defaults unavailable",
    action: null,
    disabled: true,
  });
  panel.button("KeyConfig/BtDelete", 177, 236, {
    label: "Assignments unavailable",
    action: null,
    disabled: true,
  });
  panel.button("KeyConfig/BtQuickSlot", 260, 236, {
    label: "Quick-slot assignment unavailable",
    action: () =>
      panel.owner.notice(
        "Original quick-slot assignment needs live keymap/session state. The HUD offers a skin-only preview.",
      ),
  });
}

function glyphGallery(panel, paths, layout) {
  if (paths.length > 128) throw new Error("UI glyph gallery exceeds bound");
  for (let i = 0; i < paths.length; i++) {
    panel.image(
      paths[i],
      layout.x + (i % layout.columns) * layout.stepX,
      layout.y + Math.floor(i / layout.columns) * layout.stepY,
    );
  }
}

function layoutDialog(panel) {
  panel.image("UtilDlgEx/t", 0, 0);
  for (let i = 0; i < 6; i++) panel.image("UtilDlgEx/c", 0, 28 + i * 20);
  panel.image("UtilDlgEx/s", 0, 148);
  panel.message = panel.text(
    panel.owner.dialogText ||
      "Server dialogue is unavailable. This is original dialog chrome only; no script branch or NPC speech is invented.",
    24,
    38,
    { width: 480, className: "maple-ui-dialog-text" },
  );
  panel.button("UtilDlgEx/BtClose", 425, 176, {
    label: "Close server-unavailable inspection",
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
