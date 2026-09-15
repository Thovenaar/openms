import { Graphics } from "pixi.js";
import { StreamScene } from "../rendering/stream-scene.js";
import { EntityAnimation } from "../rendering/animation.js";
import {
  VisualTextures,
  loadVisualBundle,
} from "../rendering/visual-resources.js";
import { AvatarVisuals } from "../character/avatar-visuals.js";
import { prepareFieldAvatar } from "../character/field-avatar.js";
import { makeAppearanceProfile } from "./read-model.js";
import { animationName, PROTOCOL } from "../../../shared/protocol.js";
import { manifest as validateManifest } from "../rendering/stream-validation.js";
import {
  createCameraFilter,
  evaluateCameraFilter,
  followCamera,
} from "../rendering/camera.js";

import { PlayerName } from "../character/player-name.js";
import { currencyEntity, itemEntity } from "../world/drop-artwork.js";
import { SceneEvents } from "./scene-events.js";
import { SceneDrops } from "./scene-drops.js";
import { SceneChairs } from "./scene-chairs.js";
import { SceneLife } from "./scene-life.js";
import { observeWorldCharacter } from "./native-world-actions.js";
import { createMobNameLabel } from "../combat/offline-mob-renderer.js";
import { weaponActionAnimationMs } from "../combat/weapon-usage.js";
const MAX_ENTITIES = 4096;
/** Server entity publications land every third field tick (server/src/world.js); peers,
 * mobs and drops are chases over that interval, not per-tick motion. */
const ENTITY_PUBLISH_MS = PROTOCOL.TICK_MS * 3;
const MOVEMENT_ACTIONS = new Set([
  "stand1",
  "walk1",
  "jump",
  "fly",
  "prone",
  "ladder",
  "rope",
  "sit",
]);
const CLIMB_ACTIONS = new Set(["ladder", "rope", "ladder2", "rope2"]);

/** 00452792..004527d3 holds ladder/rope artwork when consecutive Y positions match. */
export function holdObservedClimb(action, previousY, nextY) {
  return CLIMB_ACTIONS.has(action) && previousY === nextY;
}
/** Owns display resources only. Entity membership and actions are observations. */
export class OnlineScene {
  constructor({ manifest, services, catalog, viewport, intent, app }) {
    this.scene = new StreamScene(manifest, services, viewport);
    this.services = services;
    this.catalog = catalog;
    this.app = app;
    this.visuals = new AvatarVisuals(services, catalog);
    this.views = new Map();
    this.npcs = new Map();
    this.npcByPlacement = new Map();
    this.lifeEntities = new Map();
    this.reactorEntities = new Map();
    this.native = null;
    this.lifePromise = null;
    this.footholds = new Map(
      manifest.physics.footholds.map((entry) => [entry.id, entry]),
    );
    this.controller = new AbortController();
    this.filter = createCameraFilter();
    this.intent = intent;
    this.selfId = null;
    this.tick = 0;
    this.paused = false;
    this.follow = true;
    this.geometry = new Graphics();
    this.scene.overlays.addChild(this.geometry);
    this.geometry.visible = false;
    this.queue = Promise.resolve();
    this.scene.onEntitiesChanged = () => this.refreshNpcs();
    this.events = new SceneEvents(this, app);
    this.drops = new SceneDrops(this);
    this.chairs = new SceneChairs(this);
    this.observedSimulation = Object.create(null);
    this.simulationSource = null;
    this.selfPose = { x: 0, y: 0 };
    this.presentation = { x: 0, y: 0, facing: 0, action: "stand1" };
    const presentationView = Object.create(null);
    for (const key of Object.keys(this.presentation)) {
      Object.defineProperty(presentationView, key, {
        enumerable: true,
        get: () => this.presentation[key],
      });
    }
    Object.freeze(presentationView);
    Object.defineProperties(this.scene, {
      simulation: { get: () => this.observedSimulation },
      presentation: { get: () => presentationView },
    });
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
    await this.events.prepare(this.controller.signal);
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
    for (const entity of this.reactorEntities.values()) {
      if (!ids.has(entity.id)) this.remove(entity.id);
    }
  }
  changes(message) {
    this.tick = message.serverTick;
    const work = this.queue.then(async () => {
      for (const change of message.changes) {
        if (change.kind === "remove") this.remove(change.entityId);
        else await this.upsert(change.entity);
      }
    });
    // A failed resource is reported by the caller. It must not poison every
    // subsequent replacement/recovery by leaving a rejected queue tail.
    this.queue = work.catch((error) => {
      this.lastError = error;
    });
    return work;
  }
  async upsert(entity) {
    this.controller.signal.throwIfAborted();
    if (entity.kind === "npc") return this.upsertNpc(entity);
    if (entity.kind === "reactor") {
      this.reactorEntities.set(entity.reactor.placementId, entity);
      return;
    }
    let view = this.views.get(entity.id);
    const identity = JSON.stringify([
      entity.kind,
      entity.templateId,
      entity.appearance,
    ]);
    if (!view || view.identity !== identity) {
      if (!view && this.views.size >= MAX_ENTITIES) {
        throw new Error("Online entity residency limit");
      }
      const owner = await this.prepareEntity(entity);
      if (this.controller.signal.aborted) {
        owner.destroy();
        this.controller.signal.throwIfAborted();
      }
      if (view) this.remove(entity.id);
      view = {
        owner,
        animation: owner.animation,
        entity,
        identity,
        fromX: entity.position.x,
        fromY: entity.position.y,
        drawX: entity.position.x,
        drawY: entity.position.y,
        received: performance.now(),
      };
      this.views.set(entity.id, view);
      this.scene.addDynamicEntity(owner.animation);
      this.bindEntity(view);
    }
    this.updateView(view, entity);
  }
  updateView(view, entity) {
    const previousY = view.entity.position.y;
    if (entity.placementId) {
      this.lifeEntities.set(entity.placementId, view);
      view.animation.gameplayOwned = true;
    }
    view.fromX = view.drawX;
    view.fromY = view.drawY;
    view.received = performance.now();
    view.observedAge = 0;
    view.entity = entity;
    view.holdClimb = holdObservedClimb(
      animationName(entity.action),
      previousY,
      entity.position.y,
    );
    this.updateViewDepth(view);
    if (entity.id === this.selfId) {
      this.scene.actor = view.animation;
      this.presentation.x = entity.position.x;
      this.presentation.y = entity.position.y;
      this.presentation.facing = entity.facing;
      this.presentation.action = animationName(entity.action);
    }
    this.pose(view, entity.position.x, entity.position.y);
    this.seekObservedAction(view);
    this.observeAppearance(view);
    this.native?.life.refresh();
  }
  updateViewDepth(view) {
    const entity = view.entity;
    const foothold = this.footholds.get(entity.foothold);
    if (entity.kind === "mob") {
      this.scene.setEntityDepth(
        view.animation,
        entity.mobState?.movementType === 3
          ? 270100
          : foothold
            ? 29991 + (foothold.layer * 3000 - foothold.group) * 10
            : 239991,
      );
    } else if (foothold) {
      this.scene.setEntityDepth(
        view.animation,
        (entity.kind === "drop" ? 29999 : 29997) +
          (foothold.layer * 3000 - foothold.group) * 10,
      );
    }
  }
  seekObservedAction(view) {
    const entity = view.entity;
    if (view.holdClimb) return;
    view.animation.seek(
      entity.dropMotion?.age ??
        entity.mobState?.elapsedMs ??
        entity.combatState?.elapsedMs ??
        Math.max(0, this.tick - entity.actionStartTick) * PROTOCOL.TICK_MS,
    );
  }
  observeAppearance(view) {
    const entity = view.entity;
    if (entity.kind === "player") {
      observeWorldCharacter(view, entity, Date.now());
    }
    view.animation.setTint(entity.combatState?.tint ?? 0xffffff);
    view.animation.container.alpha = entity.mobState?.opacity ?? 1;
    if (entity.mobState) {
      view.animation.container.visible = entity.mobState.bodyVisible;
      if (view.mobName) view.mobName.visible = entity.mobState.nameVisible;
    }
    this.observeCombatExpression(view);
  }
  observeCombatExpression(view) {
    const entity = view.entity;
    const combat = entity.combatState;
    if (combat?.expressionMs > 0) {
      const startedAt = this.tick * PROTOCOL.TICK_MS + combat.expressionMs;
      if (
        view.combatExpression !== combat.expression ||
        view.combatExpressionEnd !== startedAt
      ) {
        view.animation.setExpression(combat.expression, combat.expressionMs);
        view.combatExpression = combat.expression;
        view.combatExpressionEnd = startedAt;
      }
    }
  }
  bindEntity(view) {
    const { entity, animation } = view;
    if (entity.appearance) {
      const scene = {
        actor: animation,
        registerPresentationContainer:
          this.scene.registerPresentationContainer.bind(this.scene),
        unregisterPresentationContainer:
          this.scene.unregisterPresentationContainer.bind(this.scene),
      };
      view.name = new PlayerName(scene, { profile: entity.appearance });
      view.name.step(this.app.renderer.resolution);
    }
    if (entity.kind === "mob") {
      const name = this.catalog.monsters[entity.templateId]?.name;
      if (typeof name !== "string") {
        throw new Error("Original monster name is not packaged.");
      }
      view.mobName = createMobNameLabel(name);
      view.mobName.position.set(0, 4);
      animation.container.addChild(view.mobName);
      this.scene.registerPresentationContainer(view.mobName);
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
    const placement = this.npcArtwork(entity);
    const previous = this.npcs.get(entity.id);
    if (previous) this.releaseNpc(entity.id);
    const reference = {
      entity,
      regionId: placement?.id ?? null,
      placement,
      animation: null,
    };
    this.npcs.set(entity.id, reference);
    if (placement) this.npcByPlacement.set(placement.id, reference);
    this.bindNpc(entity.id);
    this.native?.life.refresh();
  }
  npcArtwork(entity) {
    const { placements, templates } = this.scene.manifest.life;
    const templateId = Number(entity.templateId);
    for (const placement of placements) {
      if (placement.kind !== "npc") continue;
      if (Number(templates[placement.template]?.originalId) !== templateId) {
        continue;
      }
      if (
        placement.authored.x !== entity.position.x ||
        placement.authored.y !== entity.position.y
      ) {
        continue;
      }
      return placement;
    }
    return null;
  }
  bindNpc(id) {
    const reference = this.npcs.get(id);
    const animation = reference?.regionId
      ? this.scene.byId.get(reference.regionId)
      : null;
    if (!reference?.regionId) return;
    reference.animation = animation;
    this.lifeEntities.set(reference.regionId, reference);
    if (!animation) return;
    animation.gameplayOwned = true;
    animation.setAction(animationName(reference.entity.action));
    animation.seek(
      Math.max(0, this.tick - reference.entity.actionStartTick) * 30,
    );
  }
  /** Region teardown replaces owned display objects, so references re-bind by identity. */
  refreshNpcs() {
    for (const id of this.npcs.keys()) this.bindNpc(id);
    this.native?.life.refresh();
  }
  releaseNpc(id) {
    const reference = this.npcs.get(id);
    if (!reference?.regionId) return;
    this.npcByPlacement.delete(reference.regionId);
    this.lifeEntities.delete(reference.regionId);
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
    try {
      return this.animationOwner(
        entity,
        itemEntity(resources, item),
        resources,
      );
    } catch (error) {
      resources.destroy();
      throw error;
    }
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
    try {
      return this.animationOwner(
        entity,
        currencyEntity(resources, artwork, variant),
        resources,
      );
    } catch (error) {
      resources.destroy();
      throw error;
    }
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
    animation.container.scale.x =
      entity.kind !== "drop" && entity.facing > 0 ? -1 : 1;
    if (view.name) view.name.step(this.app.renderer.resolution);
    if (view.mobName) view.mobName.scale.x = animation.container.scale.x;
    animation.setAction(this.poseAction(view), this.posePlayback(entity));
    animation.holdFrame = view.holdClimb;
  }
  poseAction(view) {
    const { entity, animation } = view;
    if (entity.kind === "drop") return "default";
    const action = animationName(entity.action);
    let pose = action;
    if (action === "stand1") pose = animation.avatar?.standAction ?? action;
    if (action === "walk1") pose = animation.avatar?.walkAction ?? action;
    return animation.actions.has(pose)
      ? pose
      : (animation.avatar?.standAction ?? "stand1");
  }
  posePlayback(entity) {
    return (entity.combatState && entity.combatState.phase !== "idle") ||
      (entity.mobState &&
        (entity.mobState.hp === 0 ||
          entity.mobState.phase === "spawning" ||
          entity.mobState.phase === "hit" ||
          entity.mobState.phase === "attack"))
      ? "once"
      : "loop";
  }
  /** Borrow predictor state through getter-only fields; never step a field here. */
  syncPrediction(prediction, active) {
    if (!prediction?.simulation) return;
    if (!this.simulationSource) {
      for (const key of Object.keys(prediction.simulation)) {
        Object.defineProperty(this.observedSimulation, key, {
          enumerable: true,
          get: () => this.simulationSource[key],
        });
      }
      Object.freeze(this.observedSimulation);
    }
    // Disconnects retain the last complete predictor state for native inspection.
    if (active || !this.simulationSource) {
      this.simulationSource = prediction.simulation;
    }
  }
  get life() {
    return this.native?.life ?? null;
  }
  /** Quest markers, nameplates and portal artwork observe the server presentation only. */
  setNativePresentation(quests) {
    if (this.lifeQuests !== quests) {
      this.native?.destroy();
      this.native = null;
      this.lifePromise = null;
      this.lifeQuests = quests;
    }
    this.lifePromise ??= this.createLife(quests);
    return this.lifePromise;
  }
  async createLife(quests) {
    const native = new SceneLife(this, quests);
    try {
      await native.prepare();
    } catch (error) {
      native.destroy();
      if (this.controller.signal.aborted) return null;
      throw error;
    }
    if (this.controller.signal.aborted || this.lifeQuests !== quests) {
      native.destroy();
      return null;
    }
    this.native = native;
    native.life.refresh();
    return native;
  }
  isInteractive(x, y) {
    return this.native?.isInteractive(x, y) ?? false;
  }
  event(message) {
    if (!message.event || message.fieldEpoch !== this.fieldEpoch) {
      return Promise.resolve();
    }
    this.queue = this.queue.then(() => this.events.event(message));
    return this.queue;
  }
  relocateObserved(event) {
    const view = this.views.get(event.actorId);
    if (!view) return;
    view.fromX = view.drawX = event.destination.x;
    view.fromY = view.drawY = event.destination.y;
    view.received = performance.now();
    view.holdClimb = false;
    view.animation.setPosition(event.destination.x, event.destination.y);
    if (event.actorId === this.selfId) {
      this.presentation.x = this.selfPose.x = event.destination.x;
      this.presentation.y = this.selfPose.y = event.destination.y;
    }
  }
  resize(width, height) {
    this.scene.viewport.width = width;
    this.scene.viewport.height = height;
    this.updateCamera(performance.now());
    this.scene.updateDemand();
  }
  setFollow(value) {
    this.follow = Boolean(value);
    if (this.follow) this.filter = createCameraFilter();
    this.updateCamera(performance.now());
  }
  setCamera(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("Invalid online camera coordinates");
    }
    this.follow = false;
    this.scene.camera.x = x;
    this.scene.camera.y = y;
    this.updateCamera(performance.now());
    this.scene.updateDemand();
  }
  inspectionSnapshot() {
    return {
      selfId: this.selfId,
      fieldEpoch: this.fieldEpoch,
      serverTick: this.tick,
      follow: this.follow,
      camera: { ...this.scene.camera },
      presentation: { ...this.presentation },
      entityCount: this.views.size,
      npcs: this.npcs.size,
      chairs: this.chairs.seats.size,
      npcPresentation: this.native?.snapshotNpcs() ?? [],
      combat: this.events.combat.snapshot(),
      enhancements: this.events.enchant.snapshot(),
    };
  }
  effectTarget(actorId) {
    const view = this.views.get(actorId);
    return view ? this.events.target(view) : null;
  }
  draw(now, elapsed, prediction, active) {
    this.paused = prediction?.paused ?? false;
    this.syncPrediction(prediction, active);
    this.drawPrediction = prediction?.ready && active ? prediction : null;
    for (const view of this.views.values()) {
      this.drawView(view, now, elapsed, active);
    }
    this.drawNpcs(elapsed, active);
    this.updateCamera(now);
    this.native?.update(elapsed);
    this.events.draw(elapsed);
    this.drops.draw(elapsed);
    this.chairs.draw(elapsed);
    if (this.geometry.visible) this.showGeometry(true);
    this.drawScenery(elapsed, active);
  }
  drawView(view, now, elapsed, active) {
    const simulation = this.interpolateView(view, now);
    if (view.entity.id === this.selfId) this.drawSelfPose(view, simulation);
    if (active) this.advanceView(view, elapsed);
    if (view.mobName) {
      view.mobName.visible =
        view.entity.mobState.nameVisible &&
        view.observedAge < view.entity.mobState.nameRemainingMs;
    }
    if (view.entity.kind === "drop") {
      this.drops.observe(view, view.drawX, view.drawY);
    }
    this.chairs.observe(view, view.drawX, view.drawY);
  }
  interpolateView(view, now) {
    const self = view.entity.id === this.selfId;
    // An action locks input, not gravity or the local presentation clock. The
    // predictor already imports that lock in each authoritative motion checkpoint.
    const prediction = self ? this.drawPrediction : null;
    const simulation = prediction?.simulation ?? null;
    let x;
    let y;
    if (simulation) {
      prediction.interpolate(now, this.selfPose);
      x = this.selfPose.x;
      y = this.selfPose.y;
    } else {
      const fraction = Math.min(1, (now - view.received) / ENTITY_PUBLISH_MS);
      x = view.fromX + (view.entity.position.x - view.fromX) * fraction;
      y = view.fromY + (view.entity.position.y - view.fromY) * fraction;
      this.pose(view, x, y);
    }
    view.drawX = x;
    view.drawY = y;
    return simulation;
  }
  advanceView(view, elapsed) {
    view.observedAge += elapsed;
    view.animation.advance(elapsed);
    const combat = view.entity.combatState;
    if (combat?.phase === "attack" && combat.attackSpeed !== null) {
      view.animation.seek(
        weaponActionAnimationMs(
          view.animation.current,
          combat.attackSpeed,
          combat.phaseMs + view.observedAge,
        ),
      );
    }
  }
  drawSelfPose(view, simulation) {
    this.presentation.x = view.drawX;
    this.presentation.y = view.drawY;
    this.presentation.facing = simulation
      ? simulation.facing
      : view.entity.facing;
    const action = animationName(view.entity.action);
    this.presentation.action =
      simulation && !view.entity.seat && MOVEMENT_ACTIONS.has(action)
        ? simulation.action
        : action;
    if (simulation) {
      this.scene.updateActor(this.presentation);
      view.name?.step(this.app.renderer.resolution);
    }
  }
  drawNpcs(elapsed, active) {
    for (const reference of this.npcs.values()) {
      if (reference.animation && active) reference.animation.advance(elapsed);
    }
  }
  drawScenery(elapsed, active) {
    for (const entity of this.scene.entities) {
      if (!this.views.has(entity.id) && !entity.gameplayOwned && active) {
        entity.advance(elapsed);
      }
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
    for (const [placementId, entity] of this.reactorEntities) {
      if (entity.id === id) {
        this.reactorEntities.delete(placementId);
        return;
      }
    }
    if (this.npcs.has(id)) {
      this.releaseNpc(id);
      this.npcs.delete(id);
      this.native?.life.refresh();
      return;
    }
    const view = this.views.get(id);
    if (!view) return;
    if (this.lifeEntities.get(view.entity.placementId) === view) {
      this.lifeEntities.delete(view.entity.placementId);
    }
    this.scene.removeDynamicEntity(id);
    view.name?.destroy();
    if (view.mobName) {
      this.scene.unregisterPresentationContainer(view.mobName);
      view.mobName.destroy();
    }
    if (this.scene.actor === view.animation) this.scene.actor = null;
    view.owner.destroy();
    this.views.delete(id);
  }
  destroy() {
    this.controller.abort();
    this.scene.onEntitiesChanged = null;
    this.events.destroy();
    this.drops.destroy();
    this.chairs.destroy();
    this.native?.destroy();
    this.native = null;
    for (const id of this.views.keys()) this.remove(id);
    for (const id of this.npcs.keys()) this.remove(id);
    this.reactorEntities.clear();
    this.scene.destroy();
  }
}
