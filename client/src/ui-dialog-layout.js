import { NativeScrollbar } from "./ui-scrollbar.js";

const MAX_BODY = 240;
const MIN_BODY = 120;
const TEXT_WIDTH = 341;
const TEXT_STEP = 8;
const MAX_TILES = 256;
const MAX_LOGICAL_BODY = 4096; // Browser resource bound for the native unbounded input variants.
const BUTTONS = [
  ["back", "BtPrev", "Previous"],
  ["next", "BtNext", "Next"],
  ["yes", "BtYes", "Yes"],
  ["no", "BtNo", "No"],
  ["accept", "BtQYes", "Accept"],
  ["decline", "BtQNo", "Decline"],
  ["ok", "BtOK", "OK"],
  ["close", "BtClose", "Close dialogue"],
];

/** CUtilDlgEx 009acc20/009acd54. Measurements are browser Arial metrics, not Windows rasterization. */
export function dialogGeometry(
  textHeight,
  kind,
  speaker = 0,
  viewportHeight = Infinity,
) {
  const input = kind === "number" || kind === "text";
  const measured = Math.ceil(textHeight) + (kind === "choice" ? 24 : 0);
  let body = Math.max(MIN_BODY, measured);
  if (!input && Math.trunc((measured - MAX_BODY) / TEXT_STEP) > 1) {
    body = MAX_BODY;
  }
  // Containment only: native inputs have no maximum. Preserve all text with the native scroll control.
  body = Math.min(
    body,
    MAX_LOGICAL_BODY,
    Math.max(MIN_BODY, Math.floor(viewportHeight - 86)),
  );
  const scrolling = measured > body;
  const right = (speaker & 2) !== 0;
  const position = textPosition({ input, right, scrolling, body, measured });
  return {
    width: 529,
    height: body + 86,
    body,
    measured,
    scrolling,
    right,
    x: position.x,
    y: position.y,
    textWidth: TEXT_WIDTH,
    textHeight: Math.max(
      1,
      Math.min(textHeight, body - (input ? 20 : kind === "choice" ? 24 : 0)),
    ),
  };
}

function textPosition({ input, right, scrolling, body, measured }) {
  return {
    x: input ? 157 : (right ? 25 : 157) - (scrolling ? 2 : 0),
    y:
      28 +
      (scrolling ? -6 : Math.trunc((body - measured - (input ? 20 : 6)) / 2)),
  };
}

function resize(surface, width, height) {
  surface.width = width;
  surface.height = height;
  surface.element.style.width = `${width}px`;
  surface.element.style.height = `${height}px`;
}

/** One replacement lease for chrome, controls, scroll events and DOM. Never owns an authority/save. */
export class NativeDialogLayout {
  constructor(panel) {
    this.panel = panel;
    this.original = {
      content: panel.content,
      width: panel.width,
      height: panel.height,
      nativeClose: panel.nativeClose,
      closeVisible: panel.dialogClose?.visible,
      sprites: panel.sprites.map((sprite) => [
        sprite,
        sprite.container.visible,
      ]),
    };
    panel.nativeClose = true;
    panel.dialogClose?.setVisible(false);
    for (const sprite of panel.sprites) sprite.container.visible = false;
    this.original.content.hidden = true;
    this.layer = panel.layer("Native NPC dialogue");
    this.bodyLayer = this.layer.layer("Clipped dialogue prose");
    this.content = this.bodyLayer.contentArea(157, 28, TEXT_WIDTH, MIN_BODY);
    this.content.style.cssText +=
      ";overflow:hidden;font:12px/18px Arial,sans-serif;color:#000;white-space:pre-wrap;overflow-wrap:break-word;";
    this.prose = document.createElement("div");
    this.prose.style.position = "relative";
    this.content.append(this.prose);
    panel.content = this.prose;
    this.controls = {};
    for (const [key, asset, label] of BUTTONS) {
      this.controls[key] = this.layer.button(`UtilDlgEx/${asset}`, 0, 0, {
        label,
        action: null,
      });
      this.controls[key].setVisible(false);
    }
    this.error = this.layer.text("", 104, 0, { width: 306 });
    this.error.setAttribute("role", "status");
    this.error.style.cssText +=
      ";font:11px/12px Arial,sans-serif;color:#a00000;white-space:normal;pointer-events:auto;";
    this.error.style.cssText += ";height:24px;overflow:hidden;";
    this.layer.listen(this.prose, "pointerover", (event) =>
      this.choiceEvent(event),
    );
    this.layer.listen(this.prose, "focusin", (event) =>
      this.choiceEvent(event),
    );
    this.layer.listen(this.prose, "click", (event) => this.choiceEvent(event));
  }

  reflow(kind = "say", speaker = 0, reset = false) {
    const position = reset ? 0 : (this.scroll?.position ?? 0);
    this.content.style.height = "auto";
    this.prose.style.width = `${TEXT_WIDTH}px`;
    const textHeight = this.prose.scrollHeight;
    const owner = this.panel.owner;
    const height = Number.isFinite(owner.viewportHeight / owner.scale)
      ? owner.viewportHeight / owner.scale
      : Infinity;
    const geometry = dialogGeometry(textHeight, kind, speaker, height);
    this.geometry = geometry;
    resize(this.panel, geometry.width, geometry.height);
    resize(this.layer, geometry.width, geometry.height);
    resize(this.bodyLayer, geometry.width, geometry.height);
    this.chrome?.destroy();
    this.drawChrome(geometry);
    this.placeBody(geometry, position);
    this.placeControls(geometry);
    this.error.style.top = `${geometry.height - 27}px`;
    if (Number.isFinite(this.panel.x) && Number.isFinite(this.panel.y)) {
      owner.positionWindow?.(this.panel, this.panel.x, this.panel.y);
    }
    this.panel.renderArtwork();
    return geometry;
  }

  drawChrome(geometry) {
    const { body, width, height } = geometry;
    const top = this.panel.assets["UtilDlgEx/t"];
    const middle = this.panel.assets["UtilDlgEx/c"];
    const bottom = this.panel.assets["UtilDlgEx/s"];
    if (
      top?.width !== width ||
      middle?.width !== width ||
      bottom?.width !== width ||
      !(middle.height > 0)
    ) {
      throw new Error(
        "Original UtilDlgEx chrome metadata is missing or incompatible",
      );
    }
    const count = Math.ceil(body / middle.height);
    if (count > MAX_TILES) {
      throw new Error("Dialogue exceeds chrome tile bound");
    }
    this.chrome = this.layer.layer("Original dialogue border");
    this.chrome.root.zIndex = -1;
    this.layer.root.sortableChildren = true;
    this.chrome.image("UtilDlgEx/t", 0, 0);
    const tiles = this.chrome.layer("Clipped original middle slices");
    tiles.root.rasterClip = { x: 0, y: top.height, width, height: body };
    for (let index = 0; index < count; index++) {
      tiles.image("UtilDlgEx/c", 0, top.height + index * middle.height);
    }
    this.chrome.image("UtilDlgEx/s", 0, height - bottom.height);
  }

  placeBody(geometry, position) {
    const { x, y, textWidth, textHeight, scrolling, body } = geometry;
    this.content.style.left = `${x}px`;
    this.content.style.top = `${y}px`;
    this.content.style.width = `${textWidth}px`;
    this.content.style.height = `${textHeight}px`;
    this.bodyLayer.root.rasterClip = {
      x,
      y,
      width: textWidth,
      height: textHeight,
    };
    this.scrollRegion?.destroy();
    this.scrollRegion = this.layer.layer("Dialogue scroll input");
    this.scrollRegion.listen(this.content, "wheel", (event) =>
      this.scroll.wheel(event),
    );
    this.scroll = new NativeScrollbar(
      this.scrollRegion,
      { x: x + textWidth - 3, y: y + 2, extent: body + 3, style: 3 },
      (value) => {
        this.content.scrollTop = value * TEXT_STEP;
      },
    );
    const overflow = Math.max(0, this.prose.scrollHeight - textHeight);
    this.scroll.setRange(
      Math.max(1, Math.ceil(overflow / TEXT_STEP) + 1),
      position,
    );
    this.scroll.setVisible(scrolling || overflow > 0);
    this.content.scrollTop = this.scroll.position * TEXT_STEP;
    this.prose.style.width = `${textWidth}px`;
  }

  placeControls({ width, height, scrolling, right }) {
    // 009a7c8b: navigation is on the upper footer shelf; OK/close are on its lower border.
    const edge = width - (right ? 140 : 10) - (scrolling ? 8 : 0);
    this.controls.back.position(edge - 122, height - 77);
    this.controls.next.position(edge - 68, height - 77);
    this.controls.ok.position(width - 54, height - 26);
    this.controls.close.position(9, height - 26);
    this.controls.yes.position(width - 108, height - 26);
    this.controls.no.position(width - 54, height - 26);
    this.controls.accept.position(width - 130, height - 26);
    this.controls.decline.position(width - 65, height - 26);
  }

  hideControls() {
    for (const control of Object.values(this.controls)) {
      control.setVisible(false);
      control.options.action = null;
    }
  }

  show(key, action, disabled = false) {
    const control = this.controls[key];
    control.options.action = action;
    control.setDisabled(disabled);
    control.setVisible(true);
  }

  choiceEvent(event) {
    const button = event.target.closest?.("button");
    if (!button || !this.prose.contains(button) || button.disabled) return;
    if (event.type === "click") {
      if (event.detail > 0) this.panel.owner.sound("BtMouseClick");
      return;
    }
    if (event.type === "pointerover" && !button.contains(event.relatedTarget)) {
      this.panel.owner.sound("BtMouseOver");
    }
    if (event.type !== "focusin" || !this.scroll) return;
    this.scrollChoiceIntoView(button);
  }

  scrollChoiceIntoView(button) {
    const top = button.offsetTop,
      bottom = top + button.offsetHeight;
    if (top < this.content.scrollTop) {
      this.scroll.setPosition(Math.floor(top / TEXT_STEP));
    } else if (bottom > this.content.scrollTop + this.content.clientHeight) {
      this.scroll.setPosition(
        Math.ceil((bottom - this.content.clientHeight) / TEXT_STEP),
      );
    }
  }

  setPending(pending) {
    this.layer.element.setAttribute("aria-busy", String(pending));
    for (const control of Object.values(this.controls)) {
      control.setDisabled(pending);
    }
    for (const control of this.prose.querySelectorAll(
      "button,input,textarea,select",
    )) {
      control.disabled = pending;
    }
    if (this.input) this.input.disabled = pending;
    if (this.scrollRegion) this.scrollRegion.element.inert = pending;
  }

  setError(reason = "") {
    this.error.textContent = reason;
    this.error.title = reason;
  }

  destroy() {
    this.layer.destroy();
    this.panel.content = this.original.content;
    this.original.content.hidden = false;
    resize(this.panel, this.original.width, this.original.height);
    this.panel.nativeClose = this.original.nativeClose;
    for (const [sprite, visible] of this.original.sprites) {
      sprite.container.visible = visible;
    }
    this.panel.dialogClose?.setVisible(this.original.closeVisible);
    this.panel.renderArtwork();
  }
}
