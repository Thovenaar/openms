import { element, button, input, field, empty } from "./dom.js";

function createSidebar(app) {
  return element("aside", { class: "sidebar" }, [
    element("a", { class: "brand", href: "/studio/" }, [
      element("span", { class: "brand-mark", text: "✦" }),
      element("span", { text: "OpenMS", class: "brand-name" }),
      element("small", { text: "STUDIO" }),
    ]),
    element("p", { class: "nav-label", text: "WORKSPACE" }),
    button("▦  My creations", () => app.show("library"), "nav-button"),
    button("✎  Workbench", () => app.show("editor"), "nav-button"),
    button(
      "◉  Shared world",
      () => app.run(() => app.openRelease()),
      "nav-button",
    ),
    element("div", { class: "sidebar-bottom" }, [
      element("p", { text: "A little imagination.\nA whole new adventure." }),
      element("a", {
        href: app.api.settings.clientUrl,
        target: "_blank",
        rel: "noopener",
        text: "Open game ↗",
      }),
      button("Sign out", () => app.run(() => app.signOut()), "nav-button"),
    ]),
  ]);
}

export function createShell(app) {
  const sidebar = createSidebar(app);
  app.heading = element("h1", { text: "My creations" });
  app.message = element("div", {
    class: "notice",
    role: "status",
    "aria-live": "polite",
    text: "Your original assets are ready to explore.",
  });
  app.libraryHost = element("section", { class: "library-view" });
  app.releaseHost = element("section", { class: "release-view", hidden: true });
  const workbench = createWorkbench(app);
  app.views = {
    library: app.libraryHost,
    editor: workbench,
    release: app.releaseHost,
  };
  const project = input(app.projectId, () => {}, {
    "aria-label": "Project ID",
    maxLength: 64,
  });
  project.addEventListener("change", () =>
    app.run(() => app.changeProject(project.value)),
  );
  app.root.replaceChildren(
    element("div", { class: "studio-shell" }, [
      sidebar,
      element("main", { class: "main" }, [
        element("header", { class: "page-header" }, [
          element("div", {}, [
            element("p", {
              class: "eyebrow",
              text: "MAKE SOMETHING WORTH EXPLORING",
            }),
            app.heading,
          ]),
          field("Project", project),
        ]),
        app.message,
        app.libraryHost,
        workbench,
        app.releaseHost,
      ]),
    ]),
  );
}

function createWorkbench(app) {
  app.assetsHost = element("aside", { class: "asset-browser" });
  app.editorHost = element("aside", { class: "properties" });
  app.canvasHost = element("div", { class: "preview-canvas" });
  app.previewTitle = element("strong", { text: "Scene preview" });
  app.paletteHost = element("div", {
    class: "palette",
    text: "Select an asset to start building.",
  });
  app.documentHost = element("div", { class: "document-toolbar" });
  app.customHost = element("div", { class: "custom-palette" });
  app.previewHint = element("p", {
    class: "preview-hint",
    text: "Drag to pan · choose a tool to place assets",
  });
  app.inspectionHost = element("div", {
    class: "asset-inspection",
    hidden: true,
  });
  const center = element("div", { class: "preview-column" }, [
    element("div", { class: "preview-heading" }, [
      app.previewTitle,
      element("span", { class: "badge", text: "LIVE PREVIEW" }),
    ]),
    app.canvasHost,
    app.previewHint,
    app.paletteHost,
    app.inspectionHost,
  ]);
  app.editorHost.append(
    empty(
      "Choose a creation",
      "Open a saved creation or start with a new map, mob, or quest.",
    ),
  );
  return element("section", { class: "workbench-view", hidden: true }, [
    app.documentHost,
    element("div", { class: "workbench" }, [
      element("div", { class: "library-column" }, [
        app.customHost,
        app.assetsHost,
      ]),
      center,
      app.editorHost,
    ]),
  ]);
}
