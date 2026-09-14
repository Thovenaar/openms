import { StudioAPI } from "./api.js";
import { loginScreen } from "./auth.js";
import { StudioPreview } from "./preview.js";
import { AssetBrowser } from "./assets.js";
import { createShell } from "./shell.js";
import { renderLibrary, documentToolbar } from "./library.js";
import { openRelease } from "./release.js";
import { newDocument, editDocument, addPlacement, original } from "./models.js";
import { mapEditor } from "./editor-map.js";
import { mobEditor } from "./editor-mob.js";
import { questEditor } from "./editor-quest.js";
import { dropsEditor } from "./editor-drops.js";
import { dialogueEditor } from "./editor-dialogue.js";
import { element, button, empty } from "./dom.js";
import { decodeJson } from "../../shared/json.js";

/** The account owns revisions; this controller owns only the current unsaved edit and preview. */
class Studio {
  constructor(root) {
    this.root = root;
    this.api = new StudioAPI();
    this.projectId = "my-world";
    this.rows = [];
    this.offset = 0;
    this.selected = new Map();
    this.draft = null;
    this.dirty = false;
    this.pending = false;
    this.root.addEventListener("studio-error", (event) =>
      this.notice(event.detail.message, "error"),
    );
    window.addEventListener("beforeunload", (event) => {
      if (this.dirty) event.preventDefault();
    });
    window.addEventListener("error", (event) =>
      this.notice(event.message, "error"),
    );
    window.addEventListener("unhandledrejection", (event) =>
      this.notice(
        event.reason?.message ?? "Studio could not complete this action.",
        "error",
      ),
    );
  }

  async start() {
    await this.api.bootstrap();
    if (!this.api.config.role) {
      this.root.replaceChildren(loginScreen(this.api, () => this.mount()));
      return;
    }
    await this.mount();
  }

  async mount() {
    createShell(this);
    this.preview = new StudioPreview(this.canvasHost, {
      place: (mode, start, end) => this.run(() => this.place(mode, start, end)),
      error: (error) => this.notice(error.message, "error"),
    });
    await this.preview.ready;
    this.assets = new AssetBrowser(
      this.assetsHost,
      this.api,
      (row) => this.run(() => this.choose(row)),
      (error) => this.notice(error.message, "error"),
    );
    await this.reload();
    await this.assets.search();
  }

  async run(work) {
    if (this.pending) return;
    this.pending = true;
    this.root.inert = true;
    this.root.setAttribute("aria-busy", "true");
    try {
      await work();
    } catch (error) {
      this.notice(error.message, "error");
    } finally {
      this.pending = false;
      this.root.inert = false;
      this.root.removeAttribute("aria-busy");
    }
  }

  notice(text, type = "info") {
    if (!this.message) {
      this.root.textContent = text;
      return;
    }
    this.message.textContent = text;
    this.message.className = `notice ${type}`;
  }

  show(view) {
    for (const [key, node] of Object.entries(this.views)) {
      node.hidden = key !== view;
    }
    this.heading.textContent = {
      library: "My creations",
      editor: "Workbench",
      release: "Shared world",
    }[view];
    if (view === "editor") this.preview.resize();
  }

  async reload() {
    this.rows = await this.api.post("list", {
      projectId: this.projectId,
      offset: this.offset,
      limit: 100,
    });
    renderLibrary(this);
  }

  async page(direction) {
    if (direction > 0 && this.rows.length < 100) return;
    this.offset = Math.max(0, Math.min(4000, this.offset + direction * 100));
    await this.reload();
  }

  async changeProject(id) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) {
      throw new Error(
        "Use a project ID of 1–64 letters, numbers, dashes, or underscores.",
      );
    }
    if (!this.discard()) return;
    this.projectId = id;
    this.offset = 0;
    this.selected.clear();
    this.releaseOperation = null;
    this.draft = null;
    this.dirty = false;
    this.preview.clear();
    documentToolbar(this);
    this.renderEditor();
    await this.reload();
    this.show("library");
  }

  discard() {
    return (
      !this.dirty ||
      window.confirm("Discard the unsaved changes to this creation?")
    );
  }

  async create(kind) {
    if (!this.discard()) return;
    this.draft = newDocument(
      kind,
      this.projectId,
      this.api.config.assetBuildId,
    );
    this.row = null;
    this.base = null;
    this.dirty = true;
    this.manualId = false;
    this.show("editor");
    documentToolbar(this);
    this.renderEditor();
    await this.loadBase();
  }

  async edit(row) {
    if (!this.discard()) return;
    this.row = await this.api.get(
      `revisions/${encodeURIComponent(row.projectId)}/${encodeURIComponent(row.id)}/${row.revision}`,
    );
    this.draft = editDocument(this.row);
    this.base = null;
    this.dirty = false;
    this.manualId = true;
    this.show("editor");
    documentToolbar(this);
    this.renderEditor();
    await this.loadBase();
  }

  changed() {
    this.dirty = true;
    this.draft.operationId = crypto.randomUUID();
    if (this.saveState) this.saveState.textContent = "Unsaved changes";
    this.preview.definition =
      this.draft.kind === "map" ? this.draft.definition : null;
    this.preview.drawGeometry();
  }

  renderEditor() {
    if (!this.draft) {
      this.editorHost.replaceChildren(
        empty("Choose a creation", "Start in My creations."),
      );
      return;
    }
    const editors = {
      map: mapEditor,
      mob: mobEditor,
      quest: questEditor,
      drops: dropsEditor,
      dialogue: dialogueEditor,
    };
    if (this.draft.kind === "dialogue") this.refreshNpcLabel();
    this.editorHost.replaceChildren(
      ...editors[this.draft.kind](this),
      this.definitionEditor(),
    );
  }

  definitionEditor() {
    const text = element("textarea", {
      class: "definition-json",
      value: JSON.stringify(this.draft.definition, null, 2),
      maxLength: 1048576,
      "aria-label": "Advanced definition JSON",
      spellcheck: false,
    });
    return element("details", { class: "advanced-editor" }, [
      element("summary", { text: "Advanced definition" }),
      element("p", {
        class: "hint",
        text: "For precise edits. Apply validates the definition and refreshes the preview before replacing your edit.",
      }),
      text,
      button("Apply definition", () =>
        this.run(async () => {
          const definition = decodeJson(text.value, {
            maxBytes: 1048576,
            maxNodes: 100000,
            maxDepth: 32,
          });
          const candidate = {
            ...this.draft,
            definition,
            operationId: crypto.randomUUID(),
          };
          const runtime = await this.api.post("preview", {
            content: candidate,
          });
          this.draft = candidate;
          this.changed();
          this.renderEditor();
          await this.showRuntime(runtime);
        }),
      ),
    ]);
  }

  async loadBase() {
    const definition = this.draft.definition;
    if (this.draft.kind === "quest") {
      await this.preview.ready;
      this.preview.clear();
      this.previewTitle.textContent = "Quest dialogue and objectives";
      this.previewHint.textContent =
        "Set the quest giver, objectives, rewards, and dialogue in the editor.";
      return;
    }
    if (this.draft.kind === "dialogue") {
      await this.preview.ready;
      this.preview.clear();
      this.previewTitle.textContent = this.draft.name || "NPC conversation";
      this.previewHint.textContent =
        "Each node is a message with replies. The player view shows the first path through it.";
      return;
    }
    let base;
    try {
      base = await this.api.resolve(definition.base ?? definition.target);
    } catch (error) {
      if (["map", "mob"].includes(this.draft.kind)) throw error;
      this.preview.clear();
      this.previewTitle.textContent = this.draft.name || "No artwork to show";
      this.previewHint.textContent =
        "This subject has no preview in the loaded world; the edit still applies to it.";
      this.base = null;
      this.renderEditor();
      return;
    }
    this.previewTitle.textContent = this.draft.name || "Original asset preview";
    if (this.draft.kind === "map") {
      this.assets.mapId = definition.base.id;
      await this.preview.map(base.manifest, definition);
    } else {
      if (this.draft.kind === "drops") {
        this.previewHint.textContent =
          "Rows apply when a player kills this monster. Conditions use the killer's class, level and the current time.";
      }
      await this.preview.visual(base.visual);
    }
    this.base = base;
    this.renderEditor();
  }

  async updatePreview() {
    const runtime = await this.api.post("preview", { content: this.draft });
    await this.showRuntime(runtime);
    this.notice("Preview updated. Your draft is valid.", "success");
  }

  async showRuntime(runtime) {
    this.previewTitle.textContent = this.draft.name;
    if (runtime.kind === "map") {
      await this.preview.map(
        runtime.manifest,
        this.draft.definition,
        runtime.resources,
      );
    }
    if (runtime.kind === "mob") await this.preview.visual(runtime.visual);
    if (runtime.kind === "quest") {
      this.previewHint.textContent = `“${runtime.record.stages[0].say.pages[0].text}”`;
    }
    if (runtime.kind === "drops") {
      this.previewHint.textContent = `${runtime.rows.length} drop rows · ${
        runtime.mode === "replace"
          ? "replacing the original table"
          : "added to the original table"
      }`;
    }
    if (runtime.kind === "dialogue") {
      this.previewHint.textContent = `${runtime.nodes.length} nodes · starts at node ${runtime.start}`;
    }
  }

  /** Asset names are decoration for the editors; failures stay silent. */
  async resolveName(ref) {
    try {
      const asset = await this.api.resolve(ref);
      return asset.record?.name ?? asset.descriptor?.name ?? null;
    } catch {
      return null;
    }
  }

  async refreshNpcLabel() {
    const target = this.draft.definition.target;
    const key = `${target.source}:${target.id}:${target.mapId ?? ""}`;
    if (this.npcLabelKey === key) return;
    this.npcLabelKey = key;
    this.npcLabel = "";
    const name = await this.resolveName(target);
    if (name && this.draft?.kind === "dialogue") {
      this.npcLabel = `${name} · ${target.id}`;
      this.renderEditor();
    }
  }

  async save() {
    if (!this.dirty && this.row) {
      this.notice("This revision is already saved.");
      return;
    }
    const row = await this.api.post("save", { content: this.draft });
    this.row = row;
    this.draft = editDocument(row);
    this.dirty = false;
    this.manualId = true;
    documentToolbar(this);
    this.renderEditor();
    await this.reload();
    this.notice(`${row.name} saved as revision ${row.revision}.`, "success");
  }

  async publish() {
    if (this.dirty || !this.row) await this.save();
    this.row = await this.api.post("publish", {
      ref: {
        projectId: this.projectId,
        id: this.row.id,
        revision: this.row.revision,
      },
    });
    this.selected.set(this.row.id, {
      id: this.row.id,
      revision: this.row.revision,
    });
    this.releaseOperation = null;
    await this.reload();
    this.notice(
      `${this.row.name} published and added to your release selection. Activate it in Shared world when ready.`,
      "success",
    );
  }

  setPalette(value) {
    this.palette = value;
    this.paletteHost.replaceChildren(
      element("span", { class: "eyebrow", text: "SELECTED ASSET" }),
      element("strong", {
        text: value.name ?? value.ref?.id ?? "Uploaded artwork",
      }),
    );
    this.notice(
      `${value.name ?? "Asset"} selected. Use it in a placement or quest objective.`,
    );
  }

  async choose(row) {
    const ref = original(row.kind, row.id, row.mapId);
    this.setPalette({ ref, name: row.name });
    this.inspectionHost.hidden = false;
    this.inspectionHost.replaceChildren(
      element("p", { text: `${row.name} · ${row.kind} ${row.id}` }),
    );
    if (["map", "mob"].includes(row.kind)) {
      this.inspectionHost.append(
        button("Use as base", () =>
          this.run(async () => {
            if (this.draft?.kind !== row.kind) await this.create(row.kind);
            if (this.draft?.kind !== row.kind) return;
            this.draft.definition.base = ref;
            this.changed();
            await this.loadBase();
          }),
        ),
      );
    }
    if (this.draft?.kind === "map") return;
    const asset = await this.api.resolve(ref);
    if (asset.visual) await this.preview.visual(asset.visual);
    else if (asset.manifest) await this.preview.map(asset.manifest);
    else {
      this.inspectionHost.append(
        element("pre", {
          text: JSON.stringify(
            asset.record ?? asset.descriptor ?? { id: row.id },
            null,
            2,
          ).slice(0, 12000),
        }),
      );
    }
  }

  place(mode, start, end) {
    if (this.draft?.kind !== "map" || !this.base) {
      throw new Error("Open a map first.");
    }
    addPlacement(this.draft.definition, this.base.manifest, {
      mode,
      start,
      end,
      palette: this.palette,
    });
    this.changed();
    this.renderEditor();
    this.notice("Placement added. Update preview to see compiled artwork.");
  }

  focus(row) {
    if (!this.preview.scene) return;
    this.preview.scene.camera.x = row.x - this.preview.view.width / 2;
    this.preview.scene.camera.y = row.y - this.preview.view.height / 2;
  }

  openRelease() {
    return openRelease(this);
  }

  async signOut() {
    if (!this.discard()) return;
    await this.api.request("/api/v1/session", {
      method: "DELETE",
      headers: { "X-CSRF-Token": this.api.config.csrfToken },
    });
    this.dirty = false;
    this.preview.destroy();
    location.reload();
  }
}

const app = new Studio(document.querySelector("#app"));
app.start().catch((error) => app.notice(error.message, "error"));
