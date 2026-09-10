import {
  CanvasSource,
  Container,
  Sprite,
  Texture,
  TilingSprite,
} from "pixi.js";
import { loadVisualBundle } from "./visual-resources.js";
import { check } from "./stream-network.js";

const CHAT_LIMIT = 70; // 008d379c / 004ca25d, ordinary edit length.
const DISPLAY_MS = 5000; // 00937495 / 00978b4f push 0x1388.
const PART_NAMES = ["nw", "n", "ne", "w", "c", "e", "sw", "s", "se", "arrow"];
const TILED = new Set(["n", "w", "c", "e", "s"]);
const MAX_COLUMNS = 7; // 00489941: seven center tiles for ordinary speech.
const FONT = "12px Arial, sans-serif"; // Browser substitute for the original font rasterizer.
const DESTROY_DISPLAY = Object.freeze({ children: true });

/** Validate the one ordinary WZ skin before constructing any display resources. */
function skinParts(resource) {
  const assets = resource.manifest.metadata?.assets;
  if (!assets || resource.manifest.entities.length !== PART_NAMES.length) {
    throw new Error("Invalid ordinary speech skin");
  }
  const parts = Object.create(null);
  for (const name of PART_NAMES) {
    parts[name] = skinPart(resource, assets, name);
  }
  return parts;
}

/** Read one already-counted WZ part and reject missing or composite canvases. */
function skinPart(resource, assets, name) {
  const id = `0/${name}`;
  const asset = assets[id];
  const entity = resource.manifest.entities.find((entry) => entry.id === id);
  const frames = entity?.actions.default;
  const frame = frames?.[0];
  const texture = resource.textures.get(frame?.parts?.[0]?.texture);
  if (!asset || frames?.length !== 1 || frame.parts.length !== 1 || !texture) {
    throw new Error(`Invalid speech canvas ${id}`);
  }
  validateCanvasGeometry(asset, texture, id);
  return { asset, texture };
}

/** Skin dimensions are bounded WZ pixels and must match the decoded canvas. */
function invalidCanvasDimensions(asset, texture) {
  return (
    texture.width !== asset.width ||
    texture.height !== asset.height ||
    asset.width < 1 ||
    asset.width > 32 ||
    asset.height < 1 ||
    asset.height > 32
  );
}

function validateCanvasGeometry(asset, texture, id) {
  if (
    invalidCanvasDimensions(asset, texture) ||
    !Number.isFinite(asset.origin?.x) ||
    !Number.isFinite(asset.origin?.y) ||
    Math.abs(asset.origin.x) > 32 ||
    Math.abs(asset.origin.y) > 32
  ) {
    throw new Error(`Invalid speech canvas geometry ${id}`);
  }
}

/** Resize tiled parts without stretching the underlying WZ texture. */
function sizeSprite(sprite, width, height) {
  if (width !== undefined) sprite.width = width;
  if (height !== undefined) sprite.height = height;
  sprite.visible = width !== 0;
}

/** The field supplies a stable world head anchor and finite camera coordinates. */
function validateHeadAnchor(pose, camera) {
  if (
    !Number.isFinite(pose?.x) ||
    !Number.isFinite(pose?.headY) ||
    !Number.isFinite(camera?.x) ||
    !Number.isFinite(camera?.y)
  ) {
    throw new Error("Speech needs a finite avatar head anchor and camera");
  }
}

/** One local utterance, world anchored and rendered below the UI. No server-message log. */
export class SpeechBubbles {
  constructor(app, services) {
    this.app = app;
    this.services = services;
    // Field-overlay ordering is browser presentation policy, not original numeric depth.
    this.root = new Container({ label: "local-speech", zIndex: 999999 });
    this.root.eventMode = "none";
    this.root.visible = false;
    this.scene = null;
    this.resource = null;
    this.parts = null;
    this.sprites = Object.create(null);
    this.text = "";
    this.remainingMs = -1;
    this.width = 0;
    this.height = 0;
    this.lines = [];
    this.destroyed = false;
  }

  /** Transfer the presentation into the live field's world-transform/lifetime boundary. */
  setScene(scene) {
    if (
      this.destroyed ||
      this.root.destroyed ||
      scene?.destroyed ||
      !scene?.overlays ||
      scene.overlays.destroyed
    ) {
      throw new Error("Speech needs a live field overlay");
    }
    if (this.scene === scene) return;
    scene.overlays.addChild(this.root);
    this.scene = scene;
  }

  async prepare(catalog, signal) {
    if (this.destroyed || this.resource) {
      throw new Error("Speech owner is not fresh");
    }
    const record = catalog.ui?.speechBubbles;
    if (!record?.bundle || !Number.isInteger(record.color)) {
      throw new Error("Speech catalog is missing");
    }
    const resource = await loadVisualBundle(
      record.bundle,
      this.services,
      signal,
    );
    try {
      check(signal);
      if (this.destroyed) {
        throw new Error("Speech owner was destroyed while loading");
      }
      this.parts = skinParts(resource);
      this.buildDisplay(record.color);
      this.resource = resource;
      return this;
    } catch (error) {
      resource.destroy();
      this.destroy();
      throw error;
    }
  }

  buildDisplay(color) {
    for (const name of PART_NAMES) {
      const part = this.parts[name];
      const sprite = TILED.has(name)
        ? new TilingSprite({
            texture: part.texture,
            width: part.asset.width,
            height: part.asset.height,
          })
        : new Sprite(part.texture);
      this.sprites[name] = sprite;
      this.root.addChild(sprite);
    }
    this.sprites.sRight = new TilingSprite({ texture: this.parts.s.texture });
    this.root.addChild(this.sprites.sRight);
    this.canvas = document.createElement("canvas");
    this.textWidth = this.parts.c.asset.width * MAX_COLUMNS;
    // Seventy input units bound the worst possible number of wrapped lines.
    this.textHeight = this.parts.c.asset.height * CHAT_LIMIT;
    this.context = this.canvas.getContext("2d");
    if (!this.context) throw new Error("Speech text canvas is unavailable");
    this.textColor = `#${((color >>> 0) & 0xffffff).toString(16).padStart(6, "0")}`;
    this.textTexture = new Texture({
      source: new CanvasSource({
        resource: this.canvas,
        width: this.textWidth,
        height: this.textHeight,
        resolution: this.app.renderer.resolution,
      }),
    });
    this.syncDensity(this.app.renderer.resolution);
    this.textSprite = new Sprite(this.textTexture);
    this.root.addChild(this.textSprite);
  }

  /** Prepared owner; printable ASCII matches 008d549f sanitization. Returns local acceptance. */
  show(text) {
    if (
      !this.resource ||
      this.destroyed ||
      !this.scene ||
      this.scene.destroyed
    ) {
      return false;
    }
    if (
      typeof text !== "string" ||
      text.length < 1 ||
      text.length > CHAT_LIMIT ||
      /[^\x20-\x7e]/.test(text)
    ) {
      return false;
    }
    this.syncDensity(this.app.renderer.resolution);
    if (text !== this.text) {
      this.layoutText(text);
      this.layoutSkin();
      this.text = text;
    }
    this.remainingMs = DISPLAY_MS;
    // update() places it at the current avatar origin before making it visible.
    this.root.visible = false;
    return true;
  }

  /** Logical shaping happens only on submission; density changes only redraw existing lines. */
  layoutText(text) {
    const tile = this.parts.c.asset;
    const maximum = tile.width * MAX_COLUMNS;
    this.lines.length = 0;
    let start = 0;
    let wordBreak = -1;
    for (let end = 1; end <= text.length; end++) {
      if (text[end - 1] === " ") wordBreak = end - 1;
      if (this.context.measureText(text.slice(start, end)).width <= maximum) {
        continue;
      }
      const split = wordBreak > start ? wordBreak : end - 1;
      if (split <= start) {
        throw new Error("Speech glyph exceeds its line budget");
      }
      this.lines.push(text.slice(start, split));
      start = text[split] === " " ? split + 1 : split;
      end = start;
      wordBreak = -1;
    }
    this.lines.push(text.slice(start));
    const columns =
      this.lines.length === 1
        ? Math.max(
            1,
            Math.ceil(this.context.measureText(text).width / tile.width) | 1,
          )
        : MAX_COLUMNS;
    this.width = columns * tile.width;
    this.height = this.lines.length * tile.height;
    this.rasterText();
  }

  /** Called by the renderer-density owner on resize, including while simulation is paused. */
  syncDensity(resolution) {
    if (this.destroyed || !this.textTexture || this.resolution === resolution) {
      return;
    }
    if (!Number.isFinite(resolution) || resolution <= 0) {
      throw new Error("Invalid speech text resolution");
    }
    this.resolution = resolution;
    this.textTexture.source.resize(this.textWidth, this.textHeight, resolution);
    this.context.setTransform(resolution, 0, 0, resolution, 0, 0);
    this.context.font = FONT;
    this.context.textBaseline = "top";
    this.context.fillStyle = this.textColor;
    this.rasterText();
  }

  rasterText() {
    this.context.clearRect(0, 0, this.textWidth, this.textHeight);
    for (let i = 0; i < this.lines.length; i++) {
      this.context.fillText(this.lines[i], 0, i * this.parts.c.asset.height);
    }
    this.textTexture.source.update();
  }

  /** 0048a029 replaces the middle bottom tile with arrow, preserving every WZ origin. */
  layoutSkin() {
    const width = this.width;
    const height = this.height;
    this.place("nw", 0, 0).visible = true;
    this.place("ne", width, 0).visible = true;
    this.place("sw", 0, height).visible = true;
    this.place("se", width, height).visible = true;
    sizeSprite(this.place("n", 0, 0), width);
    sizeSprite(this.place("w", 0, 0), this.parts.w.asset.width, height);
    sizeSprite(this.place("e", width, 0), this.parts.e.asset.width, height);
    sizeSprite(this.place("c", 0, 0), width, height);
    const half = (width - this.parts.c.asset.width) / 2;
    sizeSprite(this.place("s", 0, height), half);
    this.place("arrow", half, height).visible = true;
    const right = this.sprites.sRight;
    right.position.set(half + this.parts.c.asset.width, height);
    right.width = half;
    right.height = this.parts.s.asset.height;
    right.visible = half > 0;
    this.textSprite.position.set(0, -1);
  }

  place(name, x, y) {
    const sprite = this.sprites[name];
    const asset = this.parts[name].asset;
    sprite.position.set(x - asset.origin.x, y - asset.origin.y);
    return sprite;
  }

  /** pose.headY is the current avatar canvas top in world pixels, derived from resident frame geometry. */
  update(ms, pose, camera) {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error("Invalid speech elapsed milliseconds");
    }
    if (this.destroyed || !this.scene || this.remainingMs < 0) return;
    this.syncDensity(this.app.renderer.resolution);
    this.remainingMs -= ms;
    // 0048e6d4 keeps the layer at exact equality and releases it after the deadline.
    if (this.remainingMs < 0) {
      this.root.visible = false;
      return;
    }
    validateHeadAnchor(pose, camera);
    // 00489d66 centers at x+3; 0048e85a leaves a five-pixel gap above the avatar top.
    this.root.position.set(
      Math.round(pose.x + 3 - this.width / 2),
      Math.round(pose.headY - 5 - this.parts.arrow.asset.height - this.height),
    );
    // No viewport clamping: the original field layer follows the character, not the HUD.
    this.root.visible = true;
  }

  snapshot() {
    return {
      authority: "offline-local-speech",
      ready: this.resource !== null,
      visible: Boolean(
        this.root.visible &&
        this.scene?.container.visible &&
        this.scene.overlays.visible &&
        !this.scene.destroyed,
      ),
      text: this.text,
      remainingMs: Math.max(0, this.remainingMs),
      lines: this.lines.length,
      width: this.width,
      height: this.height,
      worldX: this.root.x,
      worldY: this.root.y,
      screenX: this.scene ? this.root.x - this.scene.camera.x : null,
      screenY: this.scene ? this.root.y - this.scene.camera.y : null,
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (!this.root.destroyed) this.root.destroy(DESTROY_DISPLAY);
    this.textTexture?.destroy(true);
    this.resource?.destroy();
    this.resource = null;
    this.scene = null;
    this.remainingMs = -1;
    this.lines.length = 0;
    if (this.canvas) this.canvas.width = this.canvas.height = 0;
  }
}
