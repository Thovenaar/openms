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
const LOCAL_NPC_REACH_X = 120;
const LOCAL_NPC_REACH_Y = 100;

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
      action:
        template.defaultAction ?? Object.keys(template.actions)[0] ?? null,
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
      canInteract: this.canInteract.bind(this, record.id),
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
    slot.previousX = entity.container.x;
    slot.previousY = entity.container.y;
    if (!entity.gameplayOwned) {
      entity.setAction(slot.action);
      entity.advance(slot.elapsedMs);
    }
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
    if (entity?.gameplayOwned) {
      slot.action = entity.action;
      slot.elapsedMs = entity.elapsedMs;
    } else slot.elapsedMs += ms;
    slot.resident = !!entity;
    const visible = slotVisible(slot, this.revealHidden);
    slot.label.visible = visible && slot.template.info.hideName !== 1;
    slot.contact.visible =
      visible && this.showGeometry && this.selected === slot;
    if (entity) {
      if (!entity.gameplayOwned) entity.container.visible = visible;
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
    const mob = this.scene.offlineField?.byId.get(slot.record.id);
    slot.delta.x = (mob ? mob.previousX : slot.previousX) - position.x;
    slot.delta.y = (mob ? mob.previousY : slot.previousY) - position.y;
    sweepBody(slot.sweep, slot.body, slot.delta);
    if (mob && !mob.alive) {
      slot.body.active = false;
      slot.sweep.active = false;
    }
    placeBody(slot.interaction, slot.interactionLocal, position, mirrored);
    slot.previousX = position.x;
    slot.previousY = position.y;
    slot.playerFootInsideBody = containsPoint(slot.body, this.scene.simulation);
  }

  pointer(slot, event) {
    event.stopPropagation();
    this.interact(slot.record.id, "world-pointer");
  }

  /** Inspector selection cannot open gameplay. Native world clicks use local proximity admission. */
  interact(id, source = "inspection") {
    if (this.destroyed) return;
    const slot = this.byId.get(id);
    if (!slot) throw new Error("Unknown life interaction preview");
    this.selected = slot;
    if (
      slot.record.kind !== "npc" ||
      source !== "world-pointer" ||
      !this.canInteract(id)
    ) {
      this.controls.showSelection(id);
      return;
    }
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
        "local visible/alive world-pointer within 120px horizontal and 100px vertical; dc geometry remains separate",
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

  /** Provisional interaction reach is not a recovered dc-rectangle admission rule. */
  canInteract(id) {
    const slot = this.byId.get(id);
    if (
      this.destroyed ||
      this.scene.destroyed ||
      !slot ||
      slot.record.kind !== "npc"
    ) {
      return false;
    }
    if (
      !this.scene.offlineField?.prepared ||
      this.scene.offlineField.dead ||
      slot.record.authored.hide === 1
    ) {
      return false;
    }
    if (!residentNpcVisible(slot)) return false;
    const entity = slot.entity;
    const sim = this.scene.simulation;
    return (
      Math.abs(sim.x - entity.container.x) <= LOCAL_NPC_REACH_X &&
      Math.abs(sim.y - entity.container.y) <= LOCAL_NPC_REACH_Y
    );
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

/** Gameplay owns mob visibility; preview reveal applies only to authored scenery. */
function slotVisible(slot, revealHidden) {
  const entity = slot.entity;
  if (!entity) return false;
  return entity.gameplayOwned
    ? entity.container.visible
    : slot.record.authored.hide !== 1 || revealHidden;
}

function residentNpcVisible(slot) {
  const entity = slot.entity;
  return !!entity && !entity.container.destroyed && entity.container.visible;
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
  const label = template.name ?? "";
  return template.function ? `${label}\n${template.function}` : label;
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
    timingKnown: slot.template.actions[slot.action]?.timingKnown ?? false,
    nameHidden: slot.template.info.hideName === 1,
    authored: slot.record.authored,
    contactStatus: slot.contactStatus,
    body: snapshotRectangle(slot.body),
    sweptBody: snapshotRectangle(slot.sweep),
    npcInteraction: snapshotRectangle(slot.interaction),
    playerFootInsideBody: slot.playerFootInsideBody,
    authority:
      slot.record.kind === "mob"
        ? "offline-local-policy; inspection only"
        : "metadata-preview; no damage",
  };
}
