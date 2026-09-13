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

export function button(text, action, className = "button") {
  const node = element("button", {
    type: "button",
    class: className,
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
    element("span", { text: label }),
    control,
    ...(hint ? [element("small", { text: hint })] : []),
  ]);
}

export function input(value, update, options = {}) {
  return element("input", {
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

export function select(value, choices, update) {
  const node = element(
    "select",
    { onchange: (event) => update(event.target.value) },
    choices.map(([id, label]) => element("option", { value: id, text: label })),
  );
  node.value = String(value);
  return node;
}

export function section(title, children, hint = "") {
  return element("section", { class: "editor-section" }, [
    element("h3", { text: title }),
    ...(hint ? [element("p", { class: "hint", text: hint })] : []),
    ...children,
  ]);
}

export function empty(title, description) {
  return element("div", { class: "empty-state" }, [
    element("div", { class: "empty-icon", text: "✦" }),
    element("h3", { text: title }),
    element("p", { text: description }),
  ]);
}
