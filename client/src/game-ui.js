import { Container } from "pixi.js";
import { loadVisualBundle } from "./visual-resources.js";
import { UISurface } from "./ui-surface.js";
import { HUD_TOP, layoutHud, layoutWindow } from "./ui-layout.js";
import {
  replaceMinimap,
  updateProfilePanel,
  ProfileControls,
} from "./ui-inspection.js";
import { updateProfileHud, finishGaugeWarnings } from "./ui-hud.js";
import { UICursor } from "./ui-cursor.js";
import { UIChat } from "./ui-chat.js";
import { refreshKeys, cancelKeys, keyAtPoint } from "./ui-keyconfig.js";
import {
  layoutQuickSlotConfig,
  closeQuickSlotConfig,
  captureQuickKey,
} from "./ui-quickslot-config.js";
import {
  toggleQuickSlots,
  refreshQuickSlots,
  quickKeyAtPoint,
} from "./ui-quickslots.js";

const MAX_OPEN_WINDOWS = 4;
const WINDOWS = new Set([
  "Item",
  "Equip",
  "Stat",
  "Skill",
  "GameMenu",
  "ShortCut",
  "KeyConfig",
  "MiniMap",
  "UtilDlgEx",
  "QuickSlotConfig",
  "GameOpt",
  "Quest",
  "SysOpt",
]);
const SIZES = {
  MiniMap: [260, 216],
  UtilDlgEx: [529, 206],
  Quest: [529, 206],
  QuickSlotConfig: [266, 238],
};
const STYLE = `.maple-ui-root{position:absolute;pointer-events:none;transform-origin:0 0;z-index:5;font:11px Tahoma,Arial,sans-serif;color:#222;user-select:none}.maple-ui-root button{pointer-events:auto;cursor:pointer;font:11px Tahoma,Arial,sans-serif;min-height:0;min-width:0;box-sizing:border-box;margin:0;line-height:normal}.maple-ui-root .maple-ui-hit{padding:0;border:0;background:transparent;color:transparent;box-shadow:none;border-radius:0}.maple-ui-root .maple-ui-hit:focus-visible{outline:1px solid #ffc63d;outline-offset:1px}.maple-ui-root .maple-ui-local{padding:3px 5px;background:#263442;color:white;border:1px solid #a6bed0;border-radius:2px;white-space:nowrap}.maple-ui-root .maple-ui-text{white-space:pre-wrap;line-height:1.35;overflow-wrap:anywhere;pointer-events:none}.maple-ui-root .maple-ui-unavailable{background:rgba(255,255,240,.94);padding:4px;box-sizing:border-box;border:1px solid #c6ad75}.maple-ui-root .maple-ui-status{color:white;background:#273342;padding:3px}.maple-ui-root .maple-ui-dialog-text{color:#222}.maple-ui-root .maple-ui-tooltip{position:absolute;max-width:300px;background:#20252a;color:white;padding:6px;border:1px solid #a9b6c2;white-space:pre-wrap;z-index:100;pointer-events:none}.maple-ui-root .maple-ui-drag{position:absolute;left:0;top:0;height:20px;cursor:move;background:transparent;touch-action:none}`;
const LOCAL_STYLE = `.maple-ui-root .maple-ui-content{white-space:pre-wrap;line-height:1.35;overflow-wrap:anywhere;user-select:text}.maple-ui-root .maple-ui-profile{font-size:11px}.maple-ui-root .maple-ui-content button{position:static;white-space:normal}.maple-ui-root select,.maple-ui-root input{pointer-events:auto;max-width:100%;box-sizing:border-box}.maple-ui-root .maple-ui-status{box-sizing:border-box}.maple-ui-root .maple-ui-save-actions{display:flex;gap:8px;margin-top:8px}`;
const CURSOR_STYLE =
  ".maple-ui-root.maple-ui-original-cursor,.maple-ui-root.maple-ui-original-cursor *{cursor:none!important}.maple-ui-chat-log{position:absolute;overflow:hidden;font:12px Arial,sans-serif;line-height:13px;color:white;white-space:pre-wrap;pointer-events:none}";
const FOCUSABLE =
  "button:not([disabled]):not([hidden]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex='0']";

/** Resolve retained window sizes or original background dimensions within the logical viewport. */
function windowSize(name, resource) {
  const asset = resource.manifest.metadata.assets?.[`${name}/backgrnd`];
  const size = SIZES[name] || [asset?.width, asset?.height];
  if (
    !size.every((value) => Number.isFinite(value) && value > 0) ||
    size[0] > 800 ||
    size[1] > HUD_TOP
  ) {
    throw new Error(`Invalid UI dimensions: ${name}`);
  }
  return [size[0], size[1]];
}

function windowBounds(panel) {
  const bounds = panel.root.getLocalBounds();
  return [
    panel.x + Math.min(0, bounds.x),
    panel.y + Math.min(0, bounds.y),
    panel.x +
      Math.max(panel.width, panel.element.scrollWidth, bounds.x + bounds.width),
    panel.y +
      Math.max(
        panel.height,
        panel.element.scrollHeight,
        bounds.y + bounds.height,
      ),
  ];
}

/** Subtract opaque browser window envelopes without leaking through overlapping occluders. */
function subtractWindow(rectangles, [left, top, right, bottom]) {
  const visible = [];
  for (const rectangle of rectangles) {
    const [x1, y1, x2, y2] = rectangle;
    const l = Math.max(x1, left);
    const t = Math.max(y1, top);
    const r = Math.min(x2, right);
    const b = Math.min(y2, bottom);
    if (l >= r || t >= b) {
      visible.push(rectangle);
      continue;
    }
    if (y1 < t) visible.push([x1, y1, x2, t]);
    if (b < y2) visible.push([x1, b, x2, y2]);
    if (x1 < l) visible.push([x1, t, l, b]);
    if (r < x2) visible.push([r, t, x2, b]);
  }
  return visible;
}

/** Screen-space UI owner. Browser window/focus policy is explicit, not a claim about original global arbitration. */
export class GameUI {
  constructor(app, services, hooks) {
    this.app = app;
    this.services = services;
    this.hooks = hooks;
    this.root = new Container({ label: "game-ui" });
    this.root.zIndex = 1000000;
    app.stage.addChild(this.root);
    this.host = document.createElement("div");
    this.host.className = "maple-ui-root";
    this.host.style.width = "800px";
    this.host.style.height = "600px";
    this.style = document.createElement("style");
    this.style.textContent = STYLE + LOCAL_STYLE + CURSOR_STYLE;
    this.host.append(this.style);
    app.canvas.parentElement.append(this.host);
    this.tooltip = document.createElement("div");
    this.tooltip.className = "maple-ui-tooltip";
    this.tooltip.hidden = true;
    this.host.append(this.tooltip);
    this.windows = new Map();
    this.pending = new Map();
    this.epoch = 0;
    this.prepareController = null;
    this.controller = new AbortController();
    this.scene = null;
    this.disposed = false;
    this.visible = true;
    this.drag = null;
    this.dialogText = "";
    this.dialogNpc = null;
    this.dialogMode = "notice";
    this.store = null;
    this.quests = null;
    this.saving = false;
    this.resetting = false;
    this.layoutGeneration = 0;
    this.bindings = null;
    this.bindingDrag = null;
    this.confirmAction = null;
    this.quickCapture = null;
    this.pointerPoint = { x: 0, y: 0 };
    this.layoutFrame = null;
    this.keyHandler = this.onKey.bind(this);
    this.pointerHandler = this.onPointer.bind(this);
    this.focusHandler = this.onFocus.bind(this);
    this.moveHandler = this.onDrag.bind(this);
    this.releaseHandler = this.endDrag.bind(this);
    window.addEventListener("keydown", this.keyHandler, true);
    window.addEventListener("pointerdown", this.pointerHandler, true);
    window.addEventListener("focusin", this.focusHandler, true);
    window.addEventListener("pointermove", this.moveHandler, true);
    window.addEventListener("pointerup", this.releaseHandler, true);
    window.addEventListener("pointercancel", this.releaseHandler, true);
    window.addEventListener("blur", this.releaseHandler);
    document.addEventListener("visibilitychange", this.releaseHandler);
    this.resize(app.screen.width, app.screen.height);
    this.observeLayout();
  }

  validateIndex(index) {
    if (
      index?.schemaVersion !== 1 ||
      !index.bundles?.StatusBar ||
      !index.bundles.Basic ||
      !index.minimaps
    ) {
      throw new Error("Unsupported UI catalog");
    }
  }

  /** Prepare replacement HUD offscreen; old UI survives a failed or aborted catalog refresh. */
  async prepare(index, signal) {
    if (this.disposed) throw new Error("UI is destroyed");
    this.validateIndex(index);
    this.prepareController?.abort();
    const controller = new AbortController();
    this.prepareController = controller;
    const combined = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    let resource = null,
      basic = null,
      cursorResource = null,
      panel = null;
    try {
      resource = await loadVisualBundle(
        index.bundles.StatusBar,
        this.services,
        combined,
      );
      basic = await loadVisualBundle(
        index.bundles.Basic,
        this.services,
        combined,
      );
      cursorResource = await loadVisualBundle(
        index.bundles.Cursor,
        this.services,
        combined,
      );
      combined.throwIfAborted();
      panel = new UISurface(this, "StatusBar", resource, [800, 600]);
      panel.dependencies.push(basic);
      panel.basic = basic;
      panel.borrow(basic);
      basic = null;
      panel.position(0, 0);
      layoutHud(panel, index);
      combined.throwIfAborted();
      this.installHud(panel, index, cursorResource);
      panel = null;
      resource = null;
      cursorResource = null;
    } catch (error) {
      basic?.destroy();
      cursorResource?.destroy();
      if (panel) panel.destroy();
      else resource?.destroy();
      throw error;
    } finally {
      if (this.prepareController === controller) this.prepareController = null;
    }
  }

  installHud(panel, index, cursorResource) {
    this.controller.abort();
    this.controller = new AbortController();
    this.epoch++;
    this.closeAll();
    this.chat?.destroy();
    this.cursor?.destroy();
    this.hud?.destroy();
    this.hud = panel;
    this.index = index;
    this.cursor = new UICursor(this, cursorResource);
    this.chat = new UIChat(this, this.hud);
    this.root.setChildIndex(this.hud.root, 0);
    this.refreshProfile();
  }

  help(target) {
    const record = this.index?.help?.[target];
    return record ? `${record.title}\n${record.description}` : target;
  }

  sound(name) {
    this.hooks.playSound?.("UI", name);
  }

  /** Subscribe to durable authority; profile root may be null after an explicit load failure. */
  setProfile(store, quests) {
    if (
      !store ||
      typeof store.subscribe !== "function" ||
      typeof store.flush !== "function"
    ) {
      throw new Error("UI requires a subscribable ProfileStore");
    }
    this.unsubscribeProfile?.();
    this.store = store;
    this.quests = quests;
    const jobs = quests?.knownJobs() || [];
    if (
      !Array.isArray(jobs) ||
      jobs.length > 1024 ||
      !jobs.every((id) => Number.isSafeInteger(id) && id >= 0)
    ) {
      throw new Error("Invalid retained quest job catalog");
    }
    this.knownJobs = jobs.slice();
    this.profileControls?.destroy();
    this.profileControls = new ProfileControls(this);
    this.unsubscribeProfile = store.subscribe(() => this.refreshProfile());
    this.refreshProfile();
  }

  setBindings(service) {
    this.unsubscribeBindings?.();
    this.bindings = service;
    this.unsubscribeBindings = service.subscribe(() => {
      refreshKeys(this.windows.get("KeyConfig"));
      refreshQuickSlots(this);
    });
    refreshKeys(this.windows.get("KeyConfig"));
    refreshQuickSlots(this);
  }

  status(message) {
    this.lastStatus = String(message).slice(0, 1800);
    this.hooks.onStatus?.(this.lastStatus);
  }

  refreshProfile() {
    if (this.disposed) return;
    this.profileControls?.refresh();
    updateProfileHud(this.hud, this.store);
    refreshQuickSlots(this);
    for (const panel of this.windows.values()) {
      this.refreshProfilePanel(panel);
      panel.dialogCleanup?.refresh?.();
    }
  }

  refreshProfilePanel(panel) {
    if (panel.name === "KeyConfig") refreshKeys(panel);
    else updateProfilePanel(panel, this.store);
  }

  /** Recovery is queued by field authority; the UI never grants HP or moves the avatar. */
  recoverProfile() {
    if (this.store?.profile?.hp !== 0 || !this.hooks.onRecover) return;
    try {
      const accepted = this.hooks.onRecover();
      this.status(
        accepted
          ? "Local recovery queued."
          : "Recovery is not ready. Wait for the local death animation, then try again.",
      );
      if (accepted) this.hooks.focusGame();
    } catch (error) {
      this.report(error);
    }
  }

  async saveProfile() {
    if (!this.store?.profile || this.saving || this.resetting) return;
    this.saving = true;
    this.refreshProfile();
    try {
      await this.hooks.onSave?.();
      await this.store.flush();
    } catch (error) {
      this.report(error);
      this.notice(`Local save failed: ${error.message}`);
    } finally {
      this.saving = false;
      this.refreshProfile();
    }
  }

  requestReset() {
    if (!this.store || this.saving || this.resetting) return;
    this.dialogMode = "reset";
    this.dialogNpc = null;
    this.refreshDialog();
  }

  async resetProfile() {
    if (!this.store || this.saving || this.resetting) return;
    this.resetting = true;
    this.refreshProfile();
    try {
      await this.store.reset();
      await this.hooks.onReset?.();
      this.closeAll();
      this.hooks.focusGame();
    } catch (error) {
      this.report(error);
      this.notice(`Local reset failed: ${error.message}`);
    } finally {
      this.resetting = false;
      this.refreshProfile();
    }
  }

  activate(name) {
    if (name === "QuickSlot") {
      toggleQuickSlots(this).catch((error) => this.report(error));
      return;
    }
    if (WINDOWS.has(name)) {
      this.open(name).catch((error) => this.report(error));
      return;
    }
    this.status(
      `${name} requires original session/server behavior that is not available. No operation was sent.`,
    );
  }

  /** Demand-load one window; repeated requests coalesce and closed/cancelled loads never resurrect it. */
  async open(name) {
    if (!WINDOWS.has(name) || !this.index) {
      throw new Error(`Unsupported UI window ${name}`);
    }
    const existing = this.windows.get(name);
    if (existing) {
      this.front(existing);
      return existing;
    }
    if (this.pending.has(name)) return this.pending.get(name).promise;
    if (this.windows.size + this.pending.size >= MAX_OPEN_WINDOWS) {
      throw new Error(
        "Close a UI window before opening another (four-window residency bound).",
      );
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, this.controller.signal]);
    const task = { controller, promise: null };
    task.promise = this.loadWindow(name, signal).finally(() => {
      if (this.pending.get(name) === task) this.pending.delete(name);
    });
    this.pending.set(name, task);
    return task.promise;
  }

  async loadWindow(name, signal) {
    let resource = await loadVisualBundle(
      this.index.bundles[
        name === "Quest"
          ? "UtilDlgEx"
          : name === "QuickSlotConfig"
            ? "KeyConfig"
            : name
      ],
      this.services,
      signal,
    );
    let panel = null;
    try {
      signal.throwIfAborted();
      panel = new UISurface(this, name, resource, windowSize(name, resource));
      panel.borrow(this.hud.basic);
      resource = null;
      this.compose(panel);
      this.addWindowChrome(panel);
      signal.throwIfAborted();
      this.windows.set(name, panel);
      this.front(panel);
      this.hooks.clearInput();
      if (name === "QuickSlotConfig") {
        panel.element.focus({ preventScroll: true });
      } else panel.element.querySelector("button")?.focus();
      if (name === "MiniMap") this.refreshMinimap(panel);
      this.refreshProfilePanel(panel);
      return panel;
    } catch (error) {
      if (panel) panel.destroy();
      else resource?.destroy();
      throw error;
    }
  }

  compose(panel) {
    if (panel.name === "QuickSlotConfig") return layoutQuickSlotConfig(panel);
    layoutWindow(panel);
    if (panel.name === "UtilDlgEx" || panel.name === "Quest") {
      this.mountDialog(panel);
    }
  }

  /** Initial centering, drag strip and viewport clamping are browser policies, not inferred WZ origins. */
  addWindowChrome(panel) {
    const offset = this.windows.size * 18;
    this.positionWindow(panel, (800 - panel.width) / 2 + offset, 70 + offset);
    const strip = document.createElement("div");
    strip.className = "maple-ui-drag";
    strip.style.width = `${panel.width - 24}px`;
    panel.listen(strip, "pointerdown", (event) => this.beginDrag(event, panel));
    panel.element.prepend(strip);
    panel.dragStrip = strip;
    if (panel.name === "QuickSlotConfig") return;
    panel.closeControl = panel.button("BtClose", panel.width - 17, 6, {
      label: `Close ${panel.name}`,
      action: () => this.close(panel.name),
    });
  }

  positionWindow(panel, x, y) {
    panel.position(
      Math.max(0, Math.min(800 - panel.width, x)),
      Math.max(0, Math.min(HUD_TOP - panel.height, y)),
    );
  }

  front(panel) {
    this.root.setChildIndex(panel.root, this.root.children.length - 1);
    if (this.cursor) {
      this.root.setChildIndex(
        this.cursor.surface.root,
        this.root.children.length - 1,
      );
    }
    this.windows.delete(panel.name);
    this.windows.set(panel.name, panel);
    // Keep DOM nodes attached during pointerdown so native click/focus survives.
    let depth = 1;
    for (const window of this.windows.values()) {
      window.element.style.zIndex = String(depth++);
    }
    this.clipDomWindows();
  }

  /** Pixi rasterizes every window below the DOM plane; lower DOM captions must not bleed over a higher window. */
  clipDomWindows() {
    const panels = this.hud
      ? [this.hud, ...this.windows.values()]
      : [...this.windows.values()];
    const bounds = panels.map(windowBounds);
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      if (i === panels.length - 1) {
        panel.element.style.clipPath = "";
        continue;
      }
      let visible = [bounds[i]];
      for (let j = i + 1; j < panels.length; j++) {
        visible = subtractWindow(visible, bounds[j]);
      }
      const path = visible
        .map(
          ([l, t, r, b]) =>
            `M${l - panel.x} ${t - panel.y}H${r - panel.x}V${b - panel.y}H${l - panel.x}Z`,
        )
        .join("");
      panel.element.style.clipPath = path ? `path("${path}")` : "inset(50%)";
    }
  }

  close(name, committed = false) {
    this.pending.get(name)?.controller.abort();
    const panel = this.windows.get(name);
    if (name === "UtilDlgEx") this.confirmAction = null;
    if (name === "QuickSlotConfig") closeQuickSlotConfig(this, committed);
    if (!panel) return;
    if (name === "KeyConfig" && !committed && this.bindings) {
      if (this.bindings.hasChanges()) {
        cancelKeys(panel);
        return;
      }
      this.bindings.cancel();
    }
    if (name === "KeyConfig") this.closeQuickCapture(committed);
    this.removeWindow(panel);
  }

  closeQuickCapture(committed) {
    this.pending.get("QuickSlotConfig")?.controller.abort();
    if (this.quickCapture === null) return;
    closeQuickSlotConfig(this, committed);
    const panel = this.windows.get("QuickSlotConfig");
    if (panel) this.removeWindow(panel);
  }

  removeWindow(panel) {
    if (this.bindingDrag) this.endBindingDrag();
    panel.mapController?.abort();
    if (this.drag?.panel === panel) this.drag = null;
    this.windows.delete(panel.name);
    panel.destroy();
    this.clipDomWindows();
    this.hideTooltip();
    this.hooks.clearInput();
    const modal = this.modal();
    if (modal) modal.element.querySelector("button")?.focus();
    else this.hooks.focusGame();
  }

  closeAll() {
    this.endBindingDrag();
    this.bindings?.cancel();
    this.quickCapture = null;
    this.quickCaptureChanges = [];
    this.confirmAction = null;
    for (const task of this.pending.values()) task.controller.abort();
    this.pending.clear();
    for (const panel of this.windows.values()) {
      panel.mapController?.abort();
      panel.destroy();
    }
    this.windows.clear();
    this.clipDomWindows();
    this.hideTooltip();
    this.drag = null;
  }

  notice(text) {
    this.dialogText = String(text).slice(0, 1800);
    this.dialogMode = "notice";
    this.dialogNpc = null;
    this.refreshDialog();
  }

  /** Only the quest owner may interpret original NPC/quest data or mutate quest state. */
  showNpc(record) {
    const id = record?.templateId;
    const validId =
      (typeof id === "string" && /^\d{1,8}$/.test(id)) ||
      (Number.isSafeInteger(id) && id >= 0 && id <= 99999999);
    if (!record || typeof record.name !== "string" || !validId) {
      throw new Error("Invalid NPC UI interaction record");
    }
    if (typeof record.canInteract !== "function" || !record.canInteract()) {
      this.notice(
        "NPC interaction is no longer available. Approach a visible nearby NPC while alive.",
      );
      return;
    }
    this.dialogNpc = record;
    this.dialogMode = "npc";
    this.refreshDialog();
  }

  refreshDialog() {
    const panel = this.windows.get("UtilDlgEx");
    if (panel) {
      this.mountDialog(panel);
      this.front(panel);
      panel.element.querySelector(FOCUSABLE)?.focus();
    } else this.activate("UtilDlgEx");
  }

  mountDialog(panel) {
    panel.dialogCleanup?.();
    panel.dialogCleanup = null;
    panel.content.replaceChildren();
    if (!panel.dialogDisposal) {
      panel.dialogDisposal = true;
      panel.cleanups.push(() => panel.dialogCleanup?.());
    }
    if (panel.name === "Quest" && this.hooks.onQuestJournal) {
      panel.dialogCleanup = this.hooks.onQuestJournal(panel);
    } else if (panel.name === "Quest") {
      panel.content.textContent = "Local quest journal is not connected.";
    } else if (this.dialogMode === "npc" && this.hooks.onNpcDialogue) {
      panel.dialogCleanup = this.hooks.onNpcDialogue(panel, this.dialogNpc);
    } else if (this.dialogMode === "reset") this.mountReset(panel);
    else if (this.dialogMode === "confirm") this.mountConfirmation(panel);
    else {
      panel.content.textContent =
        this.dialogMode === "npc"
          ? `${this.dialogNpc.name}: local quest dialogue is not connected. Original NPC scripts remain unavailable.`
          : this.dialogText ||
            "Local dialogue presentation. Original server scripts are unavailable.";
    }
  }

  confirm(text, action) {
    this.confirmAction = action;
    this.dialogText = text;
    this.dialogMode = "confirm";
    this.refreshDialog();
  }

  mountConfirmation(panel) {
    panel.content.textContent = this.dialogText;
    const layer = panel.layer("Confirmation");
    layer.button("BtOK", 300, 176, {
      label: "OK",
      action: () => {
        const action = this.confirmAction;
        this.close("UtilDlgEx");
        action?.();
      },
    });
    layer.button("BtCancel2", 355, 176, {
      label: "Cancel",
      action: () => this.close("UtilDlgEx"),
    });
    panel.dialogCleanup = () => layer.destroy();
  }

  openQuickSlotCapture() {
    if (!this.bindings || this.quickCapture !== null) return;
    this.quickCapture = -1;
    const changes = [];
    this.quickCaptureChanges = changes;
    this.hooks.clearInput();
    this.open("QuickSlotConfig").catch((error) => {
      if (this.quickCaptureChanges === changes) this.close("QuickSlotConfig");
      this.report(error);
    });
  }

  mountReset(panel) {
    panel.content.textContent =
      "RESET LOCAL PROFILE\nThis permanently replaces this browser's name, statistics, inventory, quests, location and settings with the provisional beginner profile. No server is contacted.";
    const actions = document.createElement("div");
    actions.className = "maple-ui-save-actions";
    const confirm = document.createElement("button");
    confirm.className = "maple-ui-local";
    confirm.type = "button";
    confirm.textContent = "Reset local profile";
    const cancel = confirm.cloneNode(false);
    cancel.textContent = "Cancel";
    const reset = () => {
      confirm.disabled = true;
      this.resetProfile();
    };
    const close = () => this.close(panel.name);
    confirm.addEventListener("click", reset);
    cancel.addEventListener("click", close);
    actions.append(confirm, cancel);
    panel.content.append(actions);
    panel.dialogCleanup = () => {
      confirm.removeEventListener("click", reset);
      cancel.removeEventListener("click", close);
    };
  }

  showTooltip(text, x, y) {
    this.tooltip.textContent = String(text).slice(0, 1800);
    this.tooltip.hidden = false;
    this.tooltip.style.maxHeight = "560px";
    this.tooltip.style.overflow = "hidden";
    const width = this.tooltip.offsetWidth,
      height = this.tooltip.offsetHeight;
    this.tooltip.style.left = `${Math.max(0, Math.min(800 - width, x))}px`;
    this.tooltip.style.top = `${Math.max(0, Math.min(600 - height, y - height - 6))}px`;
  }

  hideTooltip() {
    this.tooltip.hidden = true;
  }

  toggleInventorySkin(panel) {
    if (!panel.fullSkin) {
      panel.fullSkin = panel.image("Item/FullBackgrnd", 0, 0);
    } else panel.fullSkin.container.visible = !panel.fullSkin.container.visible;
    panel.root.setChildIndex(panel.fullSkin.container, 0);
    const full = panel.fullSkin.container.visible;
    panel.sprites[0].container.visible = !full;
    const asset = panel.assets[full ? "Item/FullBackgrnd" : "Item/backgrnd"];
    panel.width = asset.width;
    panel.height = asset.height;
    panel.element.style.width = `${panel.width}px`;
    panel.element.style.height = `${panel.height}px`;
    panel.dragStrip.style.width = `${panel.width - 24}px`;
    panel.closeControl.position(panel.width - 17, 6);
    panel.gatherControl.position(panel.width - 32, 6);
    panel.fullControl.position(panel.width - 47, 6);
    panel.smallControl.position(panel.width - 47, 6);
    panel.fullControl.setVisible(!full);
    panel.smallControl.setVisible(full);
    panel.inventorySignature = null;
    this.refreshProfilePanel(panel);
    this.positionWindow(panel, panel.x, panel.y);
    (full ? panel.smallControl : panel.fullControl).element.focus();
    this.clipDomWindows();
  }

  setScene(scene) {
    this.scene = scene;
    const panel = this.windows.get("MiniMap");
    if (panel) this.refreshMinimap(panel);
  }

  refreshMinimap(panel) {
    panel.mapController?.abort();
    panel.mapController = new AbortController();
    const signal = AbortSignal.any([
      panel.mapController.signal,
      this.controller.signal,
    ]);
    replaceMinimap(this, panel, signal).catch((error) => {
      if (!signal.aborted) {
        panel.mapStatus.textContent =
          "Minimap load failed; previous complete artwork retained.";
      }
      this.report(error);
    });
  }
  /** World-only compositing inspection gate; does not destroy or alter window state. */
  setVisible(visible) {
    if (typeof visible !== "boolean") {
      throw new Error("UI visibility must be boolean");
    }
    this.visible = visible;
    this.root.visible = visible;
    this.host.hidden = !visible;
    this.drag = null;
    this.endBindingDrag();
    if (this.cursor) this.cursor.surface.root.visible = false;
    this.hooks.clearInput();
    if (!visible) this.hooks.focusGame();
  }

  update(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error("Invalid UI elapsed milliseconds");
    }
    if (!this.visible) return;
    this.hud?.update(ms);
    finishGaugeWarnings(this.hud);
    for (const panel of this.windows.values()) panel.update(ms);
    this.cursor?.update(ms);
  }

  resize(width, height) {
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new Error("Invalid UI viewport");
    }
    this.scale = Math.min(1, width / 800, height / 600);
    this.offsetX = (width - 800 * this.scale) / 2;
    this.offsetY = height - 600 * this.scale;
    this.root.scale.set(this.scale);
    this.root.position.set(this.offsetX, this.offsetY);
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.syncDomLayout();
    this.clipDomWindows();
  }

  /** Track canvas resize and ancestor layout changes without querying layout in the animation loop. */
  observeLayout() {
    this.layoutHandler = this.scheduleLayout.bind(this);
    this.layoutCommit = this.commitLayout.bind(this);
    this.layoutObserver = new ResizeObserver(this.layoutHandler);
    this.layoutObserver.observe(this.app.canvas);
    this.layoutObserver.observe(this.host.parentElement);
    this.layoutMutations = new MutationObserver(this.layoutHandler);
    this.layoutMutations.observe(this.app.canvas, {
      attributes: true,
      attributeFilter: ["class", "style", "width", "height"],
    });
    let ancestor = this.host.parentElement,
      depth = 0;
    while (ancestor && depth++ < 32) {
      this.layoutMutations.observe(ancestor, {
        attributes: true,
        childList: true,
      });
      ancestor = ancestor.parentElement;
    }
    if (ancestor) {
      throw new Error("UI ancestor layout depth exceeds supported bound");
    }
    window.addEventListener("resize", this.layoutHandler);
    window.addEventListener("scroll", this.layoutHandler, true);
  }

  scheduleLayout() {
    if (this.disposed || this.layoutFrame !== null) return;
    this.layoutFrame = requestAnimationFrame(this.layoutCommit);
  }

  commitLayout() {
    this.layoutFrame = null;
    if (!this.disposed) this.syncDomLayout();
  }

  syncDomLayout() {
    const parent = this.host.parentElement;
    const canvasRect = this.app.canvas.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    if (
      canvasRect.width <= 0 ||
      canvasRect.height <= 0 ||
      parent.offsetWidth <= 0 ||
      parent.offsetHeight <= 0
    ) {
      return;
    }
    const parentScaleX = parentRect.width / parent.offsetWidth;
    const parentScaleY = parentRect.height / parent.offsetHeight;
    if (parentScaleX <= 0 || parentScaleY <= 0) return;
    const ratioX = canvasRect.width / this.viewportWidth / parentScaleX;
    const ratioY = canvasRect.height / this.viewportHeight / parentScaleY;
    const left =
      (canvasRect.left - parentRect.left) / parentScaleX -
      parent.clientLeft +
      parent.scrollLeft;
    const top =
      (canvasRect.top - parentRect.top) / parentScaleY -
      parent.clientTop +
      parent.scrollTop;
    this.host.style.left = `${left + this.offsetX * ratioX}px`;
    this.host.style.top = `${top + this.offsetY * ratioY}px`;
    this.host.style.transform = `scale(${this.scale * ratioX},${this.scale * ratioY})`;
    this.screenScaleX = this.scale * ratioX * parentScaleX;
    this.screenScaleY = this.scale * ratioY * parentScaleY;
    this.layoutGeneration++;
  }

  onKey(event) {
    if (!this.acceptsKey(event)) return;
    if (captureQuickKey(this, event)) return;
    if (this.chat?.handle(event)) return;
    const modal = this.modal();
    if (modal && this.captureModalKey(event, modal)) return;
    if (this.captureControlInput(event, modal)) return;
    if (this.captureWindowKey(event)) return;
    if (!event.repeat && this.bindings?.activateCode(event.code)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  captureWindowKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const last = Array.from(this.windows.keys()).pop();
      if (last) this.close(last);
      else if (this.chat?.state !== 1) this.chat.close();
      else this.activate("GameMenu");
      return true;
    }
    if (event.key === "Enter" && event.target === this.app.canvas) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.chat?.open();
      return true;
    }
    return false;
  }
  captureControlInput(event, modal) {
    if (!this.host.contains(event.target)) return false;
    const editing =
      event.target.isContentEditable ||
      event.target.matches("input,select,textarea");
    if (!modal && !editing) return false;
    this.hooks.clearInput();
    event.stopImmediatePropagation();
    return true;
  }

  acceptsKey(event) {
    if (
      !this.visible ||
      !this.index ||
      event.metaKey ||
      (event.altKey && this.quickCapture === null)
    ) {
      return false;
    }
    return this.host.contains(event.target) || event.target === this.app.canvas;
  }

  modal() {
    return this.windows.get("QuickSlotConfig") || this.windows.get("UtilDlgEx");
  }

  blocksGameplay() {
    return Boolean(
      this.modal() ||
      this.pending.has("UtilDlgEx") ||
      this.quickCapture !== null,
    );
  }

  captureModalKey(event, panel) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.close(panel.name);
      return true;
    }
    if (!panel.element.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      panel.element.querySelector("button")?.focus();
      this.hooks.clearInput();
      return true;
    }
    if (event.key !== "Tab") return false;
    const buttons = Array.from(
      panel.element.querySelectorAll(FOCUSABLE),
    ).filter((element) => element.getClientRects().length > 0);
    const edge = event.shiftKey ? buttons[0] : buttons[buttons.length - 1];
    if (event.target === edge) {
      event.preventDefault();
      buttons[event.shiftKey ? buttons.length - 1 : 0]?.focus();
    }
    return false;
  }

  onPointer(event) {
    if (!this.visible) return;
    this.cursor?.move(event);
    const canvas = event.target === this.app.canvas;
    if (!canvas && !this.host.contains(event.target)) return;
    if (event.button === 0) this.cursor?.press();
    if (this.captureModalPointer(event)) return;
    if (canvas) {
      this.hooks.focusGame();
      return;
    }
    this.hooks.clearInput();
    for (const panel of this.windows.values()) {
      if (panel.element.contains(event.target)) {
        this.front(panel);
        break;
      }
    }
  }

  captureModalPointer(event) {
    const modal = this.modal();
    if (!modal || modal.element.contains(event.target)) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    modal.element.querySelector("button")?.focus();
    return true;
  }

  onFocus(event) {
    if (this.visible && this.host.contains(event.target)) {
      this.hooks.clearInput();
    }
  }

  beginDrag(event, panel) {
    if (event.button !== 0) return;
    if (!this.screenScaleX || !this.screenScaleY) return;
    event.preventDefault();
    this.front(panel);
    this.hooks.clearInput();
    this.drag = {
      panel,
      x: event.clientX,
      y: event.clientY,
      startX: panel.x,
      startY: panel.y,
    };
  }

  onDrag(event) {
    this.cursor?.move(event);
    this.chat?.move(event);
    if (this.bindingDrag) {
      event.preventDefault();
      return;
    }
    if (!this.drag) return;
    event.preventDefault();
    const drag = this.drag;
    this.positionWindow(
      drag.panel,
      drag.startX + (event.clientX - drag.x) / this.screenScaleX,
      drag.startY + (event.clientY - drag.y) / this.screenScaleY,
    );
    this.clipDomWindows();
  }

  endDrag(event) {
    if (
      this.bindingDrag &&
      event?.pointerId !== undefined &&
      event.pointerId !== this.bindingDrag.pointerId
    ) {
      return;
    }
    this.drag = null;
    this.chat?.endResize();
    if (this.bindingDrag && event?.type === "pointerup") {
      this.dropBinding(event);
    } else if (this.bindingDrag) this.endBindingDrag();
    this.cursor?.release();
  }

  logicalPointer(event) {
    const rect = this.host.getBoundingClientRect();
    this.pointerPoint.x = (event.clientX - rect.left) / this.screenScaleX;
    this.pointerPoint.y = (event.clientY - rect.top) / this.screenScaleY;
    return this.pointerPoint;
  }
  beginBindingDrag(event, binding, sourceIndex, { source, path }) {
    if (
      event.button !== 0 ||
      this.blocksGameplay() ||
      !this.bindings ||
      !binding.type
    ) {
      return;
    }
    if (!this.windows.has("KeyConfig")) return;
    event.preventDefault();
    this.endBindingDrag();
    this.hooks.clearInput();
    const capture = event.currentTarget;
    capture.setPointerCapture(event.pointerId);
    this.bindingDrag = {
      binding: { type: binding.type, id: binding.id },
      sourceIndex,
      source,
      capture,
      pointerId: event.pointerId,
    };
    this.cursor?.drag(source, path);
  }

  dropBinding(event) {
    const drag = this.bindingDrag;
    const panel = this.windows.get("KeyConfig");
    const point = this.logicalPointer(event);
    const target = keyAtPoint(panel, point);
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const quickTarget = quickKeyAtPoint(this, point);
    if (
      quickTarget !== null &&
      this.hud.quickSurface.element.contains(element)
    ) {
      this.bindings.assign(quickTarget, drag.binding, drag.sourceIndex);
    } else if (target !== null && panel.element.contains(element)) {
      if (target > 90 && drag.sourceIndex !== null) {
        this.bindings.remove(drag.sourceIndex);
      } else if (target < 89) {
        this.bindings.assign(target, drag.binding, drag.sourceIndex);
      }
    }
    this.endBindingDrag();
  }

  endBindingDrag() {
    const drag = this.bindingDrag;
    const source = drag?.source;
    if (drag?.capture.hasPointerCapture(drag.pointerId)) {
      drag.capture.releasePointerCapture(drag.pointerId);
    }
    this.bindingDrag = null;
    this.cursor?.clearGhost();
    if (source?.retainedForDrag) source.destroy();
  }
  report(error) {
    if (error?.name !== "AbortError") this.hooks.onError(error);
  }

  snapshot() {
    return {
      ready: Boolean(this.index),
      visible: this.visible,
      authority: this.index?.authority || null,
      windows: Array.from(this.windows.keys()),
      pending: Array.from(this.pending.keys()),
      ...this.inputSnapshot(),
      status: this.lastStatus || null,
      focused: this.host.contains(document.activeElement),
      sprites:
        (this.hud?.sprites.length || 0) +
        Array.from(this.windows.values()).reduce(
          (sum, panel) => sum + panel.sprites.length,
          0,
        ),
      scale: this.scale,
      minimap: this.windows.get("MiniMap")?.mapId || null,
      layoutGeneration: this.layoutGeneration,
      offsetX: this.offsetX,
      offsetY: this.offsetY,
      localProfile: this.store?.snapshot() || null,
      originalTiming:
        "Only explicitly authored frame delays advance; missing timing is static/unsupported.",
    };
  }

  inputSnapshot() {
    return {
      chat: this.chat
        ? {
            state: this.chat.state,
            focused: document.activeElement === this.chat.input,
            historyCount: this.chat.history.length,
          }
        : null,
      cursor: this.cursor?.current ?? null,
      draggingBinding: this.bindingDrag?.binding || null,
      keyBindings: this.bindings?.snapshot() || null,
      gaugeExtents: this.hud?.gauges?.map((gauge) => gauge.extent) || null,
    };
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.prepareController?.abort();
    this.controller.abort();
    this.closeAll();
    this.unsubscribeProfile?.();
    this.unsubscribeBindings?.();
    this.profileControls?.destroy();
    this.chat?.destroy();
    this.cursor?.destroy();
    this.layoutObserver?.disconnect();
    this.layoutMutations?.disconnect();
    if (this.layoutFrame !== null) cancelAnimationFrame(this.layoutFrame);
    window.removeEventListener("resize", this.layoutHandler);
    window.removeEventListener("scroll", this.layoutHandler, true);
    this.hud?.destroy();
    this.root.destroy({ children: true });
    this.host.remove();
    window.removeEventListener("keydown", this.keyHandler, true);
    window.removeEventListener("pointerdown", this.pointerHandler, true);
    window.removeEventListener("focusin", this.focusHandler, true);
    window.removeEventListener("pointermove", this.moveHandler, true);
    window.removeEventListener("pointerup", this.releaseHandler, true);
    window.removeEventListener("pointercancel", this.releaseHandler, true);
    window.removeEventListener("blur", this.releaseHandler);
    document.removeEventListener("visibilitychange", this.releaseHandler);
    this.hooks.clearInput();
  }
}
