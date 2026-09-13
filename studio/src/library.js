import { element, button, empty, field, input } from "./dom.js";

export function renderLibrary(app) {
  const create = element("div", { class: "creation-cards" });
  for (const [kind, glyph, title, description] of [
    ["map", "▧", "Create a map", "Give familiar places a new story."],
    ["mob", "♟", "Create a mob", "A familiar face. A new challenge."],
    ["quest", "◇", "Create a quest", "Turn an idea into an adventure."],
  ]) {
    create.append(
      element(
        "button",
        {
          class: `creation-card ${kind}`,
          onclick: () => app.run(() => app.create(kind)),
          type: "button",
        },
        [
          element("span", { class: "creation-glyph", text: glyph }),
          element("h2", { text: title }),
          element("p", { text: description }),
          element("span", { class: "create-arrow", text: "+" }),
        ],
      ),
    );
  }
  const rows = element("div", { class: "content-list" });
  for (const row of app.rows) rows.append(contentRow(app, row));
  if (!app.rows.length) {
    rows.append(
      empty(
        "An open canvas",
        "Your creations will appear here. Start with the original collection, add your own artwork, and make it yours.",
      ),
    );
  }
  app.libraryHost.replaceChildren(
    element("p", {
      class: "intro",
      text: "Build with the assets you love. Publish when you’re ready.",
    }),
    create,
    element("div", { class: "section-heading" }, [
      element("h2", { text: "In this project" }),
      button("Refresh", () => app.run(() => app.reload())),
    ]),
    rows,
    element("div", { class: "pagination" }, [
      button("Previous page", () => app.run(() => app.page(-1))),
      element("span", { text: `Page ${Math.floor(app.offset / 100) + 1}` }),
      button("Next page", () => app.run(() => app.page(1))),
    ]),
  );
  renderCustomPalette(app);
}

function contentRow(app, row) {
  return element(
    "article",
    { class: "content-row", "data-content-id": row.id },
    [
      element("span", {
        class: `asset-glyph ${row.kind}`,
        text: { map: "▧", mob: "♟", quest: "◇" }[row.kind],
      }),
      element("div", { class: "content-name" }, [
        element("strong", { text: row.name }),
        element("small", {
          text: `${row.kind} · ${row.id} · revision ${row.revision}`,
        }),
      ]),
      element("span", { class: `badge ${row.status}`, text: row.status }),
      button("Edit", () => app.run(() => app.edit(row))),
      ...(row.status === "published"
        ? [
            button("Add to release", () => {
              app.selected.set(row.id, { id: row.id, revision: row.revision });
              app.releaseOperation = null;
              app.notice(`${row.name} added to your release selection.`);
            }),
          ]
        : []),
    ],
  );
}

export function renderCustomPalette(app) {
  const choices = app.rows.filter(
    (row) => row.status === "published" && row.kind === "mob",
  );
  app.customHost.replaceChildren(
    element("h3", { text: "Your published mobs" }),
  );
  if (!choices.length) {
    app.customHost.append(
      element("p", {
        class: "hint",
        text: "Publish a mob to use it in maps and quest objectives.",
      }),
    );
  }
  for (const row of choices) {
    app.customHost.append(
      button(
        `${row.name} · r${row.revision}`,
        () =>
          app.setPalette({
            name: row.name,
            ref: {
              source: "custom",
              kind: "mob",
              id: row.id,
              revision: row.revision,
            },
          }),
        "button custom-asset",
      ),
    );
  }
}

export function documentToolbar(app) {
  if (!app.draft) {
    app.documentHost.replaceChildren();
    return;
  }
  const value = app.draft;
  app.saveState = element("span", {
    class: "save-state",
    text: app.dirty
      ? "Unsaved changes"
      : `Saved · revision ${value.expectedRevision}`,
  });
  const name = input(
    value.name,
    (next) => {
      value.name = next;
      if (!value.expectedRevision && !app.manualId) {
        value.id = next
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 64);
        id.value = value.id;
      }
      app.changed();
    },
    {
      "aria-label": "Creation name",
      placeholder: "Name your creation",
      maxLength: 160,
    },
  );
  const id = input(
    value.id,
    (next) => {
      value.id = next;
      app.manualId = true;
      app.changed();
    },
    {
      "aria-label": "Content ID",
      placeholder: "content-id",
      disabled: value.expectedRevision > 0,
      maxLength: 64,
    },
  );
  app.documentHost.replaceChildren(
    element("span", { class: "badge", text: value.kind }),
    field("Name", name),
    field("ID", id),
    app.saveState,
    button("Update preview", () => app.run(() => app.updatePreview())),
    button("Save draft", () => app.run(() => app.save())),
    button(
      "Publish revision",
      () => app.run(() => app.publish()),
      "button primary",
    ),
  );
}
