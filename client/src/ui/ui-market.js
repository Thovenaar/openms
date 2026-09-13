import { replaceIcons, drawItemCount } from "./ui-icons.js";
import { openMarketForm, closeMarketForm } from "./ui-market-form.js";
import { itemTooltip } from "./ui-tooltip.js";

const TABS = [
  ["sale", "For sale"],
  ["wanted", "Wanted"],
  ["auction", "Auction"],
  ["mine", "My page"],
  ["guide", "Guide"],
];

/** Original ITC800×600 chrome and 20px listing rows; browser forms are documented adaptations. */
export function layoutMarket(panel, service) {
  panel.market = service;
  panel.noDrag = true;
  panel.nativeClose = true;
  panel.marketInventoryType = 2;
  panel.marketInventoryPage = 0;
  panel.marketTransferPage = 0;
  panel.marketSelected = null;
  panel.image("Base/backgrnd", 0, 0).container.zIndex = -10;
  panel.image("Base/Preview/0", 17, 33);
  const portrait = panel.owner.hooks.tradePortrait(panel, { x: 126, y: 131 });
  portrait.useSurfaceClock();
  panel.cleanups.push(() => portrait.destroy());
  text(panel, service.store.profile.name, [80, 171, 150], "#213b55");
  text(panel, "OpenMS", [80, 152, 150], "#213b55");
  panel.marketNx = text(panel, "", [349, 531, 105], "#213b55");
  panel.marketPoints = text(panel, "", [349, 552, 105], "#213b55");
  panel.marketMeso = text(panel, "", [349, 574, 105], "#213b55");
  composeControls(panel);
  composeCategories(panel);
  panel.marketBody = panel.contentArea(277, 151, 499, 320);
  panel.marketBody.style.overflow = "hidden";
  panel.marketStatus = text(panel, "", [278, 486, 490]);
  panel.marketStatus.setAttribute("role", "status");
  panel.marketStatus.style.whiteSpace = "normal";
  const unsubscribe = service.subscribe(() => refreshMarket(panel));
  panel.cleanups.push(() => {
    unsubscribe();
    service.destroy();
    closeMarketForm(panel);
  });
  panel.localRefresh = () => refreshMarket(panel);
  refreshMarket(panel);
  void service.read();
}

function text(panel, value, [x, y, width], color = "#fff") {
  const element = panel.text(value, x, y, { width });
  element.style.cssText += `;font:12px/18px Arial,sans-serif;color:${color};overflow:hidden;white-space:nowrap;text-overflow:ellipsis;`;
  return element;
}

function hit(panel, label, rect, action) {
  const button = panel.localButton(label, rect.x, rect.y, action);
  button.setAttribute("aria-label", label);
  button.style.cssText += `;width:${rect.width}px;height:${rect.height}px;border:0;padding:0;background:transparent;color:transparent;box-shadow:none;`;
  return button;
}

function composeControls(panel) {
  for (let index = 0; index < TABS.length; index++) {
    const [tab, label] = TABS[index];
    hit(
      panel,
      label,
      {
        x: 276 + (index ? 130 + (index - 1) * 94 : 0),
        y: 39,
        width: index ? 94 : 126,
        height: 40,
      },
      () => selectTab(panel, tab),
    );
  }
  composeSearch(panel);
  panel.button("BtExit", 639, 543, {
    label: "Return to game",
    action: () => panel.owner.close("ITC"),
  });
  panel.localButton("‹", 282, 471, () =>
    panel.market.read({ page: Math.max(0, panel.market.query.page - 1) }),
  );
  panel.localButton("›", 312, 471, () => {
    if (panel.market.value.more) {
      void panel.market.read({ page: panel.market.query.page + 1 });
    }
  });
  const cart = panel.localButton("Cart", 360, 472, () =>
    selectTab(panel, "cart"),
  );
  cart.setAttribute("aria-label", "Shopping cart");
  panel.localButton("Transfer", 409, 472, () => selectTab(panel, "transfer"));
  panel.button("Sell/BtBuy", 637, 474, {
    label: "Buy selected listing",
    action: () => actSelected(panel, "buy"),
  });
  panel.button("Auction/BtBid", 676, 474, {
    label: "Bid on selected listing",
    action: () => actSelected(panel, "bid"),
  });
  panel.button("Sell/BtShoppingBasket", 727, 474, {
    label: "Change selected cart item",
    action: () => actSelected(panel, "cart"),
  });
  panel.button("Sell/BtRegistration", 486, 548, {
    label: "Create wanted order",
    action: () => openMarketForm(panel, null, true),
  });
  panel.localButton("Refresh", 571, 548, () => panel.market.read());
  composeInventoryControls(panel);
}

function composeSearch(panel) {
  const details = panel.localButton("Item details", 390, 86, () => {
    void marketItemDetails(panel).catch((error) => panel.owner.report(error));
  });
  details.setAttribute("aria-label", "Selected item details");
  const input = document.createElement("input");
  input.setAttribute("aria-label", "Search MTS items");
  input.maxLength = 64;
  input.style.cssText =
    "position:absolute;left:487px;top:86px;width:240px;height:18px;font:12px Arial";
  panel.element.append(input);
  panel.button("BtSearch", 734, 86, {
    label: "Search MTS",
    action: () => panel.market.read({ query: input.value, page: 0 }),
  });
}

async function marketItemDetails(panel) {
  const listing = panel.marketSelected;
  if (!listing || panel.market.pending) return;
  const template = panel.owner.index.items[listing.itemId];
  const instance = listing.item;
  const projection = {
    store: {
      profile: { inventory: instance ? [instance] : [], equipment: [] },
    },
  };
  const content = itemTooltip(projection, template, listing.itemId, {
    uid: instance?.uid,
    quantity: listing.quantity,
  });
  const lines = [content.title, ...content.lines.map((line) => line.text)];
  appendInstanceDetails(lines, instance);
  if (listing.buyNow) lines.push(`Buy now: ${listing.buyNow} NX`);
  await panel.owner.prompt({
    kind: "notice",
    text: lines.join("\n").replaceAll("\\n", "\n"),
    owner: panel,
  });
}

function appendInstanceDetails(lines, instance) {
  if (instance?.owner) lines.push(`Owner inscription: ${instance.owner}`);
  if (
    instance &&
    instance.flags & (Math.floor(instance.id / 1000000) === 1 ? 16 : 2)
  ) {
    lines.push("This item becomes untradeable after purchase.");
  }
  if (instance?.expiresAt) {
    lines.push(
      `Item expires: ${new Date(instance.expiresAt).toLocaleString()}`,
    );
  }
}

function composeCategories(panel) {
  for (const [category, label] of [
    "All",
    "Equip",
    "Use",
    "Setup",
    "Etc",
  ].entries()) {
    hit(
      panel,
      `MTS category: ${label}`,
      { x: 276 + category * 64, y: 107, width: 64, height: 18 },
      () => {
        if (!panel.marketForm) void panel.market.read({ category, page: 0 });
      },
    );
  }
  panel.marketClearCart = panel.localButton("Clear cart", 279, 86, () => {
    if (!panel.marketForm) void runMarket(panel, { kind: "mts.cart.clear" });
  });
  panel.marketClearCart.setAttribute("aria-label", "Clear shopping cart");
}

function composeInventoryControls(panel) {
  for (let type = 1; type <= 4; type++) {
    const button = panel.localButton(
      ["Equip", "Use", "Setup", "Etc"][type - 1],
      19 + (type - 1) * 55,
      450,
      () => {
        panel.marketInventoryType = type;
        panel.marketInventoryPage = 0;
        refreshMarket(panel);
      },
    );
    button.style.cssText += ";font:10px Arial;padding:1px 3px;";
  }
  panel.localButton("‹", 159, 423, () => {
    panel.marketInventoryPage = Math.max(0, panel.marketInventoryPage - 1);
    refreshMarket(panel);
  });
  panel.localButton("›", 199, 423, () => {
    panel.marketInventoryPage = (panel.marketInventoryPage + 1) % 6;
    refreshMarket(panel);
  });
  panel.localButton("‹", 159, 317, () => {
    panel.marketTransferPage = Math.max(0, panel.marketTransferPage - 1);
    refreshMarket(panel);
  });
  panel.localButton("›", 199, 317, () => {
    panel.marketTransferPage = (panel.marketTransferPage + 1) % 4;
    refreshMarket(panel);
  });
}

function selectTab(panel, tab) {
  if (panel.market.pending || panel.marketForm) return;
  panel.marketGuide = tab === "guide";
  panel.marketSelected = null;
  if (panel.marketGuide) refreshMarket(panel);
  else void panel.market.read({ tab, page: 0 });
}

function refreshMarket(panel) {
  if (panel.disposed || !marketPresentationChanged(panel)) return;
  const service = panel.market;
  panel.marketNx.textContent = String(
    service.store.profile.cash.balances.prepaid,
  );
  panel.marketMeso.textContent = String(service.store.profile.meso);
  panel.marketPoints.textContent = String(
    service.store.profile.cash.balances.points,
  );
  panel.marketClearCart.hidden = service.query.tab !== "cart";
  panel.marketStatus.textContent = service.pending
    ? "Updating trading system…"
    : service.error ||
      "Select a listing to trade. Select an inventory item to register it.";
  panel.marketChrome?.destroy();
  const chrome = (panel.marketChrome = panel.layer("MTS page artwork"));
  chrome.root.zIndex = -5;
  panel.root.sortableChildren = true;
  const index = panel.marketGuide
    ? 5
    : Math.max(1, TABS.findIndex(([tab]) => tab === service.query.tab) + 1);
  chrome.image(
    `Tab/${["cart", "transfer"].includes(service.query.tab) ? 4 : index}`,
    273,
    33,
  );
  chrome.image(`Sell/Tab/${service.query.category}`, 273, 104);
  chrome.image("Sell/backgrnd", 273, 151);
  panel.marketBody.replaceChildren();
  if (panel.marketGuide) renderGuide(panel);
  else renderRows(panel);
  refreshMarketIcons(panel);
  syncMarketControls(panel);
  panel.renderArtwork();
}

/** Field movement publications must not replace buttons or reload artwork under the pointer. */
function marketPresentationChanged(panel) {
  const service = panel.market;
  const revision = service.owner.transport.revisions.character;
  if (
    panel.marketRevision === revision &&
    panel.marketValue === service.value &&
    panel.marketQuery === service.query &&
    panel.marketWasPending === service.pending &&
    panel.marketError === service.error &&
    panel.marketType === panel.marketInventoryType &&
    panel.marketPage === panel.marketInventoryPage &&
    panel.marketDeliveryPage === panel.marketTransferPage &&
    panel.marketWasGuide === panel.marketGuide
  ) {
    return false;
  }
  panel.marketRevision = revision;
  panel.marketValue = service.value;
  panel.marketQuery = service.query;
  panel.marketWasPending = service.pending;
  panel.marketError = service.error;
  panel.marketType = panel.marketInventoryType;
  panel.marketPage = panel.marketInventoryPage;
  panel.marketDeliveryPage = panel.marketTransferPage;
  panel.marketWasGuide = panel.marketGuide;
  return true;
}

function syncMarketControls(panel) {
  for (const control of panel.controls) {
    control.setDisabled(panel.market.pending);
  }
  const buttons = panel.element.querySelectorAll("button");
  if (buttons.length > 160) throw new Error("MTS control capacity exceeded");
  for (const button of buttons) button.disabled = panel.market.pending;
}

function renderGuide(panel) {
  const prose = document.createElement("p");
  prose.style.cssText =
    "color:white;font:12px/20px Arial;padding:10px;white-space:pre-line";
  prose.textContent =
    "Maple Trading System\n\nSelect an item in your inventory to list a fixed-price sale or auction. Prices apply to the whole lot. Listings last 24–168 hours.\n\nWanted orders reserve NX for seven days. Auctions reserve the leading bid and return the previous bid automatically. Bids increase by at least 5%; the seller pays a 5% fee, rounded up.\n\nPurchased and returned items appear in Transfer Inventory. Select an item there to move it to your bag. Cancel a listing from My Page before it has a bid.\n\nMTS uses your existing prepaid NX. Payments are not enabled.";
  panel.marketBody.append(prose);
}

function renderRows(panel) {
  const service = panel.market;
  if (service.query.tab === "transfer") {
    for (const item of service.value.transfers.slice(
      service.query.page * 16,
      service.query.page * 16 + 16,
    )) {
      listingRow(
        panel,
        {
          itemId: item.id,
          quantity: item.count,
          ownerName: "Transfer inventory",
          price: 0,
        },
        () => runMarket(panel, { kind: "mts.claim", uid: item.uid }),
      );
    }
    return;
  }
  for (const listing of service.value.listings) {
    listingRow(panel, listing, () => {
      panel.marketSelected = listing;
      panel.marketStatus.textContent = `${panel.owner.index.items[listing.itemId].name}: select Buy, Bid or Cart below.`;
    });
  }
}

function listingRow(panel, listing, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.style.cssText =
    "display:grid;grid-template-columns:282px 83px 67px 1fr;gap:0;width:499px;height:20px;padding:0;border:0;background:transparent;text-align:left;color:white;font:12px/20px Arial;";
  const name =
    panel.owner.index.items[listing.itemId]?.name ?? String(listing.itemId);
  button.setAttribute(
    "aria-label",
    `${name} × ${listing.quantity} from ${listing.ownerName}`,
  );
  button.dataset.mtsListing = listing.id ?? "";
  for (const value of [
    `${name} × ${listing.quantity}`,
    listing.ownerName,
    String(listing.bid || listing.price),
    listing.expiresAt
      ? `${Math.max(0, Math.ceil((listing.expiresAt - Date.now()) / 3600000))}h`
      : "Claim",
  ]) {
    const label = document.createElement("span");
    label.textContent = value;
    label.style.cssText =
      "overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding-left:3px";
    button.append(label);
  }
  button.disabled = panel.market.pending;
  button.addEventListener("click", () => {
    Promise.resolve(action()).catch((error) => panel.owner.report(error));
  });
  panel.marketBody.append(button);
}

async function chooseListing(panel, listing) {
  if (panel.market.pending) return;
  if (listing.mine) {
    if (
      await confirm(
        panel,
        "Cancel this listing? Unsold items return to Transfer Inventory.",
      )
    ) {
      await runMarket(panel, { kind: "mts.cancel", listingId: listing.id });
    }
  } else if (listing.kind === "wanted") {
    const item = panel.market.store.profile.inventory.find(
      (item) => item.id === listing.itemId && item.count >= listing.quantity,
    );
    if (!item) {
      return panel.owner.prompt({
        kind: "notice",
        text: "You do not have the requested quantity in one stack.",
        owner: panel,
      });
    }
    if (
      await confirm(
        panel,
        `Sell ${listing.quantity} items for ${listing.price} NX before the seller fee?`,
      )
    ) {
      await runMarket(panel, {
        kind: "mts.fulfill",
        listingId: listing.id,
        uid: item.uid,
      });
    }
  } else await purchaseListing(panel, listing);
}

function actSelected(panel, action) {
  const listing = panel.marketSelected;
  if (!listing || panel.market.pending) return;
  const task =
    action === "cart"
      ? runMarket(panel, {
          kind: "mts.cart",
          listingId: listing.id,
          add: panel.market.query.tab !== "cart",
        })
      : action === "bid"
        ? placeBid(panel, listing)
        : chooseListing(panel, listing);
  Promise.resolve(task).catch((error) => panel.owner.report(error));
}

async function purchaseListing(panel, listing) {
  const price = listing.kind === "auction" ? listing.buyNow : listing.price;
  if (!price) {
    return panel.owner.prompt({
      kind: "notice",
      text: "This auction has no buy-now price. Place a bid instead.",
      owner: panel,
    });
  }
  if (await confirm(panel, `Buy this entire lot for ${price} NX?`)) {
    return runMarket(panel, { kind: "mts.buy", listingId: listing.id, price });
  }
}

async function placeBid(panel, listing) {
  if (listing.kind !== "auction" || listing.mine) return;
  const minimum = listing.bid
    ? listing.bid + Math.max(1, Math.ceil(listing.bid * 0.05))
    : listing.price;
  const price = await panel.owner.prompt({
    kind: "number",
    text: "Your bid in NX",
    value: minimum,
    min: minimum,
    max: 100000000,
    owner: panel,
  });
  if (price !== null) {
    return runMarket(panel, { kind: "mts.bid", listingId: listing.id, price });
  }
}

function confirm(panel, message) {
  return panel.owner.prompt({ kind: "confirm", text: message, owner: panel });
}

async function runMarket(panel, action) {
  const result = await panel.market.run(action);
  if (!result.ok && !panel.disposed) {
    await panel.owner.prompt({
      kind: "notice",
      text: result.reason,
      owner: panel,
    });
  }
}

function refreshMarketIcons(panel) {
  const rows = [];
  const add = (item, index, y, action) =>
    rows.push({
      item,
      template: panel.owner.index.items[item.id],
      x: 19 + (index % 6) * 35,
      y: y + Math.floor(index / 6) * 35,
      action,
    });
  for (const [index, listing] of panel.market.value.owned
    .filter((entry) => entry.item)
    .slice(0, 12)
    .entries()) {
    add(listing.item, index, 235, () => chooseListing(panel, listing));
  }
  for (const [index, item] of panel.market.value.transfers
    .slice(panel.marketTransferPage * 12, panel.marketTransferPage * 12 + 12)
    .entries()) {
    add(item, index, 343, () =>
      runMarket(panel, { kind: "mts.claim", uid: item.uid }),
    );
  }
  const inventory = panel.market.store.profile.inventory
    .filter(
      (item) => Math.floor(item.id / 1000000) === panel.marketInventoryType,
    )
    .sort((a, b) => a.slot - b.slot);
  for (const [index, item] of inventory
    .slice(panel.marketInventoryPage * 18, panel.marketInventoryPage * 18 + 18)
    .entries()) {
    add(item, index, 478, () => openMarketForm(panel, item));
  }
  void replaceIcons(panel, rows, (layer, row) => {
    layer.image(row.template.iconPath, row.x, row.y);
    drawItemCount(layer, row.item.count, { x: row.x, y: row.y });
    const button = hit(
      layer,
      `${row.template.name} × ${row.item.count}`,
      { x: row.x, y: row.y, width: 32, height: 32 },
      () => {
        Promise.resolve(row.action()).catch((error) =>
          panel.owner.report(error),
        );
      },
    );
    button.disabled = panel.market.pending;
  });
}
