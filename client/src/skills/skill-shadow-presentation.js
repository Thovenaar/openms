import { EntityAnimation } from "../rendering/animation.js";

const SHADOW_IDS = Object.freeze([4111002, 14111000]);
const MAX_ACTIONS = 256;
const DESTROY_DISPLAY = Object.freeze({ children: true });
// Original0092f12a..0092f13c and0092f219..0092f270:30px,200ms offset transition.
const OFFSET_MS = 200;

/** Owns display only; SkillResources retains every original special/<action> lease. */
export class SkillShadowPresentation {
  constructor(system) {
    this.system = system;
    this.records = new Map();
    this.sources = new Map();
    this.actor = null;
    this.x = 0;
    this.y = 0;
    this.fromX = 0;
    this.fromY = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.elapsed = OFFSET_MS;
  }

  async prepare(skills) {
    this.destroy();
    this.actor = this.system.scene.actor;
    for (const skill of skills) {
      if (!SHADOW_IDS.includes(skill.id)) continue;
      const sources = new Map();
      const textures = new Map();
      for (const path of Object.keys(skill.visuals)) {
        if (!path.startsWith("special/")) continue;
        const sequence = await this.system.resources.acquireSequence(
          skill,
          path,
          0,
        );
        sources.set(
          path.slice(8),
          sequence.owner.manifest.entities[0].actions.play,
        );
        for (const [key, texture] of sequence.owner.textures) {
          textures.set(key, texture);
        }
      }
      this.sources.set(skill.id, { frames: sources, textures });
      const animation = this.createAnimation(skill.id, this.actor);
      this.system.scene.overlays.addChild(animation.container);
      this.records.set(skill.id, animation);
    }
  }

  createAnimation(id, actor) {
    const source = this.sources.get(id);
    return new EntityAnimation(
      {
        id: `shadow:${id}`,
        kind: "effect",
        order: 0,
        x: 0,
        y: 0,
        z: actor.container.zIndex - 1,
        visible: false,
        action: actor.action,
        actions: this.actions(source.frames, actor),
      },
      source.textures,
    );
  }

  /** Reuse leased original artwork; no active state or display owner changes here. */
  prepareActor(actor) {
    const records = new Map();
    try {
      for (const id of this.sources.keys()) {
        records.set(id, this.createAnimation(id, actor));
      }
      return records;
    } catch (error) {
      this.discardActor(records);
      throw error;
    }
  }

  publishActor(actor, records) {
    this.discardActor(this.records);
    this.actor = actor;
    this.records = records;
    for (const animation of records.values()) {
      this.system.scene.overlays.addChild(animation.container);
    }
  }

  discardActor(records) {
    for (const animation of records.values()) {
      animation.container.destroy(DESTROY_DISPLAY);
    }
    records.clear();
  }

  actions(sources, actor) {
    if (actor.actions.size > MAX_ACTIONS) {
      throw new Error("Shadow action bound exceeded");
    }
    const actions = Object.create(null);
    for (const [name, action] of actor.actions) {
      actions[name] = action.frames.map((frame, index) => {
        const source = sources.get(frame.poseAction ?? name)?.[
          frame.poseIndex ?? index
        ];
        if (!source) {
          throw new Error(
            `Missing original Shadow Partner pose ${name}/${index}`,
          );
        }
        return { ...frame, parts: source.parts, alphaEnd: source.alphaEnd };
      });
    }
    return actions;
  }

  /** Called after ordinary avatar presentation; never advances the gameplay clock. */
  present(ms) {
    const system = this.system;
    const actor = system.scene.actor;
    for (const [id, animation] of this.records) {
      const visible =
        actor === this.actor &&
        system.states.get(id)?.remaining > 0 &&
        actor.container.visible &&
        actor.container.renderable &&
        actor.action !== "dead";
      animation.container.visible = visible;
      if (!visible) continue;
      animation.container.alpha = actor.container.alpha;
      this.offset(actor, ms);
      animation.container.scale.x = actor.container.scale.x;
      animation.setPosition(
        system.scene.presentation.x + this.x,
        system.scene.presentation.y + this.y,
      );
      animation.setAction(actor.action, actor.playback);
      animation.seek(actor.actionTimeMs);
    }
  }

  offset(actor, ms) {
    const climb =
      actor.action === "ladder" ||
      actor.action === "rope" ||
      actor.action === "ladder2" ||
      actor.action === "rope2";
    const x = climb ? 0 : this.system.scene.simulation.facing > 0 ? -30 : 30;
    const y = climb ? 50 : 0;
    if (x !== this.targetX || y !== this.targetY) {
      this.fromX = this.x;
      this.fromY = this.y;
      this.targetX = x;
      this.targetY = y;
      this.elapsed = 0;
    }
    this.elapsed = Math.min(OFFSET_MS, this.elapsed + ms);
    this.x =
      this.fromX + ((this.targetX - this.fromX) * this.elapsed) / OFFSET_MS;
    this.y =
      this.fromY + ((this.targetY - this.fromY) * this.elapsed) / OFFSET_MS;
  }

  destroy() {
    this.discardActor(this.records);
    this.sources.clear();
  }
}
