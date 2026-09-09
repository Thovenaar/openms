const HISTORY_LIMIT = 64;
const CHAT_LIMIT = 255;
const CHANNELS = [
  "To a buddy",
  "To Group",
  "To the party",
  "To the Guild",
  "To Alliance",
  "To Spouse",
  "Whisper",
  "To All",
];

/** 008d536c and 008dfb36: edit child is distinct from the log child. No offline server echo. */
export class UIChat {
  constructor(owner, panel) {
    this.owner = owner;
    this.panel = panel;
    this.state = 1;
    this.height = 70;
    this.history = [];
    this.historyIndex = 0;
    this.draft = "";
    this.log = panel.contentArea(4, 513, 566, 25);
    this.log.className = "maple-ui-chat-log";
    this.log.setAttribute("role", "log");
    this.log.setAttribute("aria-label", "Chat messages");
    this.log.style.pointerEvents = "none";
    this.layer = panel.layer("Chat input");
    this.layer.image("base/chatTarget", 1, 515);
    this.createInput();
    this.createSelector();
    this.maximum = panel.button("BtMax", 536, 519, {
      label: "Expand chat",
      action: () => {
        this.setState(3);
        this.input.focus();
      },
    });
    this.minimum = panel.button("BtMin", 536, 519, {
      label: "Minimize chat",
      action: () => this.close(),
    });
    this.resizeHighlight = panel.image("base/chat", 0, 434);
    this.resizeHighlight.container.visible = false;
    this.grip = panel.hit(
      "Resize chat",
      { x: 0, y: 435, width: 580, height: 10 },
      {
        pointerdown: (event) => this.beginResize(event),
        pointerenter: () => {
          this.resizeHighlight.container.visible = true;
          this.owner.cursor?.set(7);
        },
        pointerleave: () => {
          if (!this.resizeStart) this.resizeHighlight.container.visible = false;
        },
      },
    );
    panel.listen(this.grip, "pointerenter", () => this.owner.cursor?.set(7));
    this.grip.hidden = true;
    this.setState(1);
  }

  createInput() {
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.maxLength = CHAT_LIMIT;
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", "Chat message");
    this.input.style.cssText =
      "position:absolute;left:85px;top:520px;width:440px;height:12px;padding:0;border:0;outline:0;background:transparent;color:#000;font:11px Arial,sans-serif;line-height:12px;pointer-events:auto;user-select:text;";
    this.layer.element.append(this.input);
    this.layer.listen(this.input, "blur", () => {
      this.owner.hooks.clearInput();
    });
  }

  createSelector() {
    this.selector = document.createElement("select");
    this.selector.setAttribute("aria-label", "Chat channel");
    this.selector.style.cssText =
      "position:absolute;left:1px;top:515px;width:80px;height:20px;border:0;background:transparent;font:11px Arial,sans-serif;color:#000;";
    for (const name of CHANNELS) {
      const option = document.createElement("option");
      option.textContent = name;
      this.selector.append(option);
    }
    this.selector.selectedIndex = -1;
    this.layer.element.append(this.selector);
    this.layer.listen(this.selector, "change", () => this.input.focus());
  }

  setState(state) {
    this.state = state;
    const active = state !== 1;
    this.layer.root.visible = active;
    this.layer.element.hidden = !active;
    this.grip.hidden = state !== 3;
    this.maximum.setVisible(state !== 3);
    this.minimum.setVisible(state === 3);
    this.resizeHighlight.container.visible = false;
    this.resizeHighlight.setPosition(0, 504 - this.height);
    const top = state === 1 ? 513 : state === 2 ? 486 : 510 - this.height;
    const height = state === 3 ? this.height - 2 : 25;
    this.log.style.top = `${top}px`;
    this.log.style.height = `${height}px`;
    this.log.style.background = state === 3 ? "rgba(0,0,0,.45)" : "transparent";
    this.grip.style.top = `${504 - this.height}px`;
    this.owner.hooks.clearInput();
  }

  open() {
    this.setState(this.state === 3 ? 3 : 2);
    this.historyIndex = this.history.length;
    this.input.focus();
  }

  close(clear = false) {
    if (clear) this.input.value = "";
    this.setState(1);
    this.owner.hooks.focusGame();
  }

  handle(event) {
    if (event.target !== this.input) return false;
    event.stopImmediatePropagation();
    if (event.isComposing) return true;
    if (event.key === "Enter") {
      event.preventDefault();
      if (this.input.value) this.submit();
      else this.close();
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.close(true);
    } else if (
      (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
      !this.input.value
    ) {
      event.preventDefault();
      this.close();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      this.recall(event.key === "ArrowUp" ? -1 : 1);
    }
    return true;
  }

  submit() {
    if (this.history.length === HISTORY_LIMIT) this.history.shift();
    this.history.push(this.input.value);
    this.historyIndex = this.history.length;
    this.draft = "";
    this.input.value = "";
    this.owner.status("Chat was not sent: the original server is unavailable.");
    this.input.focus();
  }

  recall(direction) {
    if (this.historyIndex === this.history.length) {
      this.draft = this.input.value;
    }
    this.historyIndex = Math.max(
      0,
      Math.min(this.history.length, this.historyIndex + direction),
    );
    this.input.value =
      this.historyIndex === this.history.length
        ? this.draft
        : this.history[this.historyIndex];
    this.input.setSelectionRange(
      this.input.value.length,
      this.input.value.length,
    );
  }

  beginResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    this.resizeStart = { y: event.clientY, height: this.height };
  }

  move(event) {
    if (!this.resizeStart) return;
    const delta =
      (this.resizeStart.y - event.clientY) / this.owner.screenScaleY;
    if (Math.abs(delta) < 14) return;
    this.height = Math.max(
      26,
      Math.min(507, this.resizeStart.height + Math.trunc(delta / 13) * 13),
    );
    if (this.height % 13 === 0) this.height = Math.min(507, this.height + 2);
    this.setState(3);
  }

  endResize() {
    this.resizeStart = null;
    this.resizeHighlight.container.visible = false;
  }

  destroy() {
    this.layer.destroy();
    this.log.remove();
    this.grip.remove();
  }
}
