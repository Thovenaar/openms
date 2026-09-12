import { centerDrop } from "../world/drop-artwork.js";
import { collectDrop, dropDrawY, DROP_MOTION } from "../world/drop-motion.js";

const MAX_PICKUP_PRESENTATIONS = 4096;

/** Retains display ownership after a server-confirmed pickup, never inventory ownership. */
export class SceneDrops {
  constructor(owner) {
    this.owner = owner;
    this.pickups = new Map();
  }

  observe(view, x, y) {
    const animation = view.animation;
    const motion = view.entity.dropMotion;
    animation.container.visible = motion?.state !== "waiting";
    animation.container.rotation = motion?.rotation ?? 0;
    animation.container.alpha = motion?.alpha ?? 1;
    animation.setPosition(x, y - centerDrop(animation));
  }

  pickup(event) {
    const view = this.owner.views.get(event.dropId);
    const target = this.owner.views.get(event.actorId);
    if (!view || !target || view.entity.kind !== "drop") return;
    if (this.pickups.size >= MAX_PICKUP_PRESENTATIONS) {
      throw new Error("Online pickup presentation residency limit");
    }
    this.owner.views.delete(event.dropId);
    view.animation.gameplayOwned = true;
    view.animation.container.eventMode = "none";
    view.animation.container.rotation = 0;
    this.pickups.set(event.dropId, {
      view,
      actorId: event.actorId,
      state: "collecting",
      phaseAge: 0,
      sourceX: event.position.x,
      sourceY: event.position.y,
      target: { x: target.drawX, y: target.drawY },
      targetHeight:
        target.animation.current.geometry[target.animation.frame].height,
      x: event.position.x,
      y: event.position.y,
      alpha: 1,
    });
  }

  draw(elapsed) {
    for (const [id, slot] of this.pickups) {
      const target = this.owner.views.get(slot.actorId);
      slot.phaseAge += elapsed;
      if (!target || slot.phaseAge >= DROP_MOTION.pickupMs) {
        this.release(id, slot);
        continue;
      }
      slot.target.x = target.drawX;
      slot.target.y = target.drawY;
      slot.targetHeight =
        target.animation.current.geometry[target.animation.frame].height;
      collectDrop(slot);
      const animation = slot.view.animation;
      animation.advance(elapsed);
      animation.setPosition(slot.x, dropDrawY(slot, centerDrop(animation)));
      animation.container.alpha = slot.alpha;
    }
  }

  release(id, slot) {
    this.owner.scene.removeDynamicEntity(id);
    slot.view.owner.destroy();
    this.pickups.delete(id);
  }

  destroy() {
    for (const [id, slot] of this.pickups) this.release(id, slot);
  }
}
