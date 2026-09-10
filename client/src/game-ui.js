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
import { updateMinimap, cycleMinimap } from "./ui-minimap.js";
import { UICursor } from "./ui-cursor.js";
import { UIChat } from "./ui-chat.js";
import {
  refreshKeys,
  cancelKeys,
  keyAtPoint,
  layoutKeyNotice,
  answerKeyNotice,
} from "./ui-keyconfig.js";
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
import { REVIVAL_POLICY } from "./revival.js";
import { renderTooltip } from "./ui-tooltip.js";
import {
  layoutMesoDialog,
  refreshMesoDialog,
  submitMesoDrop,
} from "./ui-meso-dialog.js";
import {
  LOCAL_WINDOW_NAMES,
  layoutLocalWindow,
  localWindowSize,
} from "./ui-local-windows.js";

const MAX_OPEN_WINDOWS = 4;
const MAX_WINDOWS_WITH_MODALS = MAX_OPEN_WINDOWS + 2;
const MODAL_WINDOWS = new Set([
  "UtilDlgEx",
  "QuickSlotConfig",
  "KeyConfigNotice",
  "Revive",
  "MesoDrop",
]);
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
  "Revive",
  "MesoDrop",
  "QuickSlotConfig",
  "KeyConfigNotice",
  "GameOpt",
  "Quest",
  "SysOpt",
  ...LOCAL_WINDOW_NAMES,
]);
/** Normal command names exclude constructing internal modal windows without their owners. */
export const NORMAL_UI_NAMES = Object.freeze([
  ...Array.from(WINDOWS).filter((name) => !MODAL_WINDOWS.has(name)),
  "QuickSlot",
  "focusGame",
  "close",
  "confirm",
  "cancel",
  "chat",
]);
const SIZES = {
  MiniMap: [260, 216],
  UtilDlgEx: [529, 206],
  Quest: [529, 206],
  QuickSlotConfig: [266, 238],
  KeyConfigNotice: [266, 116],
  Revive: [286, 146],
  MesoDrop: [266, 160],
  GameMenu: [93, 140],
  ShortCut: [93, 271],
};
// Native 00849e31..6a / 0084a5e2: fixed reference-plane popups above their HUD controls.
const POPUP_POSITIONS = {
  GameMenu: [666, 423],
  ShortCut: [707, 296],
  Revive: [257, 227],
};
const STYLE = `.maple-ui-root{position:absolute;pointer-events:none;transform-origin:0 0;z-index:5;font:11px Tahoma,Arial,sans-serif;color:#222;user-select:none}.maple-ui-root button{pointer-events:auto;cursor:pointer;font:11px Tahoma,Arial,sans-serif;min-height:0;min-width:0;box-sizing:border-box;margin:0;line-height:normal}.maple-ui-root .maple-ui-hit{padding:0;border:0;background:transparent;color:transparent;box-shadow:none;border-radius:0}.maple-ui-root .maple-ui-hit:focus-visible{outline:1px solid #ffc63d;outline-offset:1px}.maple-ui-root .maple-ui-local{padding:3px 5px;background:#263442;color:white;border:1px solid #a6bed0;border-radius:2px;white-space:nowrap}.maple-ui-root .maple-ui-text{white-space:pre-wrap;line-height:1.35;overflow-wrap:anywhere;pointer-events:none}.maple-ui-root .maple-ui-unavailable{background:rgba(255,255,240,.94);padding:4px;box-sizing:border-box;border:1px solid #c6ad75}.maple-ui-root .maple-ui-status{color:white;background:#273342;padding:3px}.maple-ui-root .maple-ui-dialog-text{color:#222}.maple-ui-root .maple-ui-tooltip{position:absolute;max-width:300px;background:#20252a;color:white;padding:6px;border:1px solid #a9b6c2;white-space:pre-wrap;z-index:100;pointer-events:none}.maple-ui-root .maple-ui-drag{position:absolute;left:0;top:0;height:20px;cursor:move;background:transparent;touch-action:none}`;
const LOCAL_STYLE = `.maple-ui-root .maple-ui-content{white-space:pre-wrap;line-height:1.35;overflow-wrap:anywhere;user-select:text}.maple-ui-root .maple-ui-profile{font-size:11px}.maple-ui-root .maple-ui-content button{position:static;white-space:normal}.maple-ui-root select,.maple-ui-root input{pointer-events:auto;max-width:100%;box-sizing:border-box}.maple-ui-root .maple-ui-status{box-sizing:border-box}.maple-ui-root .maple-ui-save-actions{display:flex;gap:8px;margin-top:8px}`;
const CURSOR_STYLE =
  ".maple-ui-root.maple-ui-original-cursor,.maple-ui-root.maple-ui-original-cursor *{cursor:none!important}.maple-ui-chat-log{position:absolute;overflow:hidden;font:12px Arial,sans-serif;line-height:13px;color:white;white-space:pre-wrap;pointer-events:none}";
const FOCUSABLE =
  "button:not([disabled]):not([hidden]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,a[href],[tabindex='0']";

/** Resolve retained window sizes or original background dimensions within the logical viewport. */
function windowSize(name, resource) {
  const asset = resource.manifest.metadata.assets?.[`${name}/backgrnd`];
  const size = SIZES[name] ||
    localWindowSize(name, resource) || [asset?.width, asset?.height];
  if (
    !size.every((value) => Number.isFinite(value) && value > 0) ||
    size[0] > 800 ||
    size[1] > (LOCAL_WINDOW_NAMES.includes(name) ? 600 : HUD_TOP)
  ) {
    throw new Error(`Invalid UI dimensions: ${name}`);
  }
  return [size[0], size[1]];
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
    this.tooltip.setAttribute("role", "tooltip");
    this.tooltip.id = "maple-context-tooltip";
    this.tooltip.style.cssText =
      "box-sizing:border-box;background:rgba(0,0,64,.62745);color:white;border:1px solid white;padding:8px;font:12px Arial,sans-serif;line-height:16px;overflow-wrap:anywhere;min-height:32px;";
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
    this.revivalPending = null;
    this.revivalOpenedAt = 0;
    this.revivalAutoConfirmed = false;
    this.layoutGeneration = 0;
    this.bindings = null;
    this.bindingDrag = null;
    this.bindingClickPointer = null;
    this.confirmAction = null;
    this.quickCapture = null;
    this.quickCaptureDraft = null;
    this.keyNotice = null;
    this.pointerPoint = { x: 0, y: 0 };
    this.layoutFrame = null;
    this.commandSignal = null;
    this.listenForInput();
    this.resize(app.screen.width, app.screen.height);
    this.observeLayout();
  }

  listenForInput() {
    this.keyHandler = this.onKey.bind(this);
    this.pointerHandler = this.onPointer.bind(this);
    this.focusHandler = this.onFocus.bind(this);
    this.moveHandler = this.onDrag.bind(this);
    this.releaseHandler = this.endDrag.bind(this);
    this.bindingClickHandler = this.captureBindingClick.bind(this);
    this.bindingMouseHandler = this.onBindingMouseDown.bind(this);
    window.addEventListener("keydown", this.keyHandler, true);
    window.addEventListener("pointerdown", this.pointerHandler, true);
    window.addEventListener("focusin", this.focusHandler, true);
    window.addEventListener("pointermove", this.moveHandler, true);
    window.addEventListener("pointerup", this.releaseHandler, true);
    window.addEventListener("pointercancel", this.releaseHandler, true);
    window.addEventListener("click", this.bindingClickHandler, true);
    window.addEventListener("dblclick", this.bindingClickHandler, true);
    window.addEventListener("contextmenu", this.bindingClickHandler, true);
    window.addEventListener("mousedown", this.bindingMouseHandler, true);
    window.addEventListener("blur", this.releaseHandler);
    this.captureLostHandler = this.onCaptureLost.bind(this);
    window.addEventListener(
      "lostpointercapture",
      this.captureLostHandler,
      true,
    );
    document.addEventListener("visibilitychange", this.releaseHandler);
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
    this.endBindingDrag();
    this.epoch++;
    this.saving = false;
    this.resetting = false;
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
    this.endBindingDrag();
    this.unsubscribeBindings?.();
    this.bindings = service;
    this.unsubscribeBindings = service.subscribe(() => {
      this.syncBindingCarry();
      refreshKeys(this.windows.get("KeyConfig"));
      refreshQuickSlots(this);
    });
    refreshKeys(this.windows.get("KeyConfig"));
    refreshQuickSlots(this);
  }

  status(message, { record = true } = {}) {
    this.lastStatus = String(message).slice(0, 1800);
    if (record && this.lastStatus) {
      this.chat?.receive({
        source: "local-system",
        text: this.lastStatus,
        time: this.hooks.now?.() ?? performance.now(),
      });
    }
    this.hooks.onStatus?.(this.lastStatus);
  }

  refreshProfile() {
    this.hideTooltip();
    if (this.disposed) return;
    this.syncBindingCarry();
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
    else if (panel.name === "MesoDrop") refreshMesoDialog(panel);
    else if (panel.localRefresh) panel.localRefresh();
    else updateProfilePanel(panel, this.store);
  }

  /** Reopen the original prompt; the UI never grants HP or moves the avatar. */
  recoverProfile() {
    if (this.store?.profile?.hp !== 0 || !this.hooks.onRecover) return;
    try {
      const accepted = this.hooks.onRecover();
      this.status(
        accepted
          ? "Revival confirmation opened."
          : "Ordinary revival is unavailable.",
      );
    } catch (error) {
      this.report(error);
    }
  }

  async showRevival(scene) {
    if (scene !== this.scene || this.store.profile.hp !== 0) return;
    if (this.windows.has("Revive") || this.pending.has("Revive")) {
      return this.open("Revive", null);
    }
    this.close("UtilDlgEx", true);
    this.close("QuickSlotConfig");
    this.revivalOpenedAt = this.hooks.now?.() ?? performance.now();
    this.revivalAutoConfirmed = false;
    return this.open("Revive", null);
  }

  confirmRevival() {
    const panel = this.windows.get("Revive");
    if (this.store.profileTransactionPending || this.hooks.isFieldBlocked?.()) {
      return false;
    }
    if (
      !panel ||
      this.modal() !== panel ||
      this.revivalPending ||
      this.store.profile.hp !== 0
    ) {
      return false;
    }
    this.revivalPending = panel;
    panel.reviveControl.setDisabled(true);
    this.finishRevival(panel);
    return true;
  }

  async finishRevival(panel) {
    try {
      await this.hooks.onRevive();
      if (this.windows.get("Revive") === panel) this.close("Revive", true);
    } catch (error) {
      if (this.windows.get("Revive") === panel && error.name !== "AbortError") {
        this.status(`Revival unavailable: ${error.message}`);
        this.report(error);
      }
    } finally {
      if (this.revivalPending === panel) this.revivalPending = null;
      if (this.windows.get("Revive") === panel) {
        panel.reviveControl.setDisabled(false);
      }
    }
  }

  /** Async persistence belongs to the profile epoch that requested it. */
  async saveProfile() {
    if (!this.store?.profile || this.saving || this.resetting) return;
    const store = this.store;
    const epoch = this.epoch;
    this.saving = true;
    this.refreshProfile();
    try {
      await this.hooks.onSave?.();
      if (this.ownsProfile(store, epoch)) await store.flush();
    } catch (error) {
      if (this.ownsProfile(store, epoch)) {
        this.report(error);
        this.notice(`Local save failed: ${error.message}`);
      }
    } finally {
      if (this.ownsProfile(store, epoch)) {
        this.saving = false;
        this.refreshProfile();
      }
    }
  }

  ownsProfile(store, epoch) {
    return (
      this.store === store &&
      this.epoch === epoch &&
      !this.controller.signal.aborted
    );
  }

  requestReset() {
    if (
      !this.store ||
      this.saving ||
      this.resetting ||
      this.store.profileTransactionPending
    ) {
      return;
    }
    this.dialogMode = "reset";
    this.dialogNpc = null;
    this.refreshDialog();
  }

  async resetProfile() {
    if (
      !this.store ||
      this.saving ||
      this.resetting ||
      this.store.profileTransactionPending
    ) {
      return;
    }
    const store = this.store;
    const epoch = this.epoch;
    this.resetting = true;
    this.refreshProfile();
    try {
      await store.reset();
      if (!this.ownsProfile(store, epoch)) return;
      await this.hooks.onReset?.(store);
      if (!this.ownsProfile(store, epoch)) return;
      this.closeAll();
      this.hooks.focusGame();
    } catch (error) {
      if (this.ownsProfile(store, epoch)) {
        this.report(error);
        this.notice(`Local reset failed: ${error.message}`);
      }
    } finally {
      if (this.ownsProfile(store, epoch)) {
        this.resetting = false;
        this.refreshProfile();
      }
    }
  }

  advanceMinimap() {
    const panel = this.windows.get("MiniMap");
    if (panel) return cycleMinimap(panel);
    if (this.pending.has("MiniMap")) return false;
    this.open("MiniMap").catch((error) => this.report(error));
    return true;
  }

  activate(name) {
    if (name === "QuickSlot") {
      toggleQuickSlots(this).catch((error) => this.report(error));
      return;
    }
    if (WINDOWS.has(name)) {
      if (this.windows.has(name) || this.pending.has(name)) this.close(name);
      else this.open(name).catch((error) => this.report(error));
      return;
    }
    this.status(
      `${name} requires original session/server behavior that is not available. No operation was sent.`,
    );
  }

  /** Demand-load one window; repeated requests coalesce and closed/cancelled loads never resurrect it. */
  async open(name, commandSignal = this.commandSignal) {
    if (!WINDOWS.has(name) || !this.index) {
      throw new Error(`Unsupported UI window ${name}`);
    }
    const existing = this.windows.get(name);
    if (existing) {
      this.front(existing);
      return existing;
    }
    if (this.pending.has(name)) return this.pending.get(name).promise;
    if (MODAL_WINDOWS.has(name)) this.endBindingDrag();
    const limit = MODAL_WINDOWS.has(name)
      ? MAX_WINDOWS_WITH_MODALS
      : MAX_OPEN_WINDOWS;
    if (this.windows.size + this.pending.size >= limit) {
      throw new Error(
        "Close a UI window before opening another (four-window residency bound).",
      );
    }
    const controller = new AbortController();
    const signals = [controller.signal, this.controller.signal];
    if (commandSignal) signals.push(commandSignal);
    const signal = AbortSignal.any(signals);
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
          : name === "QuickSlotConfig" || name === "KeyConfigNotice"
            ? "KeyConfig"
            : name === "Revive"
              ? "Notice"
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
      panel.renderArtwork();
      signal.throwIfAborted();
      this.windows.set(name, panel);
      this.front(panel);
      this.positionWindow(panel, panel.x, panel.y);
      this.hooks.clearInput();
      if (name === "QuickSlotConfig") {
        panel.element.focus({ preventScroll: true });
      } else if (name === "MesoDrop") {
        panel.mesoInput.focus();
        panel.mesoInput.select();
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
    if (panel.name === "KeyConfigNotice") return layoutKeyNotice(panel);
    if (panel.name === "MesoDrop") return layoutMesoDialog(panel);
    if (layoutLocalWindow(panel)) return;
    layoutWindow(panel);
    if (panel.name === "UtilDlgEx" || panel.name === "Quest") {
      this.mountDialog(panel);
    }
  }

  /** Native HUD popups have no drag/close chrome; other placement remains browser policy. */
  addWindowChrome(panel) {
    if (POPUP_POSITIONS[panel.name]) return;
    const offset = this.windows.size * 18;
    this.positionWindow(panel, (800 - panel.width) / 2 + offset, 70 + offset);
    if (panel.name === "KeyConfigNotice" || panel.name === "MesoDrop") return;
    const strip = document.createElement("div");
    strip.className = "maple-ui-drag";
    strip.dataset.cursorState = "5";
    strip.style.width = `${panel.width - (panel.name === "MiniMap" ? 76 : 24)}px`;
    panel.listen(strip, "pointerdown", (event) => this.beginDrag(event, panel));
    panel.element.prepend(strip);
    panel.dragStrip = strip;
    if (panel.name === "QuickSlotConfig") return;
    panel.closeControl = panel.button(
      "BtClose",
      panel.name === "MiniMap" ? 60 : panel.width - 17,
      6,
      {
        label: `Close ${panel.name}`,
        action: () => this.close(panel.name),
      },
    );
  }

  positionWindow(panel, x, y) {
    const fixed = POPUP_POSITIONS[panel.name];
    if (fixed) {
      panel.position(fixed[0], fixed[1]);
      return;
    }
    const left = -this.offsetX / this.scale;
    const top = -this.offsetY / this.scale;
    const right = left + this.viewportWidth / this.scale;
    const bottom = top + this.viewportHeight / this.scale;
    panel.position(
      Math.max(left, Math.min(right - panel.width, x)),
      Math.max(top, Math.min(bottom - panel.height, y)),
    );
  }

  front(panel) {
    this.root.setChildIndex(panel.root, this.root.children.length - 1);
    const modal = MODAL_WINDOWS.has(panel.name) ? panel : this.modal();
    if (modal && modal !== panel) {
      this.root.setChildIndex(modal.root, this.root.children.length - 1);
    }
    this.windows.delete(panel.name);
    this.windows.set(panel.name, panel);
    if (modal && modal !== panel) {
      this.windows.delete(modal.name);
      this.windows.set(modal.name, modal);
    }
    if (this.cursor) {
      this.root.setChildIndex(
        this.cursor.surface.root,
        this.root.children.length - 1,
      );
    }
    // Keep DOM nodes attached during pointerdown so native click/focus survives.
    let depth = 1;
    for (const window of this.windows.values()) {
      window.element.style.zIndex = String(depth++);
    }
    this.syncModalState();
  }

  close(name, committed = false) {
    if (!this.canCloseWindow(name, committed)) return;
    if (name === "KeyConfigNotice" && !committed) {
      answerKeyNotice(this, false).catch((error) => this.report(error));
      return;
    }
    this.pending.get(name)?.controller.abort();
    this.pending.delete(name);
    const panel = this.windows.get(name);
    if (name === "UtilDlgEx") this.confirmAction = null;
    if (name === "QuickSlotConfig") closeQuickSlotConfig(this, committed);
    if (!panel) return;
    if (name === "KeyConfig" && !this.prepareKeyConfigClose(panel, committed)) {
      return;
    }
    if (name === "KeyConfig") this.closeQuickCapture(committed);
    this.removeWindow(panel);
  }

  canCloseWindow(name, committed) {
    if (name === "Revive" && !committed) return false;
    if (
      name === "MesoDrop" &&
      this.windows.get(name)?.mesoPending &&
      !committed
    ) {
      return false;
    }
    const modal = this.modal();
    if (modal && modal.name !== name && !committed) return false;
    return !(name === "KeyConfig" && this.bindings?.saving);
  }

  prepareKeyConfigClose(panel, committed) {
    if (committed || !this.bindings) return true;
    if (this.bindings.hasChanges()) {
      cancelKeys(panel);
      return false;
    }
    this.bindings.cancel();
    return true;
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
    if (this.drag?.panel === panel) this.releaseWindowDrag();
    this.windows.delete(panel.name);
    panel.destroy();
    this.syncModalState();
    this.hideTooltip();
    this.hooks.clearInput();
    const modal = this.modal();
    if (modal) modal.element.querySelector("button")?.focus();
    else this.hooks.focusGame();
  }

  closeAll() {
    this.releaseWindowDrag();
    this.endBindingDrag();
    this.bindings?.cancel();
    this.quickCapture = null;
    this.quickCaptureDraft = null;
    this.keyNotice = null;
    this.confirmAction = null;
    for (const task of this.pending.values()) task.controller.abort();
    this.pending.clear();
    for (const panel of this.windows.values()) {
      panel.mapController?.abort();
      panel.destroy();
    }
    this.windows.clear();
    this.hideTooltip();
    this.drag = null;
    this.syncModalState();
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
        "NPC interaction is no longer available. Select an eligible visible NPC while alive.",
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
    } else this.open("UtilDlgEx").catch((error) => this.report(error));
  }

  mountDialog(panel) {
    this.prepareDialog(panel);
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

  prepareDialog(panel) {
    panel.dialogCleanup?.();
    panel.dialogCleanup = null;
    panel.content.replaceChildren();
    panel.dialogClose?.setVisible(
      panel.name !== "UtilDlgEx" ||
        !["confirm", "reset"].includes(this.dialogMode),
    );
    if (!panel.dialogDisposal) {
      panel.dialogDisposal = true;
      panel.cleanups.push(() => panel.dialogCleanup?.());
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
      action: () => this.confirmDialog(),
    });
    layer.button("BtCancel2", 355, 176, {
      label: "Cancel",
      action: () => this.close("UtilDlgEx"),
    });
    panel.dialogCleanup = () => layer.destroy();
  }

  /** Shared visible confirmation action; normal commands cannot invoke an unseen/pending dialog. */
  confirmDialog() {
    if (this.modal()?.name === "Revive") return this.confirmRevival();
    if (this.modal()?.name === "KeyConfigNotice") {
      return answerKeyNotice(this, true);
    }
    if (this.modal()?.name !== "UtilDlgEx" || this.dialogMode !== "confirm") {
      return false;
    }
    const action = this.confirmAction;
    this.close("UtilDlgEx");
    action?.();
    return true;
  }

  openQuickSlotCapture() {
    if (!this.bindings || this.quickCapture !== null) return;
    this.quickCapture = -1;
    const draft = this.bindings.active.quickSlots.slice();
    this.quickCaptureDraft = draft;
    this.hooks.clearInput();
    this.open("QuickSlotConfig").catch((error) => {
      if (this.quickCaptureDraft === draft) this.close("QuickSlotConfig");
      this.report(error);
    });
  }

  mountReset(panel) {
    panel.content.textContent =
      "RESET LOCAL PROFILE\nThis permanently replaces this browser's name, statistics, inventory, quests, location and settings with the provisional beginner profile. No server is contacted.";
    const layer = panel.layer("Reset");
    const confirm = layer.button("BtOK", 300, 176, {
      label: "Reset local profile",
      action: () => this.resetProfile(),
    });
    layer.button("BtCancel2", 355, 176, {
      label: "Cancel",
      action: () => this.close(panel.name),
    });
    const cleanup = () => layer.destroy();
    cleanup.refresh = () =>
      confirm.setDisabled(
        this.resetting || this.store.profileTransactionPending,
      );
    cleanup.refresh();
    panel.dialogCleanup = cleanup;
  }

  showTooltip(content, x, y, anchor = null) {
    if (this.bindingDrag || !this.visible) return;
    this.hideTooltip();
    this.tooltipAnchor = anchor;
    if (anchor) anchor.setAttribute("aria-describedby", this.tooltip.id);
    renderTooltip(this, content, content?.source);
    this.tooltip.hidden = false;
    const left = -this.offsetX / this.scale;
    const top = -this.offsetY / this.scale;
    const right = left + this.viewportWidth / this.scale;
    const bottom = top + this.viewportHeight / this.scale;
    this.tooltip.style.maxWidth = `${Math.min(360, right - left)}px`;
    this.tooltip.style.maxHeight = `${bottom - top}px`;
    this.tooltip.style.overflow = "hidden";
    const width = this.tooltip.offsetWidth,
      height = this.tooltip.offsetHeight;
    this.tooltip.style.left = `${Math.max(left, Math.min(right - width, x + 12))}px`;
    const targetY = y + 20 + height <= bottom ? y + 20 : y - height - 6;
    this.tooltip.style.top = `${Math.max(top, Math.min(bottom - height, targetY))}px`;
    this.tooltipIcon?.renderArtwork();
  }

  hideTooltip() {
    this.tooltipAnchor?.removeAttribute("aria-describedby");
    this.tooltipAnchor = null;
    this.tooltipIcon?.destroy();
    this.tooltipIcon = null;
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
    panel.renderArtwork();
  }

  setScene(scene) {
    if (this.scene !== scene) this.close("MesoDrop", true);
    this.hideTooltip();
    if (this.scene !== scene) this.close("Revive", true);
    this.endBindingDrag();
    this.scene = scene;
    const panel = this.windows.get("MiniMap");
    if (panel) this.refreshMinimap(panel);
    for (const window of this.windows.values()) window.localRefresh?.();
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
    this.endDrag();
    this.endBindingDrag();
    if (this.cursor) this.cursor.surface.root.visible = false;
    this.cursor?.setVisible(visible);
    this.hooks.clearInput();
    if (!visible) this.hooks.focusGame();
  }

  update(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error("Invalid UI elapsed milliseconds");
    }
    this.updateRevival();
    if (!this.visible) return;
    this.hud?.update(ms);
    finishGaugeWarnings(this.hud);
    const minimap = this.windows.get("MiniMap");
    if (minimap && this.scene) {
      updateMinimap(
        minimap,
        this.scene.presentation.x,
        this.scene.presentation.y,
      );
    }
    for (const panel of this.windows.values()) panel.update(ms);
    this.cursor?.update(ms);
  }

  updateRevival() {
    if (
      this.windows.has("Revive") &&
      !this.revivalPending &&
      !this.revivalAutoConfirmed &&
      (this.hooks.now?.() ?? performance.now()) - this.revivalOpenedAt >
        REVIVAL_POLICY.autoConfirmMs
    ) {
      this.revivalAutoConfirmed = this.confirmRevival();
    }
  }

  resize(width, height) {
    this.hideTooltip();
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
    this.releaseWindowDrag();
    for (const panel of this.windows.values()) {
      this.positionWindow(panel, panel.x, panel.y);
    }
    this.syncDomLayout();
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
    for (const panel of this.windows.values()) panel.renderArtwork();
  }

  onKey(event) {
    if (!this.acceptsKey(event)) return;
    const modal = this.modal();
    if (this.capturePriorityKey(event, modal)) return;
    if (this.captureControlInput(event, modal)) return;
    if (this.captureWindowKey(event)) return;
    if (!event.repeat && this.bindings?.activateCode(event.code)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  capturePriorityKey(event, modal) {
    if (this.bindingDrag && event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.endBindingDrag();
      return true;
    }
    if (modal?.name === "QuickSlotConfig" && captureQuickKey(this, event)) {
      return true;
    }
    if (modal) return this.captureModalKey(event, modal);
    if (captureQuickKey(this, event)) return true;
    return this.chat?.handle(event);
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
    if (
      event.target.matches("button") &&
      (event.key === "Enter" ||
        event.key === " " ||
        (event.target.dataset.keyIndex !== undefined &&
          (event.key === "Delete" || event.key === "Backspace")))
    ) {
      return true;
    }
    const editing =
      event.target.isContentEditable ||
      event.target.matches("input,select,textarea");
    if (!modal && !editing) return false;
    this.hooks.clearInput();
    event.stopImmediatePropagation();
    return true;
  }

  acceptsKey(event) {
    if (!this.visible || !this.index || event.metaKey) {
      return false;
    }
    return this.host.contains(event.target) || event.target === this.app.canvas;
  }

  modal() {
    let modal = null;
    for (const panel of this.windows.values()) {
      if (MODAL_WINDOWS.has(panel.name)) {
        modal = panel;
      }
    }
    return modal;
  }

  syncModalState() {
    const modal = this.modal();
    if (modal) this.endBindingDrag();
    if (this.hud) this.hud.element.inert = Boolean(modal);
    for (const panel of this.windows.values()) {
      panel.element.inert = Boolean(modal && panel !== modal);
      if (MODAL_WINDOWS.has(panel.name)) {
        panel.element.tabIndex = -1;
        panel.element.setAttribute("role", "dialog");
        panel.element.setAttribute("aria-modal", String(panel === modal));
      }
    }
  }

  blocksGameplay() {
    return Boolean(
      this.modal() ||
      this.pending.has("UtilDlgEx") ||
      this.pending.has("Revive") ||
      this.pending.has("MesoDrop") ||
      this.keyNotice !== null ||
      this.quickCapture !== null,
    );
  }

  captureModalKey(event, panel) {
    if (
      panel.name === "MesoDrop" &&
      event.key === "Enter" &&
      !event.isComposing
    ) {
      if (event.target === panel.mesoCancel.element) return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) submitMesoDrop(panel);
      return true;
    }
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
    this.cycleModalFocus(event, panel);
    return false;
  }

  cycleModalFocus(event, panel) {
    const buttons = Array.from(
      panel.element.querySelectorAll(FOCUSABLE),
    ).filter((element) => element.getClientRects().length > 0);
    const edge = event.shiftKey ? buttons[0] : buttons[buttons.length - 1];
    if (event.target === edge) {
      event.preventDefault();
      buttons[event.shiftKey ? buttons.length - 1 : 0]?.focus();
    }
  }

  onPointer(event) {
    if (!this.visible) return;
    if (this.captureBindingPointer(event)) return;
    this.bindingClickPointer = null;
    this.cursor?.move(event);
    const canvas = event.target === this.app.canvas;
    if (!canvas && !this.host.contains(event.target)) return;
    if (this.captureModalPointer(event)) return;
    if (event.button === 0) this.cursor?.press(event);
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

  /** 009e3ae6: carry consumes input; only a later left down places. */
  captureBindingPointer(event) {
    const drag = this.bindingDrag;
    if (!drag) return false;
    event.stopImmediatePropagation();
    if (
      event.pointerId !== drag.pointerId ||
      event.button !== 0 ||
      drag.pressed
    ) {
      event.preventDefault();
      return true;
    }
    this.cursor?.move(event);
    this.bindingClickPointer = event.pointerId;
    if (event.pointerType === "mouse") {
      // MouseEvent.detail distinguishes native WM_LBUTTONDBLCLK before any mutation.
      // Cancelling pointerdown would suppress this compatibility mousedown event.
      drag.placing = true;
    } else {
      event.preventDefault();
      this.dropBinding(event);
    }
    return true;
  }

  onBindingMouseDown(event) {
    const drag = this.bindingDrag;
    if (!drag?.placing) return;
    drag.placing = false;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.detail < 2) {
      this.dropBinding(event);
      return;
    }
    const binding = drag.binding;
    const skillSource =
      this.windows.get("Skill")?.element.contains(drag.source.element) === true;
    this.endBindingDrag();
    // 009e37c2 vtable+8: 004efd25 uses the item; 004fb001 invokes learned skill.
    if (binding.type === 2) this.bindings.useItem(binding.id);
    else if (binding.type === 1 && skillSource) {
      this.bindings.useSkill(binding.id);
    }
  }

  /** DOM click/double-click/contextmenu must not activate the consumed source or destination. */
  captureBindingClick(event) {
    const pointerId = this.bindingDrag?.pointerId ?? this.bindingClickPointer;
    if (pointerId === null || pointerId === undefined) return;
    if (event.pointerId !== undefined && event.pointerId !== pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "dblclick") this.endBindingDrag();
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
    if (
      event.button !== 0 ||
      this.drag ||
      this.bindingDrag ||
      this.pressedControl
    ) {
      return;
    }
    if (!this.screenScaleX || !this.screenScaleY) return;
    event.preventDefault();
    this.hideTooltip();
    this.front(panel);
    this.hooks.clearInput();
    event.currentTarget.setPointerCapture(event.pointerId);
    this.drag = {
      panel,
      capture: event.currentTarget,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: panel.x,
      startY: panel.y,
    };
  }

  onDrag(event) {
    this.cursor?.move(event);
    if (!this.visible) return;
    this.chat?.move(event);
    if (this.bindingDrag) {
      event.preventDefault();
      return;
    }
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const drag = this.drag;
    this.positionWindow(
      drag.panel,
      drag.startX + (event.clientX - drag.x) / this.screenScaleX,
      drag.startY + (event.clientY - drag.y) / this.screenScaleY,
    );
  }

  endDrag(event) {
    if (!this.acceptsDragRelease(event)) return;
    if (event?.type !== "pointerup") this.hideTooltip();
    this.releaseWindowDrag();
    if (event?.type !== "pointerup") this.pressedControl?.cancelPointer();
    this.chat?.endResize();
    this.finishBindingDrag(event);
    this.releaseCursor(event);
  }

  acceptsDragRelease(event) {
    if (event?.pointerId === undefined) return true;
    return !(
      (this.bindingDrag && event.pointerId !== this.bindingDrag.pointerId) ||
      (this.drag && event.pointerId !== this.drag.pointerId) ||
      (this.pressedControl && event.pointerId !== this.pressedControl.pointerId)
    );
  }

  finishBindingDrag(event) {
    const drag = this.bindingDrag;
    if (drag && event?.type === "pointerup") {
      drag.pressed = false;
      this.releaseBindingCapture(drag);
    } else if (event?.type !== "pointerup") {
      this.endBindingDrag();
      this.bindingClickPointer = null;
    }
  }

  releaseCursor(event) {
    this.cursor?.release(event);
    if (event?.type === "pointerup") this.cursor?.move(event);
    else if (this.cursor) this.cursor.surface.root.visible = false;
  }

  releaseWindowDrag() {
    const drag = this.drag;
    this.drag = null;
    if (drag?.capture.hasPointerCapture(drag.pointerId)) {
      drag.capture.releasePointerCapture(drag.pointerId);
    }
  }

  onCaptureLost(event) {
    if (
      this.drag?.pointerId === event.pointerId ||
      (this.bindingDrag?.capture &&
        this.bindingDrag.pointerId === event.pointerId)
    ) {
      this.endDrag(event);
    }
  }
  logicalPointer(event) {
    const rect = this.host.getBoundingClientRect();
    this.pointerPoint.x = (event.clientX - rect.left) / this.screenScaleX;
    this.pointerPoint.y = (event.clientY - rect.top) / this.screenScaleY;
    return this.pointerPoint;
  }
  /** Native 009e353d installs a click-carried icon without a held-pointer requirement. */
  beginBindingDrag(event, binding, sourceIndex, { source, path }) {
    if (
      event.button !== 0 ||
      this.blocksGameplay() ||
      this.drag ||
      this.bindingDrag ||
      this.pressedControl ||
      !this.bindings?.canCarry(binding, sourceIndex) ||
      !source?.entities.has(path)
    ) {
      return false;
    }
    event.preventDefault();
    this.hooks.clearInput();
    const palette =
      sourceIndex === null && binding.type >= 4 && binding.type <= 6;
    this.carryBinding(event, binding, sourceIndex, { source, path, palette });
    this.sound("DragStart");
    return true;
  }

  carryBinding(event, binding, sourceIndex, { source, path, palette = false }) {
    this.bindingClickPointer = event.pointerId ?? this.bindingClickPointer;
    this.bindingDrag = {
      binding: { type: binding.type, id: binding.id },
      sourceIndex,
      source,
      palette,
      capture: event.target,
      pointerId: this.bindingClickPointer,
      pressed: true,
    };
    this.cursor?.drag(source, path);
    this.hideTooltip();
  }

  /** 009e37c2 clears carry before dispatch, including rejected destinations. */
  dropBinding(event) {
    const drag = this.bindingDrag;
    if (
      !drag ||
      (event.pointerId ?? this.bindingClickPointer) !== drag.pointerId
    ) {
      return;
    }
    const panel = this.windows.get("KeyConfig");
    const point = this.logicalPointer(event);
    const target = keyAtPoint(panel, point);
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const quickTarget = quickKeyAtPoint(this, point);
    const admitted =
      !this.blocksGameplay() &&
      this.bindings.canCarry(drag.binding, drag.sourceIndex);
    this.endBindingDrag();
    if (!admitted) return;
    let accepted = false;
    if (
      quickTarget !== null &&
      this.hud.quickSurface.element.contains(element)
    ) {
      accepted = this.placeQuickBinding(event, drag, quickTarget);
    } else if (target !== null && panel.element.contains(element)) {
      accepted = this.placeKeyBinding(drag, target);
    }
    if (accepted) this.sound("DragEnd");
  }

  placeKeyBinding(drag, target) {
    if (target > 90) return this.removeCarriedBinding(drag);
    return (
      target < 89 &&
      this.bindings.assign(target, drag.binding, drag.sourceIndex)
    );
  }

  /** 004f9386/004f38f4/004fb32c return the overwritten quick binding to 008d6409. */
  placeQuickBinding(event, drag, target) {
    const displaced = this.bindings.active.keys[target];
    const same =
      displaced.type === drag.binding.type && displaced.id === drag.binding.id;
    const visual = this.quickBindingVisual(displaced);
    if (!same && visual && this.bindings.canCarry(displaced)) {
      this.carryBinding(event, displaced, null, visual);
    }
    if (!this.bindings.assignQuick(target, drag.binding, drag.sourceIndex)) {
      this.endBindingDrag();
      return false;
    }
    return true;
  }

  quickBindingVisual(binding) {
    const panel = this.hud.quickSurface;
    const action = binding.type >= 4 && binding.type <= 6;
    const source = action ? panel.keyLayer : panel.iconLayer;
    const template =
      binding.type === 1
        ? this.index.skills[binding.id]
        : this.index.items[binding.id];
    const path = action ? `KeyConfig/icon/${binding.id}` : template?.iconPath;
    return source?.entities.has(path) ? { source, path } : null;
  }

  removeCarriedBinding(drag) {
    // Palette actions cannot be returned to the palette; existing keys/items/skills can.
    if (drag.palette) return false;
    const source =
      drag.sourceIndex ??
      this.bindings.active.keys.findIndex(
        (binding) =>
          binding.type === drag.binding.type && binding.id === drag.binding.id,
      );
    return source >= 0 && this.bindings.remove(source);
  }

  releaseBindingCapture(drag) {
    const capture = drag.capture;
    drag.capture = null;
    if (capture?.hasPointerCapture?.(drag.pointerId)) {
      capture.releasePointerCapture(drag.pointerId);
    }
  }

  syncBindingCarry() {
    const drag = this.bindingDrag;
    if (
      drag &&
      (this.resetting ||
        !this.bindings?.canCarry(drag.binding, drag.sourceIndex))
    ) {
      this.endBindingDrag();
    }
  }

  endBindingDrag() {
    const drag = this.bindingDrag;
    if (!drag) return;
    this.bindingDrag = null;
    this.releaseBindingCapture(drag);
    this.cursor?.release();
    this.cursor?.clearGhost();
    if (drag.source.retainedForDrag) drag.source.destroy();
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
      windowBounds: Array.from(this.windows.values(), (panel) => ({
        name: panel.name,
        x: panel.x,
        y: panel.y,
        width: panel.width,
        height: panel.height,
      })),
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
            channel: this.chat.selector.selectedIndex,
            height: this.chat.height,
            log: this.chat.messages.snapshot(),
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
    window.removeEventListener("click", this.bindingClickHandler, true);
    window.removeEventListener("dblclick", this.bindingClickHandler, true);
    window.removeEventListener("contextmenu", this.bindingClickHandler, true);
    window.removeEventListener("mousedown", this.bindingMouseHandler, true);
    window.removeEventListener("blur", this.releaseHandler);
    window.removeEventListener(
      "lostpointercapture",
      this.captureLostHandler,
      true,
    );
    document.removeEventListener("visibilitychange", this.releaseHandler);
    this.hooks.clearInput();
  }
}
