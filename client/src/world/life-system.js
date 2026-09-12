import { Container, Graphics, Point, Text } from "pixi.js";
import { MapleTVSystem } from "../social/mapletv-system.js";
import { LifeControls } from "../development/life-controls.js";
import {
  rectangleSlot,
  showRectangle,
  contactGraphic,
} from "./life-geometry.js";
import {
  placeBody,
  sweepBody,
  npcRectangle,
  containsPoint,
} from "./life-geometry-numeric.js";

const MAX_PLACEMENTS = 4096;
const MAX_ACTIONS = 128;
const MAX_FRAMES = 1024;
const MAX_TARGET_ANCESTORS = 32;
const MAX_SPEECH = 4096;
// 006d9390 / 0094f2ed, original float32 constant at00afc9f0.
const TALK_RADIUS = 200;
const TALK_EDGE = Math.trunc((1.4140000343322754 - 1) * TALK_RADIUS);
const TALK_CORNER = Math.trunc(TALK_RADIUS / 1.4140000343322754);
const TALK_HORIZONTAL = { horizontal: TALK_RADIUS, vertical: TALK_EDGE };
const TALK_VERTICAL = { horizontal: TALK_EDGE, vertical: TALK_RADIUS };
const TALK_DIAGONAL = { horizontal: TALK_CORNER, vertical: TALK_CORNER };

/** Validate the independent metadata boundary before allocating preview graphics. */
function validateLife(life) {
  if (
    !life ||
    life.schemaVersion !== 1 ||
    life.mode !== "metadata-preview" ||
    life.activationKnown !== false
  ) {
    throw new Error("Unsupported life metadata manifest");
  }
  if (
    !Array.isArray(life.placements) ||
    life.placements.length > MAX_PLACEMENTS
  ) {
    throw new Error("Life preview placement count exceeds policy");
  }
  validatePlacements(life.placements, life.templates);
}

function validatePlacements(placements, templates) {
  const ids = new Set();
  for (const record of placements) {
    if (!/^life:\d+$/.test(record.id) || ids.has(record.id)) {
      throw new Error("Invalid life preview identity");
    }
    ids.add(record.id);
    const template = templates[record.template];
    if (!template || !["npc", "mob"].includes(template.kind)) {
      throw new Error("Missing life template");
    }
    validateTemplate(template);
    for (const key of ["x", "y", "fh", "cy", "rx0", "rx1"]) {
      if (key !== "x" && key !== "y" && record.authored[key] === undefined) {
        continue;
      }
      if (!Number.isSafeInteger(record.authored[key])) {
        throw new Error("Invalid authored life geometry");
      }
    }
  }
}

function validateTemplate(template) {
  const actions = Object.values(template.actions);
  if (actions.length > MAX_ACTIONS) {
    throw new Error("Invalid life actions");
  }
  for (const action of actions) validateAction(action);
  if (template.name !== null && typeof template.name !== "string") {
    throw new Error("Invalid life name");
  }
  if (template.function !== null && typeof template.function !== "string") {
    throw new Error("Invalid life function");
  }
  validateNpcSpeech(template.speech, template.actions);
}

function validateNpcSpeech(speech, actions) {
  if (speech === null || speech === undefined) return;
  validateSpeechLines(speech.lines);
  if (!Array.isArray(speech.actions) || speech.actions.length > MAX_ACTIONS) {
    throw new Error("Invalid NPC speech action inventory");
  }
  for (const action of speech.actions) {
    if (
      !Object.hasOwn(actions, action.action) ||
      !Number.isSafeInteger(action.durationMs) ||
      action.durationMs < 1
    ) {
      throw new Error("Invalid NPC speech action");
    }
    validateSpeechLines(action.lines);
  }
}

function validateSpeechLines(lines) {
  if (!Array.isArray(lines) || lines.length > MAX_SPEECH) {
    throw new Error("NPC speech inventory exceeds policy");
  }
  for (const line of lines) {
    if (
      !line ||
      (line.text !== null &&
        (typeof line.text !== "string" || line.text.length > MAX_SPEECH))
    ) {
      throw new Error("Invalid original NPC speech text");
    }
  }
}

function validateAction(action) {
  if (
    !Array.isArray(action.frames) ||
    !action.frames.length ||
    action.frames.length > MAX_FRAMES
  ) {
    throw new Error("Invalid life frame metadata");
  }
  for (const frame of action.frames) {
    if (
      frame.body &&
      ![
        frame.body.left,
        frame.body.top,
        frame.body.right,
        frame.body.bottom,
      ].every(Number.isFinite)
    ) {
      throw new Error("Invalid life body metadata");
    }
  }
}

/** Metadata inspection observes dynamic gameplay-owned mobs without mutating their state. */
export class LifeSystem {
  constructor(scene, hooks) {
    validateLife(scene.manifest.life);
    this.scene = scene;
    this.hooks = hooks;
    this.destroyed = false;
    this.showGeometry = false;
    this.revealHidden = false;
    this.selected = null;
    this.root = new Container({ label: "life-metadata-preview" });
    this.root.eventMode = "passive";
    scene.overlays.addChild(this.root);
    this.slots = [];
    this.byId = new Map();
    this.targetSlots = new Map();
    this.pointerPoint = new Point();
    for (const record of scene.manifest.life.placements) {
      const slot = this.createSlot(record);
      this.slots.push(slot);
      this.byId.set(record.id, slot);
    }
    this.mapleTV = new MapleTVSystem(scene, this.byId);
    this.controls = new LifeControls(this, this.slots);
    this.refresh();
  }

  createSlot(record) {
    const template = this.scene.manifest.life.templates[record.template];
    const segment = this.scene.simulation.geometry.byId.get(record.authored.fh);
    const label = record.kind === "npc" ? createLabel(template) : null;
    const slot = {
      record,
      template,
      label,
      entity: null,
      action:
        template.defaultAction ?? Object.keys(template.actions)[0] ?? null,
      elapsedMs: 0,
      body: rectangleSlot(0xff6868),
      sweep: rectangleSlot(0xffc45b),
      interaction: rectangleSlot(0x72cfff),
      interactionLocal:
        record.kind === "npc" ? npcRectangle(template.info) : null,
      contact: contactGraphic(record, segment),
      contactStatus: segment
        ? "Authored foothold resolved"
        : "Authored foothold unavailable",
      previousX: record.authored.x,
      previousY: record.authored.y,
      delta: { x: 0, y: 0 },
      resident: false,
      playerFootInsideBody: false,
      handler: null,
      canInteract: this.canInteract.bind(this, record.id),
      target: null,
    };
    slot.handler = this.pointer.bind(this, slot);
    if (record.kind === "npc") this.createNpcTarget(slot);
    this.root.addChild(
      slot.contact,
      slot.sweep.graphic,
      slot.body.graphic,
      slot.interaction.graphic,
    );
    return slot;
  }

  /** 006d92d3 picks dc, not artwork or the inspector's labels/body rectangles. */
  createNpcTarget(slot) {
    const target = new Container({ label: slot.record.id });
    target.eventMode = "static";
    target.interactiveChildren = false;
    target.hitArea = { contains: this.containsNpcPoint.bind(this, slot) };
    target.on("pointerup", slot.handler);
    slot.target = target;
    this.targetSlots.set(target, slot);
    // Native pool iteration chooses its first hit. Authored order is the offline pool order.
    this.root.addChildAt(target, 0);
  }

  /** Pixi supplies world-local coordinates here; PtInRect excludes right/bottom edges. */
  containsNpcPoint(slot, x, y) {
    if (!this.canInteract(slot.record.id, true)) return false;
    const position = slot.entity.container.position;
    const rectangle = slot.interactionLocal;
    return (
      (x >= position.x + rectangle.left &&
        x < position.x + rectangle.right &&
        y >= position.y + rectangle.top &&
        y < position.y + rectangle.bottom) ||
      Boolean(this.world?.contains(slot, x, y))
    );
  }

  /** Restore preview phase when a shared streamed entity is recreated. */
  bind(slot, entity) {
    if (slot.entity && !slot.entity.container.destroyed) {
      slot.entity.container.off("pointertap", slot.handler);
    }
    if (slot.label) this.scene.unregisterPresentationContainer(slot.label);
    slot.entity = entity ?? null;
    if (!entity) return;
    if (slot.label) {
      if (slot.label.destroyed) slot.label = createLabel(slot.template);
      entity.container.addChild(slot.label);
      this.scene.registerPresentationContainer(slot.label);
    }
    slot.previousX = entity.container.x;
    slot.previousY = entity.container.y;
    if (!entity.gameplayOwned) {
      entity.setAction(slot.action);
      entity.advance(slot.elapsedMs);
    }
    entity.container.eventMode = slot.record.kind === "npc" ? "none" : "static";
    if (slot.record.kind === "mob") {
      entity.container.on("pointertap", slot.handler);
    }
  }
  /** Region membership changes are lifecycle work, never render-loop listener allocation. */
  refresh() {
    if (this.destroyed) return;
    for (const slot of this.slots) {
      const entity = this.scene.byId.get(slot.record.id);
      if (slot.entity !== (entity ?? null)) this.bind(slot, entity);
    }
    this.mapleTV.refresh();
    this.world?.refresh();
    this.update(0);
  }

  /** Elapsed time is artwork preview time, never the fixed-30-ms physics accumulator. */
  update(ms) {
    if (this.destroyed) return;
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error("Invalid life elapsed time");
    }
    for (const slot of this.slots) this.updateSlot(slot, ms);
    this.mapleTV.update(ms);
    this.world?.update(ms);
  }

  updateSlot(slot, ms) {
    const entity = slot.entity;
    if (entity?.gameplayOwned) {
      slot.action = entity.action;
      slot.elapsedMs = entity.elapsedMs;
    } else slot.elapsedMs += ms;
    slot.resident = !!entity && !entity.container.destroyed;
    const visible = slotVisible(slot, this.revealHidden);
    if (slot.label) this.updateLabel(slot, visible, entity);
    slot.contact.visible =
      visible && this.showGeometry && this.selected === slot;
    if (slot.resident) {
      if (!entity.gameplayOwned && slot.record.authored.hide) {
        entity.container.visible = visible;
      }
      this.updateGeometry(slot, entity);
    } else {
      slot.body.active = false;
      slot.sweep.active = false;
      slot.interaction.active = false;
      slot.playerFootInsideBody = false;
    }
    this.showGeometryFor(slot, visible);
  }

  showGeometryFor(slot, visible) {
    showRectangle(slot.body, visible && this.showGeometry);
    showRectangle(
      slot.sweep,
      visible && this.showGeometry && this.selected === slot,
    );
    showRectangle(slot.interaction, visible && this.showGeometry);
  }

  updateLabel(slot, visible, entity) {
    if (slot.label.destroyed) return;
    slot.label.visible = visible && slot.template.info.hideName !== 1;
    if (entity) {
      slot.label.position.set(0, 0);
      slot.label.scale.x = entity.container.scale.x;
    }
  }

  updateGeometry(slot, entity) {
    const position = entity.container.position;
    const mirrored = entity.container.scale.x < 0;
    const action = slot.template.actions[entity.action];
    const frame = action?.frames[entity.frame];
    const rectangle = slot.record.kind === "mob" ? frame?.body : null;
    placeBody(slot.body, rectangle, position, mirrored);
    const mob = this.scene.offlineField?.byId.get(slot.record.id);
    slot.delta.x = (mob ? mob.previousX : slot.previousX) - position.x;
    slot.delta.y = (mob ? mob.previousY : slot.previousY) - position.y;
    sweepBody(slot.sweep, slot.body, slot.delta);
    if (mob && !mob.alive) {
      slot.body.active = false;
      slot.sweep.active = false;
    }
    placeBody(slot.interaction, slot.interactionLocal, position, false);
    slot.previousX = position.x;
    slot.previousY = position.y;
    slot.playerFootInsideBody = containsPoint(slot.body, this.scene.simulation);
  }

  /** 0094cf7a routes WM_LBUTTONUP (0x202), not double-click, to 0094fa8e. */
  pointer(slot, event) {
    if (event.button !== 0 || event.isPrimary === false) return;
    if (slot.record.kind === "mob") {
      if (this.destroyed || !slot.entity || slot.entity.container.destroyed) {
        return;
      }
      this.interact(slot.record.id);
      return;
    }
    if (
      event.type !== "pointerup" ||
      event.target !== slot.target ||
      !event.global
    ) {
      return;
    }
    this.root.toLocal(event.global, undefined, this.pointerPoint);
    if (
      !this.containsNpcPoint(slot, this.pointerPoint.x, this.pointerPoint.y)
    ) {
      return;
    }
    if (this.interactWorld(slot.record.id)) event.stopPropagation();
  }

  /** Normal agent interaction and pointer release enter the identical live admission path. */
  interactWorld(id) {
    if (!this.canInteract(id, true)) return false;
    const slot = this.byId.get(id);
    const record = {
      id,
      templateId: slot.template.originalId,
      name: slot.template.name,
      functionName: slot.template.function,
      authority: "offline-local-policy",
      kind: slot.record.kind,
      authored: slot.record.authored,
      info: slot.template.info,
      interactionGeometryKnown: !!slot.interactionLocal,
      mode: "npc-local-interaction",
      canInteract: slot.canInteract,
      admissionPolicy:
        "native dc target/defaults and left-button release; local live-pool/alive/modal admission, no invented proximity",
    };
    try {
      if (!this.hooks.onInteract) return false;
      const pending = this.hooks.onInteract?.(record);
      if (pending && typeof pending.catch === "function") {
        pending.catch(this.hooks.onError);
      }
      return true;
    } catch (error) {
      this.hooks.onError(error);
      return false;
    }
  }
  /** Native keyboard Talk selects nearest eligible origin inside the expanded dc union. */
  talkNearest() {
    if (this.destroyed) return false;
    const player = this.scene.simulation;
    let selected = null;
    let distance = Infinity;
    for (const slot of this.slots) {
      if (!this.canInteract(slot.record.id, true)) continue;
      // 006dd71d..754: talkMouseOnly writes template+0x44; pointer talk is unaffected.
      if (slot.template.info.talkMouseOnly) continue;
      const origin = slot.entity.container;
      const x = Math.trunc(player.x) - origin.x;
      const y = Math.trunc(player.y) - origin.y;
      const rectangle = slot.interactionLocal;
      if (
        !expandedContains(rectangle, x, y, TALK_HORIZONTAL) &&
        !expandedContains(rectangle, x, y, TALK_VERTICAL) &&
        !expandedContains(rectangle, x, y, TALK_DIAGONAL)
      ) {
        continue;
      }
      const candidate = x * x + y * y;
      if (candidate < distance) {
        selected = slot;
        distance = candidate;
      }
    }
    return selected ? this.interactWorld(selected.record.id) : false;
  }

  /** Metadata selection is a separate route; failed world actions never open the inspector. */
  interact(id) {
    if (this.destroyed) return false;
    const slot = this.byId.get(id);
    if (!slot) throw new Error("Unknown life interaction preview");
    this.selected = slot;
    this.controls.showSelection(id);
    return false;
  }

  /** Opening blocks every modal; continuation may admit the same NPC's own dialogue. */
  canInteract(id, opening = false) {
    const slot = this.byId.get(id);
    if (
      this.destroyed ||
      this.scene.destroyed ||
      !slot ||
      slot.record.kind !== "npc"
    ) {
      return false;
    }
    if (!this.canTalk(slot, opening ? undefined : id)) return false;
    if (this.scene.byId.get(id) !== slot.entity) return false;
    return this.pickableNpc(slot);
  }

  pickableNpc(slot) {
    const rectangle = slot.interactionLocal;
    if (
      !rectangle ||
      rectangle.left === rectangle.right ||
      rectangle.top === rectangle.bottom
    ) {
      return false;
    }
    if (!renderedInScene(slot.target, this.scene.container)) return false;
    // 006d92d3 rejects imitate templates without their separate avatar object (+0x8c).
    // This renderer has no original imitation-avatar ownership.
    if (slot.template.info.imitate) return false;
    return residentNpcVisible(slot, this.scene.container);
  }

  canTalk(slot, id) {
    const field = this.scene.offlineField;
    return (
      !!field?.prepared &&
      !field.dead &&
      (slot.record.authored.hide === undefined ||
        slot.record.authored.hide === 0) &&
      !this.hooks.isBlocked?.(id)
    );
  }

  /** Only the owned dc target can select the NPC cursor; ancestry never authorizes gameplay. */
  isInteractiveTarget(target) {
    const slot = this.targetSlots.get(target);
    return !!slot && this.canInteract(slot.record.id, true);
  }

  select(id) {
    const slot = this.byId.get(id);
    if (!slot) throw new Error("Unknown life preview selection");
    this.selected = slot;
  }

  /** Explicit local resource selection, including hit/die artwork without gameplay transitions. */
  setPreviewAction(id, action) {
    if (this.destroyed) return;
    const slot = this.byId.get(id);
    if (slot?.record.kind === "mob") return false;
    if (!slot || !Object.hasOwn(slot.template.actions, action)) {
      throw new Error("Unknown life preview action");
    }
    slot.action = action;
    slot.elapsedMs = 0;
    if (slot.entity) slot.entity.setAction(action);
  }

  snapshot() {
    return {
      mode: "metadata-preview",
      activationKnown: false,
      destroyed: this.destroyed,
      showGeometry: this.showGeometry,
      revealHidden: this.revealHidden,
      selected: this.selected?.record.id ?? null,
      mapleTV: this.mapleTV.snapshot(),
      placements: this.slots.map(snapshotSlot),
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.controls.destroy();
    this.mapleTV.destroy();
    this.world?.destroy();
    for (const slot of this.slots) {
      if (slot.label) this.scene.unregisterPresentationContainer(slot.label);
      if (slot.label && !slot.label.destroyed) {
        slot.label.destroy({ children: true });
      }
      if (slot.entity && !slot.entity.container.destroyed) {
        slot.entity.container.off("pointertap", slot.handler);
      }
    }
    this.targetSlots.clear();
    this.root.destroy({ children: true });
    this.byId.clear();
    this.slots.length = 0;
    this.selected = null;
  }
}

/** Gameplay owns mob visibility; preview reveal applies only to authored scenery. */
function slotVisible(slot, revealHidden) {
  const entity = slot.entity;
  if (!entity || entity.container.destroyed) return false;
  return !entity.gameplayOwned && slot.record.authored.hide
    ? revealHidden
    : entity.container.visible;
}

function residentNpcVisible(slot, root) {
  const entity = slot.entity;
  if (!entity || entity.frame < 0 || !renderedInScene(entity.container, root)) {
    return false;
  }
  for (const sprite of entity.sprites) {
    if (
      !sprite.destroyed &&
      sprite.visible &&
      sprite.renderable &&
      sprite.alpha > 0
    ) {
      return true;
    }
  }
  return false;
}

/** Local residency is not enough: detached or ancestor-hidden artwork is not rendered. */
function renderedInScene(container, root) {
  let resident = false;
  for (let depth = 0; container && depth < MAX_TARGET_ANCESTORS; depth++) {
    if (
      container.destroyed ||
      !container.visible ||
      !container.renderable ||
      container.alpha <= 0
    ) {
      return false;
    }
    if (container === root) resident = true;
    container = container.parent;
  }
  return !container && resident;
}

/** Win32 PtInRect excludes right/bottom, including the expanded dc union. */
function expandedContains(rectangle, x, y, expansion) {
  return (
    x >= rectangle.left - expansion.horizontal &&
    x < rectangle.right + expansion.horizontal &&
    y >= rectangle.top - expansion.vertical &&
    y < rectangle.bottom + expansion.vertical
  );
}

/** 006d5c9a types1001/1002 → 005f10f3..11d0: Arial12, yellow, A0 black. */
function createLabel(template) {
  const label = new Container({ label: "npc-nameplate", zIndex: 2 });
  let y = 2; // 005f1691 sets canvas originY=-2.
  for (const value of [template.name, template.function]) {
    if (!value) continue;
    const text = new Text({
      text: value,
      style: { fontFamily: "Arial", fontSize: 12, fill: 0xffff00 },
    });
    // 005f12f0..1301: measured width+5, font height+4; text starts x2/y0.
    const width = Math.ceil(text.width) + 5;
    const height = Math.ceil(text.height) + 4;
    const left = -Math.trunc(width / 2);
    const background = new Graphics()
      .rect(left, y, width, height)
      .fill({ color: 0, alpha: 160 / 255 });
    text.position.set(left + 2, y);
    label.addChild(background, text);
    y += height + 1; // 005f1a04..1a18 stacks the next independent name layer.
  }
  label.eventMode = "none";
  label.visible = false;
  return label;
}

function snapshotRectangle(rectangle) {
  return {
    active: rectangle.active,
    left: rectangle.left,
    top: rectangle.top,
    right: rectangle.right,
    bottom: rectangle.bottom,
  };
}

function snapshotQuestMarker(presentation) {
  if (!presentation) return null;
  return {
    state: presentation.state,
    visible: presentation.marker.container.visible,
    frame: presentation.marker.frame,
  };
}

function snapshotEntityAnchor(entity) {
  if (!entity) return null;
  return {
    x: entity.container.x,
    y: entity.container.y,
    z: entity.container.zIndex,
  };
}

function snapshotCanvas(slot) {
  const frame =
    slot.template.actions[slot.action]?.frames[slot.entity?.frame ?? 0];
  return frame
    ? { origin: frame.origin, width: frame.width, height: frame.height }
    : null;
}

function snapshotSlot(slot) {
  const entity = slot.entity;
  return {
    id: slot.record.id,
    templateId: slot.template.originalId,
    name: slot.template.name,
    functionName: slot.template.function,
    resident: slot.resident,
    action: slot.action,
    frame: slot.entity?.frame ?? null,
    timingKnown: slot.template.actions[slot.action]?.timingKnown ?? false,
    nameHidden: slot.template.info.hideName === 1,
    authored: slot.record.authored,
    contactStatus: slot.contactStatus,
    anchor: snapshotEntityAnchor(entity),
    canvas: snapshotCanvas(slot),
    body: snapshotRectangle(slot.body),
    sweptBody: snapshotRectangle(slot.sweep),
    npcInteraction: snapshotRectangle(slot.interaction),
    questMarker: snapshotQuestMarker(slot.worldPresentation),
    ambientSpeech: slot.worldPresentation?.speech?.snapshot() ?? null,
    playerFootInsideBody: slot.playerFootInsideBody,
    authority:
      slot.record.kind === "mob"
        ? "offline-local-policy; inspection only"
        : "metadata-preview; no damage",
  };
}
