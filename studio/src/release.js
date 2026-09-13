import { element, button, empty } from "./dom.js";

export async function openRelease(app) {
  app.worldStatus = await app.api.get("world/status");
  app.show("release");
  renderRelease(app);
}

export function renderRelease(app) {
  const state = app.worldStatus;
  app.releaseHost.replaceChildren(
    releaseBanner(app),
    element("div", { class: "release-columns" }, [
      releaseSelection(app),
      activePanel(state),
    ]),
  );
}

function selectedRows(app) {
  const selected = element("div", { class: "release-selection" });
  for (const row of app.rows.filter((row) => row.status === "published")) {
    const checkbox = element("input", {
      type: "checkbox",
      checked: app.selected.has(row.id),
      "aria-label": `Release ${row.name}`,
      onchange: () => {
        if (checkbox.checked) {
          app.selected.set(row.id, { id: row.id, revision: row.revision });
        } else app.selected.delete(row.id);
        app.releaseOperation = null;
        renderRelease(app);
      },
    });
    selected.append(
      element("label", { class: "release-row" }, [
        checkbox,
        element("strong", { text: row.name }),
        element("small", { text: `${row.kind} · revision ${row.revision}` }),
      ]),
    );
  }
  if (!selected.childElementCount) {
    selected.append(
      empty(
        "Publish your first creation",
        "Saved drafts must be published before they can be included in a release.",
      ),
    );
  }
  return selected;
}

function releaseSelection(app) {
  const state = app.worldStatus;
  const activation = button(
    app.selected.size
      ? `Activate ${app.selected.size} selected creations`
      : "Deactivate custom content",
    () => app.run(() => activate(app)),
    "button primary",
  );
  activation.disabled =
    app.api.config.role !== "developer" || state.busy || state.players > 0;
  return element("section", { class: "release-panel" }, [
    element("h2", { text: "Build your next release" }),
    element("p", {
      text: "Choose published revisions to make available to every player. Referenced custom mobs and quests are included automatically. Each activation replaces the previous selection.",
    }),
    selectedRows(app),
    element("p", {
      class: "hint",
      text: `${app.selected.size} selected across project pages. Activation requires an idle world. Players reconnect to load the new release.`,
    }),
    activation,
    ...(app.api.config.role !== "developer"
      ? [
          element("p", {
            class: "hint",
            text: "A developer account is required to activate shared content.",
          }),
        ]
      : []),
  ]);
}

function activePanel(state) {
  const active = element("div", { class: "active-content" });
  for (const row of state.selection) {
    active.append(
      element("p", {
        text: `${row.name} · ${row.kind} · revision ${row.revision}`,
      }),
    );
  }
  return element("section", { class: "release-panel" }, [
    element("h2", { text: "Currently in the world" }),
    active,
    element("p", {
      class: "hint",
      text: "Active maps appear in the game’s Community maps menu. Quests are offered by their NPCs. Saved player locations and quest progress are protected when replacing a release.",
    }),
  ]);
}

function releaseBanner(app) {
  const state = app.worldStatus;
  return element("div", { class: "release-banner" }, [
    element("span", { class: "release-orb", text: "◉" }),
    element("div", {}, [
      element("p", { class: "eyebrow", text: "SHARED WORLD" }),
      element("h2", {
        text: state.generation
          ? `Release ${state.generation} is active`
          : "Your world is ready for something new",
      }),
      element("p", {
        text: `${state.players} players connected · ${state.selection.length} active creations`,
      }),
    ]),
    button("Refresh status", () => app.run(() => openRelease(app))),
  ]);
}

async function activate(app) {
  if (
    !app.selected.size &&
    !window.confirm(
      "Deactivate custom content in the shared world? Saved player locations and quest progress may prevent removal.",
    )
  ) {
    return;
  }
  app.releaseOperation ??= crypto.randomUUID();
  const release = {
    projectId: app.projectId,
    refs: [...app.selected.values()],
    expectedGeneration: app.worldStatus.generation,
    operationId: app.releaseOperation,
  };
  app.worldStatus = await app.api.post("world/activate", { release });
  app.releaseOperation = null;
  renderRelease(app);
  app.notice(
    `Shared-world release ${app.worldStatus.generation} is active. Open the game to explore it.`,
    "success",
  );
}
