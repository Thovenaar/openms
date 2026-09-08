import { Container } from "pixi.js";
import { EntityAnimation } from "./animation.js";

const MAX_PANEL_SPRITES = 512;
const MAX_PANEL_CONTROLS = 128;

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
  /** Borrow the HUD-owned Basic close-control bundle; consumers die before its owner. */
  borrow(resource) {
    for (const entity of resource.manifest.entities) {
      this.entities.set(entity.id, entity);
      this.assets[entity.id] = resource.manifest.metadata.assets[entity.id];
      this.sources.set(entity.id, resource);
    }
  }

  /** Animate only sequences whose every original canvas explicitly authors a delay. */
  stateImage(path, x, y) {
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
      delay: this.assets[key].delay,
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
    for (const sprite of this.timedSprites) {
      if (sprite.container.visible) sprite.advance(ms);
    }
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
    for (const listener of this.listeners) {
      listener.target.removeEventListener(listener.type, listener.handler);
    }
    this.element.remove();
    this.root.destroy({ children: true });
    for (const resource of this.dependencies) resource.destroy();
    this.resource.destroy();
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
  }

  createElement(normal) {
    const { panel, options } = this;
    this.element = document.createElement("button");
    this.element.type = "button";
    this.element.className = "maple-ui-hit";
    this.element.setAttribute("aria-label", options.label);
    this.element.setAttribute("aria-disabled", String(options.disabled));
    this.element.title = options.label;
    this.element.style.cssText = `position:absolute;left:${options.x}px;top:${options.y}px;width:${normal.width}px;height:${normal.height}px;`;
    const handler = this.handle.bind(this);
    for (const type of [
      "pointerenter",
      "pointerleave",
      "pointerdown",
      "pointerup",
      "pointercancel",
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
    this.updateFlags(event);
    if (event.type === "click" && this.options.disabled) return;
    if (event.type === "click" && !this.options.disabled) {
      this.panel.owner.sound("BtMouseClick");
      this.options.action();
    }
    if (event.type === "pointerenter") {
      this.panel.owner.sound("BtMouseOver");
      this.panel.owner.showTooltip(
        this.options.label,
        this.panel.x + this.options.x,
        this.panel.y + this.options.y,
      );
    }
    if (event.type === "pointerleave") this.panel.owner.hideTooltip();
    this.render();
  }
  updateFlags(event) {
    if (event.type === "pointerenter") this.hover = true;
    if (event.type === "pointerleave") {
      this.hover = false;
      this.pressed = false;
    }
    if (event.type === "pointerdown") this.pressed = true;
    if (["pointerup", "pointercancel", "blur"].includes(event.type)) {
      this.pressed = false;
    }
    if (event.type === "focus") this.focused = true;
    if (event.type === "blur") this.focused = false;
    if (event.type === "keydown" && ["Enter", " "].includes(event.key)) {
      this.pressed = true;
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
    for (const [name, sprite] of Object.entries(this.states)) {
      const visible =
        this.visible &&
        (name === state ||
          (name === "keyFocused" && this.focused && !this.options.disabled));
      if (visible && !sprite.container.visible) sprite.setAction("default");
      sprite.container.visible = visible;
    }
  }
}
