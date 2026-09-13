import { afterEach, expect, test } from "bun:test";
import { Container, EventBoundary, Graphics, Point, Texture } from "pixi.js";
import "pixi.js/events";
import { EntityAnimation } from "../src/rendering/animation.js";
import { npcRectangle } from "../src/world/life-geometry-numeric.js";
import { LifeSystem } from "../src/world/life-system.js";
import { MapleTVSystem } from "../src/social/mapletv-system.js";
import { StreamScene } from "../src/rendering/stream-scene.js";

const owners = [];
afterEach(() => {
  for (const life of owners) {
    life.destroy();
    life.scene.container.destroy({ children: true });
  }
  owners.length = 0;
});

// The DOM-only controls are excluded; routing uses the real life owner, artwork and Pixi picker.
function npcResources(info) {
  const template = {
    kind: "npc",
    originalId: 1012101,
    // Picker coverage does not depend on browser font rasterization.
    name: "",
    function: null,
    info,
    defaultAction: "stand",
    actions: { stand: { frames: [{ body: null }] } },
  };
  const record = {
    id: "life:0",
    kind: "npc",
    template: "npc:1012101",
    authored: { x: 100, y: 100 },
  };
  const entity = new EntityAnimation(
    {
      id: record.id,
      kind: "npc",
      x: 100,
      y: 100,
      z: 0,
      action: "stand",
      actions: {
        stand: [
          { delay: 180, parts: [{ texture: "pixel", x: -100, y: -100, z: 0 }] },
        ],
      },
    },
    new Map([["pixel", Texture.WHITE]]),
  );
  return { template, record, entity };
}

function fixture(info = {}, preparingDestination = false) {
  const { template, record, entity } = npcResources(info);
  const stage = new Container({ eventMode: "static" });
  const overlays = stage.addChild(new Container());
  stage.addChildAt(entity.container, 0);
  const delivered = [],
    inspected = [];
  const life = Object.create(LifeSystem.prototype);
  Object.assign(life, {
    scene: Object.assign(Object.create(StreamScene.prototype), {
      container: stage,
      overlays,
      presentationContainers: new Set(),
      presentationVisible: true,
      worldContainers: new Set(),
      depthSerial: 0,
      byId: new Map([[record.id, entity]]),
      simulation: { x: -10000, y: -10000, geometry: { byId: new Map() } },
      offlineField: { prepared: true, dead: false, byId: new Map() },
      manifest: { life: { templates: { [record.template]: template } } },
    }),
    hooks: {
      authority: "offline-local-policy",
      canTalk: () =>
        life.scene.offlineField.prepared && !life.scene.offlineField.dead,
      mobState: (id) => life.scene.offlineField.byId.get(id),
      onInteract: (npc) => delivered.push(npc),
      onError: (error) => {
        throw error;
      },
      isBlocked: () => false,
    },
    destroyed: false,
    revealHidden: false,
    showGeometry: false,
    selected: null,
    root: overlays.addChild(new Container({ eventMode: "passive" })),
    byId: new Map(),
    targetSlots: new Map(),
    pointerPoint: new Point(),
    controls: {
      showSelection: (id) => inspected.push(id),
      destroy: () => inspected.splice(0),
    },
  });
  if (preparingDestination) {
    // Destination presentation must work before any predicted simulation exists.
    life.scene.simulation = {};
    life.hooks.foothold = () => ({ x1: 0, y1: 100, x2: 200, y2: 100 });
  }
  const slot = bindFixture(life, record, entity);
  return {
    life,
    slot,
    entity,
    delivered,
    inspected,
    boundary: new EventBoundary(stage),
  };
}

test("online destination life prepares authored contact geometry before prediction", () => {
  const { slot } = fixture({}, true);
  expect(slot.contactStatus).toBe("Authored foothold resolved");
  expect(slot.resident).toBe(true);
  expect(slot.playerFootInsideBody).toBe(false);
});

function bindFixture(life, record, entity) {
  const slot = life.createSlot(record);
  life.slots = [slot];
  life.byId.set(record.id, slot);
  life.mapleTV = new MapleTVSystem(life.scene, life.byId);
  life.bind(slot, entity);
  life.update(0);
  owners.push(life);
  return slot;
}

function release(target, type = "pointerup", button = 0) {
  const event = {
    type,
    button,
    target,
    global: new Point(100, 50),
    stopped: false,
    stopPropagation() {
      this.stopped = true;
    },
  };
  target.emit(type, event);
  return event;
}

test("native dc defaults apply per missing edge and invalid authored geometry fails explicitly", () => {
  expect(npcRectangle({ dcLeft: -31, dcBottom: 7 })).toEqual({
    left: -31,
    top: -65,
    right: 22,
    bottom: 7,
  });
  expect(() => npcRectangle({ dcLeft: 23 })).toThrow();
  expect(() => npcRectangle({ dcTop: Infinity })).toThrow();
});

test("the picker translates dc without facing and rejects sprite ancestry or artwork extent", () => {
  const { life, slot, entity, boundary } = fixture({
    dcLeft: -10,
    dcRight: 40,
  });
  entity.container.scale.x = -1;
  life.update(0);
  expect(life.isInteractiveTarget(boundary.hitTest(139, 35))).toBe(true);
  expect(life.isInteractiveTarget(boundary.hitTest(140, 35))).toBe(false);
  expect(life.isInteractiveTarget(boundary.hitTest(90, 99))).toBe(true);
  expect(life.isInteractiveTarget(boundary.hitTest(89, 50))).toBe(false);
  expect(life.isInteractiveTarget(boundary.hitTest(100, 100))).toBe(false);
  expect(life.isInteractiveTarget(entity.sprites[0])).toBe(false);
  expect(life.isInteractiveTarget(entity.container)).toBe(false);
  expect(
    life.isInteractiveTarget({
      label: slot.record.id,
      parent: entity.container,
    }),
  ).toBe(false);
  expect(life.interactWorld(slot.record.id)).toBe(true);
});

test("left release interacts without a same-target press; tap, doubleclick and other buttons do not", () => {
  const { life, slot, boundary, delivered, inspected } = fixture();
  const target = boundary.hitTest(100, 50);
  release(target, "pointertap");
  release(target, "dblclick");
  release(target, "pointerup", 2);
  expect(delivered).toEqual([]);
  expect(release(target).stopped).toBe(true);
  expect(delivered.map((npc) => npc.id)).toEqual([slot.record.id]);
  expect(inspected).toEqual([]);
  life.scene.offlineField.dead = true;
  expect(delivered[0].canInteract()).toBe(false);
  expect(release(target).stopped).toBe(false);
  expect(delivered.length).toBe(1);
  expect(inspected).toEqual([]);
});

test("stale membership and hidden ancestors reject the same cached cursor and normal interaction", () => {
  const { life, slot, entity, boundary, delivered } = fixture();
  const id = slot.record.id;
  const target = boundary.hitTest(100, 50);
  expect(life.canInteract(id)).toBe(true);
  life.scene.byId.delete(id);
  expect(life.isInteractiveTarget(target)).toBe(false);
  expect(life.interactWorld(id)).toBe(false);
  life.scene.byId.set(id, entity);
  life.scene.container.visible = false;
  expect(life.isInteractiveTarget(target)).toBe(false);
  expect(life.interactWorld(id)).toBe(false);
  life.scene.container.visible = true;
  entity.container.removeFromParent();
  expect(life.interactWorld(id)).toBe(false);
  life.scene.container.addChildAt(entity.container, 0);
  entity.container.visible = false;
  life.update(0);
  expect(entity.container.visible).toBe(false);
  expect(life.interactWorld(id)).toBe(false);
  entity.container.visible = true;
  expect(life.interactWorld(id)).toBe(true);
  entity.container.destroy({ children: true });
  expect(life.isInteractiveTarget(target)).toBe(false);
  expect(life.interactWorld(id)).toBe(false);
  expect(delivered.length).toBe(1);
});

test("reveal and inspection cannot authorize hidden NPCs or divert a later eligible world release", () => {
  const { life, slot, boundary, delivered, inspected } = fixture();
  slot.record.authored.hide = 1;
  life.revealHidden = true;
  life.update(0);
  life.interact(slot.record.id);
  expect(inspected).toEqual([slot.record.id]);
  expect(life.interactWorld(slot.record.id)).toBe(false);
  expect(life.isInteractiveTarget(boundary.hitTest(100, 50))).toBe(false);
  slot.record.authored.hide = 0;
  const overlay = new Graphics().rect(0, 0, 500, 500).fill(0xffffff);
  overlay.eventMode = "static";
  life.scene.container.addChildAt(overlay, 0);
  const target = boundary.hitTest(100, 50);
  expect(life.isInteractiveTarget(target)).toBe(true);
  release(target);
  expect(delivered.length).toBe(1);
  expect(inspected).toEqual([slot.record.id]);
});

test("modal transitions, unprepared state and absent rendered content cannot admit cached targets", () => {
  const { life, slot, entity, boundary, delivered } = fixture();
  const id = slot.record.id;
  const target = boundary.hitTest(100, 50);
  let blocked = true;
  life.hooks.isBlocked = () => blocked;
  expect(life.isInteractiveTarget(target)).toBe(false);
  expect(life.interactWorld(id)).toBe(false);
  blocked = false;
  expect(life.interactWorld(id)).toBe(true);
  life.scene.offlineField.prepared = false;
  expect(delivered[0].canInteract()).toBe(false);
  life.scene.offlineField.prepared = true;
  entity.sprites[0].visible = false;
  expect(life.canInteract(id)).toBe(false);
  entity.sprites[0].visible = true;
  slot.template.info.imitate = 1;
  expect(life.canInteract(id)).toBe(false);
  slot.template.info.imitate = 0;
  slot.interactionLocal.right = slot.interactionLocal.left;
  expect(life.canInteract(id)).toBe(false);
  life.destroy();
  expect(life.isInteractiveTarget(target)).toBe(false);
  expect(life.interactWorld(id)).toBe(false);
});

test("an open NPC dialogue permits its live continuation but blocks all new world activations", () => {
  const { life, slot, boundary, delivered } = fixture();
  const target = boundary.hitTest(100, 50);
  expect(life.interactWorld(slot.record.id)).toBe(true);
  life.hooks.isBlocked = (npcId) => npcId !== slot.record.id;
  expect(delivered[0].canInteract()).toBe(true);
  expect(life.isInteractiveTarget(target)).toBe(false);
  expect(life.interactWorld(slot.record.id)).toBe(false);
  expect(release(target).stopped).toBe(false);
  expect(delivered.length).toBe(1);
});

test("presentation gating survives NPC recreation and late effects without hiding gameplay or overriding expiry", () => {
  const { life, slot, entity } = fixture();
  const scene = life.scene;
  const effect = new Container();
  scene.addWorldContainer(effect, 398500);
  scene.setPresentationVisible(false);
  life.update(0);
  expect(scene.overlays.visible).toBe(false);
  expect(slot.label.renderable).toBe(false);
  expect(effect.renderable).toBe(false);
  expect(entity.container.renderable).toBe(true);
  expect(entity.sprites[0].visible).toBe(true);

  entity.container.destroy({ children: true });
  scene.byId.delete(slot.record.id);
  life.refresh();
  const replacement = npcResources({}).entity;
  scene.container.addChild(replacement.container);
  scene.byId.set(slot.record.id, replacement);
  life.refresh();
  expect(slot.label.renderable).toBe(false);
  expect(replacement.container.renderable).toBe(true);

  const lateEffect = new Container();
  scene.addWorldContainer(lateEffect, 398500);
  expect(lateEffect.renderable).toBe(false);
  effect.visible = false;
  slot.template.info.hideName = 1;
  life.update(0);
  scene.setPresentationVisible(true);
  expect(scene.overlays.visible).toBe(true);
  expect(slot.label.renderable).toBe(true);
  expect(slot.label.visible).toBe(false);
  expect(effect.renderable).toBe(true);
  expect(effect.visible).toBe(false);
  expect(lateEffect.renderable).toBe(true);
  expect(lateEffect.visible).toBe(true);
  scene.removeWorldContainer(effect);
  scene.removeWorldContainer(lateEffect);
  effect.destroy();
  lateEffect.destroy();
});
