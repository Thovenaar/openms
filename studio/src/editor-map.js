import {
  element,
  field,
  input,
  number,
  section,
  button,
  select,
} from "./dom.js";
import { spriteEditor } from "./sprites.js";

export function mapEditor(app) {
  const definition = app.draft.definition;
  const base = section(
    "Original base",
    [
      field(
        "Map ID",
        input(
          definition.base.id,
          (id) => {
            definition.base.id = id;
            app.changed();
          },
          { "aria-label": "Base map ID" },
        ),
      ),
      button("Load base map", () => app.run(() => app.loadBase())),
    ],
    "The original map stays intact. Your changes are stored separately.",
  );
  const modes = element("div", { class: "tool-grid" });
  for (const [mode, label] of [
    ["pan", "↔ Pan"],
    ["spawn", "♟ Spawn mob"],
    ["decoration", "✦ Decoration"],
    ["platform", "╱ Platform"],
    ["ladder", "≡ Ladder"],
  ]) {
    modes.append(
      button(label, () => {
        app.preview.mode = mode;
        app.notice(
          `Tool: ${label}. ${mode === "platform" || mode === "ladder" ? "Drag from start to end." : "Click the map to place the selected asset."}`,
        );
      }),
    );
  }
  return [
    base,
    section("Build on the canvas", [
      modes,
      element("p", {
        class: "hint",
        text: "Choose an asset, then click to place it. Drag in Pan mode to move around. Orange markers are mob spawns; blue markers are decorations.",
      }),
    ]),
    section("Your placements", [placementList(app, definition)]),
    section("Original placements", [originalPlacements(app)]),
    spriteEditor(app.api, app.draft, {
      changed: () => app.changed(),
      run: (work) => app.run(work),
      palette: (palette) => app.setPalette(palette),
    }),
    geometryEditor(app),
  ];
}

function placementList(app, definition) {
  let offset = 0;
  const rows = element("div"),
    label = element("p", { class: "hint" });
  const redraw = () => {
    const entries = [
      ...definition.spawns.map((row) => ({
        row,
        list: definition.spawns,
        type: "Mob",
      })),
      ...definition.entities.map((row) => ({
        row,
        list: definition.entities,
        type: "Decoration",
      })),
    ];
    label.textContent = `${entries.length} added · showing ${offset + 1}–${Math.min(entries.length, offset + 20)}`;
    rows.replaceChildren(
      ...entries.slice(offset, offset + 20).map(({ row, list, type }) =>
        placement(app, row, type, () => {
          list.splice(list.indexOf(row), 1);
          redraw();
          app.changed();
        }),
      ),
    );
  };
  redraw();
  return element("div", {}, [
    label,
    rows,
    element("div", { class: "pagination" }, [
      button("Previous", () => {
        offset = Math.max(0, offset - 20);
        redraw();
      }),
      button("Next", () => {
        offset += 20;
        redraw();
      }),
    ]),
  ]);
}

function placement(app, row, type, remove) {
  return element("div", { class: "placement-row" }, [
    element("strong", { text: `${type} · ${row.id}` }),
    element("div", { class: "form-grid" }, [
      field(
        "X",
        number(row.x, (value) => {
          row.x = value;
          app.changed();
        }),
      ),
      field(
        "Y",
        number(row.y, (value) => {
          row.y = value;
          app.changed();
        }),
      ),
    ]),
    ...(type === "Decoration"
      ? [
          field(
            "Depth",
            number(row.z, (value) => {
              row.z = value;
              app.changed();
            }),
          ),
          field(
            "Flip",
            select(
              String(row.flip),
              [
                ["false", "No"],
                ["true", "Yes"],
              ],
              (value) => {
                row.flip = value === "true";
                app.changed();
              },
            ),
          ),
        ]
      : [
          field(
            "Foothold",
            number(row.foothold, (value) => {
              row.foothold = value;
              app.changed();
            }),
          ),
        ]),
    button("Focus", () => app.focus(row)),
    button("Remove", remove, "danger"),
  ]);
}

function originalPlacements(app) {
  const box = element("div");
  const source = app.base?.manifest;
  if (!source) {
    return element("p", {
      class: "hint",
      text: "Load a base map to browse its placements.",
    });
  }
  const mobs = source.life.placements.filter((row) => row.kind === "mob");
  box.append(
    element("p", {
      class: "hint",
      text: `${mobs.length} inherited mob spawns. Check a spawn to remove it from this map.`,
    }),
  );
  for (const row of mobs.slice(0, 100)) {
    const removed = app.draft.definition.removeSpawns ?? [];
    box.append(
      field(
        row.id,
        element("input", {
          type: "checkbox",
          checked: removed.includes(row.id),
          onchange: (event) => {
            app.draft.definition.removeSpawns = event.target.checked
              ? [...removed.filter((id) => id !== row.id), row.id]
              : removed.filter((id) => id !== row.id);
            app.changed();
            app.renderEditor();
          },
        }),
      ),
    );
  }
  if (mobs.length > 100) {
    box.append(
      element("p", {
        class: "hint",
        text: "The first 100 spawns are shown here. Use the definition editor below for the full removal list.",
      }),
    );
  }
  box.append(
    button("Remove selected original scenery", () => {
      if (
        app.palette?.ref?.kind !== "entity" ||
        app.palette.ref.mapId !== source.id
      ) {
        throw new Error(
          "Select scenery from this base map in the asset browser.",
        );
      }
      const ids = (app.draft.definition.removeEntities ??= []);
      if (!ids.includes(app.palette.ref.id)) ids.push(app.palette.ref.id);
      app.changed();
    }),
  );
  return box;
}

function geometryEditor(app) {
  const definition = app.draft.definition;
  const bounds = element("div", { class: "form-grid" });
  for (const side of ["left", "top", "right", "bottom"]) {
    bounds.append(
      field(
        side,
        number(
          definition.bounds?.[side],
          (value) => {
            definition.bounds ??= structuredClone(app.base.manifest.bounds);
            definition.bounds[side] = value;
            app.changed();
          },
          {
            placeholder: String(
              app.base?.manifest?.bounds[side] ?? "Inherited",
            ),
          },
        ),
      ),
    );
  }
  return section(
    "Geometry",
    [
      bounds,
      button("Restore original geometry", () => {
        delete definition.bounds;
        delete definition.footholds;
        delete definition.ladders;
        app.changed();
        app.renderEditor();
      }),
    ],
    "New platforms and ladders use the canvas drag tools. All coordinates are world pixels.",
  );
}
