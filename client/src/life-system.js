import { Container, Rectangle, Text } from "pixi.js";
import { LifeControls } from "./life-controls.js";
import {
  rectangleSlot,
  placeBody,
  sweepBody,
  showRectangle,
  npcRectangle,
  contactGraphic,
  containsPoint,
} from "./life-geometry.js";

const MAX_PLACEMENTS = 4096;
const MAX_ACTIONS = 128;
const MAX_FRAMES = 1024;

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
      if (!Number.isSafeInteger(record.authored[key])) {
        throw new Error("Invalid authored life geometry");
      }
    }
  }
}

function validateTemplate(template) {
  const actions = Object.values(template.actions);
  if (!actions.length || actions.length > MAX_ACTIONS) {
    throw new Error("Invalid life actions");
  }
  for (const action of actions) validateAction(action);
  if (template.name !== null && typeof template.name !== "string") {
    throw new Error("Invalid life name");
  }
  if (template.function !== null && typeof template.function !== "string") {
    throw new Error("Invalid life function");
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

/** No server-controlled actor state is synthesized; Main alone advances artwork animation. */
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
    for (const record of scene.manifest.life.placements) {
      const slot = this.createSlot(record);
      this.slots.push(slot);
      this.byId.set(record.id, slot);
    }
    this.controls = new LifeControls(this, this.slots);
    this.refresh();
  }

  createSlot(record) {
    const template = this.scene.manifest.life.templates[record.template];
    const segment = this.scene.simulation.geometry.byId.get(record.authored.fh);
    const label = createLabel(template);
    const slot = {
      record,
      template,
      label,
      entity: null,
      action: "stand",
      elapsedMs: 0,
      body: rectangleSlot(0xff6868),
      sweep: rectangleSlot(0xffc45b),
      interaction: rectangleSlot(0x72cfff),
      interactionLocal: npcRectangle(template.info),
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
      hitArea: null,
    };
    slot.handler = this.pointer.bind(this, slot);
    if (slot.interactionLocal) {
      const r = slot.interactionLocal;
      slot.hitArea = new Rectangle(
        r.left,
        r.top,
        r.right - r.left,
        r.bottom - r.top,
      );
    }
    this.root.addChild(
      slot.contact,
      slot.sweep.graphic,
      slot.body.graphic,
      slot.interaction.graphic,
      label,
    );
    return slot;
  }

  /** Restore preview phase when a shared streamed entity is recreated. */
  bind(slot, entity) {
    if (slot.entity && !slot.entity.container.destroyed) {
      slot.entity.container.off("pointertap", slot.handler);
    }
    slot.entity = entity ?? null;
    if (!entity) return;
    entity.setAction(slot.action);
    entity.advance(slot.elapsedMs);
    entity.container.eventMode = "static";
    entity.container.cursor = "pointer";
    // No missing dc geometry is invented. Without dc, Pixi artwork clicks are inspection only.
    if (slot.hitArea) entity.container.hitArea = slot.hitArea;
    entity.container.on("pointertap", slot.handler);
  }
  /** Region membership changes are lifecycle work, never render-loop listener allocation. */
  refresh() {
    if (this.destroyed) return;
    for (const slot of this.slots) {
      const entity = this.scene.byId.get(slot.record.id);
      if (slot.entity !== (entity ?? null)) this.bind(slot, entity);
    }
    this.update(0);
  }

  /** Elapsed time is artwork preview time, never the fixed-30-ms physics accumulator. */
  update(ms) {
    if (this.destroyed) return;
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error("Invalid life elapsed time");
    }
    for (const slot of this.slots) this.updateSlot(slot, ms);
  }

  updateSlot(slot, ms) {
    const entity = slot.entity;
    slot.elapsedMs += ms;
    slot.resident = !!entity;
    const visible =
      !!entity && (slot.record.authored.hide !== 1 || this.revealHidden);
    slot.label.visible = visible && slot.template.info.hideName !== 1;
    slot.contact.visible =
      visible && this.showGeometry && this.selected === slot;
    if (entity) {
      entity.container.visible = visible;
      slot.label.position.set(entity.container.x, entity.container.y + 5);
      this.updateGeometry(slot, entity);
    } else {
      slot.body.active = false;
      slot.sweep.active = false;
      slot.interaction.active = false;
      slot.playerFootInsideBody = false;
    }
    showRectangle(slot.body, visible && this.showGeometry);
    showRectangle(
      slot.sweep,
      visible && this.showGeometry && this.selected === slot,
    );
    showRectangle(slot.interaction, visible && this.showGeometry);
  }

  updateGeometry(slot, entity) {
    const position = entity.container.position;
    const mirrored = entity.container.scale.x < 0;
    const action = slot.template.actions[entity.action];
    const frame = action?.frames[entity.frame];
    const rectangle = slot.record.kind === "mob" ? frame?.body : null;
    placeBody(slot.body, rectangle, position, mirrored);
    slot.delta.x = slot.previousX - position.x;
    slot.delta.y = slot.previousY - position.y;
    sweepBody(slot.sweep, slot.body, slot.delta);
    placeBody(slot.interaction, slot.interactionLocal, position, mirrored);
    slot.previousX = position.x;
    slot.previousY = position.y;
    slot.playerFootInsideBody = containsPoint(slot.body, this.scene.simulation);
  }

  pointer(slot, event) {
    event.stopPropagation();
    this.interact(slot.record.id);
  }

  /** Exact strings/metadata reach UI; onInteract is a server-unavailable boundary, not dialogue. */
  interact(id) {
    if (this.destroyed) return;
    const slot = this.byId.get(id);
    if (!slot) throw new Error("Unknown life interaction preview");
    this.selected = slot;
    if (slot.record.kind !== "npc") {
      this.controls.showSelection(id);
      return;
    }
    const record = {
      id,
      templateId: slot.template.originalId,
      name: slot.template.name,
      functionName: slot.template.function,
      authority: "server-unavailable; metadata-preview",
      kind: slot.record.kind,
      authored: slot.record.authored,
      info: slot.template.info,
      interactionGeometryKnown: !!slot.interactionLocal,
      mode: "npc-server-boundary",
    };
    try {
      const pending = this.hooks.onInteract?.(record);
      if (pending && typeof pending.catch === "function") {
        pending.catch(this.hooks.onError);
      }
    } catch (error) {
      this.hooks.onError(error);
    }
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
      placements: this.slots.map(snapshotSlot),
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.controls.destroy();
    for (const slot of this.slots) {
      if (slot.entity && !slot.entity.container.destroyed) {
        slot.entity.container.off("pointertap", slot.handler);
      }
    }
    this.root.destroy({ children: true });
    this.byId.clear();
    this.slots.length = 0;
    this.selected = null;
  }
}

/** Browser typography is explicitly not a reconstruction of the original font renderer. */
function createLabel(template) {
  const label = new Text({
    text: nameplate(template),
    style: {
      fontFamily: "sans-serif",
      fontSize: 12,
      fill: 0xffffa0,
      align: "center",
      stroke: { color: 0x15202b, width: 3 },
    },
  });
  label.anchor.set(0.5, 0);
  label.eventMode = "none";
  label.visible = false;
  return label;
}

function nameplate(template) {
  const label = template.name ?? template.originalId;
  return template.function
    ? `${label}\n${template.function}\n[metadata preview]`
    : `${label}\n[metadata preview]`;
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

function snapshotSlot(slot) {
  return {
    id: slot.record.id,
    templateId: slot.template.originalId,
    name: slot.template.name,
    functionName: slot.template.function,
    resident: slot.resident,
    action: slot.action,
    frame: slot.entity?.frame ?? null,
    timingKnown: slot.template.actions[slot.action].timingKnown,
    nameHidden: slot.template.info.hideName === 1,
    authored: slot.record.authored,
    contactStatus: slot.contactStatus,
    body: snapshotRectangle(slot.body),
    sweptBody: snapshotRectangle(slot.sweep),
    npcInteraction: snapshotRectangle(slot.interaction),
    playerFootInsideBody: slot.playerFootInsideBody,
    authority: "metadata-preview; no damage",
  };
}
