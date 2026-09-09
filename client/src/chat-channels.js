import { HUD_CLIENT_Y } from "./ui-hud.js";

const MAX_CHANNELS = 8;
const ROW_HEIGHT = 20;

/** Original recipient strings sit over base/chatTarget; dropdown chrome is browser policy. */
export class ChatChannels {
  constructor(layer, labels, onChoose) {
    if (labels.length !== MAX_CHANNELS) {
      throw new Error("Invalid chat channel list");
    }
    this.labels = labels;
    this.onChoose = onChoose;
    this.index = 7;
    this.element = document.createElement("button");
    this.element.type = "button";
    this.element.setAttribute("aria-label", "Chat channel");
    this.element.setAttribute("aria-haspopup", "listbox");
    this.element.style.cssText = `position:absolute;left:1px;top:${HUD_CLIENT_Y + 515}px;width:80px;height:20px;border:0;padding:0 13px 0 4px;background:transparent;text-align:left;white-space:nowrap;font:11px Arial,sans-serif;color:#000;`;
    this.menu = document.createElement("div");
    this.menu.setAttribute("role", "listbox");
    this.menu.setAttribute("aria-label", "Chat channels");
    this.menu.style.cssText = `position:absolute;left:1px;top:${HUD_CLIENT_Y + 515 - ROW_HEIGHT * labels.length - 2}px;width:110px;background:white;border:1px solid #315573;pointer-events:auto;z-index:3;`;
    this.options = [];
    for (let index = 0; index < labels.length; index++) {
      const option = document.createElement("button");
      option.type = "button";
      option.setAttribute("role", "option");
      option.dataset.chatChannel = String(index);
      option.textContent = labels[index];
      option.style.cssText = `display:block;width:100%;height:${ROW_HEIGHT}px;border:0;padding:0 4px;text-align:left;font:12px Arial,sans-serif;color:#000;`;
      this.menu.append(option);
      this.options.push(option);
    }
    layer.element.append(this.element, this.menu);
    layer.listen(this.element, "click", this.toggle.bind(this));
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
    this.element.title = this.labels[index];
    for (let entry = 0; entry < this.options.length; entry++) {
      this.options[entry].setAttribute(
        "aria-selected",
        String(entry === index),
      );
      this.options[entry].style.background =
        entry === index ? "#cce2f4" : "transparent";
    }
  }

  show(visible) {
    this.menu.hidden = !visible;
    this.element.setAttribute("aria-expanded", String(visible));
  }
  toggle() {
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
