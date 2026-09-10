import { Container } from "pixi.js";
import { EntityAnimation } from "./animation.js";
import { UIRasterPlane } from "./ui-raster-plane.js";

const MAX_PANEL_SPRITES = 1632; // 96 visible stacks: one icon plus up to 16 safe-integer count digits.
const MAX_PANEL_CONTROLS = 128;
const MAX_PANEL_LAYERS = 128;
const MAX_ALPHA_PIXELS = 4 * 1024 * 1024;

/** Original raster resources with a bounded accessible DOM interaction plane. No independent image/atlas decoding. */
export class UISurface {
  constructor(owner, name, resource, size) {
    this.owner = owner;
    this.name = name;
    this.resource = resource;
    this.width = size[0];
    this.height = size[1];
    this.root = new Container({ label: `ui:${name}` });
    this.element = document.createElement("section");
    this.element.className = "maple-ui-panel";
    this.element.setAttribute("aria-label", name);
    this.element.style.cssText = `position:absolute;width:${this.width}px;height:${this.height}px;pointer-events:auto;`;
    this.entities = new Map(
      resource.manifest.entities.map((entity) => [entity.id, entity]),
    );
    this.assets = { ...resource.manifest.metadata.assets };
    this.sources = new Map();
    this.timedSprites = [];
    this.unsupportedTimings = 0;
    this.sprites = [];
    this.controls = [];
    this.listeners = [];
    this.dependencies = [];
    this.cleanups = [];
    this.disposed = false;
    this.ownsResource = true;
    this.layers = new Set();
    this.updateLayers = new Array(MAX_PANEL_LAYERS);
    this.alphaPixels = 0;
    this.raster =
      owner.app && name !== "StatusBar"
        ? new UIRasterPlane(this.root, this.element)
        : null;
    this.element.style.isolation = "isolate";
    owner.root.addChild(this.root);
    owner.host.append(this.element);
  }

  /** Top-left coordinates are converted back to the original canvas anchor. */
  image(path, x, y, anchored = false) {
    const entity = this.entities.get(path);
    const asset = this.assets[path];
    if (!entity || !asset) {
      throw new Error(`Missing UI canvas ${this.name}:${path}`);
    }
    if (this.sprites.length >= MAX_PANEL_SPRITES) {
      throw new Error("UI sprite limit exceeded");
    }
    const sprite = new EntityAnimation(
      entity,
      (this.sources.get(path) || this.resource).textures,
    );
    // Source-tree enumeration is not UI depth; composition order owns layering.
    sprite.container.zIndex = 0;
    sprite.setPosition(
      x + (anchored ? 0 : asset.origin.x),
      y + (anchored ? 0 : asset.origin.y),
    );
    this.root.addChild(sprite.container);
    this.sprites.push(sprite);
    return sprite;
  }

  /** Extract a single authored canvas once at load time; the caller owns the bounded mask. */
  alphaMask(path) {
    const asset = this.assets[path];
    const texture = this.#alphaTexture(path, asset);
    const { width, height } = asset;
    const pixels = width * height;
    if (
      !Number.isSafeInteger(pixels) ||
      pixels <= 0 ||
      this.alphaPixels + pixels > MAX_ALPHA_PIXELS
    ) {
      throw new Error("UI alpha mask pixel budget exceeded");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("UI alpha mask requires Canvas2D");
    try {
      const frame = texture.frame;
      const resolution = texture.source.resolution;
      context.drawImage(
        texture.source.resource,
        frame.x * resolution,
        frame.y * resolution,
        frame.width * resolution,
        frame.height * resolution,
        0,
        0,
        width,
        height,
      );
      const rgba = context.getImageData(0, 0, width, height).data;
      const alpha = new Uint8Array(pixels);
      for (let index = 0; index < pixels; index++) {
        alpha[index] = rgba[index * 4 + 3];
      }
      this.alphaPixels += pixels;
      return { width, height, alpha };
    } finally {
      canvas.width = canvas.height = 0;
    }
  }

  #alphaTexture(path, asset) {
    const frames = this.entities.get(path)?.actions.default;
    const part = frames?.[0]?.parts[0];
    const resource = this.sources.get(path) || this.resource;
    const texture = resource.textures.get(part?.texture);
    if (
      !asset ||
      frames?.length !== 1 ||
      frames[0].parts.length !== 1 ||
      !this.#supportsAlphaTexture(texture, asset)
    ) {
      throw new Error(`Unsupported UI alpha canvas ${this.name}:${path}`);
    }
    return texture;
  }

  #supportsAlphaTexture(texture, asset) {
    return Boolean(
      texture?.source.resource &&
      !texture.rotate &&
      !texture.trim &&
      texture.frame.width === asset.width &&
      texture.frame.height === asset.height,
    );
  }

  /** Replaceable layers borrow resources; isolated overlays own artwork above sibling DOM. */
  layer(name, { isolated = false } = {}) {
    const layer = new UISurface(
      {
        root: this.root,
        host: this.element,
        app: isolated ? this.owner.app : null,
      },
      name,
      this.resource,
      [this.width, this.height],
    );
    layer.owner = this.owner;
    layer.ownsResource = false;
    layer.borrow(this.resource);
    layer.position(0, 0);
    layer.element.style.pointerEvents = "none";
    for (const resource of new Set(this.sources.values())) {
      layer.borrow(resource);
    }
    this.layers.add(layer);
    layer.cleanups.push(() => this.layers.delete(layer));
    return layer;
  }

  /** Accessible labels never imply visual help; options.tooltip is authored content or a factory. */
  hit(label, rect, handlers = {}, options = {}) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "maple-ui-hit";
    element.setAttribute("aria-label", label);
    element.dataset.cursorState = Object.keys(handlers).length ? "5" : "0";
    element.style.cssText = `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;touch-action:none;`;
    for (const [type, handler] of Object.entries(handlers)) {
      this.listen(element, type, handler);
    }
    const show = (event) => {
      const content =
        typeof options.tooltip === "function"
          ? options.tooltip()
          : options.tooltip;
      if (!content) return;
      const box = element.getBoundingClientRect();
      const point = this.owner.logicalPointer(
        event.type === "focus"
          ? { clientX: box.left, clientY: box.top }
          : event,
      );
      this.owner.showTooltip(content, point.x, point.y, element);
    };
    this.listen(element, "pointerenter", show);
    this.listen(element, "focus", show);
    this.listen(element, "pointerleave", () => this.owner.hideTooltip());
    this.listen(element, "blur", () => this.owner.hideTooltip());
    this.cleanups.push(() => {
      if (this.owner.tooltipAnchor === element) this.owner.hideTooltip();
    });
    this.element.append(element);
    return element;
  }
  /** Borrow the HUD-owned Basic close-control bundle; consumers die before its owner. */
  borrow(resource) {
    for (const entity of resource.manifest.entities) {
      this.entities.set(entity.id, entity);
      this.assets[entity.id] = resource.manifest.metadata.assets[entity.id];
      this.sources.set(entity.id, resource);
    }
  }

  /** Original Gr2D5040b9e7 scales authored frame milliseconds by a per-mille delay. */
  stateImage(path, x, y, delayPermille = 1000) {
    if (
      !Number.isSafeInteger(delayPermille) ||
      delayPermille < 1 ||
      delayPermille > 0x7fffffff
    ) {
      throw new RangeError("Invalid native animation delay multiplier");
    }
    const sprite = this.image(path, x, y, true);
    if (!path.endsWith("/0")) return sprite;
    const base = path.slice(0, -1);
    const paths = Object.keys(this.assets).filter(
      (key) => key.startsWith(base) && /^\d+$/.test(key.slice(base.length)),
    );
    paths.sort(
      (a, b) => Number(a.slice(base.length)) - Number(b.slice(base.length)),
    );
    if (paths.length < 2) return sprite;
    if (paths.length > 128) throw new Error("UI state frame budget exceeded");
    if (paths.some((key) => this.assets[key].delay === null)) {
      this.unsupportedTimings++;
      return sprite;
    }
    const frames = paths.map((key) => ({
      ...this.entities.get(key).actions.default[0],
      delay: Math.trunc((this.assets[key].delay * delayPermille) / 1000),
    }));
    const source = this.sources.get(path) || this.resource;
    const entity = { ...this.entities.get(path), actions: { default: frames } };
    const animation = new EntityAnimation(entity, source.textures);
    animation.container.zIndex = 0;
    animation.setPosition(x, y);
    this.root.removeChild(sprite.container);
    sprite.container.destroy({ children: true });
    this.sprites[this.sprites.length - 1] = animation;
    this.root.addChild(animation.container);
    this.timedSprites.push(animation);
    return animation;
  }

  update(ms) {
    const layers = this.updateLayers;
    layers[0] = this;
    let count = 1;
    for (let index = 0; index < count; index++) {
      const layer = layers[index];
      // Keep the bounded traversal until every descendant animation has advanced.
      if (!layer.root.visible) continue;
      for (const sprite of layer.timedSprites) {
        if (sprite.container.visible) sprite.advance(ms);
      }
      for (const child of layer.layers) {
        if (count === MAX_PANEL_LAYERS) {
          throw new Error("UI layer budget exceeded");
        }
        layers[count++] = child;
      }
    }
    for (let index = count - 1; index >= 0; index--) {
      layers[index].renderArtwork();
      layers[index] = null;
    }
  }

  /** CSS/window scaling comes from the layout owner; no layout reads in the draw loop. */
  renderArtwork() {
    if (!this.raster) return;
    const ratio = window.devicePixelRatio || 1;
    this.raster.sync(
      (this.owner.screenScaleX ?? 1) * ratio,
      (this.owner.screenScaleY ?? 1) * ratio,
    );
  }

  /** State origins remain relative to the normal-state anchor, including keyFocused overlays. */
  button(path, x, y, options) {
    if (this.controls.length >= MAX_PANEL_CONTROLS) {
      throw new Error("UI control limit exceeded");
    }
    const control = new UIControl(this, {
      ...options,
      path,
      x,
      y,
      disabled: options.disabled === true,
    });
    this.controls.push(control);
    return control;
  }

  text(text, x, y, options) {
    const width = typeof options === "number" ? options : options.width;
    const className =
      typeof options === "number" ? "" : options.className || "";
    const element = document.createElement("div");
    element.className = `maple-ui-text ${className}`;
    element.textContent = text;
    element.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${width}px;`;
    this.element.append(element);
    return element;
  }

  localButton(label, x, y, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "maple-ui-local";
    button.textContent = label;
    button.style.cssText = `position:absolute;left:${x}px;top:${y}px;`;
    this.listen(button, "click", action);
    this.element.append(button);
    return button;
  }

  /** Browser-policy scroll viewport: never implies recovered original text metrics or slot layout. */
  contentArea(x, y, width, height) {
    const content = document.createElement("div");
    content.className = "maple-ui-content";
    content.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px;overflow:auto;box-sizing:border-box;pointer-events:auto;`;
    this.element.append(content);
    return content;
  }

  listen(target, type, handler) {
    target.addEventListener(type, handler);
    this.listeners.push({ target, type, handler });
  }

  position(x, y) {
    this.x = x;
    this.y = y;
    this.root.position.set(x, y);
    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    for (const control of this.controls) control.releasePointer();
    // Owners cancel live controls and subscriptions before their child artwork dies.
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    for (const layer of this.layers) layer.destroy();
    for (const listener of this.listeners) {
      listener.target.removeEventListener(listener.type, listener.handler);
    }
    this.element.remove();
    this.raster?.destroy();
    this.root.destroy({ children: true });
    for (const resource of this.dependencies) resource.destroy();
    if (this.ownsResource) this.resource.destroy();
    this.listeners.length = 0;
    this.controls.length = 0;
    this.sprites.length = 0;
  }
}

/** Each authored button state is separate; focus is an overlay, never substituted with hover. */
class UIControl {
  constructor(panel, options) {
    this.panel = panel;
    this.options = options;
    this.visible = true;
    this.hover = false;
    this.pressed = false;
    this.focused = false;
    this.states = Object.create(null);
    const normalPath = this.statePath("normal");
    const normal = panel.assets[normalPath];
    if (!normal) throw new Error(`Missing normal button state ${options.path}`);
    this.origin = normal.origin;
    for (const state of [
      "normal",
      "mouseOver",
      "pressed",
      "disabled",
      "keyFocused",
    ]) {
      const path = this.statePath(state);
      if (path) {
        this.states[state] = panel.stateImage(
          path,
          options.x + normal.origin.x,
          options.y + normal.origin.y,
        );
      }
    }
    this.createElement(normal);
    this.render();
  }

  position(x, y) {
    this.options.x = x;
    this.options.y = y;
    for (const name in this.states) {
      this.states[name].setPosition(x + this.origin.x, y + this.origin.y);
    }
    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
  }

  setVisible(visible) {
    this.visible = visible;
    this.element.hidden = !visible;
    this.render();
    if (!visible) this.releasePointer();
  }

  setDisabled(disabled) {
    this.options.disabled = disabled;
    this.element.setAttribute("aria-disabled", String(disabled));
    if (disabled) this.pressed = false;
    if (disabled) this.releasePointer();
    this.element.dataset.cursorState =
      !disabled && typeof this.options.action === "function" ? "4" : "0";
    this.render();
  }

  createElement(normal) {
    const { panel, options } = this;
    this.element = document.createElement("button");
    this.element.type = "button";
    this.element.className = "maple-ui-hit";
    this.element.setAttribute("aria-label", options.label);
    this.element.setAttribute("aria-disabled", String(options.disabled));
    this.element.dataset.cursorState =
      !options.disabled && typeof options.action === "function" ? "4" : "0";
    this.element.style.cssText = `position:absolute;left:${options.x}px;top:${options.y}px;width:${normal.width}px;height:${normal.height}px;`;
    const handler = this.handle.bind(this);
    for (const type of [
      "pointerenter",
      "pointerleave",
      "pointerdown",
      "pointerup",
      "pointercancel",
      "lostpointercapture",
      "focus",
      "blur",
      "click",
      "keydown",
      "keyup",
    ]) {
      panel.listen(this.element, type, handler);
    }
    panel.element.append(this.element);
  }

  statePath(state) {
    const base = `${this.options.path}/${state}`;
    if (this.panel.assets[base]) return base;
    if (this.panel.assets[`${base}/0`]) return `${base}/0`;
    return null;
  }

  handle(event) {
    if (!this.acceptsPointerEvent(event)) return;
    this.updateFlags(event);
    if (event.type === "click") {
      if (!this.acceptsClick(event)) return;
      // 004c0933: Space releases sound; Enter belongs to the parent dialog.
      if (event.detail > 0 || this.activationKey === " ") {
        this.panel.owner.sound("BtMouseClick");
      }
      this.activationKey = null;
      this.options.action?.();
    }
    this.updateTooltip(event);
    this.render();
  }

  updateTooltip(event) {
    if (event.type === "pointerenter" || event.type === "focus") {
      if (event.type === "pointerenter" && !this.options.disabled) {
        this.panel.owner.sound("BtMouseOver");
      }
      const content =
        typeof this.options.tooltip === "function"
          ? this.options.tooltip()
          : this.options.tooltip;
      if (!content) return;
      const box = this.element.getBoundingClientRect();
      const point = this.panel.owner.logicalPointer(
        event.type === "focus"
          ? { clientX: box.left, clientY: box.top }
          : event,
      );
      this.panel.owner.showTooltip(content, point.x, point.y, this.element);
    }
    if (event.type === "pointerleave") this.panel.owner.hideTooltip();
    if (event.type === "blur") this.panel.owner.hideTooltip();
  }

  acceptsPointerEvent(event) {
    if (event.type === "pointerdown" && this.panel.owner.pressedControl) {
      return false;
    }
    if (
      (event.type === "pointerup" || event.type === "pointercancel") &&
      this.pointerId !== undefined &&
      event.pointerId !== this.pointerId
    ) {
      return false;
    }
    return true;
  }

  acceptsClick(event) {
    if (this.options.disabled) return false;
    if (event.detail > 0 && this.cancelClick) return false;
    return this.visible;
  }
  releasePointer() {
    if (this.panel.owner.pressedControl === this) {
      this.panel.owner.pressedControl = null;
    }
    if (this.pointerId === undefined) return;
    const id = this.pointerId;
    this.pointerId = undefined;
    if (this.element.hasPointerCapture(id)) {
      this.element.releasePointerCapture(id);
    }
  }

  cancelPointer() {
    this.cancelClick = true;
    this.hover = false;
    this.pressed = false;
    this.releasePointer();
    this.render();
  }
  updateFlags(event) {
    this.updatePointerFlags(event);
    this.updateFocusFlags(event);
  }

  updatePointerFlags(event) {
    if (event.type === "pointerenter") this.hover = true;
    if (event.type === "pointerleave") {
      this.hover = false;
      this.pressed = false;
    }
    this.capturePointer(event);
    if (event.type === "pointerup" && this.pointerId === event.pointerId) {
      this.cancelOffTargetClick(event);
    }
    if (
      event.type === "pointerup" ||
      event.type === "pointercancel" ||
      event.type === "lostpointercapture" ||
      event.type === "blur"
    ) {
      this.pressed = false;
      this.releasePointer();
    }
    if (event.type === "pointercancel") this.hover = false;
  }

  capturePointer(event) {
    if (
      event.type !== "pointerdown" ||
      event.button !== 0 ||
      this.options.disabled
    ) {
      return;
    }
    this.pressed = true;
    this.cancelClick = false;
    this.panel.owner.pressedControl = this;
    this.pointerId = event.pointerId;
    this.element.setPointerCapture(event.pointerId);
  }

  cancelOffTargetClick(event) {
    const rect = this.element.getBoundingClientRect();
    this.cancelClick =
      event.clientX < rect.left ||
      event.clientX >= rect.right ||
      event.clientY < rect.top ||
      event.clientY >= rect.bottom;
  }

  updateFocusFlags(event) {
    if (event.type === "focus") this.focused = true;
    if (event.type === "blur") {
      this.focused = false;
      this.activationKey = null;
    }
    if (event.type === "keydown" && ["Enter", " "].includes(event.key)) {
      this.activationKey = event.key;
      this.pressed = event.key === " ";
    }
    if (event.type === "keyup") this.pressed = false;
  }

  currentState() {
    let state = this.options.disabled ? "disabled" : "normal";
    if (!this.options.disabled && this.hover && this.states.mouseOver) {
      state = "mouseOver";
    }
    if (!this.options.disabled && this.pressed && this.states.pressed) {
      state = "pressed";
    }
    if (!this.states[state]) state = "normal";
    return state;
  }

  render() {
    const state = this.currentState();
    for (const name in this.states) {
      const sprite = this.states[name];
      const visible =
        this.visible &&
        (name === state ||
          (name === "keyFocused" && this.focused && !this.options.disabled));
      sprite.container.visible = visible;
    }
  }
}
