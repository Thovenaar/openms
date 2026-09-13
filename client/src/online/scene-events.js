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
    if (event.kind === "combat.impact") this.damage(event);
    else if (event.kind === "projectile") this.projectile(event);
    else if (event.kind === "drop.pickup") this.owner.drops.pickup(event);
    else if (event.kind === "drop.explode") this.owner.drops.explode(event);
    else if (event.kind === "combat.recovery" || event.kind === "drop.effect")
      {this.recovery(event);}
    else if (event.kind === "skill.magnet") {
      const view = this.owner.views.get(event.targetId);
      if (view) this.combat.onMagnetResult(this.target(view), event.success);
    } else if (event.kind === "chat" && event.channel === "map") {
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

  target(view) {
    if (!view.combatTarget) {
      view.combatTarget = {
        get x() {
          return view.drawX;
        },
        get y() {
          return view.drawY;
        },
        get presentation() {
          return view.animation;
        },
      };
    }
    return view.combatTarget;
  }
  reserveNumber() {
    const numbers = this.combat.snapshot();
    const required = numbers.active + numbers.pending + 1;
    if (required > numbers.hardCapacity)
      {throw new Error("Online confirmed damage number residency limit");}
    if (required > numbers.capacity) this.combat.growNumbers(required);
  }
  damage(event) {
    this.impact(event, {
      targetId: event.targetId,
      outcome: event.damage > 0 ? "hit" : "miss",
    });
    const view = this.owner.views.get(event.targetId);
    if (!view) return;
    this.reserveNumber();
    if (view.entity.kind === "mob") {
      const target = this.target(view);
      if (event.skillId)
        {this.combat.onSkillDamageLine(target, event.damage, event);}
      else this.combat.onMobHit(target, event.damage);
    } else {
      const animation = view.animation;
      const geometry = animation.current.geometry[animation.frame];
      this.combat.show(
        event.hpDamage,
        2,
        this.combat.fixedNumberPlacement(
          event.position.x,
          event.position.y + geometry.y,
        ),
      );
    }
  }
  recovery(event) {
    if (event.hp <= 0) return;
    const view = this.owner.views.get(event.actorId);
    if (!view) return;
    this.reserveNumber();
    const geometry = view.animation.current.geometry[view.animation.frame];
    this.combat.show(
      event.hp,
      1,
      this.combat.fixedNumberPlacement(view.drawX, view.drawY + geometry.y),
    );
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
