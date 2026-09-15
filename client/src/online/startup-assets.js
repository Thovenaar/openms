import { array, entries } from "../rendering/stream-validation.js";

/** Browser preload policy: common controls and the original starter/town working set. */
const COMMON_UI = [
  "StatusBar",
  "TemporaryStatView",
  "Cursor",
  "Basic",
  "ToolTip",
  "TradingRoom",
  "Login",
  "LoginScene",
  "MiniMap",
  "UtilDlgEx",
  "Item",
  "Equip",
  "Stat",
  "Skill",
  "Quest",
  "QuestAlarm",
  "KeyConfig",
  "GameMenu",
  "Shop",
  "Trunk",
];
const COMMON_EFFECTS = [
  "Teleport",
  "LevelUp",
  "QuestClear",
  "Enchant/Success",
  "Enchant/Failure",
  "UI/tutorial.img/25",
  "UI/tutorial.img/21",
  "UI/tutorial.img/22",
  "UI/tutorial.img/27",
];
const COMMON_SOUNDS = {
  UI: [
    "BtMouseClick",
    "BtMouseOver",
    "DlgNotice",
    "CharSelect",
    "DragStart",
    "DragEnd",
    "Tab",
  ],
  Game: [
    "GameIn",
    "Portal",
    "Portal2",
    "Jump",
    "PickUpItem",
    "DropItem",
    "LevelUp",
    "QuestClear",
  ],
};

/** The catalog is validated by startup. Missing optional original artwork stays on demand. */
export function planStartupAssets(plan, catalog) {
  for (const name of COMMON_UI) plan.add(catalog.ui.bundles[name], "bundle");
  for (const name of COMMON_EFFECTS) {
    plan.add(catalog.audiovisual.effects[name]?.bundle, "bundle");
  }
  plan.add(catalog.audiovisual.combat?.digits, "bundle");
  plan.add(catalog.ui.avatar.projectiles, "bundle");
  plan.add(catalog.ui.npcWorld?.markers, "bundle");
  plan.add(catalog.ui.npcWorld?.speech?.bundle, "bundle");
  plan.add(catalog.ui.speechBubbles?.bundle, "bundle");
  planCommonAudio(plan, catalog.audiovisual);
  planStarterAvatars(plan, catalog.ui);
  for (const id of new Set([catalog.defaultMap, "100000000", "104000000"])) {
    plan.add(catalog.maps[id], "map");
    plan.add(catalog.ui.minimaps[id]?.descriptor, "bundle");
    plan.add(catalog.audiovisual.maps[id]?.bgm);
  }
}

function planCommonAudio(plan, audiovisual) {
  plan.add(audiovisual.login?.bgm);
  for (const category of ["UI", "Game"]) {
    for (const name of COMMON_SOUNDS[category]) {
      plan.add(audiovisual.sounds[category]?.[name]);
    }
  }
}

/** Base creation looks, skin tones and the compositor's original uncovered-clothing defaults. */
function planStarterAvatars(plan, ui) {
  const ids = new Set([1040036, 1041046, 1060026, 1061039]);
  for (const [, skin] of entries(ui.avatar.skins, 256)) {
    ids.add(skin.body);
    ids.add(skin.head);
  }
  for (const [, gender] of entries(ui.characterCreate.genders, 2)) {
    for (const kind of [
      "face",
      "hairBase",
      "top",
      "bottom",
      "shoes",
      "weapon",
    ]) {
      for (const id of array(gender[kind], 64)) ids.add(id);
    }
  }
  for (const id of ids) plan.add(ui.avatar.entries[id]?.descriptor, "bundle");
}
