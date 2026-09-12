import { LifeSystem } from "../world/life-system.js";
import { NpcWorldPresentation } from "../npc/npc-world-presentation.js";
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
      ambient: false,
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
  }

  async prepare() {
    await this.world.prepare(this.owner.catalog, this.owner.controller.signal);
  }

  update(elapsed) {
    this.life.update(elapsed);
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

  destroy() {
    this.life.destroy();
    for (const record of this.portals) record.animation = null;
  }
}
