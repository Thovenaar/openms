import { loadVisualBundle } from "../rendering/visual-resources.js";
import { NativeScrollbar } from "./ui-scrollbar.js";
import { replaceIcons, drawItemCount } from "./ui-icons.js";
import { itemTooltip } from "./ui-tooltip.js";
import { inventoryType } from "../items/inventory-model.js";

// Original007c618e/007c77ee/007c7c56: Trunk463x318, left5/right4 rows, step40.
const COLUMNS = Object.freeze({
  withdraw: { x: 6, y: 87, rows: 5, scrollX: 210, extent: 197 },
  deposit: { x: 236, y: 127, rows: 4, scrollX: 441, extent: 158 },
});
const TAB_NAMES = ["Equip", "Use", "Setup", "Etc", "Cash"];

function label(panel, value, bounds) {
  const text = panel.text(value, bounds.x, bounds.y, bounds.width);
  text.style.cssText +=
    ";font:12px/14px Arial,sans-serif;color:#000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;";
  return text;
}

export function layoutStorage(panel, storage) {
  if (!storage?.account) {
    throw new Error("No admitted account storage owns this window.");
  }
  panel.nativeClose = true;
  panel.canClose = () => !storage.pending;
  panel.requestClose = () => storage.close().ok;
  const view = new StorageView(panel, storage);
  panel.storageView = view;
  panel.localRefresh = () => view.refresh();
  panel.cleanups.push(() => view.destroy());
  return view;
}

class StorageView {
  constructor(panel, storage) {
    this.panel = panel;
    this.storage = storage;
    this.selected = { deposit: null, withdraw: null };
    this.tab = panel.owner.restoreTab("Trunk", [0, 1, 2, 3, 4]);
    this.disposed = false;
    this.tabSprites = [];
    this.buttons = [];
    panel.image("Trunk/backgrnd", 0, 0);
    this.header = panel.layer("Storage portraits and balance");
    this.balance = label(this.header, "", { x: 290, y: 296, width: 128 });
    this.saved = label(this.header, "", { x: 66, y: 296, width: 124 });
    this.balance.style.textAlign = this.saved.style.textAlign = "right";
    this.controls();
    this.tabs();
    this.columns = {
      withdraw: this.column("withdraw"),
      deposit: this.column("deposit"),
    };
    this.portraits().catch((error) => panel.owner.report(error));
    this.unsubscribe = storage.subscribe(() => this.refresh());
    panel.listen(panel.element, "keydown", (event) => this.key(event));
    this.refresh();
  }

  async portraits() {
    const panel = this.header;
    const metadata =
      panel.owner.index.npcPortraits[this.storage.context.npc.id];
    const resource = await loadVisualBundle(
      metadata.descriptor,
      panel.owner.services,
      panel.owner.controller.signal,
    );
    if (this.disposed || panel.disposed) {
      resource.destroy();
      return;
    }
    panel.dependencies.push(resource);
    panel.borrow(resource);
    // Original007c7326/007c7329 and007c70ef/007c70f1, unscaled original anchors.
    panel.image("NpcPortrait", 53, 76, true);
    this.selfPortrait = panel.owner.hooks.userInfoPortrait?.(panel, {
      x: 288,
      y: 75,
    });
    if (this.selfPortrait) {
      panel.cleanups.push(() => this.selfPortrait.destroy());
      this.selfPortrait.useSurfaceClock();
    }
  }

  controls() {
    const rows = [
      ["BtExit", 154, 15, "Exit storage", null],
      ["BtGet", 154, 35, "Retrieve item", "withdraw"],
      ["BtPut", 384, 15, "Store item", "deposit"],
      ["BtSort", 154, 55, "Arrange storage", "sort"],
      ["BtOutCoin", 5, 294, "Withdraw mesos", "withdraw-meso"],
      ["BtInCoin", 236, 294, "Deposit mesos", "deposit-meso"],
    ];
    for (const [path, x, y, title, kind] of rows) {
      const button = this.panel.button(`Trunk/${path}`, x, y, {
        label: title,
        action: () => (kind ? this.execute(kind) : this.storage.close()),
      });
      this.buttons.push({ button, kind });
    }
  }

  tabPart(path, x, width) {
    const sprite = this.panel.image(path, x, 92);
    sprite.container.scale.x = width / this.panel.assets[path].width;
    return sprite;
  }

  tabs() {
    let x = 241;
    this.tabSprites.push({
      index: -1,
      sprites: [0, 1].map((state) => this.tabPart(`Tab3/left${state}`, 235, 6)),
    });
    for (let index = 0; index < 5; index++) {
      const width = index < 2 ? 33 : 32;
      this.tabSprites.push(this.createTab(index, x, width));
      x += width + 12;
    }
  }

  createTab(index, x, width) {
    const sprites = [0, 1].map((state) =>
      this.tabPart(`Tab3/fill${state}`, x, width),
    );
    const edge = index === 4 ? "right" : "middle";
    const edges = Array.from({ length: index === 4 ? 2 : 3 }, (_, state) =>
      this.tabPart(`Tab3/${edge}${state}`, x + width, index === 4 ? 6 : 12),
    );
    const labels = ["disabled", "enabled"].map((state) => {
      const path = `Trunk/Tab/${state}/${index}`,
        asset = this.panel.assets[path];
      return this.panel.image(
        path,
        x + Math.trunc((width - asset.width) / 2),
        92 + Math.trunc((21 - asset.height) / 2),
      );
    });
    const button = this.panel.hit(
      TAB_NAMES[index],
      { x, y: 92, width, height: 21 },
      { click: () => this.selectTab(index) },
    );
    button.setAttribute("role", "tab");
    return { index, sprites, edges, labels, button };
  }

  selectTab(index) {
    if (this.snapshot.pending) return;
    this.tab = index;
    this.panel.owner.rememberTab("Trunk", index);
    this.selected.deposit = null;
    this.columns.deposit.setRange(1, 0);
    this.refresh();
  }

  drawTabs() {
    for (const tab of this.tabSprites) {
      const active = tab.index === -1 ? this.tab === 0 : this.tab === tab.index;
      for (let state = 0; state < 2; state++) {
        tab.sprites[state].container.visible = Number(active) === state;
        if (tab.labels) {
          tab.labels[state].container.visible = Number(active) === state;
        }
      }
      if (tab.edges) {
        const edgeState = active ? 1 : this.tab === tab.index + 1 ? 2 : 0;
        for (let state = 0; state < tab.edges.length; state++) {
          tab.edges[state].container.visible = state === edgeState;
        }
        tab.button.disabled = this.snapshot.pending;
        tab.button.setAttribute("aria-selected", String(active));
      }
    }
  }

  column(kind) {
    const geometry = COLUMNS[kind];
    const layer = this.panel.layer(`${kind} storage scrolling`);
    layer.element.style.clipPath = `inset(${geometry.y}px ${this.panel.width - geometry.x - 222}px 32px ${geometry.x}px)`;
    const scroll = new NativeScrollbar(
      layer,
      {
        x: geometry.scrollX,
        y: geometry.y + 1,
        extent: geometry.extent,
        style: 3,
      },
      () => this.rows(),
    );
    this.panel.listen(this.panel.element, "wheel", (event) => {
      const point = this.panel.owner.logicalPointer(event);
      const x = point.x - this.panel.x,
        y = point.y - this.panel.y;
      if (
        x >= geometry.x &&
        x < geometry.x + 222 &&
        y >= geometry.y &&
        y < 285 &&
        !layer.element.contains(event.target)
      ) {
        scroll.wheel(event);
      }
    });
    return scroll;
  }

  refresh() {
    if (this.disposed || this.panel.disposed) return;
    this.snapshot = this.storage.snapshot();
    this.balance.textContent = this.snapshot.meso.toLocaleString("en-US");
    this.saved.textContent = this.snapshot.account.meso.toLocaleString("en-US");
    this.drawTabs();
    for (const { button, kind } of this.buttons) {
      const selected = kind === "deposit" || kind === "withdraw";
      button.setDisabled(
        kind === null
          ? this.snapshot.committing
          : this.snapshot.pending || (selected && !this.selected[kind]),
      );
    }
    this.rows();
  }

  rows() {
    const records = [];
    for (const kind of ["withdraw", "deposit"]) {
      const entries =
        kind === "withdraw"
          ? this.snapshot.account.items
          : this.snapshot.inventory.filter(
              (item) => inventoryType(item.id) === this.tab + 1,
            );
      entries.sort(
        (left, right) =>
          inventoryType(left.id) - inventoryType(right.id) ||
          left.slot - right.slot,
      );
      const geometry = COLUMNS[kind],
        scroll = this.columns[kind];
      const count =
        kind === "withdraw" ? this.snapshot.account.slots : entries.length;
      scroll.setRange(Math.max(1, count - geometry.rows + 1));
      for (let row = 0; row < geometry.rows; row++) {
        const item = entries[scroll.position + row];
        if (item) {
          records.push({
            ...item,
            kind,
            row,
            template: this.storage.items[item.id],
          });
        } else if (kind === "withdraw" && scroll.position + row < count) {
          records.push({ kind, row, template: null });
        }
      }
    }
    replaceIcons(this.panel, records, (layer, row) =>
      this.row(layer, row),
    ).catch((error) => this.panel.owner.report(error));
  }

  row(layer, row) {
    const geometry = COLUMNS[row.kind],
      x = geometry.x,
      y = geometry.y + row.row * 40;
    if (row.kind === "withdraw") layer.image("Trunk/en", x, y);
    if (!row.template) return;
    if (row.uid === this.selected[row.kind]) {
      layer.image("Trunk/select", x + 38, y);
    }
    const path = row.template?.iconPath;
    if (path && layer.assets[path]) layer.image(path, x + 1, y + 34, true);
    label(layer, row.template.name, { x: x + 43, y: y + 2, width: 152 });
    if (inventoryType(row.id) >= 2 && inventoryType(row.id) <= 4) {
      drawItemCount(layer, row.count, { x, y });
    }
    const hit = layer.hit(
      `${row.kind} ${row.template.name}`,
      { x, y, width: 198, height: 35 },
      {
        click: () => this.select(row),
        dblclick: () => {
          this.select(row);
          this.execute(row.kind);
        },
      },
      {
        tooltip: () => ({
          ...itemTooltip(layer.owner, row.template, row.id, {
            uid: row.uid,
            quantity: row.count,
          }),
          source: { surface: layer, path },
        }),
      },
    );
    hit.dataset.itemUid = row.uid;
    hit.disabled = this.snapshot.pending;
  }

  select(row) {
    if (this.snapshot.pending) return;
    this.selected[row.kind] = row.uid;
    this.refresh();
  }

  execute(kind) {
    const uid = this.selected[kind];
    if ((kind === "deposit" || kind === "withdraw") && !uid) return;
    this.storage
      .execute({ kind, uid })
      .catch((error) => this.panel.owner.report(error));
  }

  key(event) {
    if (event.key !== "Escape" || event.target.matches("input,textarea")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.storage.close();
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.columns.deposit.cancel();
    this.columns.withdraw.cancel();
  }
}
