import { Container, Sprite } from "pixi.js";

/** @typedef {{texture:string,x:number,y:number,z:number,flip?:boolean,opacity?:number}} Part */
/** @typedef {{delay:number,parts:Part[],alphaEnd?:number}} Frame */
/** @typedef {{type:number,rx:number,ry:number,cx:number,cy:number}} Background */
/** @typedef {{id:string,kind:string,x:number,y:number,z:number,visible:boolean,flip:boolean,opacity:number,action:string,actions:Record<string,Frame[]>,background?:Background}} Entity */

/** Compile frame boundaries and stable draw order once, outside the render loop.
 * @param {Frame[]} frames
 */
function compileAction(frames) {
  let duration = 0;
  const ends = new Float64Array(frames.length);
  const parts = frames.map((frame, index) => {
    duration += frame.delay;
    ends[index] = duration;
    return frame.parts.slice().sort((a, b) => a.z - b.z);
  });
  return { ends, parts, duration, frames };
}

/** A persistent container and sprite pool; changing frames never builds display objects. */
export class EntityAnimation {
  /** @param {Entity} entity @param {Map<string, import('pixi.js').Texture>} textures @param {number} order */
  constructor(entity, textures, order) {
    this.id = entity.id;
    this.kind = entity.kind;
    this.order = order;
    this.textures = textures;
    this.background = entity.background;
    this.baseX = entity.x;
    this.baseY = entity.y;
    this.elapsedMs = 0;
    this.actions = new Map();
    this.container = new Container({ label: entity.id });
    this.container.position.set(entity.x, entity.y);
    this.container.zIndex = entity.z;
    this.container.visible = entity.visible !== false;
    this.container.alpha = entity.opacity ?? 1;
    this.container.scale.x = entity.flip ? -1 : 1;
    let capacity = 0;
    for (const [name, frames] of Object.entries(entity.actions)) {
      const action = compileAction(frames);
      this.actions.set(name, action);
      for (const parts of action.parts)
        capacity = Math.max(capacity, parts.length);
    }
    this.sprites = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      const sprite = new Sprite();
      sprite.visible = false;
      this.sprites[i] = sprite;
      this.container.addChild(sprite);
    }
    this.action = "";
    this.frame = -1;
    this.actionTimeMs = 0;
    this.setAction(entity.action);
  }

  /** @param {string} name */
  setAction(name) {
    const next = this.actions.get(name);
    if (!next) throw new Error(`Unknown action ${name} for ${this.id}`);
    this.action = name;
    this.current = next;
    this.actionTimeMs = 0;
    this.elapsedMs = 0;
    this.frame = -1;
    this.applyFrame(0);
  }

  /** Advance by elapsed milliseconds, selecting the NEXT frame at an exact boundary.
   * @param {number} ms
   */
  advance(ms) {
    this.elapsedMs += ms;
    const current = this.current;
    if (current.duration === 0) return;
    this.actionTimeMs =
      (this.actionTimeMs + (ms % current.duration)) % current.duration;
    let low = 0;
    let high = current.ends.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.actionTimeMs < current.ends[middle]) high = middle;
      else low = middle + 1;
    }
    if (low !== this.frame) this.applyFrame(low);
    this.applyAlpha();
  }

  /** @param {number} index */
  applyFrame(index) {
    this.frame = index;
    const parts = this.current.parts[index];
    for (let i = 0; i < this.sprites.length; i++) {
      const sprite = this.sprites[i];
      const part = parts[i];
      sprite.visible = !!part;
      if (!part) continue;
      const texture = this.textures.get(part.texture);
      sprite.texture = texture;
      sprite.position.set(part.x + (part.flip ? texture.width : 0), part.y);
      sprite.scale.set(part.flip ? -1 : 1, 1);
      sprite.alpha = part.opacity ?? 1;
    }
  }

  applyAlpha() {
    const end = this.current.frames[this.frame].alphaEnd;
    if (end === undefined) return;
    const elapsed =
      this.actionTimeMs - (this.frame ? this.current.ends[this.frame - 1] : 0);
    const duration = this.current.frames[this.frame].delay;
    const parts = this.current.parts[this.frame];
    for (let i = 0; i < parts.length; i++) {
      const start = Math.round((parts[i].opacity ?? 1) * 255);
      const target = Math.round(end * 255);
      // Original Shape2D 5140809f uses signed integer division.
      this.sprites[i].alpha =
        (start + Math.trunc(((target - start) * elapsed) / duration)) / 255;
    }
  }

  /** @param {number} x @param {number} y */
  setPosition(x, y) {
    this.baseX = x;
    this.baseY = y;
    this.container.position.set(x, y);
  }

  /** Original camera delta ratios and viewport-clipped repetition. No per-frame display-object rebuilding.
   * @param {{x:number,y:number}} camera @param {{x:number,y:number}} initial
   * @param {{width:number,height:number}} viewport
   */
  updateBackground(camera, initial, viewport) {
    const bg = this.background;
    const autoX = bg.type === 4 || bg.type === 6,
      autoY = bg.type === 5 || bg.type === 7;
    const dx = -(camera.x - initial.x),
      dy = -(camera.y - initial.y);
    const px =
      this.baseX +
      Math.trunc((dx * (autoX ? -100 : bg.rx)) / 100) +
      (autoX ? Math.trunc((this.elapsedMs * bg.rx) / 200) : 0);
    const py =
      this.baseY +
      Math.trunc((dy * (autoY ? -100 : bg.ry)) / 100) +
      (autoY ? Math.trunc((this.elapsedMs * bg.ry) / 200) : 0);
    this.container.position.set(px, py);
    const part = this.current.parts[this.frame][0],
      texture = this.textures.get(part.texture);
    const repeat =
      bg.type < 4 ? bg.type : bg.type === 4 ? 1 : bg.type === 5 ? 2 : 3;
    const cx = bg.cx || texture.width,
      cy = bg.cy || texture.height;
    const screenX = px - camera.x,
      screenY = py - camera.y;
    const flip = this.container.scale.x < 0;
    const localLeft = flip ? screenX - viewport.width : -screenX;
    const localRight = flip ? screenX : viewport.width - screenX;
    const firstX =
      repeat & 1
        ? Math.floor((localLeft - part.x - texture.width) / cx) + 1
        : 0;
    const lastX = repeat & 1 ? Math.ceil((localRight - part.x) / cx) - 1 : 0;
    const firstY =
      repeat & 2
        ? Math.floor((-screenY - part.y - texture.height) / cy) + 1
        : 0;
    const lastY =
      repeat & 2 ? Math.ceil((viewport.height - screenY - part.y) / cy) - 1 : 0;
    const count =
      Math.max(0, lastX - firstX + 1) * Math.max(0, lastY - firstY + 1);
    if (count > 10000)
      throw new Error(`Background repetition exceeds limit: ${this.id}`);
    while (this.sprites.length < count) {
      const sprite = new Sprite();
      this.sprites.push(sprite);
      this.container.addChild(sprite);
    }
    const alpha = this.sprites[0]?.alpha ?? 1;
    let index = 0;
    for (let y = firstY; y <= lastY; y++)
      for (let x = firstX; x <= lastX; x++) {
        const sprite = this.sprites[index++];
        sprite.texture = texture;
        sprite.visible = true;
        sprite.alpha = alpha;
        sprite.position.set(
          part.x + x * cx + (part.flip ? texture.width : 0),
          part.y + y * cy,
        );
        sprite.scale.set(part.flip ? -1 : 1, 1);
      }
    for (; index < this.sprites.length; index++)
      this.sprites[index].visible = false;
  }

  snapshot() {
    const node = this.container;
    return {
      id: this.id,
      kind: this.kind,
      action: this.action,
      frame: this.frame,
      actionTimeMs: this.actionTimeMs,
      elapsedMs: this.elapsedMs,
      actions: [...this.actions.keys()],
      visible: node.visible,
      x: this.background ? this.baseX : node.x,
      y: this.background ? this.baseY : node.y,
      z: node.zIndex,
      flip: node.scale.x < 0,
      opacity: node.alpha,
    };
  }
}
