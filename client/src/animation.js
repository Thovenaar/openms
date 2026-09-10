import { Container, Sprite } from "pixi.js";

/** @typedef {{texture:string,x:number,y:number,z:number,flip?:boolean,opacity?:number,expression?:string,expressionStart?:number,expressionEnd?:number,expressionLoopMs?:number,expressionDuration?:number}} Part */
/** @typedef {{delay:number,parts:Part[],alphaEnd?:number,sourceSize?:{width:number,height:number}}} Frame */
/** @typedef {{type:number,rx:number,ry:number,cx:number,cy:number}} Background */
/** @typedef {{id:string,order:number,kind:string,x:number,y:number,z:number,visible:boolean,flip:boolean,opacity:number,action:string,actions:Record<string,Frame[]>,background?:Background}} Entity */

/** Compile frame boundaries and stable draw order once, outside the render loop.
 * @param {Frame[]} frames
 */
function compileAction(frames, textures) {
  let duration = 0;
  const ends = new Float64Array(frames.length);
  const parts = frames.map((frame, index) => {
    duration += frame.delay;
    ends[index] = duration;
    return frame.parts.slice().sort((a, b) => a.z - b.z);
  });
  const geometry = frames.map((frame, index) =>
    frameGeometry(frame, parts[index], textures),
  );
  return { ends, parts, duration, frames, geometry };
}

/** Logical frame geometry preserves the original canvas period across atlas tiles. */
function frameGeometry(frame, parts, textures) {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const part of parts) {
    const texture = textures.get(part.texture);
    left = Math.min(left, part.x);
    top = Math.min(top, part.y);
    right = Math.max(right, part.x + texture.width);
    bottom = Math.max(bottom, part.y + texture.height);
  }
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    periodWidth: frame.sourceSize?.width ?? right - left,
    periodHeight: frame.sourceSize?.height ?? bottom - top,
  };
}

function repetitionType(type) {
  if (type < 4) return type;
  if (type === 4) return 1;
  if (type === 5) return 2;
  return 3;
}

/** A persistent container and sprite pool; changing frames never builds display objects. */
export class EntityAnimation {
  /** @param {Entity} entity @param {Map<string, import('pixi.js').Texture>} textures */
  constructor(entity, textures) {
    this.id = entity.id;
    this.kind = entity.kind;
    this.order = entity.order;
    this.textures = textures;
    this.background = entity.background;
    this.repeat = entity.background
      ? repetitionType(entity.background.type)
      : 0;
    this.backgroundLayout = {
      firstX: 0,
      lastX: 0,
      firstY: 0,
      lastY: 0,
      cx: 0,
      cy: 0,
    };
    this.elapsedMs = 0;
    this.expression = "default";
    this.expressionMs = 0;
    this.expressionElapsedMs = 0;
    this.expressionTimeMs = 0;
    this.expressionLoopMs = 0;
    this.expressionLoops = new Map();
    this.expressionDurations = new Map();
    this.actions = new Map();
    this.expressions = new Set(["default"]);
    this.tint = 0xffffff;
    this.container = new Container({ label: entity.id });
    this.setPosition(entity.x, entity.y);
    this.container.zIndex = entity.z;
    this.container.depthOrder = entity.order;
    this.container.visible = entity.visible !== false;
    this.container.alpha = entity.opacity ?? 1;
    this.container.scale.x = entity.flip ? -1 : 1;
    let capacity = 0;
    for (const [name, frames] of Object.entries(entity.actions)) {
      const action = compileAction(frames, textures);
      this.actions.set(name, action);
      for (const parts of action.parts) {
        capacity = Math.max(capacity, parts.length);
        for (const part of parts) {
          this.registerExpression(part);
        }
      }
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
    this.holdFrame = false;
    this.setAction(entity.action);
  }

  /** Compile immutable expression periods outside animation updates. */
  registerExpression(part) {
    if (!part.expression) return;
    this.expressions.add(part.expression);
    if (part.expressionDuration !== undefined) {
      const duration = this.expressionDurations.get(part.expression);
      if (duration !== undefined && duration !== part.expressionDuration) {
        throw new Error("Inconsistent avatar expression duration");
      }
      this.expressionDurations.set(part.expression, part.expressionDuration);
    }
    if (part.expressionLoopMs === undefined) return;
    const previous = this.expressionLoops.get(part.expression);
    if (previous !== undefined && previous !== part.expressionLoopMs) {
      throw new Error("Inconsistent avatar expression period");
    }
    this.expressionLoops.set(part.expression, part.expressionLoopMs);
  }

  /** Repeating the same name/mode is idempotent. Once holds its final frame.
   * @param {string} name @param {'loop'|'once'} [playback] */
  setAction(name, playback = "loop") {
    const next = this.actions.get(name);
    if (!next) throw new Error(`Unknown action ${name} for ${this.id}`);
    if (playback !== "loop" && playback !== "once") {
      throw new Error(`Unknown animation playback ${playback}`);
    }
    if (this.action === name && this.playback === playback) return;
    this.action = name;
    this.playback = playback;
    this.current = next;
    this.actionTimeMs = 0;
    this.elapsedMs = 0;
    this.completed = playback === "once" && next.duration === 0;
    this.frame = -1;
    this.selectTimedFrame();
  }

  /** Original avatar tint does not propagate into independent name overlays. */
  setTint(tint) {
    if (tint === this.tint) return;
    this.tint = tint;
    for (const sprite of this.sprites) sprite.tint = tint;
  }
  /** Select a packaged face family independently from the body action clock. */
  setExpression(name, duration) {
    if (
      !this.expressions.has(name) ||
      !Number.isFinite(duration) ||
      duration < 0
    ) {
      throw new Error("Invalid avatar expression");
    }
    this.expression = name;
    this.expressionMs = duration;
    this.expressionElapsedMs = 0;
    this.expressionTimeMs = 0;
    this.expressionLoopMs = this.expressionLoops.get(name) ?? 0;
    if (this.frame >= 0) this.applyFrame(this.frame);
  }

  advanceExpression(ms) {
    if (this.expressionMs <= 0) return;
    this.expressionMs = Math.max(0, this.expressionMs - ms);
    // 004534a2..bd selects default, not a saved previous emotion.
    if (this.expressionMs === 0) {
      this.setExpression("default", 0);
      return;
    }
    this.expressionElapsedMs += ms;
    this.expressionTimeMs =
      this.expressionLoopMs > 0
        ? this.expressionElapsedMs % this.expressionLoopMs
        : 0;
    const parts = this.current.parts[this.frame];
    for (let i = 0; i < this.sprites.length; i++) {
      this.sprites[i].visible = this.expressionVisible(parts[i]);
    }
  }

  /** Half-open authored face-frame intervals advance independently of body frames. */
  expressionVisible(part) {
    if (!part) return false;
    if (!part.expression) return true;
    if (part.expression !== this.expression) return false;
    return (
      part.expressionStart === undefined ||
      (this.expressionTimeMs >= part.expressionStart &&
        this.expressionTimeMs < part.expressionEnd)
    );
  }

  /** Player callers supply only the simulation's executed quantum.
   * @param {number} ms */
  advance(ms) {
    if (
      !Number.isFinite(ms) ||
      ms < 0 ||
      !Number.isFinite(this.elapsedMs + ms)
    ) {
      throw new Error("Invalid animation elapsed milliseconds");
    }
    this.elapsedMs += ms;
    this.advanceExpression(ms);
    const current = this.current;
    if (current.duration === 0 || this.completed) return;
    // 004522a6: stationary climb consumes the remaining delay but holds the
    // current authored frame at expiry; movement resumes without a phase reset.
    if (this.holdFrame) {
      this.actionTimeMs = Math.min(
        current.ends[this.frame],
        this.actionTimeMs + ms,
      );
      return;
    }
    if (this.playback === "once") {
      this.actionTimeMs = Math.min(current.duration, this.actionTimeMs + ms);
      this.completed = this.actionTimeMs === current.duration;
    } else {
      this.actionTimeMs =
        (this.actionTimeMs + (ms % current.duration)) % current.duration;
    }
    this.selectTimedFrame();
  }

  /** Seek an authoritative action clock without exposing mutable frame bookkeeping.
   * Resuming a completed one-shot at an earlier time clears completion.
   * @param {number} ms Elapsed milliseconds since the current action began. */
  seek(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error("Invalid animation seek milliseconds");
    }
    const duration = this.current.duration;
    this.elapsedMs = ms;
    this.completed = this.playback === "once" && ms >= duration;
    this.actionTimeMs =
      duration === 0
        ? 0
        : this.playback === "once"
          ? Math.min(ms, duration)
          : ms % duration;
    this.selectTimedFrame();
  }

  selectTimedFrame() {
    const current = this.current;
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
      sprite.visible = this.expressionVisible(part);
      if (!part) continue;
      const texture = this.textures.get(part.texture);
      sprite.tint = this.tint;
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
    if (duration === 0) {
      for (let i = 0; i < parts.length; i++) this.sprites[i].alpha = end;
      return;
    }
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
    // Quantize the whole composition, not each GPU vertex at an unstable half-pixel tie.
    if (this.kind !== "ui") {
      x = Math.trunc(x);
      y = Math.trunc(y);
    }
    this.baseX = x;
    this.baseY = y;
    this.container.position.set(x, y);
  }

  /** Reserve all repetition sprites outside rendering for the current bounded viewport. */
  prepareBackground(viewport, available = 10000) {
    const bg = this.background;
    let capacity = 1;
    for (const action of this.actions.values()) {
      for (let index = 0; index < action.parts.length; index++) {
        const geometry = action.geometry[index];
        const columns =
          Math.ceil(
            (viewport.width + geometry.width) / (bg.cx || geometry.periodWidth),
          ) + 3;
        const rows =
          Math.ceil(
            (viewport.height + geometry.height) /
              (bg.cy || geometry.periodHeight),
          ) + 3;
        const copies =
          (this.repeat & 1 ? columns : 1) * (this.repeat & 2 ? rows : 1);
        capacity = Math.max(capacity, copies * action.parts[index].length);
      }
    }
    if (capacity > 10000 || capacity > available) {
      throw new Error(`Background pool exceeds browser limit: ${this.id}`);
    }
    while (this.sprites.length < capacity) {
      const sprite = new Sprite();
      sprite.visible = false;
      this.sprites.push(sprite);
      this.container.addChild(sprite);
    }
  }

  /** Original camera delta ratios and viewport-clipped repetition. No per-frame display-object rebuilding.
   * @param {{x:number,y:number}} camera @param {{x:number,y:number}} initial
   * @param {{width:number,height:number}} viewport
   */
  positionBackground(camera, initial) {
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
  }

  layoutBackground(camera, viewport) {
    const geometry = this.current.geometry[this.frame];
    const layout = this.backgroundLayout;
    layout.cx = this.background.cx || geometry.periodWidth;
    layout.cy = this.background.cy || geometry.periodHeight;
    const screenX = this.container.x - camera.x;
    const screenY = this.container.y - camera.y;
    const flip = this.container.scale.x < 0;
    const left = flip ? screenX - viewport.width : -screenX;
    const right = flip ? screenX : viewport.width - screenX;
    layout.firstX =
      this.repeat & 1
        ? Math.floor((left - geometry.x - geometry.width) / layout.cx) + 1
        : 0;
    layout.lastX =
      this.repeat & 1 ? Math.ceil((right - geometry.x) / layout.cx) - 1 : 0;
    layout.firstY =
      this.repeat & 2
        ? Math.floor((-screenY - geometry.y - geometry.height) / layout.cy) + 1
        : 0;
    layout.lastY =
      this.repeat & 2
        ? Math.ceil((viewport.height - screenY - geometry.y) / layout.cy) - 1
        : 0;
  }

  drawBackground() {
    const layout = this.backgroundLayout;
    const parts = this.current.parts[this.frame];
    const count =
      Math.max(0, layout.lastX - layout.firstX + 1) *
      Math.max(0, layout.lastY - layout.firstY + 1) *
      parts.length;
    if (count > this.sprites.length) {
      throw new Error(
        `Background pool requires resize preparation: ${this.id}`,
      );
    }
    let index = 0;
    for (let y = layout.firstY; y <= layout.lastY; y++) {
      for (let x = layout.firstX; x <= layout.lastX; x++) {
        index = this.drawBackgroundCopy(index, x, y);
      }
    }
    for (; index < this.sprites.length; index++) {
      this.sprites[index].visible = false;
    }
  }

  drawBackgroundCopy(index, x, y) {
    const parts = this.current.parts[this.frame],
      layout = this.backgroundLayout;
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex],
        texture = this.textures.get(part.texture);
      const sprite = this.sprites[index++];
      sprite.texture = texture;
      sprite.visible = true;
      sprite.alpha = this.sprites[partIndex].alpha;
      sprite.position.set(
        part.x + x * layout.cx + (part.flip ? texture.width : 0),
        part.y + y * layout.cy,
      );
      sprite.scale.set(part.flip ? -1 : 1, 1);
    }
    return index;
  }

  updateBackground(camera, initial, viewport) {
    this.positionBackground(camera, initial);
    this.layoutBackground(camera, viewport);
    this.drawBackground();
  }

  snapshot() {
    const node = this.container;
    return {
      id: this.id,
      kind: this.kind,
      action: this.action,
      playback: this.playback,
      completed: this.completed,
      frame: this.frame,
      actionTimeMs: this.actionTimeMs,
      elapsedMs: this.elapsedMs,
      expression: this.expression,
      expressionMs: this.expressionMs,
      expressionElapsedMs: this.expressionElapsedMs,
      actions: [...this.actions.keys()],
      visible: node.visible,
      x: this.background ? this.baseX : node.x,
      y: this.background ? this.baseY : node.y,
      z: node.zIndex,
      depthOrder: node.depthOrder,
      geometry: { ...this.current.geometry[this.frame] },
      flip: node.scale.x < 0,
      opacity: node.alpha,
    };
  }
}
