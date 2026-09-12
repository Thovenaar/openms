const MAX_REFERENCES = 1000;

/** Preview metadata uses the same verified, bounded cache as other resources. */
export class HitboxInspector {
  constructor(network) {
    this.network = network;
    this.controller = null;
    this.identity = null;
    this.data = null;
    this.selected = null;
    this.context = null;
  }

  async load(descriptor) {
    if (!descriptor) {
      throw new Error("Original hitbox references are not packaged");
    }
    if (this.identity === descriptor.sha256 && this.data) return this.data;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const data = await this.network.json(descriptor, controller.signal);
    if (controller.signal.aborted) {
      throw new DOMException("Hitbox preview cancelled", "AbortError");
    }
    validateReferences(data);
    this.identity = descriptor.sha256;
    this.data = data;
    this.select("");
    const select = document.querySelector("#hitbox-reference");
    select.replaceChildren(new Option("Live player receiver only", ""));
    for (const reference of data.references) {
      select.add(new Option(reference.label, reference.id));
    }
    select.disabled = false;
    return data;
  }

  select(id) {
    this.selected = null;
    this.context = null;
    if (!id) return;
    const reference = this.data?.references.find((item) => item.id === id);
    if (!reference) throw new Error(`Unknown original hitbox reference ${id}`);
    this.selected = {
      id: reference.id,
      label: reference.label,
      activationKnown: false,
    };
    this.context = {};
    for (const key of ["attack", "body", "damage"]) {
      if (reference.context[key]) {
        this.context[key] = { ...reference.context[key] };
      }
    }
  }

  destroy() {
    this.controller?.abort();
    this.data = null;
    this.context = null;
  }
}

/** Validate dispatch and collection boundaries; the geometry module validates shapes. */
function validateReferences(data) {
  if (
    data.schemaVersion !== 1 ||
    data.mode !== "original-geometry-preview" ||
    data.activationKnown !== false
  ) {
    throw new Error("Unsupported hitbox reference manifest");
  }
  if (
    !Array.isArray(data.references) ||
    data.references.length > MAX_REFERENCES
  ) {
    throw new Error("Hitbox reference count exceeds policy");
  }
  const ids = new Set();
  for (const reference of data.references) {
    validateReference(reference, ids);
    ids.add(reference.id);
  }
}

function validateReference(reference, ids) {
  if (
    typeof reference.id !== "string" ||
    !reference.id ||
    reference.id.length > 256 ||
    ids.has(reference.id)
  ) {
    throw new Error("Invalid hitbox reference identity");
  }
  if (
    typeof reference.label !== "string" ||
    reference.label.length > 1024 ||
    !reference.context
  ) {
    throw new Error("Invalid hitbox reference metadata");
  }
}
