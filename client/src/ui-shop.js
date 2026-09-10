import { EntityAnimation } from "./animation.js";
import { loadVisualBundle } from "./visual-resources.js";
import { NativeScrollbar } from "./ui-scrollbar.js";
import { replaceIcons, drawItemCount } from "./ui-icons.js";
import { itemTooltip } from "./ui-tooltip.js";
import { inventoryType } from "./inventory-model.js";

// Original007532ce/00753723/00753a5f/00753db7; Shop WZ background463x339.
const ROWS = 5;
const ROW_Y = 146;
const ROW_STEP = 40;
const TAB_LABELS = {
  buy: ["All", "Must"],
  sell: ["Equip", "Use", "Setup", "Etc", "Cash"],
};

function text(panel, value, x, geometry) {
  const element = panel.text(value, x, geometry.y, geometry.width);
  element.style.cssText +=
    ";font:12px/14px Arial,sans-serif;color:#000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;";
  return element;
}

function tabPart(panel, part, x, width) {
  const sprites = [];
  const states = part === "middle" ? 3 : 2;
  for (let state = 0; state < states; state++) {
    const path = `Tab3/${part}${state}`;
    const sprite = panel.image(path, x, 95);
    sprite.container.scale.x = width / panel.assets[path].width;
    sprites.push(sprite);
  }
  return sprites;
}

function showPart(sprites, state) {
  for (let i = 0; i < sprites.length; i++) {
    sprites[i].container.visible = i === state;
  }
}

/** Original tab type2 uses Tab3: end6/middle12; buy fixed-fill42, sell222-pixel distribution. */
class ShopTabs {
  constructor(panel, side, changed) {
    this.panel = panel;
    this.side = side;
    this.changed = changed;
    this.selected = 0;
    this.tabs = [];
    const count = TAB_LABELS[side].length;
    const start = side === "buy" ? 5 : 235;
    this.left = tabPart(panel, "left", start, 6);
    let x = start + 6;
    for (let i = 0; i < count; i++) {
      const width = side === "buy" ? 42 : i < 2 ? 33 : 32;
      const fill = tabPart(panel, "fill", x, width);
      const last = i === count - 1;
      const edge = tabPart(
        panel,
        last ? "right" : "middle",
        x + width,
        last ? 6 : 12,
      );
      const path = `Shop/${side === "buy" ? "TabBuy" : "TabSell"}`;
      const labelX = x;
      const labels = ["disabled", "enabled"].map((state) => {
        const name = `${path}/${state}/${i}`;
        const asset = panel.assets[name];
        return panel.image(
          name,
          labelX + Math.trunc((width - asset.width) / 2),
          95 + Math.trunc((21 - asset.height) / 2),
        );
      });
      const button = panel.hit(
        `${side} ${TAB_LABELS[side][i]}`,
        { x, y: 95, width, height: 21 },
        {
          click: () => this.select(i),
          pointerenter: () => panel.owner.sound("BtMouseOver"),
        },
      );
      button.setAttribute("role", "tab");
      this.tabs.push({ fill, edge, labels, button });
      x += width + 12;
    }
    this.draw();
  }

  select(index) {
    if (this.selected === index || this.tabs[index].button.disabled) return;
    this.selected = index;
    this.panel.owner.sound("BtMouseClick");
    this.panel.owner.hideTooltip();
    this.draw();
    this.changed(index);
  }

  draw() {
    showPart(this.left, this.selected === 0 ? 1 : 0);
    for (let i = 0; i < this.tabs.length; i++) {
      const tab = this.tabs[i];
      const selected = this.selected === i;
      showPart(tab.fill, selected ? 1 : 0);
      showPart(tab.edge, selected ? 1 : this.selected === i + 1 ? 2 : 0);
      tab.labels[0].container.visible = !selected;
      tab.labels[1].container.visible = selected;
      tab.button.setAttribute("aria-selected", String(selected));
    }
    this.panel.renderArtwork();
  }
}

/** Native00752c58..00752d35 Must selects equipment within five levels, then job/gender. */
function recommended(row, profile) {
  const info = row.template?.info;
  if (!info || inventoryType(row.itemId) !== 1 || row.price <= 0) return false;
  const level = info.reqLevel ?? 0;
  if (!Number.isSafeInteger(level) || Math.abs(level - profile.level) >= 6) {
    return false;
  }
  if (!matchesRecommendedJob(info, profile.job)) return false;
  const gender = Math.floor(row.itemId / 1000) % 10;
  return gender >= 2 || gender === profile.gender;
}

function matchesRecommendedJob(info, job) {
  const family = Math.floor((job % 1000) / 100);
  const jobs = info.reqJob ?? 0;
  return !jobs || Boolean(family && jobs & (1 << (family - 1)));
}

class ShopPortrait {
  constructor(panel, npc) {
    this.panel = panel;
    this.controller = new AbortController();
    this.resource = null;
    this.animation = null;
    this.disposed = false;
    const entry = panel.owner.index.npcPortraits?.[npc.id];
    if (!entry?.available) {
      throw new Error(`Original NPC portrait ${npc.id} is not packaged`);
    }
    panel.cleanups.push(() => this.destroy());
    this.load(entry.descriptor).catch((error) => {
      if (!this.controller.signal.aborted) panel.owner.report(error);
    });
  }

  async load(descriptor) {
    const signal = AbortSignal.any([
      this.controller.signal,
      this.panel.owner.controller.signal,
    ]);
    const resource = await loadVisualBundle(
      descriptor,
      this.panel.owner.services,
      signal,
    );
    try {
      signal.throwIfAborted();
      if (this.disposed) return;
      const animation = new EntityAnimation(
        resource.manifest.entities[0],
        resource.textures,
      );
      // Native007549d7..da: NPC original anchor(56,76), no browser fit/stretch.
      animation.setPosition(56, 76);
      this.panel.root.addChild(animation.container);
      this.animation = animation;
      this.panel.timedSprites.push(animation);
      this.resource = resource;
      this.panel.renderArtwork();
    } finally {
      if (this.resource !== resource) resource.destroy();
    }
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.abort();
    const index = this.panel.timedSprites.indexOf(this.animation);
    if (index >= 0) this.panel.timedSprites.splice(index, 1);
    this.animation?.container.destroy({ children: true });
    this.resource?.destroy();
    this.animation = null;
    this.resource = null;
  }
}

/** Original two-column shop, not a generic list or inventory-mutation owner. */
export function layoutShop(panel, shop) {
  panel.nativeClose = true;
  panel.canClose = () => !shop.pending;
  panel.requestClose = () => shop.close().ok;
  const view = new ShopView(panel, shop);
  panel.shopView = view;
  panel.localRefresh = () => view.refresh();
  panel.cleanups.push(() => view.destroy());
  return view;
}

class ShopView {
  constructor(panel, shop) {
    this.panel = panel;
    this.shop = shop;
    this.disposed = false;
    this.selected = { buy: null, sell: null };
    this.positions = { buy: [0, 0], sell: [0, 0, 0, 0, 0] };
    this.highlights = [];
    panel.image("Shop/backgrnd", 0, 0);
    this.header = panel.layer("Shop portraits and balance");
    this.portrait = new ShopPortrait(this.header, shop.npc);
    this.name = text(this.header, shop.npc.name, 8, { y: 79, width: 98 });
    this.name.style.textAlign = "center";
    this.balance = text(this.header, "", 361, { y: 64, width: 86 });
    this.balance.style.textAlign = "right";
    this.selfPortrait = panel.owner.hooks.userInfoPortrait?.(this.header, {
      x: 285,
      y: 76,
    });
    if (this.selfPortrait) {
      this.header.cleanups.push(() => this.selfPortrait.destroy());
      this.selfPortrait.useSurfaceClock();
    }
    this.buttons();
    this.tabs = {
      buy: new ShopTabs(panel, "buy", () => this.tabChanged("buy")),
      sell: new ShopTabs(panel, "sell", () => this.tabChanged("sell")),
    };
    this.columns = { buy: this.column("buy"), sell: this.column("sell") };
    this.unsubscribe = shop.subscribe(() => this.refresh());
    panel.listen(panel.element, "keydown", (event) => this.key(event));
    this.refresh();
  }

  buttons() {
    const panel = this.panel;
    // Native007535e6/00753666/007536e6; Exit is the inherited PersonalShop resource.
    this.exitButton = panel.button("PersonalShop/BtExit", 142, 15, {
      label: "Exit shop",
      action: () => this.close(),
    });
    this.buyButton = panel.button("Shop/BtBuy", 142, 35, {
      label: "Buy",
      action: () => this.buy(),
    });
    this.sellButton = panel.button("Shop/BtSell", 372, 35, {
      label: "Sell",
      action: () => this.sell(),
    });
  }

  column(side) {
    const panel = this.panel.layer(`${side} shop scrollbar`);
    // NativeScrollbar listens to its panel; clip DOM hit region so one wheel never moves both lists.
    const left = side === "buy" ? 5 : 235;
    panel.element.style.clipPath = `inset(118px ${this.panel.width - left - 222}px 11px ${left}px)`;
    const scrollbar = new NativeScrollbar(
      panel,
      { x: side === "buy" ? 210 : 441, y: 127, extent: 194, style: 3 },
      (position) => {
        this.positions[side][this.tabs[side].selected] = position;
        this.renderRows();
      },
    );
    this.panel.listen(this.panel.element, "wheel", (event) => {
      const point = this.panel.owner.logicalPointer(event);
      const x = point.x - this.panel.x;
      const y = point.y - this.panel.y;
      if (
        x < left ||
        x >= left + 222 ||
        y < 118 ||
        y >= 327 ||
        panel.element.contains(event.target)
      ) {
        return;
      }
      scrollbar.wheel(event);
    });
    return scrollbar;
  }

  tabChanged(side) {
    this.selected[side] = null;
    this.refresh();
  }

  refresh() {
    if (this.disposed || this.panel.disposed) return;
    this.snapshot = this.shop.snapshot();
    this.selfPortrait
      ?.refresh(this.panel.owner.store.profile)
      .catch((error) => {
        if (
          error.name !== "AbortError" &&
          !this.disposed &&
          !this.panel.disposed
        ) {
          this.panel.owner.report(error);
        }
      });
    const purchase = this.applyTransaction();
    this.balance.textContent = this.snapshot.mesos.toLocaleString("en-US");
    this.buyRows = this.snapshot.rows.filter(
      (row) =>
        (row.price > 0 || row.pitch > 0) &&
        (this.tabs.buy.selected === 0 || recommended(row, this.snapshot.self)),
    );
    this.sellRows = this.snapshot.inventory.filter(
      (row) => row.type === this.tabs.sell.selected + 1,
    );
    if (purchase) {
      const index = this.sellRows.findIndex(
        (row) => row.uid === this.selected.sell,
      );
      const tab = this.tabs.sell.selected;
      const current = this.positions.sell[tab];
      if (index >= 0 && (index < current || index >= current + ROWS)) {
        this.positions.sell[tab] = Math.max(0, index - ROWS + 1);
      }
    }
    for (const side of ["buy", "sell"]) {
      const rows = side === "buy" ? this.buyRows : this.sellRows;
      const selected = this.selected[side];
      if (
        !rows.some((row) => (side === "buy" ? row.row : row.uid) === selected)
      ) {
        this.selected[side] = null;
      }
      const tab = this.tabs[side].selected;
      this.columns[side].setRange(
        Math.max(1, rows.length - ROWS + 1),
        this.positions[side][tab],
      );
      this.positions[side][tab] = this.columns[side].position;
    }
    this.updateButtons();
    this.renderRows();
  }

  applyTransaction() {
    const transaction = this.snapshot.lastTransaction;
    if (!transaction || transaction.revision === this.transactionRevision) {
      return false;
    }
    this.transactionRevision = transaction.revision;
    if (transaction.kind !== "buy") return false;
    this.tabs.sell.selected = inventoryType(transaction.itemId) - 1;
    this.tabs.sell.draw();
    this.selected.sell = transaction.uid;
    return true;
  }
  renderRows() {
    if (this.disposed) return;
    const revision = (this.renderRevision ?? 0) + 1;
    this.renderRevision = revision;
    const records = [];
    for (const side of ["buy", "sell"]) {
      const rows = side === "buy" ? this.buyRows : this.sellRows;
      const start = this.columns[side].position;
      for (let i = 0; i < ROWS && start + i < rows.length; i++) {
        records.push({ ...rows[start + i], side, visibleRow: i });
      }
    }
    const highlights = [];
    replaceIcons(this.panel, records, (layer, row) =>
      this.composeRow(layer, row, highlights),
    )
      .then(() => {
        if (
          this.disposed ||
          revision !== this.renderRevision ||
          highlights.length !== records.length
        ) {
          return;
        }
        this.highlights = highlights;
        this.drawSelection();
      })
      .catch((error) => this.panel.owner.report(error));
  }

  composeRow(layer, row, highlights) {
    const right = row.side === "sell";
    const anchor = ROW_Y + row.visibleRow * ROW_STEP;
    const x = right ? 236 : 6;
    const titleX = right ? 279 : 49;
    const key = right ? row.uid : row.row;
    const highlight = layer.image("Shop/select", right ? 273 : 43, anchor - 19);
    highlights.push({ sprite: highlight, side: row.side, key });
    highlight.container.visible = this.selected[row.side] === key;
    const name = this.rowItemArtwork(layer, row, { x, titleX, anchor });
    this.rowHit(layer, row, { x, anchor, key, name });
    this.rowRecharge(layer, row, { anchor, name });
  }

  rowItemArtwork(layer, row, { x, titleX, anchor }) {
    const right = row.side === "sell";
    const path = row.template?.iconPath;
    if (path && layer.assets[path]) {
      layer.image(path, right ? 238 : 8, anchor + 15, true);
    }
    const name = row.template?.name ?? "Original item unavailable";
    text(layer, name, titleX, {
      y: anchor - 18,
      width: row.rechargeable && right ? 120 : 152,
    });
    this.rowPrice(layer, row, { x: titleX, y: anchor });
    if (right && row.type >= 2 && row.type <= 4) {
      drawItemCount(layer, row.count, { x, y: anchor - 19 });
    }
    return name;
  }

  rowHit(layer, row, { x, anchor, key, name }) {
    const right = row.side === "sell";
    const hit = layer.hit(
      name,
      { x, y: anchor - 19, width: 198, height: 35 },
      {
        click: () => this.select(row.side, key),
        dblclick: () => {
          this.select(row.side, key);
          if (right) this.sell();
          else this.buy();
        },
      },
      { tooltip: () => this.tooltip(layer, row) },
    );
    hit.dataset.shopSide = row.side;
    hit.dataset.itemId = String(right ? row.id : row.itemId);
    if (right) hit.dataset.itemUid = row.uid;
    else hit.dataset.shopRow = String(row.row);
  }

  rowRecharge(layer, row, { anchor, name }) {
    const right = row.side === "sell";
    if (right && row.rechargeable && row.rechargePrice !== null) {
      layer.button("Shop/BtRecharge", 404, anchor - 19, {
        label: `Recharge ${name}`,
        disabled: this.snapshot.pending,
        action: () => this.recharge(row.uid),
      });
    }
  }

  rowPrice(layer, row, point) {
    if (!row.template) {
      text(layer, row.reason, point.x, { y: point.y, width: 155 });
      return;
    }
    if (row.side === "sell") {
      const value = row.unavailable
        ? row.reason
        : row.rechargePrice !== null && row.rechargeable
          ? `${row.unitPrice.toLocaleString("en-US")} meso / rechrg : ${row.rechargePrice}`
          : `${row.unitPrice.toLocaleString("en-US")} meso`;
      text(layer, value, point.x, { y: point.y, width: 155 });
      return;
    }
    layer.image(
      row.currency === "pitch" ? "Shop/token" : "Shop/meso",
      point.x,
      point.y - 1,
    );
    text(layer, row.pricePerUnit.toLocaleString("en-US"), point.x + 15, {
      y: point.y,
      width: 137,
    });
  }

  tooltip(layer, row) {
    if (!row.template) return row.reason;
    return {
      ...itemTooltip(
        layer.owner,
        row.template,
        row.template.id,
        row.side === "sell" ? { uid: row.uid } : {},
      ),
      source: { surface: layer, path: row.template.iconPath },
    };
  }

  select(side, key) {
    if (this.snapshot.pending) return;
    this.selected[side] = key;
    this.activeSide = side;
    this.drawSelection();
    this.updateButtons();
  }

  drawSelection() {
    for (const value of this.highlights) {
      value.sprite.container.visible = this.selected[value.side] === value.key;
    }
    this.panel.renderArtwork();
  }

  updateButtons() {
    this.buyButton.setDisabled(
      this.snapshot.pending || this.selected.buy === null,
    );
    this.sellButton.setDisabled(
      this.snapshot.pending || this.selected.sell === null,
    );
    this.exitButton.setDisabled(this.snapshot.committing);
  }

  buy() {
    if (this.selected.buy === null) return;
    this.shop
      .buy({ row: this.selected.buy })
      .catch((error) => this.panel.owner.report(error));
  }

  sell() {
    if (this.selected.sell === null) return;
    this.shop
      .sell({ uid: this.selected.sell })
      .catch((error) => this.panel.owner.report(error));
  }

  recharge(uid) {
    this.selected.sell = uid;
    this.shop.recharge(uid).catch((error) => this.panel.owner.report(error));
  }

  key(event) {
    if (event.target.matches("input,textarea,select,[contenteditable=true]")) {
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
  }

  close() {
    return this.shop.close();
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.columns.buy.cancel();
    this.columns.sell.cancel();
  }
}
