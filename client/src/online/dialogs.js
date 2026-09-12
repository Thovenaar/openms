const MAX_QUEUE = 4;

function element(tag, className, text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

/** Windows 95 style modal dialogs owned by one host element.
 *
 * The login surface has no page-level alert(); every failure or confirmation opens a
 * modal window here. One dialog is visible at a time and extra messages wait in a
 * bounded queue, so a transport failure cannot erase a confirmation the player is
 * still reading. Callers never receive a resolved promise while another dialog is up. */
export class OnlineDialogs {
  constructor(host) {
    if (!host) throw new Error("Dialogs require a host element");
    this.host = host;
    this.controller = new AbortController();
    this.queue = [];
    this.current = null;
    this.overlay = element("div", "online-dialog-overlay");
    this.overlay.hidden = true;
    this.window = element("div", "maple95-window online-dialog");
    const titlebar = element("header", "maple95-titlebar");
    this.title = element("span", "maple95-title", "");
    this.close = element("button", "maple95-dialog-close", "×");
    this.close.type = "button";
    this.close.setAttribute("aria-label", "Close dialog");
    titlebar.append(this.title, this.close);
    this.body = element("div", "maple95-body");
    this.text = element("p", "online-dialog-text", "");
    const actions = element("div", "online-dialog-actions");
    // Button fields stay distinct from the confirm()/message() methods they serve.
    this.cancelButton = element(
      "button",
      "maple95-button online-dialog-cancel",
      "Cancel",
    );
    this.confirmButton = element(
      "button",
      "maple95-button primary online-dialog-confirm",
      "OK",
    );
    for (const button of [this.cancelButton, this.confirmButton]) {
      button.type = "button";
    }
    actions.append(this.cancelButton, this.confirmButton);
    this.body.append(this.text, actions);
    this.window.append(titlebar, this.body);
    this.overlay.append(this.window);
    host.append(this.overlay);
    const options = { signal: this.controller.signal };
    this.close.addEventListener("click", () => this.settle(false), options);
    this.cancelButton.addEventListener(
      "click",
      () => this.settle(false),
      options,
    );
    this.confirmButton.addEventListener(
      "click",
      () => this.settle(true),
      options,
    );
    this.overlay.addEventListener(
      "keydown",
      (event) => this.onKey(event),
      options,
    );
  }

  /** Information dialog with a single acknowledgement. Resolves once it is dismissed. */
  message({ title = "MapleStory", text, ok = "OK" }) {
    return this.enqueue({ title, text, ok, cancel: null });
  }

  /** Confirmation dialog; resolves true only for the affirmative action. */
  confirm({ title = "MapleStory", text, confirm, cancel = "Cancel" }) {
    return this.enqueue({ title, text, ok: confirm, cancel });
  }

  enqueue(request) {
    if (this.controller.signal.aborted) return Promise.resolve(false);
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    return new Promise((resolve) => {
      this.queue.push({ ...request, resolve });
      this.showNext();
    });
  }

  showNext() {
    if (this.current || !this.queue.length) return;
    const request = this.queue.shift();
    this.current = request;
    this.title.textContent = request.title;
    this.text.textContent = request.text;
    this.confirmButton.textContent = request.ok;
    this.cancelButton.textContent = request.cancel ?? "";
    this.cancelButton.hidden = request.cancel === null;
    this.previousFocus = document.activeElement;
    this.overlay.hidden = false;
    this.host.dataset.dialog = "open";
    this.host.setAttribute("aria-busy", "true");
    this.confirmButton.focus();
  }

  /** Only the visible dialog settles; a queued request keeps waiting for its turn. */
  settle(accepted) {
    const request = this.current;
    if (!request) return;
    this.current = null;
    this.overlay.hidden = true;
    delete this.host.dataset.dialog;
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
    else this.host.focus();
    this.previousFocus = null;
    this.showNext();
    if (!this.current) this.host.setAttribute("aria-busy", "false");
    request.resolve(request.cancel === null ? true : accepted);
  }

  /** Escape cancels; Enter accepts. Focus never leaves the modal window. */
  onKey(event) {
    if (!this.current) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.settle(false);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      this.settle(true);
      return;
    }
    if (event.key === "Tab") {
      const controls = [this.confirmButton, this.cancelButton].filter(
        (node) => !node.hidden,
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  get open() {
    return this.current !== null || this.queue.length > 0;
  }

  destroy() {
    this.controller.abort();
    for (const request of this.queue) request.resolve(false);
    this.queue.length = 0;
    this.current = null;
    this.overlay.remove();
  }
}
