/** Bounded DOM controls belong to the life preview, not original game chrome. */
function element(tag, text, parent) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  parent.append(node);
  return node;
}

export class LifeControls {
  constructor(system, records) {
    this.system = system;
    this.root = document.createElement("details");
    this.root.dataset.lifePreview = "";
    element("summary", "Life metadata and previews", this.root);
    element(
      "p",
      "Original life metadata. Mobs use explicit offline-local combat policy; NPC actions are inspection previews.",
      this.root,
    );
    this.placement = element("select", "", this.root);
    this.placement.setAttribute("aria-label", "Life metadata placement");
    this.placement.style.maxWidth = "100%";
    for (const slot of records) {
      const option = element(
        "option",
        `${slot.record.id} ${slot.template.name ?? slot.template.originalId}`,
        this.placement,
      );
      option.value = slot.record.id;
    }
    this.action = element("select", "", this.root);
    this.action.setAttribute(
      "aria-label",
      "Non-authoritative life action preview",
    );
    this.inspect = element("button", "Inspect / server boundary", this.root);
    this.inspect.disabled = records.length === 0;
    this.action.disabled = records.length === 0;
    this.placement.disabled = records.length === 0;
    const label = element("label", "", this.root);
    label.className = "check";
    this.geometry = element("input", "", label);
    this.geometry.type = "checkbox";
    label.append(" Body, interaction and foothold geometry");
    const hiddenLabel = element("label", "", this.root);
    hiddenLabel.className = "check";
    this.hidden = element("input", "", hiddenLabel);
    this.hidden.type = "checkbox";
    hiddenLabel.append(" Reveal authored hidden placements");
    this.status = element("p", "", this.root);
    this.status.setAttribute("role", "status");
    this.listen();
    document.querySelector("#inspection-controls").append(this.root);
    if (records.length) this.select();
  }
  /** Register only once per owner; never from update or selection. */
  listen() {
    this.onSelection = this.select.bind(this);
    this.onAction = this.selectAction.bind(this);
    this.onInspect = this.inspectSelection.bind(this);
    this.onGeometry = this.toggleGeometry.bind(this);
    this.onHidden = this.toggleHidden.bind(this);
    this.onKey = this.stopKey.bind(this);
    this.placement.addEventListener("change", this.onSelection);
    this.action.addEventListener("change", this.onAction);
    this.inspect.addEventListener("click", this.onInspect);
    this.geometry.addEventListener("change", this.onGeometry);
    this.hidden.addEventListener("change", this.onHidden);
    this.root.addEventListener("keydown", this.onKey);
    this.root.addEventListener("keyup", this.onKey);
  }

  select() {
    this.system.select(this.placement.value);
    const slot = this.system.selected;
    this.action.replaceChildren();
    for (const name of Object.keys(slot.template.actions)) {
      const option = element("option", name, this.action);
      option.value = name;
    }
    this.action.value = slot.action;
    this.action.disabled = slot.record.kind === "mob" || !slot.action;
    const a = slot.record.authored;
    this.status.textContent = `${slot.template.name ?? slot.template.originalId}; authored (${a.x}, ${a.y}), fh=${a.fh}, cy=${a.cy}, range=${a.rx0}..${a.rx1}. ${slot.contactStatus}. Click artwork to inspect; NPC requests stop at the server boundary.`;
  }
  /** Mob clicks stay in nondamaging metadata inspection, never the NPC dialogue hook. */
  showSelection(id) {
    this.root.open = true;
    this.placement.value = id;
    this.select();
    this.geometry.checked = true;
    this.system.showGeometry = true;
  }

  selectAction() {
    this.system.setPreviewAction(this.placement.value, this.action.value);
  }

  inspectSelection() {
    this.system.interact(this.placement.value);
  }

  toggleGeometry() {
    this.system.showGeometry = this.geometry.checked;
  }

  toggleHidden() {
    this.system.revealHidden = this.hidden.checked;
  }

  stopKey(event) {
    event.stopPropagation();
  }

  destroy() {
    this.placement.removeEventListener("change", this.onSelection);
    this.action.removeEventListener("change", this.onAction);
    this.inspect.removeEventListener("click", this.onInspect);
    this.geometry.removeEventListener("change", this.onGeometry);
    this.hidden.removeEventListener("change", this.onHidden);
    this.root.removeEventListener("keydown", this.onKey);
    this.root.removeEventListener("keyup", this.onKey);
    this.root.remove();
  }
}
