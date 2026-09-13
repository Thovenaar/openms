import { element, field, input, number, section, button } from "./dom.js";
import { spriteEditor } from "./sprites.js";

export function mobEditor(app) {
  const definition = app.draft.definition;
  const base = section(
    "Original base",
    [
      field(
        "Mob ID",
        input(
          definition.base.id,
          (id) => {
            definition.base.id = id;
            app.changed();
          },
          { "aria-label": "Base mob ID" },
        ),
      ),
      button("Load base mob", () => app.run(() => app.loadBase())),
    ],
    app.base?.template?.name ??
      "Choose a mob in the asset library and use it as the base.",
  );
  return [base, statEditor(app), artworkEditor(app)];
}

function statEditor(app) {
  const definition = app.draft.definition;
  const stats = element("div", { class: "form-grid" });
  for (const [key, label] of [
    ["maxHP", "HP"],
    ["maxMP", "MP"],
    ["level", "Level"],
    ["exp", "EXP reward"],
    ["PADamage", "Physical attack"],
    ["PDDamage", "Physical defense"],
    ["MADamage", "Magic attack"],
    ["MDDamage", "Magic defense"],
    ["acc", "Accuracy"],
    ["eva", "Avoidability"],
    ["pushed", "Knockback"],
    ["speed", "Speed adjustment"],
  ]) {
    stats.append(
      field(
        label,
        number(
          definition.stats[key],
          (value) => {
            if (value === undefined) delete definition.stats[key];
            else definition.stats[key] = value;
            app.changed();
          },
          { placeholder: String(app.base?.template?.info[key] ?? "Inherited") },
        ),
      ),
    );
  }
  return section(
    "Stats",
    [stats],
    "Leave a field blank to inherit its original value.",
  );
}

function artworkEditor(app) {
  const definition = app.draft.definition;
  const artwork = spriteEditor(app.api, app.draft, {
    changed: () => app.changed(),
    run: (work) => app.run(work),
    palette: (palette) => app.setPalette(palette),
  });
  if (definition.appearance) {
    artwork.append(
      button(
        "Restore original artwork",
        () => {
          delete definition.appearance;
          app.changed();
          app.renderEditor();
        },
        "button subtle",
      ),
    );
  }
  return artwork;
}
