import { UISurface } from "./ui-surface.js";
import { EntityAnimation } from "./animation.js";

/** 009e cursor setter: states 0..12, remembered fallback only when previous <9. */
export class UICursor {
  constructor(owner, resource) {
    this.owner = owner;
    this.surface = new UISurface(owner, "Cursor", resource, [800, 600]);
    this.surface.element.remove();
    this.surface.root.eventMode = "none";
    this.surface.root.zIndex = 1000001;
    this.states = [];
    this.current = 0;
    this.fallback = 0;
    this.ghost = null;
    for (let state = 0; state <= 12; state++) {
      const sprite = this.surface.stateImage(`Cursor/${state}/0`, 0, 0);
      sprite.container.visible = state === 0;
      this.states.push(sprite);
    }
    this.surface.root.visible = false;
    this.cursorStyle = document.createElement("style");
    this.cursorStyle.textContent =
      "canvas.maple-original-cursor{cursor:none!important}";
    document.head.append(this.cursorStyle);
    owner.app.canvas.classList.add("maple-original-cursor");
    owner.host.classList.add("maple-ui-original-cursor");
  }

  set(state) {
    if (state === -1) state = this.fallback;
    if (!Number.isInteger(state) || state < 0 || state > 12) return;
    if (state === this.current) return;
    if (this.current < 9) this.fallback = this.current;
    this.states[this.current].container.visible = false;
    this.current = state;
    this.states[state].container.visible = true;
  }

  press() {
    this.set(this.current === 7 ? 9 : this.current === 8 ? 10 : 12);
  }

  release() {
    if (this.current === 9 || this.current === 10 || this.current === 12) {
      this.set(-1);
    }
  }

  move(event) {
    const owner = this.owner;
    const canvas = owner.app.canvas.getBoundingClientRect();
    const inside =
      event.clientX >= canvas.left &&
      event.clientX < canvas.right &&
      event.clientY >= canvas.top &&
      event.clientY < canvas.bottom;
    this.surface.root.visible = owner.visible && inside;
    if (!inside) return;
    const point = owner.logicalPointer(event);
    this.surface.root.position.set(point.x, point.y);
    owner.root.setChildIndex(this.surface.root, owner.root.children.length - 1);
  }

  drag(source, path) {
    this.clearGhost();
    const entity = source.entities.get(path);
    const resource = source.sources.get(path) || source.resource;
    this.ghost = new EntityAnimation(entity, resource.textures);
    this.ghost.setPosition(0, 0);
    this.surface.root.addChildAt(this.ghost.container, 0);
    this.set(11);
  }

  clearGhost() {
    this.ghost?.container.destroy({ children: true });
    this.ghost = null;
    this.set(0);
  }

  update(ms) {
    if (this.surface.root.visible) this.states[this.current].advance(ms);
  }

  destroy() {
    this.clearGhost();
    this.surface.destroy();
    this.owner.app.canvas.classList.remove("maple-original-cursor");
    this.cursorStyle.remove();
    this.owner.host.classList.remove("maple-ui-original-cursor");
  }
}
