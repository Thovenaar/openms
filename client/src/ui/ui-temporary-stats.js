import { EntityAnimation } from "../rendering/animation.js";
import { UISurface } from "./ui-surface.js";
import { itemTooltip, skillTooltip } from "./ui-tooltip.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";
import {
  durationFrame,
  MAX_TEMPORARY_STATS,
} from "../skills/temporary-stats.js";

const MAX_SOURCES = 128; // Browser lease budget: learned skills plus active/owned consumables.
const DESTROY_DISPLAY = Object.freeze({ children: true });

/** Prepared source artwork; update borrows authority records and never loads/sorts/snapshots. */
export class TemporaryStatView {
  constructor(owner, descriptor) {
    this.owner = owner;
    this.descriptor = descriptor;
    this.controller = new AbortController();
    this.panel = null;
    this.system = null;
    this.sources = new Map();
    this.pending = new Map();
    this.preparation = null;
    this.slots = new Array(MAX_TEMPORARY_STATS);
    this.revision = -1;
    this.layoutGeneration = -1;
    this.destroyed = false;
  }

  prepare(signal = null) {
    if (this.destroyed) {
      return Promise.reject(new Error("Temporary stat view destroyed"));
    }
    if (this.preparation) return this.preparation;
    if (this.panel) return Promise.resolve();
    this.preparation = this.prepareBundle(signal).finally(() => {
      this.preparation = null;
    });
    return this.preparation;
  }

  async prepareBundle(signal) {
    const combined = signal
      ? AbortSignal.any([signal, this.controller.signal])
      : this.controller.signal;
    const resource = await loadVisualBundle(
      this.descriptor,
      this.owner.services,
      combined,
    );
    try {
      combined.throwIfAborted();
      this.panel = new UISurface(
        this.owner,
        "TemporaryStatView",
        resource,
        [800, 55],
      );
      this.panel.element.style.pointerEvents = "none";
      this.panel.position(0, 0);
      this.prepareOverlayFrames();
      for (let index = 0; index < MAX_TEMPORARY_STATS; index++) {
        this.prepareSlot(index);
      }
    } catch (error) {
      if (this.panel) this.panel.destroy();
      else resource.destroy();
      this.panel = null;
      throw error;
    }
  }

  prepareOverlayFrames() {
    const frames = [];
    this.overlayAssets = [];
    for (let frame = 0; frame < 16; frame++) {
      const path = `Skill/CoolTime/${frame}`;
      const entity = this.panel.entities.get(path);
      const asset = this.panel.assets[path];
      if (!asset || entity?.actions.default.length !== 1) {
        throw new Error(`Missing original duration overlay ${path}`);
      }
      frames.push(entity.actions.default[0]);
      this.overlayAssets.push(asset);
    }
    this.overlayEntity = {
      ...this.panel.entities.get("Skill/CoolTime/0"),
      actions: { default: frames },
    };
  }

  prepareSlot(index) {
    const overlay = new EntityAnimation(
      this.overlayEntity,
      this.panel.resource.textures,
    );
    overlay.container.visible = false;
    overlay.container.zIndex = 0;
    this.panel.root.addChild(overlay.container);
    this.panel.sprites.push(overlay);
    const slot = {
      state: null,
      icon: null,
      frame: -1,
      overlay,
      left: 0,
      button: null,
    };
    this.slots[index] = slot;
    slot.button = this.panel.hit(
      "Temporary effect",
      { x: 0, y: 23, width: 32, height: 32 },
      {
        pointerup: (event) => this.cancel(slot, event),
        contextmenu: (event) => event.preventDefault(),
      },
      { tooltip: () => this.tooltip(slot) },
    );
    slot.button.style.pointerEvents = "auto";
    slot.button.hidden = true;
  }

  /** Item group238 uses icon; all other ordinary potion sources use iconRaw (007b3bc5). */
  prepareSource(kind, id) {
    const source = kind === "item" ? -id : id;
    if (
      this.destroyed ||
      !this.panel ||
      (kind !== "item" && kind !== "skill")
    ) {
      return Promise.reject(new Error("Temporary stat view is not prepared"));
    }
    if (this.sources.has(source)) return Promise.resolve();
    if (this.pending.has(source)) return this.pending.get(source);
    if (this.sources.size + this.pending.size >= MAX_SOURCES) {
      this.releaseUnusedSources();
    }
    if (this.sources.size + this.pending.size >= MAX_SOURCES) {
      return Promise.reject(
        new Error("Temporary stat icon lease budget exceeded"),
      );
    }
    const task = this.loadSource(kind, id).finally(() =>
      this.pending.delete(source),
    );
    this.pending.set(source, task);
    return task;
  }

  async loadSource(kind, id) {
    const template =
      kind === "item"
        ? this.owner.index.items[id]
        : this.owner.index.skills[id];
    const path = this.#sourcePath(kind, id, template);
    const resource = await loadVisualBundle(
      template.descriptor,
      this.owner.services,
      this.controller.signal,
    );
    let sprite = null;
    try {
      this.controller.signal.throwIfAborted();
      const asset = resource.manifest.metadata.assets[path];
      const entity = resource.manifest.entities.find(
        (entry) => entry.id === path,
      );
      if (!asset || !entity) {
        throw new Error(`Missing original source icon ${path}`);
      }
      sprite = new EntityAnimation(entity, resource.textures);
      sprite.container.visible = false;
      sprite.container.zIndex = 0;
      this.panel.root.addChildAt(sprite.container, 0);
      this.sources.set(kind === "item" ? -id : id, {
        resource,
        sprite,
        asset,
        template,
      });
      this.revision = -1;
    } catch (error) {
      sprite?.container.destroy(DESTROY_DISPLAY);
      resource.destroy();
      throw error;
    }
  }

  #sourcePath(kind, id, template) {
    const path =
      kind === "item" && Math.floor(id / 10000) !== 238
        ? template?.iconRawPath
        : template?.iconPath;
    if (!template?.descriptor || !path) {
      throw new Error("Original temporary stat icon is unavailable");
    }
    return path;
  }

  /** Call at field entry and after learned-rank changes, outside fixed-step/update. */
  async prepareEffects(system) {
    if (!this.panel) await this.prepare();
    for (const [id] of system.states) {
      if (system.level(id) && system.stateController.hasSource(id)) {
        await this.prepareSource("skill", id);
      }
    }
    for (let index = 0; index < system.effects.count; index++) {
      const state = system.effects.sources[index];
      await this.prepareSource(state.kind, state.id);
    }
  }

  bind(system) {
    if (!this.panel || this.destroyed) {
      throw new Error("Temporary stat view is not prepared");
    }
    for (let index = 0; index < (system?.effectCount() ?? 0); index++) {
      if (!this.sources.has(system.effectAt(index).source)) {
        throw new Error("Active temporary-stat source artwork is not prepared");
      }
    }
    this.system = system;
    this.revision = -1;
    this.update();
  }

  /** 007b2bb0: newest ordinary source leftmost, right edge797, row top23. */
  layout() {
    this.panel.position(this.owner.bounds.right - 800, this.owner.bounds.top);
    for (let index = 0; index < MAX_TEMPORARY_STATS; index++) {
      this.hideSlot(this.slots[index]);
    }
    const count = this.system?.effectCount() ?? 0;
    for (let index = 0; index < count; index++) {
      const slot = this.slots[index];
      const state = this.system.effectAt(index);
      const icon = this.sources.get(state.source);
      if (!icon) continue; // Preparation failure must not invent a substitute source image.
      const left = 797 - count * 32 + index * 32;
      slot.state = state;
      slot.icon = icon;
      this.positionIcon(icon.sprite, icon.asset, left);
      icon.sprite.container.visible = true;
      slot.left = left;
      slot.button.style.left = `${left}px`;
      slot.button.setAttribute(
        "aria-label",
        icon.template.name || "Temporary effect",
      );
      slot.button.hidden = false;
    }
  }

  positionIcon(sprite, asset, left) {
    sprite.setPosition(
      left + Math.trunc((32 - asset.width) / 2) + asset.origin.x,
      23 + Math.trunc((32 - asset.height) / 2) + asset.origin.y,
    );
  }

  hideSlot(slot) {
    if (slot.icon) slot.icon.sprite.container.visible = false;
    slot.overlay.container.visible = false;
    if (this.owner.tooltipAnchor === slot.button) this.owner.hideTooltip();
    slot.state = null;
    slot.icon = null;
    slot.frame = -1;
    slot.button.hidden = true;
  }

  update() {
    if (!this.panel || this.destroyed) return;
    const revision = this.system?.effects.revision ?? 0;
    if (
      revision !== this.revision ||
      this.layoutGeneration !== this.owner.layoutGeneration
    ) {
      this.layout();
      this.revision = revision;
      this.layoutGeneration = this.owner.layoutGeneration;
    }
    const count = this.system?.effectCount() ?? 0;
    for (let index = 0; index < count; index++) {
      this.updateOverlay(this.slots[index]);
    }
    this.panel.renderArtwork();
  }

  updateOverlay(slot) {
    if (!slot.state) return;
    const frame = durationFrame(slot.state);
    if (frame === slot.frame) return;
    slot.overlay.container.visible = frame >= 0;
    if (frame >= 0) {
      slot.overlay.applyFrame(frame);
      this.positionIcon(slot.overlay, this.overlayAssets[frame], slot.left);
    }
    slot.frame = frame;
  }

  tooltip(slot) {
    if (!slot.state || !slot.icon) return null;
    return slot.state.kind === "item"
      ? itemTooltip(this.owner, slot.icon.template, slot.state.id)
      : skillTooltip(this.owner, slot.icon.template);
  }

  cancel(slot, event) {
    if (event.button !== 2 || !slot.state) return;
    event.preventDefault();
    if (this.system?.cancelEffect(slot.state.kind, slot.state.id)) {
      this.update();
    }
  }

  /** Aborted pickup preparation owns no active/learned source; release its icon lease now. */
  releaseSource(kind, id) {
    const source = kind === "item" ? -id : id;
    if (
      this.pending.has(source) ||
      this.system?.effects.find(source) ||
      this.system?.effects.reservation?.state.source === source ||
      (source > 0 && this.system?.level(source))
    ) {
      return;
    }
    const record = this.sources.get(source);
    if (!record) return;
    record.sprite.container.destroy(DESTROY_DISPLAY);
    record.resource.destroy();
    this.sources.delete(source);
  }

  releaseUnusedSources() {
    for (const [source, record] of this.sources) {
      if (
        this.system?.effects.find(source) ||
        (source > 0 && this.system?.level(source))
      ) {
        continue;
      }
      if (this.system?.effects.reservation?.state.source === source) continue;
      record.sprite.container.destroy(DESTROY_DISPLAY);
      record.resource.destroy();
      this.sources.delete(source);
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.controller.abort();
    this.panel?.destroy();
    for (const record of this.sources.values()) record.resource.destroy();
    this.sources.clear();
    this.system = null;
  }
}
