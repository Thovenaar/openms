import { UISurface } from "./ui-surface.js";
import { EntityAnimation } from "./animation.js";

/** 0059a6d9 states/fallback; 004c09e3 button state4, 004dfeaf noninteractive state0. */
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
    this.pointerId = null;
    this.worldTarget = false;
    this.clientX = 0;
    this.clientY = 0;
    this.hoverHandler = this.move.bind(this);
    this.leaveHandler = this.leave.bind(this);
    window.addEventListener("pointerover", this.hoverHandler);
    window.addEventListener("pointerout", this.leaveHandler);
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
    this.setVisible(owner.visible);
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

  press(event) {
    if (this.pointerId !== null) return;
    this.pointerId = event.pointerId;
    this.set(this.current === 7 ? 9 : this.current === 8 ? 10 : 12);
  }

  release(event) {
    if (event?.pointerId !== undefined && event.pointerId !== this.pointerId) {
      return;
    }
    this.pointerId = null;
    if (this.current === 9 || this.current === 10 || this.current === 12) {
      this.set(-1);
    }
  }

  setVisible(visible) {
    this.owner.app.canvas.classList.toggle("maple-original-cursor", visible);
    this.owner.host.classList.toggle("maple-ui-original-cursor", visible);
    if (!visible) this.surface.root.visible = false;
  }

  move(event) {
    const owner = this.owner;
    this.clientX = event.clientX;
    this.clientY = event.clientY;
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
    if (this.pointerId === null && !owner.bindingDrag) {
      this.set(this.hoverState(event));
    }
  }

  leave(event) {
    if (!event.relatedTarget) this.surface.root.visible = false;
  }

  worldState() {
    return !this.owner.blocksGameplay() &&
      this.owner.hooks.isWorldInteractive?.(this.clientX, this.clientY) === true
      ? 4
      : 0;
  }

  hoverState(event) {
    const owner = this.owner;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    this.worldTarget = hit === owner.app.canvas;
    if (this.worldTarget) return this.worldState();
    if (!hit || !owner.host.contains(hit)) return 0;
    const modal = owner.modal();
    if (modal && !modal.element.contains(hit)) return 0;
    const control = hit.closest(
      "button,input,select,textarea,a[href],[data-cursor-state]",
    );
    if (
      !control ||
      control.disabled ||
      control.getAttribute("aria-disabled") === "true"
    ) {
      return 0;
    }
    const state = control.dataset.cursorState;
    if (state !== undefined) {
      const value = Number(state);
      return value >= 0 && value <= 8 ? value : 0;
    }
    return 4;
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
    if (!this.surface.root.visible) return;
    if (
      this.worldTarget &&
      this.pointerId === null &&
      !this.owner.bindingDrag
    ) {
      this.set(this.worldState());
    }
    this.states[this.current].advance(ms);
  }

  destroy() {
    window.removeEventListener("pointerover", this.hoverHandler);
    window.removeEventListener("pointerout", this.leaveHandler);
    this.clearGhost();
    this.surface.destroy();
    this.owner.app.canvas.classList.remove("maple-original-cursor");
    this.cursorStyle.remove();
    this.owner.host.classList.remove("maple-ui-original-cursor");
  }
}
