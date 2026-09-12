import { cashMessage, cashTemplate } from "./ui-cash-modal.js";
import { SpeechBubbles } from "../rendering/speech-bubbles.js";
import { equippedSlots } from "../items/inventory-model.js";
import { heldActionForCode } from "../input/keymap.js";
import { advanceSimulation, createSimulation } from "../physics/simulation.js";

const MAX_TRIED_ITEMS = 30;

/** Owns detached appearance, input and motion; never mutates field simulation or durable state. */
export class CashAvatarPreview {
  constructor(panel) {
    this.panel = panel;
    this.service = panel.cashService;
    this.layer = panel.layer("Cash Shop avatar preview");
    // 004ab10f..004ab121: native CSChar preview layer at(24,40),212×165.
    this.layer.root.rasterClip = { x: 24, y: 40, width: 212, height: 165 };
    this.background = this.layer.layer("Cash Shop preview background");
    this.visual = null;
    this.controller = null;
    this.pending = false;
    this.proposal = null;
    this.epoch = 0;
    this.tried = new Map();
    this.sns = new Set();
    this.removeAll = false;
    this.backgroundIndex = panel.owner.restoreTab(
      "CashShop.preview",
      [0, 1, 2],
    );
    this.enabled = true;
    this.lifetime = new AbortController();
    //009785bd initializes CUserPreview at(-350,-250); the source scene owns its contacts.
    this.simulation = createSimulation(
      this.service.catalog.ui.cashShop.preview.physics,
      { x: -350, y: -250 },
    );
    this.input = {
      left: false,
      right: false,
      up: false,
      down: false,
      jump: false,
      attack: false,
      jumpPressed: false,
    };
    this.held = new Map();
    this.inputGeneration = panel.owner.hooks.inputGeneration();
    this.step = this.advancePose.bind(this);
    this.clearHeld = this.clearInput.bind(this);
    window.addEventListener("blur", this.clearHeld);
    this.layer.cleanups.push(() =>
      window.removeEventListener("blur", this.clearHeld),
    );
    this.speech = new SpeechBubbles(panel.owner.app, panel.owner.services);
    this.speechScene = {
      container: this.layer.root,
      overlays: this.layer.root,
      camera: { x: 0, y: 0 },
      destroyed: false,
    };
    this.speechPose = { x: 128, headY: 199 };
    this.speech.setScene(this.speechScene);
    this.drawBackground();
    this.layer.cleanups.push(() => this.destroy());
    this.prepareSpeech();
    this.prepare();
  }

  drawBackground() {
    this.background.destroy();
    this.background = this.layer.layer("Cash Shop preview background");
    this.background.image(`Base/Preview/${this.backgroundIndex}`, 24, 40);
    this.layer.root.setChildIndex(this.background.root, 0);
  }

  async prepareSpeech() {
    try {
      const signal = AbortSignal.any([
        this.lifetime.signal,
        this.panel.owner.controller.signal,
      ]);
      await this.speech.prepare(this.service.catalog, signal);
      if (this.panel.cashChatInput) this.panel.cashChatInput.disabled = false;
    } catch (error) {
      if (this.lifetime.signal.aborted || this.panel.disposed) return;
      if (this.panel.cashChatInput) {
        this.panel.cashChatInput.title = error.message;
      }
      this.panel.owner.report(error);
    }
  }

  async prepare(request = {}) {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const epoch = ++this.epoch;
    const proposal = this.#previewProposal(request);
    this.proposal = proposal;
    this.pending = true;
    this.refreshBuyControl();
    let prepared;
    try {
      const signal = AbortSignal.any([
        controller.signal,
        this.panel.owner.controller.signal,
      ]);
      prepared = await this.#prepareAppearance(proposal, signal);
      if (signal.aborted || this.panel.disposed || epoch !== this.epoch) {
        prepared.destroy();
        return;
      }
      this.#publishAppearance(prepared, proposal);
    } catch (error) {
      this.#discardAppearance(prepared);
      if (!controller.signal.aborted && !this.panel.disposed) {
        this.panel.cashPreviewError = error.message;
        this.panel.owner.report(error);
      }
    } finally {
      if (epoch === this.epoch) {
        this.pending = false;
        this.proposal = null;
        this.refreshBuyControl();
      }
    }
  }

  #discardAppearance(prepared) {
    if (prepared !== this.visual && typeof prepared?.destroy === "function") {
      prepared.destroy();
    }
  }

  #previewProposal(request) {
    return {
      tried: request.tried ?? this.proposal?.tried ?? this.tried,
      removeAll:
        request.removeAll ?? this.proposal?.removeAll ?? this.removeAll,
    };
  }

  #prepareAppearance(proposal, signal) {
    if (!this.service.hooks.preparePreview) {
      throw new Error("The original composed avatar preview is not available.");
    }
    return this.service.hooks.preparePreview({
      profile: this.service.store.profile,
      itemIds: [...proposal.tried.values()].map((entry) => entry.id),
      removeAll: proposal.removeAll,
      signal,
    });
  }

  #publishAppearance(prepared, proposal) {
    if (
      !prepared?.root ||
      typeof prepared.destroy !== "function" ||
      typeof prepared.update !== "function" ||
      typeof prepared.pose !== "function" ||
      typeof prepared.attack !== "function"
    ) {
      throw new Error("Invalid composed avatar preview ownership.");
    }
    this.visual?.destroy();
    this.visual = prepared;
    this.tried = proposal.tried;
    this.sns = new Set([...this.tried.values()].map((entry) => entry.sn));
    this.removeAll = proposal.removeAll;
    this.publishPose();
    this.layer.root.addChild(prepared.root);
    if (!this.speech.destroyed) this.layer.root.addChild(this.speech.root);
    this.panel.cashPreviewError = null;
  }

  tryOn(sn) {
    try {
      const offer = this.service.catalog.ui.cashShop.commodities[sn];
      const pack = this.service.catalog.ui.cashShop.packages[offer?.itemId];
      const candidates = pack ? pack.sns : [sn];
      if (candidates.length > 96) {
        throw new Error(
          "Original cash preview package exceeds its bounded size.",
        );
      }
      const tried = new Map(this.proposal?.tried ?? this.tried);
      let added = false;
      for (const candidate of candidates) {
        const template = this.#wearableTemplate(candidate);
        if (!template) continue;
        this.#applyTriedItem(tried, template, sn);
        added = true;
      }
      if (!added) {
        throw new Error(
          "This item has no wearable equipment appearance for this character.",
        );
      }
      this.prepare({ tried });
    } catch (error) {
      cashMessage(this.panel, error.message);
    }
  }

  #wearableTemplate(sn) {
    const item = this.service.catalog.ui.cashShop.commodities[sn];
    const template = cashTemplate(this.panel, item?.itemId);
    if (
      !template ||
      Math.floor(template.id / 1000000) !== 1 ||
      !template.info?.islot
    ) {
      return null;
    }
    if (
      item.gender !== -1 &&
      item.gender !== 2 &&
      item.gender !== this.service.store.profile.gender
    ) {
      return null;
    }
    return template;
  }

  #applyTriedItem(tried, template, sn) {
    const slot = equippedSlots(template)[0],
      offset = slot < -100 ? 100 : 0;
    const kind = Math.floor(template.id / 10000);
    if (kind === 105) tried.delete(-6 - offset);
    if (
      kind === 106 &&
      Math.floor(tried.get(-5 - offset)?.id / 10000) === 105
    ) {
      tried.delete(-5 - offset);
    }
    if (!tried.has(slot) && tried.size >= MAX_TRIED_ITEMS) {
      throw new Error("Remove a preview item before trying on another.");
    }
    tried.set(slot, { id: template.id, sn });
  }

  reset(removeAll = false) {
    this.prepare({ tried: new Map(), removeAll });
  }

  refreshBuyControl() {
    this.panel.cashBuyAvatar?.setDisabled(
      this.pending || this.service.pending || !this.sns.size,
    );
  }

  setBackground(index) {
    if (!Number.isInteger(index) || index < 0 || index > 2) return;
    this.backgroundIndex = index;
    this.panel.owner.rememberTab("CashShop.preview", index);
    this.drawBackground();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.clearInput();
    this.panel.cashSelected = null;
    this.panel.cashActionIndex = -1;
    for (const row of this.panel.cashSelections) {
      row.selection.container.visible = false;
      for (const control of row.controls) control.element.blur();
    }
    this.panel.cashPreviewMode?.(enabled);
  }

  /** 004ad20b resolves the active bound Jump53/Attack52; arrows are physical controls. */
  key(event) {
    const bindings = this.panel.owner.bindings?.active;
    if (!this.enabled || !bindings) return false;
    const action = heldActionForCode(event.code, bindings);
    if (!action) return false;
    if (event.target?.matches?.("input,select,textarea")) {
      if (action === "attack" || event.target !== this.panel.cashChatInput) {
        return false;
      }
      event.target.blur();
    }
    if (action === "jump" && !this.input.jump) this.input.jumpPressed = true;
    this.held.set(event.code, action);
    this.input[action] = true;
    this.inputGeneration = this.panel.owner.hooks.inputGeneration();
    return true;
  }

  keyUp(event) {
    const action = this.held.get(event.code);
    if (!action) return false;
    this.held.delete(event.code);
    this.input[action] = false;
    for (const held of this.held.values()) {
      if (held === action) this.input[action] = true;
    }
    return true;
  }

  clearInput() {
    this.held.clear();
    this.input.left =
      this.input.right =
      this.input.up =
      this.input.down =
        false;
    this.input.jump = this.input.attack = this.input.jumpPressed = false;
  }

  advancePose(ms) {
    const visual = this.visual;
    if (!visual) return;
    this.publishPose();
    if (this.input.attack && this.simulation.state !== "ladder") {
      visual.attack(this.simulation.crouching);
    }
    visual.update(ms);
    this.simulation.movementLocked = visual.attacking;
  }

  publishPose() {
    if (!this.visual) return;
    this.visual.pose(this.simulation);
    //Original centered800×600 world origin; the CSChar clip is independent of motion.
    this.visual.root.position.set(
      this.simulation.x + 400,
      this.simulation.y + 300,
    );
  }

  update(ms) {
    const generation = this.panel.owner.hooks.inputGeneration();
    if (
      generation !== this.inputGeneration ||
      !this.enabled ||
      this.panel.cashDialog ||
      this.panel.owner.modal() ||
      document.activeElement?.matches?.("input,select,textarea")
    ) {
      this.clearInput();
    }
    this.inputGeneration = generation;
    advanceSimulation(this.simulation, this.input, ms, this.step);
    if (this.visual) {
      this.speechPose.x = this.visual.root.x;
      this.speechPose.headY = this.visual.root.y - this.visual.speechHeight;
      this.speech.update(ms, this.speechPose, this.speechScene.camera);
    }
  }

  destroy() {
    this.epoch++;
    this.controller?.abort();
    this.lifetime.abort();
    this.speechScene.destroyed = true;
    this.speech.destroy();
    this.visual?.destroy();
    this.visual = null;
  }
}
