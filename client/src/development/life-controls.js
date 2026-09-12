import { showInspectionPanel } from "./inspection-theme.js";

const MAX_LIFE_RECORDS = 16384;
const MAX_LIFE_OPTIONS = 200;

/** Bounded DOM controls belong to the life preview, not original game chrome. */
function element(tag, text, parent) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  parent.append(node);
  return node;
}

export class LifeControls {
  constructor(system, records) {
    if (records.length > MAX_LIFE_RECORDS) {
      throw new Error(`Life inspection exceeds ${MAX_LIFE_RECORDS} placements`);
    }
    this.records = records;
    this.system = system;
    this.root = document.createElement("details");
    this.root.dataset.lifePreview = "";
    element("summary", "NPC & mob placement inspector", this.root);
    element(
      "p",
      "Original life metadata. These controls inspect only; eligible NPC world targets use normal dialogue interaction.",
      this.root,
    );
    this.buildSearch();
    this.placement = element("select", "", this.root);
    this.placement.setAttribute("aria-label", "Life metadata placement");
    this.placement.style.maxWidth = "100%";
    this.populatePlacements("");
    this.action = element("select", "", this.root);
    this.action.setAttribute(
      "aria-label",
      "Non-authoritative life action preview",
    );
    this.inspect = element("button", "Show placement geometry", this.root);
    this.inspect.type = "button";
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
    document.querySelector("#life-inspection").append(this.root);
    if (records.length) this.select();
  }
  buildSearch() {
    const label = element("label", "Find NPC / mob by name or ID", this.root);
    this.search = element("input", "", label);
    this.search.type = "search";
    this.search.maxLength = 120;
    this.search.placeholder = "Name, placement ID, npc or mob";
    this.count = element("p", "", this.root);
    this.count.setAttribute("role", "status");
  }

  populatePlacements(query, exactId = null) {
    const previous = this.placement.value;
    this.placement.replaceChildren();
    let count = 0;
    for (const slot of this.records) {
      if (exactId !== null && slot.record.id !== exactId) continue;
      const text = `${slot.record.kind} · ${slot.record.id} · ${slot.template.name ?? slot.template.originalId}`;
      if (!text.toLowerCase().includes(query)) continue;
      count++;
      if (count > MAX_LIFE_OPTIONS) continue;
      const option = element("option", text, this.placement);
      option.value = slot.record.id;
    }
    for (const option of this.placement.options) {
      if (option.value === previous) this.placement.value = previous;
    }
    this.count.textContent =
      count > MAX_LIFE_OPTIONS
        ? `${count} matches; showing first ${MAX_LIFE_OPTIONS}. Refine your search.`
        : `${count} matching placements.`;
  }

  searchPlacements() {
    this.populatePlacements(this.search.value.trim().toLowerCase());
    this.placement.disabled = !this.placement.options.length;
    this.inspect.disabled = this.placement.disabled;
    if (this.placement.disabled) {
      this.action.replaceChildren();
      this.action.disabled = true;
      this.status.textContent =
        "No placement matches. Clear or refine the search.";
      return;
    }
    this.select();
  }
  /** Register only once per owner; never from update or selection. */
  listen() {
    this.onSelection = this.select.bind(this);
    this.onAction = this.selectAction.bind(this);
    this.onInspect = this.inspectSelection.bind(this);
    this.onGeometry = this.toggleGeometry.bind(this);
    this.onHidden = this.toggleHidden.bind(this);
    this.onKey = this.stopKey.bind(this);
    this.onSearch = this.searchPlacements.bind(this);
    this.search.addEventListener("input", this.onSearch);
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
    this.status.textContent = `${slot.template.name ?? slot.template.originalId}; authored (${a.x}, ${a.y}), fh=${a.fh}, cy=${a.cy}, range=${a.rx0}..${a.rx1}. ${slot.contactStatus}. These controls inspect metadata only. Release the left mouse button over an eligible NPC world target to interact.`;
  }
  /** Mob clicks stay in nondamaging metadata inspection, never the NPC dialogue hook. */
  showSelection(id) {
    this.root.open = true;
    showInspectionPanel("world");
    this.search.value = id;
    this.populatePlacements(id.toLowerCase(), id);
    this.placement.disabled = false;
    this.inspect.disabled = false;
    this.placement.value = id;
    this.select();
    this.geometry.checked = true;
    this.system.showGeometry = true;
  }

  selectAction() {
    try {
      if (this.system.destroyed) {
        throw new Error("Life system has been disposed");
      }
      const result = this.system.setPreviewAction(
        this.placement.value,
        this.action.value,
      );
      this.status.textContent =
        result === false
          ? "Mob actions are controlled by offline combat; metadata preview cannot override them."
          : `NPC preview action: ${this.action.value}. No gameplay rewards or damage applied.`;
    } catch (error) {
      this.status.textContent = `Preview unavailable: ${error.message}`;
    }
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
    this.search.removeEventListener("input", this.onSearch);
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
