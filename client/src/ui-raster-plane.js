import { Sprite } from "pixi.js";

const MAX_RASTER_NODES = 8192;
const MAX_RASTER_SPRITES = 4096;
const MAX_RASTER_DEPTH = 64;
const MAX_RASTER_DIMENSION = 8192;
const MAX_RASTER_PIXELS = 16 * 1024 * 1024;
const MATRIX_SIZE = 11;
const COMMAND_SIZE = 15;

/** A DOM artwork plane borrows decoded atlas bitmaps; it never owns or decodes textures.
 * The existing Sprite tree remains the animation/geometry owner, but is not GPU-rendered.
 * Native controls and text share the same window stacking context as this canvas. */
export class UIRasterPlane {
  constructor(root, host) {
    this.root = root;
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.style.cssText =
      "position:absolute;pointer-events:none;image-rendering:pixelated;";
    this.context = this.canvas.getContext("2d");
    if (!this.context) throw new Error("UI artwork requires Canvas2D");
    host.prepend(this.canvas);
    root.renderable = false;
    this.nodes = new Array(MAX_RASTER_DEPTH);
    this.indices = new Uint32Array(MAX_RASTER_DEPTH);
    this.matrices = new Float64Array(MAX_RASTER_DEPTH * MATRIX_SIZE);
    this.textures = new Array(MAX_RASTER_SPRITES);
    this.commands = new Float64Array(MAX_RASTER_SPRITES * COMMAND_SIZE);
    this.count = 0;
    this.scaleX = 0;
    this.scaleY = 0;
    this.dirty = true;
  }

  /** Scan is allocation-free and bounded. Unchanged artwork causes no canvas redraw. */
  sync(scaleX, scaleY) {
    if (
      !Number.isFinite(scaleX) ||
      !Number.isFinite(scaleY) ||
      scaleX <= 0 ||
      scaleY <= 0
    ) {
      throw new Error("Invalid UI raster scale");
    }
    this.dirty ||= scaleX !== this.scaleX || scaleY !== this.scaleY;
    this.scaleX = scaleX;
    this.scaleY = scaleY;
    this.scan();
    this.canvas.hidden = !this.root.visible || this.count === 0;
    if (this.canvas.hidden || !this.dirty) return;
    this.resize();
    this.draw();
    this.dirty = false;
  }

  scan() {
    const previous = this.count;
    this.count = 0;
    this.left = this.top = Infinity;
    this.right = this.bottom = -Infinity;
    this.nodes[0] = this.root;
    this.indices[0] = 0;
    this.matrices.fill(0, 0, 7);
    this.matrices[0] = this.matrices[3] = 1;
    this.matrices[6] = this.root.alpha;
    this.matrices[7] = this.matrices[8] = -Infinity;
    this.matrices[9] = this.matrices[10] = Infinity;
    let depth = 0;
    let visited = 0;
    while (depth >= 0) {
      const parent = this.nodes[depth];
      if (parent.sortableChildren && parent.sortDirty) parent.sortChildren();
      if (this.indices[depth] === parent.children.length) {
        this.nodes[depth--] = null;
        continue;
      }
      if (++visited > MAX_RASTER_NODES) {
        throw new Error("UI raster node budget exceeded");
      }
      const node = parent.children[this.indices[depth]++];
      if (!node.visible || node.alpha === 0) continue;
      this.visit(node, depth);
      this.nodes[++depth] = node;
      this.indices[depth] = 0;
    }
    if (previous !== this.count) this.dirty = true;
    for (let index = this.count; index < previous; index++) {
      this.textures[index] = null;
    }
  }

  visit(node, depth) {
    if (depth + 1 >= MAX_RASTER_DEPTH) {
      throw new Error("UI raster depth budget exceeded");
    }
    if (node.mask || node.filters?.length) {
      throw new Error("Unsupported UI raster effect");
    }
    this.transform(node, depth);
    if (node instanceof Sprite) this.record(node, (depth + 1) * MATRIX_SIZE);
    else if (node.renderPipeId !== undefined) {
      throw new Error("Unsupported UI raster primitive");
    }
  }

  transform(node, depth) {
    node.updateLocalTransform();
    const t = node.localTransform;
    const m = this.matrices;
    const p = depth * MATRIX_SIZE;
    const n = p + MATRIX_SIZE;
    m[n] = m[p] * t.a + m[p + 2] * t.b;
    m[n + 1] = m[p + 1] * t.a + m[p + 3] * t.b;
    m[n + 2] = m[p] * t.c + m[p + 2] * t.d;
    m[n + 3] = m[p + 1] * t.c + m[p + 3] * t.d;
    m[n + 4] = m[p] * t.tx + m[p + 2] * t.ty + m[p + 4];
    m[n + 5] = m[p + 1] * t.tx + m[p + 3] * t.ty + m[p + 5];
    m[n + 6] = m[p + 6] * node.alpha;
    for (let index = 7; index < MATRIX_SIZE; index++) {
      m[n + index] = m[p + index];
    }
    if (node.rasterClip) this.clip(node.rasterClip, n);
  }

  /** The minimap uses a local axis-aligned viewport, not an independent Pixi mask pass. */
  clip(rect, matrix) {
    const m = this.matrices;
    if (
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height) ||
      rect.width < 0 ||
      rect.height < 0 ||
      m[matrix + 1] !== 0 ||
      m[matrix + 2] !== 0
    ) {
      throw new Error("Invalid or rotated UI raster clip");
    }
    const left = m[matrix] * rect.x + m[matrix + 4];
    const right = left + m[matrix] * rect.width;
    const top = m[matrix + 3] * rect.y + m[matrix + 5];
    const bottom = top + m[matrix + 3] * rect.height;
    m[matrix + 7] = Math.max(m[matrix + 7], Math.min(left, right));
    m[matrix + 8] = Math.max(m[matrix + 8], Math.min(top, bottom));
    m[matrix + 9] = Math.min(m[matrix + 9], Math.max(left, right));
    m[matrix + 10] = Math.min(m[matrix + 10], Math.max(top, bottom));
  }

  record(sprite, matrix) {
    if (
      this.matrices[matrix + 7] >= this.matrices[matrix + 9] ||
      this.matrices[matrix + 8] >= this.matrices[matrix + 10]
    ) {
      return;
    }
    if (this.count === MAX_RASTER_SPRITES) {
      throw new Error("UI raster sprite budget exceeded");
    }
    const texture = sprite.texture;
    if (texture.rotate || texture.trim || sprite.tint !== 0xffffff) {
      throw new Error("Unsupported UI atlas sprite geometry");
    }
    if (!texture.source.resource) {
      throw new Error("UI atlas bitmap was released before its surface");
    }
    const index = this.count++;
    if (this.textures[index] !== texture) this.dirty = true;
    this.textures[index] = texture;
    const start = index * COMMAND_SIZE;
    for (let offset = 0; offset < 7; offset++) {
      this.number(start + offset, this.matrices[matrix + offset]);
    }
    this.number(start + 7, -sprite.anchor.x * texture.orig.width);
    this.number(start + 8, -sprite.anchor.y * texture.orig.height);
    this.number(start + 9, texture.orig.width);
    this.number(start + 10, texture.orig.height);
    for (let offset = 0; offset < 4; offset++) {
      this.number(start + 11 + offset, this.matrices[matrix + 7 + offset]);
    }
    this.bounds(start);
  }

  number(index, value) {
    if (this.commands[index] !== value) this.dirty = true;
    this.commands[index] = value;
  }

  bounds(start) {
    const c = this.commands;
    const x = c[start + 7];
    const y = c[start + 8];
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (let corner = 0; corner < 4; corner++) {
      const px = x + (corner & 1 ? c[start + 9] : 0);
      const py = y + (corner & 2 ? c[start + 10] : 0);
      const tx = c[start] * px + c[start + 2] * py + c[start + 4];
      const ty = c[start + 1] * px + c[start + 3] * py + c[start + 5];
      left = Math.min(left, tx);
      top = Math.min(top, ty);
      right = Math.max(right, tx);
      bottom = Math.max(bottom, ty);
    }
    left = Math.max(left, c[start + 11]);
    top = Math.max(top, c[start + 12]);
    right = Math.min(right, c[start + 13]);
    bottom = Math.min(bottom, c[start + 14]);
    if (left >= right || top >= bottom) return;
    this.left = Math.min(this.left, left);
    this.top = Math.min(this.top, top);
    this.right = Math.max(this.right, right);
    this.bottom = Math.max(this.bottom, bottom);
  }

  resize() {
    this.left = Math.floor(this.left);
    this.top = Math.floor(this.top);
    const width = Math.ceil(this.right) - this.left;
    const height = Math.ceil(this.bottom) - this.top;
    const pixelsX = Math.max(1, Math.ceil(width * this.scaleX));
    const pixelsY = Math.max(1, Math.ceil(height * this.scaleY));
    if (
      pixelsX > MAX_RASTER_DIMENSION ||
      pixelsY > MAX_RASTER_DIMENSION ||
      pixelsX * pixelsY > MAX_RASTER_PIXELS
    ) {
      throw new Error("UI artwork exceeds raster budget");
    }
    if (this.canvas.width !== pixelsX) this.canvas.width = pixelsX;
    if (this.canvas.height !== pixelsY) this.canvas.height = pixelsY;
    this.canvas.style.left = `${this.left}px`;
    this.canvas.style.top = `${this.top}px`;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.drawScaleX = pixelsX / Math.max(1, width);
    this.drawScaleY = pixelsY / Math.max(1, height);
  }

  draw() {
    const ctx = this.context;
    const c = this.commands;
    const sx = this.drawScaleX;
    const sy = this.drawScaleY;
    ctx.resetTransform();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    for (let index = 0; index < this.count; index++) {
      const start = index * COMMAND_SIZE;
      const texture = this.textures[index];
      const frame = texture.frame;
      const clipped = Number.isFinite(c[start + 11]);
      if (clipped) {
        ctx.save();
        ctx.setTransform(sx, 0, 0, sy, -this.left * sx, -this.top * sy);
        ctx.beginPath();
        ctx.rect(
          c[start + 11],
          c[start + 12],
          c[start + 13] - c[start + 11],
          c[start + 14] - c[start + 12],
        );
        ctx.clip();
      }
      ctx.setTransform(
        c[start] * sx,
        c[start + 1] * sy,
        c[start + 2] * sx,
        c[start + 3] * sy,
        (c[start + 4] - this.left) * sx,
        (c[start + 5] - this.top) * sy,
      );
      ctx.globalAlpha = c[start + 6];
      ctx.drawImage(
        texture.source.resource,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        c[start + 7],
        c[start + 8],
        c[start + 9],
        c[start + 10],
      );
      if (clipped) ctx.restore();
    }
  }

  destroy() {
    this.canvas.remove();
    this.canvas.width = this.canvas.height = 1;
    this.textures.length = 0;
    this.nodes.length = 0;
    this.count = 0;
  }
}
