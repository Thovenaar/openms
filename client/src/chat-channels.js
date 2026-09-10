import { HUD_CLIENT_Y } from "./ui-hud.js";

const MAX_CHANNELS = 8;
// 004c7068: eight 16px rows, 90px-wide popup at combo (x+1,y-129).
const ROW_HEIGHT = 16;

/** 008dfb36/004c4552: type1 uses Basic/ComboBox2; 008d3705 supplies list colors. */
export class ChatChannels {
  constructor(layer, labels, onChoose) {
    if (labels.length !== MAX_CHANNELS) {
      throw new Error("Invalid chat channel list");
    }
    this.labels = labels;
    this.onChoose = onChoose;
    this.layer = layer;
    this.index = 7;
    this.control = layer.button("ComboBox2", 1, HUD_CLIENT_Y + 515, {
      label: "Chat channel",
      action: this.toggle.bind(this),
    });
    this.element = this.control.element;
    this.element.setAttribute("aria-haspopup", "listbox");
    // 004c6b94 ->0098a707(0x22): white 11px Arial; native label offset x6/y3.
    this.element.style.cssText +=
      "padding:0 6px;text-align:left;white-space:nowrap;font:11px Arial,sans-serif;line-height:20px;color:#fff;";
    this.menu = document.createElement("div");
    this.menu.setAttribute("role", "listbox");
    this.menu.setAttribute("aria-label", "Chat channels");
    this.menu.style.cssText = `position:absolute;left:2px;top:${HUD_CLIENT_Y + 515 - ROW_HEIGHT * labels.length - 1}px;width:90px;height:${ROW_HEIGHT * labels.length + 1}px;box-sizing:border-box;overflow:hidden;background:#315573;border:1px solid #404040;pointer-events:auto;z-index:3;`;
    this.options = [];
    for (let index = 0; index < labels.length; index++) {
      const option = document.createElement("button");
      option.type = "button";
      option.setAttribute("role", "option");
      option.dataset.chatChannel = String(index);
      option.textContent = labels[index];
      option.style.cssText = `display:block;width:100%;height:${ROW_HEIGHT}px;box-sizing:border-box;border:0;border-bottom:1px solid #315573;padding:0 6px;text-align:left;white-space:nowrap;font:11px Arial,sans-serif;line-height:15px;color:#fff;`;
      this.menu.append(option);
      this.options.push(option);
    }
    layer.element.append(this.element, this.menu);
    layer.listen(this.menu, "click", this.choose.bind(this));
    layer.listen(document, "pointerdown", this.outside.bind(this));
    this.selectedIndex = 7;
    this.show(false);
  }

  get selectedIndex() {
    return this.index;
  }
  set selectedIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.labels.length) {
      throw new RangeError("Invalid chat channel");
    }
    this.index = index;
    this.element.textContent = this.labels[index];
    this.element.setAttribute(
      "aria-label",
      `Chat channel: ${this.labels[index]}`,
    );
    for (let entry = 0; entry < this.options.length; entry++) {
      this.options[entry].setAttribute(
        "aria-selected",
        String(entry === index),
      );
      this.options[entry].style.background =
        entry === index ? "#559ab9" : "#315573";
    }
  }

  show(visible) {
    if (!visible && this.menu.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    this.menu.hidden = !visible;
    this.element.setAttribute("aria-expanded", String(visible));
  }
  toggle() {
    this.layer.owner.hooks.clearInput();
    this.show(this.menu.hidden);
    if (!this.menu.hidden) this.options[this.index].focus();
  }
  choose(event) {
    const option = event.target.closest("[data-chat-channel]");
    if (!option || !this.menu.contains(option)) return;
    this.selectedIndex = Number(option.dataset.chatChannel);
    this.show(false);
    this.onChoose();
  }
  outside(event) {
    if (event.target !== this.element && !this.menu.contains(event.target)) {
      this.show(false);
    }
  }

  /** Keep dropdown focus out of movement/window-hotkey dispatch. */
  handle(event) {
    if (event.target !== this.element && !this.menu.contains(event.target)) {
      return false;
    }
    this.layer.owner.hooks.clearInput();
    event.stopImmediatePropagation();
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      this.show(false);
      this.onChoose();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const direction = event.key === "ArrowUp" ? -1 : 1;
      this.selectedIndex =
        (this.index + direction + this.labels.length) % this.labels.length;
      this.show(true);
      this.options[this.index].focus();
    }
    return true;
  }
}
