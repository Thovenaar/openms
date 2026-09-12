import { Text, Graphics } from "pixi.js";
import { StreamScene } from "../rendering/stream-scene.js";
import { EntityAnimation } from "../rendering/animation.js";
import {
  VisualTextures,
  loadVisualBundle,
} from "../rendering/visual-resources.js";
import { AvatarVisuals } from "../character/avatar-visuals.js";
import { prepareFieldAvatar } from "../character/field-avatar.js";
import { makeAppearanceProfile } from "./read-model.js";
import { animationName } from "../../../shared/protocol.js";
import { manifest as validateManifest } from "../rendering/stream-validation.js";
import {
  createCameraFilter,
  evaluateCameraFilter,
  followCamera,
} from "../rendering/camera.js";

const MAX_ENTITIES = 4096;
/** Owns display resources only. Entity membership and actions are observations. */
export class OnlineScene {
  constructor({ manifest, services, catalog, viewport, intent }) {
    this.scene = new StreamScene(manifest, services, viewport);
    this.services = services;
    this.catalog = catalog;
    this.visuals = new AvatarVisuals(services, catalog);
    this.views = new Map();
    this.npcs = new Map();
    this.npcHandlers = new Map();
    this.footholds = new Map(
      manifest.physics.footholds.map((entry) => [entry.id, entry]),
    );
    this.controller = new AbortController();
    this.filter = createCameraFilter();
    this.intent = intent;
    this.selfId = null;
    this.tick = 0;
    this.follow = true;
    this.geometry = new Graphics();
    this.scene.overlays.addChild(this.geometry);
    this.geometry.visible = false;
    this.queue = Promise.resolve();
    this.scene.onEntitiesChanged = () => this.refreshNpcs();
  }
  async prepare(snapshot) {
    this.selfId = snapshot.self.entity.id;
    this.fieldEpoch = snapshot.fieldEpoch;
    this.tick = snapshot.serverTick;
    await this.scene.preparePresentation(
      this.controller.signal,
      snapshot.self.entity.position,
    );
    await this.replace(snapshot);
    return this;
  }
  async replace(snapshot) {
    this.tick = snapshot.serverTick;
    const ids = new Set([snapshot.self.entity.id]);
    await this.upsert(snapshot.self.entity);
    for (const entity of snapshot.entities) {
      ids.add(entity.id);
      if (entity.id !== this.selfId) await this.upsert(entity);
    }
    for (const id of this.views.keys()) if (!ids.has(id)) this.remove(id);
    for (const id of this.npcs.keys()) if (!ids.has(id)) this.remove(id);
  }
  changes(message) {
    this.tick = message.serverTick;
    this.queue = this.queue.then(async () => {
      for (const change of message.changes) {
        if (change.kind === "remove") this.remove(change.entityId);
        else await this.upsert(change.entity);
      }
    });
    return this.queue;
  }
  async upsert(entity) {
    this.controller.signal.throwIfAborted();
    if (entity.kind === "npc") return this.upsertNpc(entity);
    let view = this.views.get(entity.id);
    const identity = JSON.stringify([
      entity.kind,
      entity.templateId,
      entity.appearance,
    ]);
    if (view && view.identity !== identity) {
      this.remove(entity.id);
      view = null;
    }
    if (!view) {
      if (this.views.size >= MAX_ENTITIES) {
        throw new Error("Online entity residency limit");
      }
      const owner = await this.prepareEntity(entity);
      if (this.controller.signal.aborted) {
        owner.destroy();
        this.controller.signal.throwIfAborted();
      }
      view = {
        owner,
        animation: owner.animation,
        entity,
        identity,
        fromX: entity.position.x,
        fromY: entity.position.y,
        received: performance.now(),
      };
      this.views.set(entity.id, view);
      this.scene.addDynamicEntity(owner.animation);
      this.bindEntity(view);
    }
    view.fromX = view.animation.baseX;
    view.fromY = view.animation.baseY;
    view.received = performance.now();
    view.entity = entity;
    const foothold = this.footholds.get(entity.foothold);
    if (foothold) {
      this.scene.setEntityDepth(
        view.animation,
        29997 + (foothold.layer * 3000 - foothold.group) * 10,
      );
    }
    this.pose(view, entity.position.x, entity.position.y);
    view.animation.seek(Math.max(0, this.tick - entity.actionStartTick) * 30);
  }
  bindEntity(view) {
    const { entity, animation } = view;
    if (entity.appearance) {
      const name = new Text({
        text: entity.appearance.name,
        style: {
          fontFamily: "Arial",
          fontSize: 12,
          fill: 0xffffff,
          stroke: { color: 0x222222, width: 3 },
        },
      });
      name.anchor.set(0.5, 0);
      name.position.set(0, 5);
      animation.container.addChild(name);
      view.name = name;
    }
    if (entity.kind === "npc" || entity.kind === "drop") {
      animation.container.eventMode = "static";
      animation.container.cursor = "pointer";
      animation.container.on("pointertap", () =>
        this.intent(
          entity.kind === "npc"
            ? { kind: "npc.open", npcId: entity.id }
            : { kind: "drop.pickup", dropId: entity.id },
        ),
      );
    }
  }
  /** Authored NPC artwork is region-owned and matched by placement, not wire identity. */
  upsertNpc(entity) {
    this.npcs.set(entity.id, { entity, regionId: this.npcArtwork(entity) });
    this.bindNpc(entity.id);
  }
  npcArtwork(entity) {
    const { placements, templates } = this.scene.manifest.life;
    const templateId = Number(entity.templateId);
    for (const placement of placements) {
      if (placement.kind !== "npc") continue;
      if (Number(templates[placement.template]?.originalId) !== templateId) continue;
      if (
        placement.authored.x !== entity.position.x ||
        placement.authored.y !== entity.position.y
      ) {
        continue;
      }
      return placement.id;
    }
    return null;
  }
  bindNpc(id) {
    const reference = this.npcs.get(id);
    const animation = reference?.regionId
      ? this.scene.byId.get(reference.regionId)
      : null;
    if (!animation) return;
    const bound = this.npcHandlers.get(id);
    if (bound?.animation === animation) return;
    this.releaseNpc(id);
    const handler = () => this.intent({ kind: "npc.open", npcId: id });
    animation.container.eventMode = "static";
    animation.container.cursor = "pointer";
    animation.container.on("pointertap", handler);
    this.npcHandlers.set(id, { animation, handler });
  }
  /** Region teardown replaces owned display objects, so references re-bind by identity. */
  refreshNpcs() {
    for (const [id, bound] of this.npcHandlers) {
      const reference = this.npcs.get(id);
      if (!reference?.regionId) continue;
      if (this.scene.byId.get(reference.regionId) !== bound.animation) {
        this.releaseNpc(id);
      }
    }
    for (const id of this.npcs.keys()) this.bindNpc(id);
  }
  releaseNpc(id) {
    const bound = this.npcHandlers.get(id);
    if (!bound) return;
    this.npcHandlers.delete(id);
    if (!bound.animation.container.destroyed) {
      bound.animation.container.off("pointertap", bound.handler);
    }
  }
  async prepareEntity(entity) {
    const signal = this.controller.signal;
    if (entity.kind === "player") {
      const original = this.scene.manifest.actors.find(
        (entry) => entry.kind === "character",
      );
      if (!original) {
        throw new Error("Original character artwork source missing");
      }
      return prepareFieldAvatar(
        this.visuals,
        makeAppearanceProfile(entity.appearance),
        {
          ...original,
          id: entity.id,
          x: entity.position.x,
          y: entity.position.y,
        },
        signal,
      );
    }
    if (entity.kind === "drop") return this.prepareDrop(entity);
    let manifest = this.scene.manifest;
    let key = Object.keys(manifest.life.templates).find(
      (id) =>
        Number(manifest.life.templates[id].originalId) === entity.templateId,
    );
    if (!key && entity.kind === "mob") {
      const sourceMap = this.catalog.monsters[entity.templateId]?.mapId;
      const descriptor = this.catalog.maps[String(sourceMap)];
      if (!descriptor) throw new Error("Spawn artwork source map unavailable");
      manifest = validateManifest(
        await this.services.network.json(descriptor, signal),
      );
      key = Object.keys(manifest.life.templates).find(
        (id) =>
          Number(manifest.life.templates[id].originalId) === entity.templateId,
      );
    }
    const placement = manifest.life.placements.find(
      (entry) => entry.template === key && entry.kind === entity.kind,
    );
    const descriptor = manifest.life.renderables?.[key];
    const original =
      descriptor?.entity ??
      manifest.actors.find((entry) => entry.id === placement?.id);
    if (!original) {
      throw new Error(
        `Missing original ${entity.kind} artwork ${entity.templateId}`,
      );
    }
    const resources = new VisualTextures(manifest, this.services.atlases);
    await resources.load([original], signal);
    return this.animationOwner(entity, original, resources);
  }
  async prepareDrop(entity) {
    if (entity.templateId === 0) return this.prepareCurrency(entity);
    const item = this.catalog.ui.items[entity.templateId];
    if (!item) {
      throw new Error(`Missing dropped item artwork ${entity.templateId}`);
    }
    const resources = await loadVisualBundle(
      item.descriptor,
      this.services,
      this.controller.signal,
    );
    const original = resources.manifest.entities.find(
      (entry) => entry.id === (item.iconRawPath ?? item.iconPath),
    );
    if (!original) {
      resources.destroy();
      throw new Error("Missing dropped-item icon");
    }
    return this.animationOwner(entity, original, resources);
  }
  async prepareCurrency(entity) {
    const artwork = this.catalog.ui.dropArtwork;
    const name = animationName(entity.action);
    const variant = Number(name.slice("currency".length));
    if (
      !name.startsWith("currency") ||
      !Number.isInteger(variant) ||
      variant < 0 ||
      variant > 3
    ) {
      throw new Error("Missing authoritative currency appearance");
    }
    const resources = await loadVisualBundle(
      artwork.descriptor,
      this.services,
      this.controller.signal,
    );
    const frames = [];
    for (const record of artwork.variants[variant]) {
      const source = resources.manifest.entities.find(
        (entry) => entry.id === record.path,
      );
      if (!source) {
        resources.destroy();
        throw new Error("Missing native currency frame");
      }
      frames.push({
        delay: record.delay,
        parts: source.actions.default[0].parts,
      });
    }
    return this.animationOwner(
      entity,
      {
        ...resources.manifest.entities[0],
        actions: { default: frames },
        action: "default",
      },
      resources,
    );
  }
  animationOwner(entity, original, resources) {
    const animation = new EntityAnimation(
      {
        ...original,
        id: entity.id,
        kind: entity.kind,
        x: entity.position.x,
        y: entity.position.y,
      },
      resources.textures,
    );
    return {
      animation,
      destroy() {
        animation.container.destroy({ children: true });
        resources.destroy();
      },
    };
  }
  pose(view, x, y) {
    const { entity, animation } = view;
    animation.setPosition(x, y);
    animation.container.scale.x = entity.facing > 0 ? -1 : 1;
    if (view.name) view.name.scale.x = animation.container.scale.x;
    const action = animationName(entity.action);
    animation.setAction(
      entity.kind === "drop"
        ? "default"
        : action === "stand1"
          ? (animation.avatar?.standAction ?? action)
          : action === "walk1"
            ? (animation.avatar?.walkAction ?? action)
            : action,
    );
  }
  draw(now, elapsed, prediction, active) {
    for (const view of this.views.values()) {
      const predicted =
        view.entity.id === this.selfId && prediction?.ready && active;
      const fraction = Math.min(1, (now - view.received) / 90);
      const x = predicted
        ? prediction.simulation.x
        : view.fromX + (view.entity.position.x - view.fromX) * fraction;
      const y = predicted
        ? prediction.simulation.y
        : view.fromY + (view.entity.position.y - view.fromY) * fraction;
      this.pose(view, x, y);
      if (active) view.animation.advance(elapsed);
    }
    this.updateCamera(now);
    for (const entity of this.scene.entities) {
      if (!this.views.has(entity.id) && active) entity.advance(elapsed);
    }
    for (const background of this.scene.backgrounds) {
      background.updateBackground(this.scene.camera, this.scene.viewport);
    }
  }
  updateCamera(now) {
    const self = this.views.get(this.selfId)?.animation;
    if (self && this.follow) {
      evaluateCameraFilter(this.filter, self.container.position, now);
      followCamera(
        this.scene.camera,
        this.filter,
        this.scene.manifest.physics,
        this.scene.viewport,
      );
    }
    this.scene.container.position.set(
      -this.scene.camera.x,
      -this.scene.camera.y,
    );
  }
  showGeometry(value) {
    this.geometry.visible = value;
    this.geometry.clear();
    if (!value) return;
    for (const foothold of this.scene.manifest.physics.footholds) {
      this.geometry
        .moveTo(foothold.x1, foothold.y1)
        .lineTo(foothold.x2, foothold.y2)
        .stroke({ color: 0x00ff99, width: 2 });
    }
    for (const view of this.views.values()) {
      const animation = view.animation;
      const box = animation.current.geometry[animation.frame];
      const x = animation.container.scale.x < 0 ? -box.x - box.width : box.x;
      this.geometry
        .rect(
          animation.baseX + x,
          animation.baseY + box.y,
          box.width,
          box.height,
        )
        .stroke({ color: 0xffbb44, width: 1 });
    }
  }
  /** Read-only world-to-canvas projection for inspection and verification. */
  project(x, y) {
    return { x: x - this.scene.camera.x, y: y - this.scene.camera.y };
  }
  remove(id) {
    if (this.npcs.has(id)) {
      this.npcs.delete(id);
      this.releaseNpc(id);
      return;
    }
    const view = this.views.get(id);
    if (!view) return;
    this.scene.removeDynamicEntity(id);
    view.owner.destroy();
    this.views.delete(id);
  }
  destroy() {
    this.controller.abort();
    this.scene.onEntitiesChanged = null;
    for (const id of this.views.keys()) this.remove(id);
    for (const id of this.npcs.keys()) this.remove(id);
    this.scene.destroy();
  }
}
