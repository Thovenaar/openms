function node(tag, className, text = "") {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

/** UI-only recovery form. No account lookup, email submission or success claim. */
export class AccountRecovery {
  constructor(login) {
    this.login = login;
    this.controller = new AbortController();
    this.overlay = node("div", "online-registration-overlay");
    this.overlay.hidden = true;
    this.window = node("section", "online-registration inspection-chrome");
    this.window.setAttribute("role", "dialog");
    this.window.setAttribute("aria-modal", "true");
    this.window.setAttribute("aria-label", "Recover your account");
    const header = node("header", "online-registration-titlebar");
    const close = node("button", "online-registration-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close account recovery");
    header.append(node("span", "", "Recover your account"), close);
    this.form = this.buildForm();
    this.window.append(header, this.form);
    this.overlay.append(this.window);
    login.host.append(this.overlay);
    const options = { signal: this.controller.signal };
    close.addEventListener("click", () => this.close(), options);
    this.form.addEventListener(
      "submit",
      (event) => this.submit(event),
      options,
    );
    this.overlay.addEventListener(
      "keydown",
      (event) => this.key(event),
      options,
    );
  }

  buildForm() {
    const form = node("form", "online-registration-form");
    form.append(
      node(
        "p",
        "online-registration-instructions",
        "Enter the email address associated with your account. Email recovery is not available yet.",
      ),
    );
    const label = node("label", "online-login-row");
    this.email = node("input", "");
    this.email.type = "email";
    this.email.required = true;
    this.email.maxLength = 254;
    this.email.autocomplete = "email";
    this.email.setAttribute("aria-label", "Recovery email address");
    label.append(node("span", "", "Email address"), this.email);
    this.status = node("p", "online-registration-status");
    this.status.setAttribute("role", "status");
    const actions = node("div", "online-registration-actions");
    const submit = node("button", "", "Continue");
    submit.type = "submit";
    actions.append(submit);
    form.append(label, this.status, actions);
    return form;
  }

  open() {
    const login = this.login;
    if (
      login.pending ||
      login.stage !== "account" ||
      login.dialogs.open ||
      !login.registrationOverlay.hidden
    ) {
      return;
    }
    this.previousFocus = document.activeElement;
    login.window.inert = true;
    this.overlay.hidden = false;
    this.email.focus();
  }

  submit(event) {
    event.preventDefault();
    if (!this.form.reportValidity()) return;
    this.status.textContent =
      "Email recovery is coming soon. No email has been sent. Please contact the server administrator for help.";
  }

  key(event) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
    } else if (event.key === "Tab") {
      const controls = [...this.window.querySelectorAll("button,input")];
      const index = controls.indexOf(document.activeElement);
      event.preventDefault();
      controls[
        (index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length
      ].focus();
    }
  }

  close() {
    this.overlay.hidden = true;
    this.login.window.inert = false;
    this.email.value = "";
    this.status.textContent = "";
    this.previousFocus?.focus();
  }

  destroy() {
    this.close();
    this.controller.abort();
    this.overlay.remove();
  }
}
