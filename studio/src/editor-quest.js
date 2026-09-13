import {
  element,
  field,
  input,
  number,
  select,
  button,
  section,
} from "./dom.js";
import { original } from "./models.js";

export function questEditor(app) {
  const value = app.draft.definition;
  return [
    section("Quest givers", [
      npcEditor(app, "Start NPC", value.startNpc),
      npcEditor(app, "Finish NPC", value.endNpc),
    ]),
    section("Requirements", [
      element("div", { class: "form-grid" }, [
        field(
          "Minimum level",
          number(
            value.minLevel,
            (next) => {
              value.minLevel = next;
              app.changed();
            },
            { min: 1, max: 200 },
          ),
        ),
        field(
          "Maximum level",
          number(
            value.maxLevel,
            (next) => {
              value.maxLevel = next;
              app.changed();
            },
            { min: 1, max: 200 },
          ),
        ),
      ]),
      referenceList(app, value.prerequisites, "quest", "Completed quests"),
    ]),
    section("Objectives", [objectives(app)]),
    section("Rewards", [rewards(app)]),
    section("Dialogue", dialogue(app)),
  ];
}

function npcEditor(app, label, ref) {
  const choices = element("select", {
    "aria-label": `${label} choices`,
    onchange: (event) => {
      ref.id = event.target.value;
      app.changed();
      app.renderEditor();
    },
  });
  const load = async () => {
    const { manifest } = await app.api.resolve(original("map", ref.mapId));
    const templates = Object.values(manifest.life.templates).filter(
      (row) => row.kind === "npc",
    );
    choices.replaceChildren(
      ...templates.map((row) =>
        element("option", {
          value: String(Number(row.originalId)),
          text: `${row.name} · ${Number(row.originalId)}`,
        }),
      ),
    );
    choices.value = ref.id;
  };
  return element("div", { class: "npc-editor" }, [
    element("strong", { text: label }),
    field(
      "Source map ID",
      input(ref.mapId, (value) => {
        ref.mapId = value;
        app.changed();
      }),
    ),
    field(
      "NPC ID",
      input(ref.id, (value) => {
        ref.id = value;
        app.changed();
      }),
    ),
    button("Browse NPCs in map", () => app.run(load)),
    choices,
  ]);
}

function objectives(app) {
  const values = app.draft.definition.objectives;
  const rows = values.map((row, index) =>
    element("div", { class: "objective-row" }, [
      select(
        row.kind,
        [
          ["kill", "Defeat mobs"],
          ["collect", "Collect items"],
        ],
        (kind) => {
          row.kind = kind;
          row.target = original(
            kind === "kill" ? "mob" : "item",
            kind === "kill" ? 100101 : 2000000,
          );
          app.changed();
          app.renderEditor();
        },
      ),
      ...targetControls(app, row.target, row.kind === "kill" ? "mob" : "item"),
      field(
        "Required count",
        number(
          row.count,
          (next) => {
            row.count = next;
            app.changed();
          },
          { min: 1, max: 9999 },
        ),
      ),
      button(
        "Remove objective",
        () => {
          values.splice(index, 1);
          app.changed();
          app.renderEditor();
        },
        "button danger subtle",
      ),
    ]),
  );
  return element("div", {}, [
    ...rows,
    button("Add objective", () => {
      if (values.length >= 64) {
        throw new Error("A quest supports at most 64 objectives.");
      }
      const ref =
        app.palette?.ref?.kind === "mob"
          ? structuredClone(app.palette.ref)
          : original("mob", 100101);
      values.push({ kind: "kill", target: ref, count: 1 });
      app.changed();
      app.renderEditor();
    }),
  ]);
}

function targetControls(app, ref, kind) {
  const sources =
    kind === "item"
      ? [["original", "Original item"]]
      : [
          ["original", `Original ${kind}`],
          ["custom", `Custom ${kind}`],
        ];
  return [
    field(
      "Source",
      select(ref.source, sources, (source) => {
        ref.source = source;
        if (source === "custom") ref.revision = 1;
        else delete ref.revision;
        app.changed();
        app.renderEditor();
      }),
    ),
    field(
      "Asset ID",
      input(ref.id, (id) => {
        ref.id = id;
        app.changed();
      }),
    ),
    ...(ref.source === "custom"
      ? [
          field(
            "Published revision",
            number(
              ref.revision,
              (next) => {
                ref.revision = next;
                app.changed();
              },
              { min: 1 },
            ),
          ),
        ]
      : []),
  ];
}

function referenceList(app, values, kind, label) {
  const rows = values.map((ref, index) =>
    element("div", { class: "objective-row" }, [
      ...targetControls(app, ref, kind),
      button("Remove prerequisite", () => {
        values.splice(index, 1);
        app.changed();
        app.renderEditor();
      }),
    ]),
  );
  return element("div", {}, [
    element("h4", { text: label }),
    ...rows,
    button("Add prerequisite", () => {
      if (values.length >= 64) throw new Error("Prerequisite limit reached");
      values.push(original(kind, "1000"));
      app.changed();
      app.renderEditor();
    }),
  ]);
}

function rewards(app) {
  const rewards = app.draft.definition.rewards;
  return element("div", {}, [
    element("div", { class: "form-grid" }, [
      field(
        "EXP",
        number(
          rewards.exp,
          (value) => {
            rewards.exp = value;
            app.changed();
          },
          { min: 0 },
        ),
      ),
      field(
        "Mesos",
        number(
          rewards.meso,
          (value) => {
            rewards.meso = value;
            app.changed();
          },
          { min: 0 },
        ),
      ),
    ]),
    ...rewards.items.map((row, index) => rewardRow(app, row, index)),
    button("Add item reward", () => {
      if (rewards.items.length >= 64) throw new Error("Reward limit reached");
      rewards.items.push({
        item: original(
          "item",
          app.palette?.ref?.kind === "item" ? app.palette.ref.id : 2000000,
        ),
        count: 1,
      });
      app.changed();
      app.renderEditor();
    }),
  ]);
}

function rewardRow(app, row, index) {
  const rewards = app.draft.definition.rewards;
  return element("div", { class: "reward-row" }, [
    field(
      "Item ID",
      input(row.item.id, (value) => {
        row.item.id = value;
        app.changed();
      }),
    ),
    field(
      "Count",
      number(
        row.count,
        (value) => {
          row.count = value;
          app.changed();
        },
        { min: 1, max: 9999 },
      ),
    ),
    button("Remove reward", () => {
      rewards.items.splice(index, 1);
      app.changed();
      app.renderEditor();
    }),
  ]);
}

function dialogue(app) {
  return Object.entries(app.draft.definition.dialogue).map(([key, value]) =>
    field(
      key[0].toUpperCase() + key.slice(1),
      element("textarea", {
        value,
        rows: 3,
        maxLength: 4096,
        oninput: (event) => {
          app.draft.definition.dialogue[key] = event.target.value;
          app.changed();
        },
      }),
    ),
  );
}
