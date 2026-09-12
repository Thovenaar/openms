import { CombatPresentation } from "../combat/combat-presentation.js";
import { SpeechBubbles } from "../rendering/speech-bubbles.js";

const MAX_PROJECTILE_EVENTS = 1024;
const PROJECTILE_EVENT_LIFETIME = 10000;
/** Field-owned consumers of accepted events; no damage or delivery is predicted. */
export class SceneEvents {
  constructor(owner, app) {
    this.owner = owner;
    this.app = app;
    this.combat = new CombatPresentation(app, owner.services);
    this.combat.setScene(owner.scene);
    this.speech = new Map();
    this.pose = { x: 0, headY: 0 };
    this.projectiles = new Map();
    this.projectileCount = 0;
  }

  async prepare(signal) {
    const catalog = this.owner.catalog;
    await this.combat.prepare(
      catalog.audiovisual,
      signal,
      catalog.ui.avatar.projectiles,
    );
  }

  async event(message) {
    const event = message.event;
    if (event.kind === "combat") this.damage(event);
    else if (event.kind === "projectile") this.projectile(event);
    else if (event.kind === "drop.pickup") this.owner.drops.pickup(event);
    else if (event.kind === "chat" && event.channel === "map") {
      await this.chat(event);
    }
  }

  projectile(event) {
    if (this.projectileCount >= MAX_PROJECTILE_EVENTS) {
      throw new Error("Online projectile event residency limit");
    }
    this.combat.onProjectile({
      projectileId: event.templateId,
      facing: event.facing,
      x: event.source.x,
      y: event.source.y,
      endX: event.destination.x,
      endY: event.destination.y,
      duration: event.durationMs,
      target: null,
    });
    let action = this.projectiles.get(event.actionId);
    if (!action) {
      action = new Map();
      this.projectiles.set(event.actionId, action);
    }
    if (!action.has(event.targetId)) this.projectileCount++;
    action.set(event.targetId, { event, age: 0 });
  }

  impact(event, hit) {
    const action = this.projectiles.get(event.actionId);
    const projectile = action?.get(hit.targetId);
    if (!projectile) return;
    action.delete(hit.targetId);
    this.projectileCount--;
    if (!action.size) this.projectiles.delete(event.actionId);
    if (hit.outcome === "hit") {
      this.combat.onProjectileImpact(
        projectile.event.templateId,
        projectile.event.destination,
        projectile.event.facing,
      );
    }
  }

  damage(event) {
    const numbers = this.combat.snapshot();
    const required = numbers.active + numbers.pending + event.hits.length;
    if (required > numbers.hardCapacity) {
      throw new Error("Online confirmed damage number residency limit");
    }
    if (required > numbers.capacity) this.combat.growNumbers(required);
    for (const hit of event.hits) {
      this.impact(event, hit);
      const view = this.owner.views.get(hit.targetId);
      if (!view) continue;
      const animation = view.animation;
      const geometry = animation.current.geometry[animation.frame];
      const player = view.entity.kind === "player";
      const placement = this.combat.fixedNumberPlacement(
        animation.baseX,
        animation.baseY + geometry.y - (player ? 0 : 15),
      );
      this.combat.show(hit.damage, player ? 2 : 0, placement);
    }
  }

  async chat(event) {
    const view = this.owner.views.get(event.senderId);
    if (!view?.entity.appearance) return;
    let speech = this.speech.get(event.senderId);
    if (!speech) {
      speech = new SpeechBubbles(this.app, this.owner.services);
      speech.setScene(this.owner.scene);
      try {
        await speech.prepare(this.owner.catalog, this.owner.controller.signal);
        this.owner.controller.signal.throwIfAborted();
      } catch (error) {
        speech.destroy();
        throw error;
      }
      this.speech.set(event.senderId, speech);
    }
    speech.show(event.text, event.senderName);
  }

  draw(elapsed) {
    this.combat.update(elapsed);
    this.expireProjectiles(elapsed);
    for (const [id, speech] of this.speech) {
      const animation = this.owner.views.get(id)?.animation;
      if (!animation) {
        speech.destroy();
        this.speech.delete(id);
        continue;
      }
      this.pose.x = animation.baseX;
      this.pose.headY =
        animation.baseY - animation.avatar.speechHeights[animation.action];
      speech.update(elapsed, this.pose, this.owner.scene.camera);
    }
  }

  expireProjectiles(elapsed) {
    for (const [id, action] of this.projectiles) {
      for (const [target, projectile] of action) {
        projectile.age += elapsed;
        if (projectile.age < PROJECTILE_EVENT_LIFETIME) continue;
        action.delete(target);
        this.projectileCount--;
      }
      if (!action.size) this.projectiles.delete(id);
    }
  }

  destroy() {
    this.combat.destroy();
    for (const speech of this.speech.values()) speech.destroy();
    this.speech.clear();
    this.projectiles.clear();
  }
}
