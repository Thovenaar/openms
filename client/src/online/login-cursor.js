import { Container } from "pixi.js";
import { UICursor } from "../ui/ui-cursor.js";

/** Login owns a viewport-sized cursor plane, independent of the centered 800×600 window. */
export class LoginCursor {
  constructor(login, resource) {
    this.login = login;
    this.app = login.app;
    this.host = this.cursorTarget = login.host;
    this.root = new Container({ label: "login-cursor" });
    this.scale = 1;
    this.offsetX = this.offsetY = 0;
    this.layoutGeneration = 0;
    this.controller = new AbortController();
    this.dialogPanel = { element: login.dialogs.overlay };
    this.recoveryPanel = { element: login.recovery.overlay };
    this.registrationPanel = { element: login.registrationOverlay };
    this.resize(login.width, login.height);
    this.cursor = new UICursor(this, resource);
    this.cursor.surface.element.setAttribute("aria-hidden", "true");
    this.installInput();
  }

  get visible() {
    return this.login.visible && !this.login.destroyed;
  }

  get suspended() {
    return !this.visible;
  }

  blocksGameplay() {
    return true;
  }

  modal() {
    const login = this.login;
    if (login.dialogs.open) return this.dialogPanel;
    if (!login.recovery.overlay.hidden) return this.recoveryPanel;
    if (!login.registrationOverlay.hidden) return this.registrationPanel;
    return null;
  }

  logicalPointer(event) {
    const rect = this.host.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  resize(width, height) {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.layoutGeneration++;
  }

  installInput() {
    const options = { signal: this.controller.signal, capture: true };
    window.addEventListener(
      "pointermove",
      (event) => this.cursor.move(event),
      options,
    );
    window.addEventListener(
      "pointerdown",
      (event) => {
        if (
          this.suspended ||
          event.button !== 0 ||
          !this.host.contains(event.target)
        ) {
          return;
        }
        this.cursor.move(event);
        this.cursor.press(event);
      },
      options,
    );
    window.addEventListener(
      "pointerup",
      (event) => {
        if (this.suspended) return;
        this.cursor.release(event);
        this.cursor.move(event);
      },
      options,
    );
    window.addEventListener("pointercancel", () => this.cancel(), options);
    // Only leaving the browser window cancels the cursor; text-field blur does not.
    window.addEventListener("blur", () => this.cancel(), {
      signal: this.controller.signal,
    });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) this.cancel();
      },
      options,
    );
  }

  cancel() {
    this.cursor.release();
    this.cursor.lastPointer = null;
    this.cursor.surface.root.visible = false;
    this.cursor.surface.element.hidden = true;
  }

  update(ms) {
    const modal = this.modal()?.element;
    if (
      modal !== this.modalElement ||
      this.pending !== this.login.pending ||
      this.stage !== this.login.stage
    ) {
      this.modalElement = modal;
      this.pending = this.login.pending;
      this.stage = this.login.stage;
      this.layoutGeneration++;
    }
    this.cursor.update(ms);
  }

  snapshot() {
    return {
      state: this.cursor.current,
      visible: this.cursor.surface.root.visible,
      x: this.cursor.surface.x,
      y: this.cursor.surface.y,
    };
  }

  destroy() {
    this.controller.abort();
    this.cursor.destroy();
    this.root.destroy({ children: true });
  }
}
