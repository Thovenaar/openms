/** Construct trusted controls; authored names/dialogue are always text nodes. */
export function element(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

const BUTTON_VARIANTS = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  danger: "btn-danger",
  subtle: "btn-ghost-secondary",
};

export function button(text, action, variant = "primary") {
  const tokens = variant.split(" ").filter(Boolean);
  const classes = tokens.map((token) => BUTTON_VARIANTS[token] ?? token);
  const node = element("button", {
    type: "button",
    class: `btn ${classes.join(" ")}`,
    text,
    onclick: async (event) => {
      try {
        await action(event);
      } catch (error) {
        node.dispatchEvent(
          new CustomEvent("studio-error", { bubbles: true, detail: error }),
        );
      }
    },
  });
  return node;
}

export function field(label, control, hint = "") {
  return element("label", { class: "field" }, [
    element("span", { class: "form-label", text: label }),
    control,
    ...(hint ? [element("small", { class: "form-hint", text: hint })] : []),
  ]);
}

export function input(value, update, options = {}) {
  return element("input", {
    class: "form-control",
    value: value ?? "",
    ...options,
    oninput: (event) => update(event.target.value),
  });
}

export function number(value, update, options = {}) {
  return input(
    value,
    (next) => update(next === "" ? undefined : Number(next)),
    { type: "number", step: 1, ...options },
  );
}

export function text(value, update, options = {}) {
  return element("textarea", {
    class: "form-control",
    value: value ?? "",
    rows: 3,
    maxLength: 512,
    ...options,
    oninput: (event) => update(event.target.value),
  });
}

export function select(value, choices, update, options = {}) {
  const node = element(
    "select",
    {
      class: "form-select",
      ...options,
      onchange: (event) => update(event.target.value),
    },
    choices.map(([id, label]) => element("option", { value: id, text: label })),
  );
  node.value = String(value);
  return node;
}

export function checkbox(label, checked, update) {
  return element("label", { class: "form-check" }, [
    element("input", {
      class: "form-check-input",
      type: "checkbox",
      checked: Boolean(checked),
      onchange: (event) => update(event.target.checked),
    }),
    element("span", { class: "form-check-label", text: label }),
  ]);
}

export function section(title, children, hint = "") {
  return element("section", { class: "card editor-section" }, [
    element("div", { class: "card-header" }, [
      element("h3", { class: "card-title", text: title }),
    ]),
    element("div", { class: "card-body" }, [
      ...(hint ? [element("p", { class: "hint", text: hint })] : []),
      ...children,
    ]),
  ]);
}

export function table(headings, rows) {
  return element("div", { class: "table-responsive" }, [
    element("table", { class: "table table-sm table-vcenter" }, [
      element("thead", {}, [
        element(
          "tr",
          {},
          headings.map((heading) => element("th", { text: heading })),
        ),
      ]),
      element("tbody", {}, rows.flat()),
    ]),
  ]);
}

export function empty(title, description) {
  return element("div", { class: "empty" }, [
    element("div", { class: "empty-icon", text: "✦" }),
    element("p", { class: "empty-title", text: title }),
    element("p", { class: "empty-subtitle text-secondary", text: description }),
  ]);
}
