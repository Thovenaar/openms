import { LifeSystem } from "../world/life-system.js";
import { NpcWorldPresentation } from "../npc/npc-world-presentation.js";
import { GameplayEffects } from "../audio/gameplay-effects.js";
import {
  portalRevealContains,
  updatePortalGraphics,
} from "../world/portal-presentation.js";

/** Native life inspection/labels/markers and portal artwork consume observed state only. */
export class SceneLife {
  constructor(owner, quests) {
    this.owner = owner;
    this.quests = quests;
    this.life = new LifeSystem(owner.scene, {
      authority: "server-observation",
      // Destination artwork prepares before its predictor is installed. Contact
      // overlays need only the destination's validated, immutable WZ endpoints.
      foothold: (id) => owner.footholds.get(id),
      entity: (id) => owner.lifeEntities.get(id)?.animation,
      canTalk: (id) =>
        quests.store.profile.hp > 0 && owner.npcByPlacement.has(id),
      isBlocked: () =>
        quests.owner.blocked() || quests.owner.ui.blocksGameplay(),
      onInteract: (record) =>
        owner.intent({
          kind: "npc.open",
          npcId: owner.npcByPlacement.get(record.id).entity.id,
        }),
      onError: (error) => quests.owner.report(error),
    });
    this.world = new NpcWorldPresentation(this.life, quests, {
      app: owner.app,
      services: owner.services,
      ambient: "server",
      speech: (id) => owner.npcByPlacement.get(id)?.entity.npcSpeech,
      tick: () => owner.tick,
    });
    const portals = new Map(
      owner.scene.manifest.physics.portals.map((portal) => [portal.id, portal]),
    );
    this.portals = owner.scene.manifest.portalPresentation.records.map(
      (record) => ({
        portal: portals.get(record.portalId),
        entityId: record.entityId,
        animation: null,
        phase: record.status === "looping-graphics" ? "looping" : "hidden",
        desired: false,
      }),
    );
    this.reactors = owner.scene.manifest.reactors.placements.map(
      (placement) => ({
        placement,
        animation: null,
        entity: null,
      }),
    );
    this.tutorials = null;
    this.teleports = new GameplayEffects(owner.services);
  }

  async prepare() {
    await this.world.prepare(this.owner.catalog, this.owner.controller.signal);
    await this.teleports.prepare(
      this.owner.catalog.audiovisual,
      this.owner.controller.signal,
      ["Teleport"],
    );
    const names = new Set();
    for (const record of this.owner.scene.manifest.portalPresentation.records) {
      for (const branch of record.tutorialProgram?.branches ?? []) {
        names.add(branch.path);
      }
    }
    if (names.size) {
      this.tutorials = new GameplayEffects(this.owner.services);
      await this.tutorials.prepare(
        this.owner.catalog.audiovisual,
        this.owner.controller.signal,
        [...names],
      );
    }
    this.updateReactors(0);
  }

  update(elapsed) {
    this.life.update(elapsed);
    this.updateReactors(elapsed);
    this.tutorials?.update(elapsed);
    this.teleports.update(elapsed);
    let reveal = null;
    for (let index = this.portals.length - 1; index >= 0; index--) {
      const record = this.portals[index];
      if (
        (record.portal.type === 10 || record.portal.type === 11) &&
        portalRevealContains(record.portal, this.owner.presentation)
      ) {
        reveal = record;
        break;
      }
    }
    for (const record of this.portals) {
      updatePortalGraphics(this.owner.scene, record, reveal === record);
    }
  }

  /** Authored sprites remain region owned; the server owns every state and its resumable clock. */
  updateReactors(elapsed) {
    for (const record of this.reactors) {
      const animation = this.owner.scene.byId.get(record.placement.entityId);
      const entity =
        this.owner.reactorEntities?.get(record.placement.id) ?? null;
      if (!animation) {
        record.animation = null;
        continue;
      }
      animation.gameplayOwned = true;
      const state = entity?.reactor;
      animation.container.visible = Boolean(state?.visible);
      if (!state?.action) {
        record.animation = animation;
        record.entity = entity;
        continue;
      }
      if (record.entity !== entity || record.animation !== animation) {
        animation.setAction(state.action, state.repeat ? "loop" : "once");
        animation.seek(state.elapsedMs);
        record.entity = entity;
        record.animation = animation;
      } else animation.advance(elapsed);
    }
  }

  showTutorial(path) {
    if (!this.tutorials) {
      throw new Error("Original tutorial artwork was not prepared");
    }
    this.tutorials.play(path, this.owner.scene);
  }

  /** Fixed world endpoints share native pooled effects; another player's teleport never cancels them. */
  showTeleport(source, destination) {
    const scene = this.owner.scene;
    for (const point of [source, destination]) {
      this.teleports.play("Teleport", {
        presentation: point,
        addWorldContainer: (container, layer) =>
          scene.addWorldContainer(container, layer),
        removeWorldContainer: (container) =>
          scene.removeWorldContainer(container),
      });
    }
  }

  isInteractive(x, y) {
    const camera = this.owner.scene.camera;
    for (const slot of this.life.slots) {
      if (
        slot.target &&
        this.life.containsNpcPoint(slot, x + camera.x, y + camera.y)
      ) {
        return true;
      }
    }
    return false;
  }

  /** Read-only native presentation evidence; no field/quest mutation port. */
  snapshotNpcs() {
    return this.world.slots.map((slot) => ({
      placementId: slot.life.record.id,
      templateId: Number(slot.life.template.originalId),
      action: slot.life.entity?.action ?? null,
      markerState: slot.state,
      speechStartTick: slot.speechStartTick,
      speech: slot.speech
        ? {
            text: slot.speech.text,
            visible: slot.speech.root.visible,
            remainingMs: Math.max(0, slot.speech.remainingMs),
          }
        : null,
    }));
  }

  destroy() {
    this.life.destroy();
    for (const record of this.portals) record.animation = null;
    this.tutorials?.destroy();
    this.tutorials = null;
    this.teleports.destroy();
    for (const record of this.reactors) record.animation = null;
  }
}
