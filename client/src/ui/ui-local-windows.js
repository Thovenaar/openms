import { layoutWorldMap } from "./ui-worldmap.js";
import { layoutUserInfo } from "./ui-userinfo.js";
import { layoutQuestAlarm } from "./ui-quest-alarm.js";
import {
  layoutUserList,
  layoutMessenger,
  layoutPartySearch,
  layoutFamily,
  layoutTitle,
} from "./ui-social.js";
import { layoutCashShop } from "./ui-cash-shop.js";
import { layoutMarket } from "./ui-market.js";
import { layoutMonsterBook } from "./ui-monster-book.js";
import { layoutSkillMacros } from "./ui-skill-macros.js";
import { layoutShop } from "./ui-shop.js";
import { layoutStorage } from "./ui-storage.js";
import { layoutEnhancement } from "./ui-enhancement.js";
import { layoutTradingRoom } from "./ui-trading-room.js";
import { layoutFamilyTree } from "./ui-family-tree.js";
import { layoutPartyHP } from "./ui-party-hp.js";
import {
  layoutTradeInvitation,
  layoutSocialInvitation,
} from "./ui-trade-invitation.js";

export const LOCAL_WINDOW_NAMES = Object.freeze([
  "WorldMap",
  "UserList",
  "UserInfo",
  "QuestAlarm",
  "MonsterBook",
  "PartySearch",
  "Family",
  "Title",
  "Messenger",
  "CashShop",
  "ITC",
  "SkillMacro",
  "Shop",
  "Trunk",
  "EnchantSkill",
  "TradingRoom",
  "TradeInvitation",
  "SocialInvitation",
  "FamilyTree",
  "PartyHP",
]);
const NATIVE_SIZES = Object.freeze({
  WorldMap: [666, 524],
  UserInfo: [275, 199],
  QuestAlarm: [223, 20],
  UserList: [312, 389],
  Messenger: [295, 364],
  PartySearch: [305, 407],
  Family: [224, 392],
  Title: [260, 374],
  CashShop: [800, 600],
  ITC: [800, 600],
  SkillMacro: [207, 289],
  Shop: [463, 339],
  Trunk: [463, 318],
  EnchantSkill: [178, 206],
  TradingRoom: [565, 474],
  TradeInvitation: [208, 37],
  SocialInvitation: [208, 37],
  FamilyTree: [578, 386],
  PartyHP: [150, 25],
});

export function localWindowSize(name, resource) {
  if (!LOCAL_WINDOW_NAMES.includes(name)) return null;
  if (NATIVE_SIZES[name]) return NATIVE_SIZES[name];
  const background = resource.manifest.metadata.assets[`${name}/backgrnd`];
  if (!background) {
    throw new Error(`Missing original ${name} window background`);
  }
  return [background.width, background.height];
}

function attachCleanup(panel, cleanup) {
  if (typeof cleanup !== "function") return;
  panel.cleanups.push(cleanup);
  if (cleanup.refresh) panel.localRefresh = cleanup.refresh;
}

/** Each native surface owns its artwork, controls, subscription and child layers. */
export function layoutLocalWindow(panel) {
  const owner = panel.owner;
  switch (panel.name) {
    case "WorldMap":
      layoutWorldMap(panel);
      break;
    case "UserInfo":
      layoutUserInfo(panel);
      break;
    case "QuestAlarm":
      panel.nativeClose = true;
      attachCleanup(panel, layoutQuestAlarm(panel, owner.quests));
      break;
    case "MonsterBook":
      layoutMonsterBook(panel, owner.hooks.monsterBook());
      break;
    case "SkillMacro":
      layoutSkillMacros(panel, owner.hooks.macros());
      break;
    case "CashShop":
      panel.noDrag = true;
      panel.nativeClose = true;
      panel.operationOwner = owner.hooks.cashShop();
      layoutCashShop(panel, panel.operationOwner);
      break;
    case "ITC":
      panel.operationOwner = owner.hooks.market();
      layoutMarket(panel, panel.operationOwner);
      break;
    case "Shop":
      panel.nativeClose = true;
      panel.operationOwner = owner.hooks.shop();
      layoutShop(panel, panel.operationOwner);
      break;
    case "Trunk":
      panel.nativeClose = true;
      panel.operationOwner = owner.hooks.storage();
      layoutStorage(panel, panel.operationOwner);
      break;
    case "EnchantSkill":
      panel.nativeClose = true;
      panel.operationOwner = owner.hooks.skillUtilities().enhancement;
      layoutEnhancement(panel);
      break;
    case "TradingRoom":
      panel.nativeClose = true;
      panel.operationOwner = owner.hooks.trade();
      layoutTradingRoom(panel, panel.operationOwner);
      break;
    default:
      return layoutSocialWindow(panel);
  }
  return true;
}

function layoutSocialWindow(panel) {
  const owner = panel.owner;
  switch (panel.name) {
    case "UserList":
      layoutUserList(panel, owner.hooks.social());
      break;
    case "Messenger":
      layoutMessenger(panel, owner.hooks.social());
      break;
    case "PartySearch":
      layoutPartySearch(panel, owner.hooks.social());
      break;
    case "Family":
      layoutFamily(panel, owner.hooks.social());
      break;
    case "FamilyTree":
      panel.nativeClose = true;
      layoutFamilyTree(panel, owner.hooks.social());
      break;
    case "PartyHP":
      panel.nativeClose = true;
      layoutPartyHP(panel, owner.hooks.social());
      break;
    case "TradeInvitation":
      panel.operationOwner = owner.hooks.trade();
      layoutTradeInvitation(panel, panel.operationOwner);
      break;
    case "SocialInvitation":
      layoutSocialInvitation(panel, owner.socialInvitation);
      break;
    case "Title":
      layoutTitle(panel, owner.hooks.social());
      break;
    default:
      return false;
  }
  return true;
}
