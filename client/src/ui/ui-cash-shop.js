import { replaceIcons, drawItemCount } from "./ui-icons.js";
import { NativeScrollbar } from "./ui-scrollbar.js";
import { CashAvatarPreview } from "./ui-cash-preview.js";
import {
  cashPurchaseDialog,
  cashGiftDialog,
  cashGiftReceipt,
  cashSearchDialog,
} from "./ui-cash-dialogs.js";
import {
  cashText,
  cashInput,
  cashTemplate,
  cashTooltip,
  cashMessage,
  cashOutcome,
  closeCashDialog,
  cashDialogKey,
} from "./ui-cash-modal.js";
import { cashGiftable } from "../items/cash-commerce.js";

const MAX_OFFERS = 20000;
const PAGE_ITEMS = 10;
const TABS = [
  "Main",
  "Event",
  "Equip",
  "Use",
  "Set-Up",
  "Etc.",
  "Pet",
  "Package",
  "Wish List",
];
const TAB_CATEGORIES = [8, 1, 2, 3, 4, 5, 6, 7, 9];
// 004b6b3b / original DWORD table00bd8acc: hit X before/after the selected category.
const TAB_HIT_X = [
  [57, 69],
  [107, 119],
  [157, 169],
  [209, 220],
  [260, 272],
  [311, 323],
  [362, 374],
  [3, 3],
  [451, 451],
];
const BAG_LABELS = ["Equip", "Use", "Set-Up", "Etc.", "Cash"];

function surface(panel, name, rect) {
  const layer = panel.layer(name);
  layer.width = rect.width;
  layer.height = rect.height;
  layer.position(rect.x, rect.y);
  layer.element.style.width = `${rect.width}px`;
  layer.element.style.height = `${rect.height}px`;
  layer.element.style.pointerEvents = "auto";
  return layer;
}

/** 00468f3e is a distinct800x600 stage, not a draggable UIWindow branch. */
export function layoutCashShop(panel, service) {
  panel.cashService = service;
  panel.nativeClose = true;
  panel.noDrag = true;
  panel.cashTab = panel.owner.restoreTab(
    "CashShop.category",
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
  );
  panel.cashSubcategory = restoreCashSubcategory(panel);
  panel.cashPage = 0;
  panel.cashInventoryType = panel.owner.restoreTab(
    "CashShop.inventory",
    [1, 2, 3, 4, 5],
  );
  panel.cashLockerPage = 0;
  panel.cashBagPage = 0;
  panel.cashCurrency = "credit";
  panel.cashSelected = null;
  panel.cashActionIndex = -1;
  panel.cashSelections = [];
  panel.cashPendingList = null;
  panel.cashPageCount = 1;
  panel.cashSearch = "";
  panel.cashMaximumPrice = null;
  panel.cashOffers = Object.values(service.catalog.ui.cashShop.commodities);
  if (panel.cashOffers.length > MAX_OFFERS) {
    throw new Error("Cash offer display bound");
  }
  composeCashSurfaces(panel);
  composeCashControls(panel);
  panel.localRefresh = () => refreshCashShop(panel);
  panel.cashNextGift = () => {
    const gift = service.snapshot().gifts[0];
    if (gift && !panel.cashDialog) cashGiftReceipt(panel, gift);
  };
  panel.cashKey = (event) => cashKey(panel, event);
  panel.cashOpenGift = (sn, recipient, targetId) =>
    cashGiftDialog(panel, sn, recipient, targetId);
  panel.cashUpdate = (ms) => panel.cashPreview.update(ms);
  panel.canClose = () =>
    !service.pending && !service.store.profileTransactionPending;
  panel.requestClose = () => service.close().ok;
  panel.cleanups.push(service.subscribe(panel.localRefresh));
  panel.cleanups.push(() => {
    panel.cashDialog?.controller.abort();
  });
  refreshCashShop(panel);
  panel.cashNextGift();
}

function composeCashSurfaces(panel) {
  const job = panel.cashService.store.profile.job;
  const background =
    Math.floor(job / 1000) === 1
      ? "backgrnd1"
      : job === 2000 || Math.floor(job / 100) === 21
        ? "backgrnd2"
        : "backgrnd";
  panel.image(`Base/${background}`, 0, 0);
  panel.cashPreview = new CashAvatarPreview(panel);
  panel.cashList = surface(panel, "Cash commodity list", {
    x: 275,
    y: 95,
    width: 412,
    height: 430,
  });
  panel.cashList.listen(panel.cashList.element, "wheel", (event) => {
    if (!event.deltaY || panel.cashDialog) return;
    event.preventDefault();
    moveCashPage(panel, Math.sign(event.deltaY));
  });
  panel.cashLocker = surface(panel, "Cash Inventory", {
    x: -1,
    y: 318,
    width: 256,
    height: 104,
  });
  panel.cashBag = surface(panel, "Character cash items", {
    x: 0,
    y: 426,
    width: 246,
    height: 163,
  });
}

function exitCashShop(panel) {
  if (!closeCashDialog(panel)) return;
  const result = panel.cashService.close();
  if (!result.ok) return;
  panel.owner.close(panel.name);
}

function help(panel, name, prerequisite = "") {
  const record = panel.cashService.catalog.ui.cashShop.help[name];
  const text = record
    ? `${record.Title}\n${record.Desc.replaceAll("\\n", "\n")}`
    : "";
  return prerequisite ? `${text}\n${prerequisite}` : text;
}

function composeCashControls(panel) {
  composeAvatarControls(panel);
  composeCashStatusControls(panel);
  panel.button("CSItemSearch/BtSearch", 690, 97, {
    label: "Search cash items",
    action: () => cashSearchDialog(panel),
  });
  panel.hit(
    "Best Item ranking",
    { x: 691, y: 122, width: 90, height: 382 },
    {},
    {
      tooltip:
        "Original purchase-ranking data has not been supplied; no local ranking is fabricated.",
    },
  );
  panel.cashBalanceLabels = ["credit", "prepaid", "points"].map((key, index) =>
    cashText(panel, "", { x: 359, y: 544 + 14 * index, width: 122 }, "#111"),
  );
  panel.cashName = cashText(
    panel,
    "",
    { x: 103, y: 273, width: 128, height: 15 },
    "#111",
  );
  panel.cashAccount = cashText(
    panel,
    "",
    { x: 103, y: 291, width: 128, height: 15 },
    "#111",
  );
  composeBagControls(panel);
  previewControls(panel);
}

function composeAvatarControls(panel) {
  panel.cashBuyAvatar = panel.button("CSChar/BtBuyAvatar", 16, 237, {
    label: "Buy equipped preview items",
    disabled: true,
    tooltip: help(panel, "BuyAvatar"),
    action: () => {
      const sns = [...panel.cashPreview.sns];
      if (sns.length) cashPurchaseDialog(panel, sns);
    },
  });
  panel.button("CSChar/BtDefaultAvatar", 101, 237, {
    label: "Restore original appearance",
    tooltip: help(panel, "DefaultAvatar"),
    action: () => panel.cashPreview.reset(),
  });
  panel.button("CSChar/BtTakeoffAvatar", 187, 237, {
    label: "Remove all preview equipment",
    tooltip: help(panel, "TakeoffAvatar"),
    action: () => panel.cashPreview.reset(true),
  });
}

function composeCashStatusControls(panel) {
  // 004bc3e4 status-local x248/289/330/378,y13/15; status origin254,530.
  panel.button("CSStatus/BtCharge", 502, 543, {
    label: "Charge cash",
    disabled: true,
    tooltip: help(
      panel,
      "Charge",
      "External payment service is not connected. Local simulation funding is outside the game UI.",
    ),
  });
  panel.button("CSStatus/BtCheck", 543, 543, {
    label: "Check cash balances",
    tooltip: help(panel, "Check"),
    action: () => refreshCashShop(panel),
  });
  panel.button("CSStatus/BtCoupon", 584, 543, {
    label: "Redeem coupon",
    disabled: true,
    tooltip: help(
      panel,
      "Coupon",
      "Coupon serial issuance and redemption authority are not connected.",
    ),
  });
  panel.button("CSStatus/BtExit", 632, 545, {
    label: "Exit Cash Shop",
    action: () => exitCashShop(panel),
  });
}

function previewControls(panel) {
  drawPreviewTabs(panel);
  panel.cashPreviewMode = () => drawPreviewMode(panel);
  drawPreviewMode(panel);
  // The authored speech icon and white edit strip are not an action/sort selector.
  const input = cashInput(
    panel,
    { x: 49, y: 215, width: 185, height: 14 },
    { label: "Preview speech", maxLength: 70 },
  );
  panel.cashChatInput = input;
  input.disabled = !panel.cashPreview.speech.resource;
  panel.hit(
    "Preview speech input",
    { x: 23, y: 214, width: 20, height: 16 },
    { click: () => input.focus() },
  );
}

/**00468fae initially enables preview;004732a0 and004ac31e toggle input, never hide the actor. */
function drawPreviewMode(panel) {
  panel.cashPreviewModeLayer?.destroy();
  const layer = panel.layer("Preview input mode");
  panel.cashPreviewModeLayer = layer;
  const enabled = panel.cashPreview.enabled;
  const path = `Base/PreviewOnOff/${enabled ? "On" : "Off"}/0`;
  const asset = layer.assets[path];
  //004ad51e supplies the original layer centers (130,120)/(122,18).
  layer.image(
    path,
    (enabled ? 130 : 122) - Math.trunc(asset.width / 2),
    (enabled ? 120 : 18) - Math.trunc(asset.height / 2),
  );
  for (const [name, rect] of [
    ["Preview input", { x: 95, y: 5, width: 30, height: 25 }],
    ["Preview scene", { x: 24, y: 40, width: 212, height: 165 }],
  ]) {
    const button = layer.hit(name, rect, {
      pointerdown: (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        panel.cashChatInput.blur();
        panel.cashPreview.setEnabled(!enabled);
      },
    });
    button.setAttribute("aria-pressed", String(enabled));
  }
}

/** 004ab446: CCtrlTab1004,type3,(141,11),width115; 004abd9c selects Base/Preview/%d. */
function drawPreviewTabs(panel) {
  panel.cashPreviewTabs?.destroy();
  const layer = panel.layer("Preview backgrounds");
  panel.cashPreviewTabs = layer;
  const selected = panel.cashPreview.backgroundIndex;
  // 004de15f variable glyph widths: first inset10, glyph width-4, separator12, end6.
  previewTabPart(layer, selected === 0 ? "Tab4/left1" : "Tab4/left0", 141, 10);
  let x = 151;
  for (let index = 0; index < 3; index++) {
    const active = selected === index;
    const path = `Base/Tab/${active ? "Enable" : "Disable"}/${index}`;
    const asset = layer.assets[path];
    const width = asset.width - 4;
    previewTabPart(layer, active ? "Tab4/fill1" : "Tab4/fill0", x, width);
    previewTabPart(
      layer,
      `Tab4/${index === 2 ? "right" : "middle"}${active ? 1 : selected === index + 1 ? 2 : 0}`,
      x + width,
      index === 2 ? 6 : 12,
    );
    // 004dd903: integer-centered glyph, type3 has no additional Y offset.
    layer.image(
      path,
      x + Math.trunc(width / 2) - Math.trunc(asset.width / 2),
      25 - Math.trunc(asset.height / 2),
    );
    const button = layer.hit(
      `Preview background ${index + 1}`,
      { x: x - 2, y: 15, width: width + 5, height: 24 },
      {
        pointerdown: (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          panel.cashPreview.setBackground(index);
          panel.owner.sound("Tab");
          drawPreviewTabs(panel);
        },
      },
    );
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(active));
    x += width + 12;
  }
}

function previewTabPart(layer, path, x, width) {
  const sprite = layer.image(path, x, 11);
  sprite.container.scale.x = width / layer.assets[path].width;
}

function composeBagControls(panel) {
  const locker = panel.cashLocker;
  panel.cashLockerScroll = new NativeScrollbar(
    locker,
    { x: 231, y: 31, extent: 67, style: 0 },
    (position) => {
      panel.cashLockerPage = position;
      refreshCashBags(panel);
    },
  );
  const bag = panel.cashBag;
  panel.cashBagScroll = new NativeScrollbar(
    bag,
    { x: 160, y: 54, extent: 102, style: 0 },
    (position) => {
      panel.cashBagPage = position;
      refreshCashBags(panel);
    },
  );
  for (let type = 1; type <= 4; type++) {
    const branch = ["BtExEquip", "BtExConsume", "BtExInstall", "BtExEtc"][
      type - 1
    ];
    bag.button(`CSInventory/${branch}`, 176, 28 + (type - 1) * 26, {
      label: `Expand ${BAG_LABELS[type - 1]} inventory`,
      tooltip: help(panel, branch.slice(2)),
      action: () => expandInventory(panel, type),
      disabled: panel.cashService.store.profile.inventorySlots[type - 1] >= 96,
    });
  }
  bag.button("CSInventory/BtExTrunk", 176, 132, {
    label: "Expand storage",
    disabled: true,
    tooltip:
      "The original account storage inventory and its expansion authority are not loaded.",
  });
}

async function expandInventory(panel, type) {
  try {
    const accepted = await panel.owner.prompt({
      kind: "confirm",
      text: `Expand ${BAG_LABELS[type - 1]} inventory by 4 slots for 4,000 NX?`,
      owner: panel,
    });
    if (!accepted || panel.disposed) return;
    await cashOutcome(
      panel,
      panel.cashService.expandInventory({ type, currency: panel.cashCurrency }),
    );
  } catch (error) {
    if (!panel.disposed) cashMessage(panel, error.message);
  }
}

function selectedOffers(panel) {
  const category = TAB_CATEGORIES[panel.cashTab];
  const wishlist = new Set(panel.cashService.store.profile.cash.wishlist);
  const search = panel.cashSearch.toLocaleLowerCase();
  const offers = panel.cashOffers.filter((offer) => {
    if (!offer.onSale) return false;
    if (search) return matchesCashSearch(panel, offer, search);
    if (panel.cashTab === 0) return false;
    if (panel.cashTab === 8) return wishlist.has(offer.sn);
    if (offer.category !== category) return false;
    if (
      panel.cashSubcategory >= 0 &&
      offer.subcategory !== panel.cashSubcategory
    ) {
      return false;
    }
    return (
      panel.cashMaximumPrice === null || offer.price <= panel.cashMaximumPrice
    );
  });
  offers.sort((a, b) => b.priority - a.priority || a.sn - b.sn);
  return offers;
}

function matchesCashSearch(panel, offer, search) {
  return (
    (cashTemplate(panel, offer.itemId)?.name ?? "")
      .toLocaleLowerCase()
      .includes(search) &&
    (panel.cashMaximumPrice === null || offer.price <= panel.cashMaximumPrice)
  );
}

export function refreshCashShop(panel) {
  if (panel.disposed) return;
  const snapshot = panel.cashService.snapshot();
  if (snapshot.closed) return;
  panel.cashPreview.refreshBuyControl();
  ["credit", "prepaid", "points"].forEach((key, index) => {
    panel.cashBalanceLabels[index].textContent =
      snapshot.balances[key].toLocaleString();
  });
  panel.cashName.textContent = snapshot.self.name;
  // Offline profile IDs are not Nexon IDs. Leave the native account field empty, not fabricated.
  panel.cashAccount.textContent = "";
  refreshCashTabs(panel);
  const offers = selectedOffers(panel);
  panel.cashPage = Math.min(
    panel.cashPage,
    Math.max(0, Math.ceil(offers.length / PAGE_ITEMS) - 1),
  );
  const visible = offers.slice(
    panel.cashPage * PAGE_ITEMS,
    (panel.cashPage + 1) * PAGE_ITEMS,
  );
  const pages = Math.max(1, Math.ceil(offers.length / PAGE_ITEMS));
  const records = visible.map((offer) => ({
    template: cashTemplate(panel, offer.itemId),
    offer,
  }));
  if (!records.length) records.push({ template: null, empty: true });
  refreshCommodityList(panel, records, pages);
  refreshCashBags(panel);
}

/** Retain the committed DOM, hit targets and raster until the replacement is complete. */
function refreshCommodityList(panel, records, pages) {
  panel.cashPendingList?.destroy();
  const stage = panel.cashList.layer("Cash commodity publication", {
    isolated: true,
  });
  stage.root.visible = false;
  stage.element.hidden = true;
  stage.cashSelections = [];
  stage.cashView = {
    cashTab: panel.cashTab,
    cashSubcategory: panel.cashSubcategory,
    cashSearch: panel.cashSearch,
    cashMaximumPrice: panel.cashMaximumPrice,
    cashPage: panel.cashPage,
    cashPageCount: pages,
  };
  const previousView = panel.cashPublication?.cashView;
  stage.resetSelection =
    !previousView ||
    Object.keys(stage.cashView).some(
      (key) => stage.cashView[key] !== previousView[key],
    );
  panel.cashPendingList = stage;
  panel.cashActionIndex = -1;
  const pressed = panel.owner.pressedControl;
  if (pressed && panel.cashList.element.contains(pressed.element)) {
    pressed.cancelPointer();
  }
  if (panel.cashList.element.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  panel.cashList.element.inert = true;
  publishCommodityList(panel, stage, records);
}

async function publishCommodityList(panel, stage, records) {
  try {
    await replaceIcons(stage, records, (layer, record, index) => {
      const row = drawCommodity(panel, layer, record, index);
      if (row) stage.cashSelections.push(row);
      if (row && stage.resetSelection) row.selection.container.visible = false;
    });
    if (panel.disposed || panel.cashPendingList !== stage) return;
    if (!stage.iconLayer) return;
    refreshPagination(panel, stage);
    stage.root.visible = true;
    // Shared ancestor rasters redraw on a later tick; this isolated canvas must be
    // painted before its new labels or hit targets become visible.
    stage.renderArtwork();
    panel.cashPublication?.destroy();
    panel.cashPublication = stage;
    panel.cashSelections = stage.cashSelections;
    panel.cashPageCount = stage.cashView.cashPageCount;
    if (
      stage.resetSelection ||
      !panel.cashSelections.some((row) => row.sn === panel.cashSelected)
    ) {
      panel.cashSelected = null;
    }
    stage.element.hidden = false;
  } catch (error) {
    if (!panel.disposed && panel.cashPendingList === stage) {
      panel.owner.report(error);
    }
  } finally {
    finishCommodityPublication(panel, stage);
  }
}

function finishCommodityPublication(panel, stage) {
  const committed = panel.cashPublication === stage;
  if (!committed) stage.destroy();
  if (panel.disposed || panel.cashPendingList !== stage) return;
  panel.cashPendingList = null;
  panel.cashList.element.inert = false;
  if (!committed && panel.cashPublication) {
    Object.assign(panel, panel.cashPublication.cashView);
    refreshCashTabs(panel);
  }
}

function refreshCashTabs(panel) {
  panel.cashTabs?.destroy();
  const layer = panel.layer("Cash categories");
  panel.cashTabs = layer;
  layer.image(`CSTab/Tab/${panel.cashTab + 1}`, 272, 17);
  for (let index = 0; index < TABS.length; index++) {
    if (index === panel.cashTab) continue;
    const category = TAB_CATEGORIES[index];
    const tabX =
      272 +
      TAB_HIT_X[category - 1][category > TAB_CATEGORIES[panel.cashTab] ? 1 : 0];
    layer.hit(
      TABS[index],
      { x: tabX, y: 39, width: 51, height: 31 },
      {
        click: () => selectCashTab(panel, index),
      },
    );
  }
  const categories = panel.cashService.catalog.ui.cashShop.categories.filter(
    (entry) => entry.category === TAB_CATEGORIES[panel.cashTab],
  );
  if (categories.length > 32) throw new Error("Cash subcategory bound");
  const width = Math.floor(506 / Math.max(1, categories.length));
  categories.forEach((entry, index) => {
    const rect = { x: 274 + index * width, y: 75, width, height: 18 };
    cashText(
      layer,
      entry.name,
      rect,
      panel.cashSubcategory === entry.subcategory ? "#ffff00" : "#fff",
    );
    layer.hit(entry.name, rect, {
      click: () => {
        panel.cashSubcategory = entry.subcategory;
        panel.owner.rememberTab("CashShop.subcategory", entry.subcategory);
        panel.cashPage = 0;
        refreshCashShop(panel);
      },
    });
  });
}

function selectCashTab(panel, index) {
  panel.cashTab = index;
  panel.owner.rememberTab("CashShop.category", index);
  panel.cashSubcategory = restoreCashSubcategory(panel);
  panel.cashSearch = "";
  panel.cashPage = 0;
  // Selection belongs to the committed list until its replacement publishes.
  panel.owner.sound("Tab");
  refreshCashShop(panel);
}

function restoreCashSubcategory(panel) {
  const choices = panel.cashService.catalog.ui.cashShop.categories
    .filter((entry) => entry.category === TAB_CATEGORIES[panel.cashTab])
    .map((entry) => entry.subcategory);
  return panel.owner.restoreTab(
    "CashShop.subcategory",
    choices,
    choices[0] ?? -1,
  );
}

function drawCommodity(panel, layer, record, index) {
  if (record.empty) {
    drawEmptyCommodities(panel, layer);
    return;
  }
  const { template, offer } = record;
  const x = (index % 2) * 206,
    y = 2 + Math.floor(index / 2) * 81;
  layer.image("CSList/Base", x, y);
  const selection = layer.image("CSList/ItemIcon", x, y);
  selection.container.visible = panel.cashSelected === offer.sn;
  const row = { sn: offer.sn, selection, controls: [] };
  const position = {
    x,
    y,
    controls: row.controls,
    wrongGender:
      offer.gender !== -1 &&
      offer.gender !== 2 &&
      offer.gender !== panel.cashService.store.profile.gender,
  };
  drawCommodityPresentation(layer, record, position);
  layer.hit(
    template?.name ?? "Cash item",
    { x: x + 5, y: y + 5, width: 64, height: 64 },
    {
      click: () => {
        if (panel.cashSelected === offer.sn) return;
        panel.cashSelected = offer.sn;
        panel.cashActionIndex = -1;
        for (const entry of panel.cashSelections) {
          entry.selection.container.visible = entry.sn === offer.sn;
        }
      },
      dblclick: () => panel.cashPreview.tryOn(offer.sn),
    },
    { tooltip: () => cashTooltip(panel, offer, layer) },
  );
  drawCommodityPurchaseControls(panel, layer, record, position);
  drawCommodityWishlist(panel, layer, offer, position);
  return row;
}

function drawEmptyCommodities(panel, layer) {
  const path =
    panel.cashTab === 0 && !panel.cashSearch
      ? `PicturePlate/${panel.cashSubcategory === 1 ? "HowToGift" : "HowTo"}`
      : "PicturePlate/NoItem";
  layer.image(path, 3, path.endsWith("HowTo") ? 2 : 60);
}

function drawCommodityPresentation(layer, record, position) {
  const { template, offer } = record;
  const { x, y } = position;
  if (template) layer.image(template.iconPath, x + 21, y + 19);
  const title = cashText(layer, template?.name ?? "Original name unavailable", {
    x: x + 76,
    y: y + 5,
    width: 121,
    height: 15,
  });
  title.style.whiteSpace = "nowrap";
  title.style.textOverflow = "ellipsis";
  cashText(
    layer,
    `${offer.price.toLocaleString()} ${offer.category === 8 ? "Mesos" : "NX"}`,
    { x: x + 79, y: y + 25, width: 117 },
    "#fff",
  );
  cashText(
    layer,
    `${offer.count} item(s) / ${offer.period || 90} days`,
    { x: x + 79, y: y + 39, width: 117 },
    "#fff",
  );
}

function drawCommodityPurchaseControls(panel, layer, record, position) {
  const { template, offer } = record;
  const { x, y, wrongGender, controls } = position;
  controls.push(
    layer.button("CSList/BtBuy", x + 80, y + 53, {
      label: `Buy ${template?.name ?? "item"}`,
      disabled: panel.cashService.pending || wrongGender,
      action: () => cashPurchaseDialog(panel, [offer.sn]),
    }),
  );
  controls.push(
    layer.button("CSList/BtGift", x + 119, y + 53, {
      label: `Gift ${template?.name ?? "item"}`,
      disabled: panel.cashService.pending || !cashGiftable(offer),
      action: () => cashGiftDialog(panel, offer.sn),
    }),
  );
}

function drawCommodityWishlist(panel, layer, offer, position) {
  const { x, y, wrongGender, controls } = position;
  const wished = panel.cashService.store.profile.cash.wishlist.includes(
    offer.sn,
  );
  controls.push(
    layer.button(
      `CSList/${panel.cashTab === 8 ? "BtRemove" : "BtReserve"}`,
      x + 158,
      y + 53,
      {
        label:
          panel.cashTab === 8 ? "Remove from Wish List" : "Add to Wish List",
        disabled: panel.cashTab !== 8 && (offer.category === 8 || wrongGender),
        action: () => {
          const wishlist = panel.cashService.store.profile.cash.wishlist;
          const sns = wished
            ? wishlist.filter((sn) => sn !== offer.sn)
            : [...wishlist, offer.sn];
          cashOutcome(panel, panel.cashService.setWishlist(sns));
        },
      },
    ),
  );
}

function refreshPagination(panel, stage) {
  const { cashPage: selectedPage, cashPageCount: pages } = stage.cashView;
  const layer = stage.layer("Cash pages");
  const start = Math.floor(selectedPage / 10) * 10;
  const entries = [{ label: "<", page: Math.max(0, start - 1) }];
  for (let page = start; page < Math.min(pages, start + 10); page++) {
    entries.push({ label: String(page + 1), page });
  }
  entries.push({ label: ">", page: Math.min(pages - 1, start + 10) });
  entries.forEach((entry, index) => {
    const rect = { x: 5 + index * 25, y: 407, width: 24, height: 18 };
    cashText(
      layer,
      entry.label,
      rect,
      entry.page === selectedPage ? "#ffff00" : "#fff",
    );
    layer.hit(`Page ${entry.label}`, rect, {
      click: () => {
        panel.cashPage = entry.page;
        refreshCashShop(panel);
      },
    });
  });
}

function refreshCashBags(panel) {
  const snapshot = panel.cashService.snapshot();
  const locker = [...snapshot.locker].sort((a, b) => a.slot - b.slot);
  const bag = snapshot.inventory
    .filter(
      (item) =>
        Math.floor(item.id / 1000000) === panel.cashInventoryType &&
        cashTemplate(panel, item.id)?.info.cash === 1,
    )
    .sort((a, b) => a.slot - b.slot);
  panel.cashLockerScroll.setRange(8, panel.cashLockerPage);
  panel.cashBagScroll.setRange(
    Math.max(1, Math.ceil(bag.length / 12)),
    panel.cashBagPage,
  );
  panel.cashBagPage = panel.cashBagScroll.position;
  const lockerItems = locker.filter(
    (item) =>
      item.slot > panel.cashLockerPage * 12 &&
      item.slot <= (panel.cashLockerPage + 1) * 12,
  );
  const records = lockerItems.map((item) => ({
    ...item,
    template: cashTemplate(panel, item.id),
  }));
  replaceIcons(panel.cashLocker, records, (layer, item) =>
    drawCashInstance(panel, layer, item, {
      x: 22 + ((item.slot - 1) % 6) * 35,
      y: 33 + Math.floor(((item.slot - 1) % 12) / 6) * 35,
      width: 32,
      height: 32,
      locker: true,
    }),
  );
  const bagItems = bag
    .slice(panel.cashBagPage * 12, (panel.cashBagPage + 1) * 12)
    .map((item) => ({ ...item, template: cashTemplate(panel, item.id) }));
  replaceIcons(panel.cashBag, bagItems, (layer, item, index) =>
    drawCashInstance(panel, layer, item, {
      x: 22 + (index % 4) * 35,
      y: 55 + Math.floor(index / 4) * 35,
      width: 32,
      height: 32,
      locker: false,
    }),
  );
  refreshBagTabs(panel);
}

function refreshBagTabs(panel) {
  panel.cashBagTabs?.destroy();
  const layer = panel.cashBag.layer("Inventory categories");
  panel.cashBagTabs = layer;
  for (let index = 0; index < 5; index++) {
    const x = 18 + index * 30;
    layer.image(
      `Base/Tab2/${panel.cashInventoryType === index + 1 ? "Enable" : "Disable"}/${index}`,
      x,
      33,
    );
    layer.hit(
      BAG_LABELS[index],
      { x, y: 28, width: 30, height: 22 },
      {
        click: () => {
          panel.cashInventoryType = index + 1;
          panel.owner.rememberTab("CashShop.inventory", index + 1);
          panel.cashBagPage = 0;
          refreshCashBags(panel);
        },
      },
    );
  }
}

function drawCashInstance(panel, layer, item, rect) {
  if (item.template) {
    layer.image(item.template.iconPath, rect.x, rect.y + 32, true);
  }
  if (item.count > 1) drawItemCount(layer, item.count, rect);
  layer.hit(
    `${item.template?.name ?? "Cash item"} × ${item.count}`,
    rect,
    {
      dblclick: () =>
        cashOutcome(
          panel,
          rect.locker
            ? panel.cashService.moveToInventory(item.uid)
            : panel.cashService.moveToLocker(item.uid),
        ),
    },
    { tooltip: () => cashTooltip(panel, item, layer) },
  );
}

function cashKey(panel, event) {
  if (panel.cashDialog) return cashDialogKey(panel, event);
  if (cashPreviewKey(panel, event)) return true;
  const editing = event.target?.matches?.("input,select,textarea");
  if (
    !editing &&
    (cashCategoryKey(panel, event) || cashListKey(panel, event))
  ) {
    return true;
  }
  return cashCommandKey(panel, event, editing);
}

function cashPreviewKey(panel, event) {
  if (event.code === "CapsLock") {
    if (!event.repeat) panel.cashPreview.setEnabled(!panel.cashPreview.enabled);
    return true;
  }
  if (event.key === "Escape" && event.target === panel.cashChatInput) {
    panel.cashChatInput.blur();
    return true;
  }
  return panel.cashPreview.key(event);
}

function cashCommandKey(panel, event, editing) {
  if (event.key === "Escape") {
    exitCashShop(panel);
    event.preventDefault();
    return true;
  }
  if (event.key === "Enter" && !event.target?.matches?.("button")) {
    if (!cashChatKey(panel, event)) return false;
    event.preventDefault();
    return true;
  }
  if (editing) return false;
  return cashPageKey(panel, event);
}

/**004b6655: top-row1..9/Home, backquote+Shift, and Tab+Shift select authored categories. */
function cashCategoryKey(panel, event) {
  if (/^Digit[1-9]$/.test(event.code)) {
    selectCashTab(panel, Number(event.code.slice(5)) - 1);
  } else if (event.code === "Home") {
    selectCashTab(panel, 0);
  } else if (event.code === "Backquote" && panel.cashTab !== 8) {
    selectCashTab(panel, (panel.cashTab + (event.shiftKey ? 7 : 1)) % 8);
  } else if (event.code === "Tab") {
    const categories = panel.cashService.catalog.ui.cashShop.categories.filter(
      (entry) => entry.category === TAB_CATEGORIES[panel.cashTab],
    );
    if (!categories.length) return true;
    const current = categories.findIndex(
      (entry) => entry.subcategory === panel.cashSubcategory,
    );
    const index =
      (Math.max(0, current) + categories.length + (event.shiftKey ? -1 : 1)) %
      categories.length;
    panel.cashSubcategory = categories[index].subcategory;
    panel.owner.rememberTab("CashShop.subcategory", panel.cashSubcategory);
    panel.cashPage = 0;
    refreshCashShop(panel);
  } else return false;
  return true;
}

/**004b7417: preview Off returns arrows/Enter/Escape to the two-column list. */
function cashListKey(panel, event) {
  const rows = panel.cashSelections;
  if (panel.cashPreview.enabled) return false;
  if (panel.cashPendingList) {
    return (
      event.key === "Enter" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown"
    );
  }
  if (!rows.length) return false;
  let index = Math.max(
    0,
    rows.findIndex((row) => row.sn === panel.cashSelected),
  );
  if (panel.cashActionIndex >= 0) {
    return cashListActionKey(panel, rows[index], event);
  }
  if (event.key === "Enter") {
    panel.cashSelected = rows[index].sn;
    panel.cashActionIndex = 0;
    rows[index].controls[0].element.focus();
    return true;
  }
  index = cashListRowIndex(index, rows.length, event.key);
  if (index < 0) return false;
  panel.cashSelected = rows[index].sn;
  for (const row of rows) {
    row.selection.container.visible = row.sn === panel.cashSelected;
  }
  return true;
}

function cashListActionKey(panel, row, event) {
  const control = row.controls[panel.cashActionIndex];
  if (event.key === "Enter") control.element.click();
  else if (event.key === "Escape") {
    control.element.blur();
    panel.cashActionIndex = -1;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    panel.cashActionIndex =
      (panel.cashActionIndex + (event.key === "ArrowLeft" ? 2 : 1)) % 3;
    row.controls[panel.cashActionIndex].element.focus();
  } else return false;
  return true;
}

function cashListRowIndex(index, count, key) {
  if (key === "ArrowLeft" || key === "ArrowRight") {
    return Math.min(count - 1, index ^ 1);
  }
  if (key === "ArrowUp") {
    if (index > 1) return index - 2;
    index += Math.floor(count / 2) * 2;
    return index >= count ? index - 2 : index;
  }
  if (key === "ArrowDown") {
    return count - index < 3 ? index % 2 : index + 2;
  }
  return -1;
}

function moveCashPage(panel, direction) {
  if (panel.cashPendingList) return;
  const pages = panel.cashPageCount;
  panel.cashPage = (panel.cashPage + pages + direction) % pages;
  refreshCashShop(panel);
}

function cashPageKey(panel, event) {
  if (event.key !== "PageDown" && event.key !== "PageUp") return false;
  moveCashPage(panel, event.key === "PageDown" ? 1 : -1);
  return true;
}

function cashChatKey(panel, event) {
  const input = panel.cashChatInput;
  if (event.target === input) {
    if (panel.cashPreview.speech.show(input.value)) input.value = "";
    else {
      cashMessage(
        panel,
        "Enter 1 to 70 printable characters for the speech preview.",
      );
    }
  } else if (!event.target?.matches?.("input,select,textarea")) input.focus();
  else return false;
  return true;
}
