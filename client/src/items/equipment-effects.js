import { Container, Sprite } from "pixi.js";
import {
  validateEquipmentEffect,
  EQUIPMENT_EFFECT_LIMITS,
} from "./equipment-effect-model.js";

/** Independent native SetEff layer, not a body action frame or a transient combat emission.
 * 009393fc starts loop mode0x20;00941417 resolves fixed/pos;00940eb7 follows facing only
 * for fixed0. Its parent owns destruction; the prepared avatar owns immutable texture leases. */
export class EquipmentEffects {
  constructor(owner, effect, textures) {
    this.owner = owner;
    this.effect = validateEquipmentEffect(effect);
    this.textures = textures;
    this.frames = effect.frames;
    this.ends = new Float64Array(this.frames.length);
    this.duration = 0;
    this.elapsedMs = 0;
    this.frame = -1;
    let capacity = 0;
    for (let index = 0; index < this.frames.length; index++) {
      const frame = this.frames[index];
      this.duration += frame.delay;
      this.ends[index] = this.duration;
      capacity = Math.max(capacity, frame.parts.length);
    }
    if (capacity > EQUIPMENT_EFFECT_LIMITS.parts) {
      throw new Error("Equipment effect sprite bound exceeded");
    }
    this.container = new Container({ label: effect.source });
    this.sprites = new Array(capacity);
    for (let index = 0; index < capacity; index++) {
      const sprite = new Sprite();
      this.sprites[index] = sprite;
      this.container.addChild(sprite);
    }
    const parent = owner.container;
    if (effect.z < 0) parent.addChildAt(this.container, 0);
    else parent.addChild(this.container);
    this.advance(0);
  }

  /** Advance on the caller's scene/preview clock even when the character is holding a ladder pose. */
  advance(ms) {
    if (this.container.destroyed) return;
    this.elapsedMs = this.duration ? (this.elapsedMs + ms) % this.duration : 0;
    let low = 0,
      high = this.ends.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.elapsedMs < this.ends[middle]) high = middle;
      else low = middle + 1;
    }
    if (low !== this.frame) this.applyFrame(low);
    this.applyAlpha();
    this.sync();
  }

  applyFrame(index) {
    this.frame = index;
    const parts = this.frames[index].parts;
    for (let i = 0; i < this.sprites.length; i++) {
      const sprite = this.sprites[i],
        part = parts[i];
      sprite.visible = Boolean(part);
      if (!part) continue;
      const texture = this.textures.get(part.texture);
      sprite.texture = texture;
      sprite.position.set(part.x + (part.flip ? texture.width : 0), part.y);
      sprite.scale.set(part.flip ? -1 : 1, 1);
      sprite.alpha = part.opacity ?? 1;
    }
  }

  applyAlpha() {
    const frame = this.frames[this.frame];
    if (frame.alphaEnd === undefined) return;
    const elapsed =
      this.elapsedMs - (this.frame ? this.ends[this.frame - 1] : 0);
    const target = Math.round(frame.alphaEnd * 255);
    for (let index = 0; index < frame.parts.length; index++) {
      const start = Math.round((frame.parts[index].opacity ?? 1) * 255);
      this.sprites[index].alpha =
        frame.delay === 0
          ? frame.alphaEnd
          : (start + Math.trunc(((target - start) * elapsed) / frame.delay)) /
            255;
    }
  }

  /** Frames carry the original composed brow pivot for pos1; pos0 stays at the actor feet.
   * 009393fc removes equipment layers on death/form replacement, not walk/jump/climb. */
  sync() {
    const owner = this.owner,
      effect = this.effect;
    const frame = owner.current.frames[0];
    this.container.visible = owner.action !== "dead";
    this.container.scale.x = effect.fixed
      ? owner.container.scale.x < 0
        ? -1
        : 1
      : 1;
    if (effect.pos === 1) {
      const point = frame.effectAnchor;
      if (!point) {
        throw new Error("Missing original equipment effect brow anchor");
      }
      this.container.position.set(point.x, point.y);
    } else if (effect.pos === 2) {
      const bounds = owner.current.geometry[owner.frame];
      this.container.position.set(
        Math.trunc((bounds.left + bounds.right) / 2),
        Math.trunc((bounds.top + bounds.bottom) / 2),
      );
    } else this.container.position.set(0, 0);
  }
}
