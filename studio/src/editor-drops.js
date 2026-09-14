import {
  element,
  field,
  input,
  number,
  select,
  button,
  section,
  table,
} from "./dom.js";
import { original } from "./models.js";

/** MapleStory v83 explorer job ids; a condition matches the character's exact job id. */
const JOBS = [
  [0, "Beginner"],
  [100, "Warrior"],
  [110, "Fighter"],
  [111, "Crusader"],
  [112, "Hero"],
  [120, "Page"],
  [121, "White Knight"],
  [122, "Paladin"],
  [130, "Spearman"],
  [131, "Dragon Knight"],
  [132, "Dark Knight"],
  [200, "Magician"],
  [210, "F/P Wizard"],
  [211, "F/P Mage"],
  [212, "F/P Archmage"],
  [220, "I/L Wizard"],
  [221, "I/L Mage"],
  [222, "I/L Archmage"],
  [230, "Cleric"],
  [231, "Priest"],
  [232, "Bishop"],
  [300, "Bowman"],
  [310, "Hunter"],
  [311, "Ranger"],
  [312, "Bow Master"],
  [320, "Crossbowman"],
  [321, "Sniper"],
  [322, "Crossbow Master"],
  [400, "Rogue"],
  [410, "Assassin"],
  [411, "Hermit"],
  [412, "Night Lord"],
  [420, "Bandit"],
  [421, "Chief Bandit"],
  [422, "Shadower"],
  [500, "Pirate"],
  [510, "Brawler"],
  [511, "Marauder"],
  [512, "Buccaneer"],
  [520, "Gunslinger"],
  [521, "Outlaw"],
  [522, "Corsair"],
];

const MAX_ROWS = 64;
const itemNames = new Map();

export function dropsEditor(app) {
  const value = app.draft.definition;
  return [
    targetSection(app, value),
    rowsSection(app, value),
    element("p", {
      class: "hint",
      text: "Conditional rows are checked on the server with the killing character's class, level and the current time.",
    }),
  ];
}

function targetSection(app, value) {
  const ref = value.target;
  return section(
    "Monster",
    [
      element("div", { class: "form-grid" }, targetFields(app, value, ref)),
      button("Use the monster selected in the asset library", () => {
        if (app.palette?.ref?.kind !== "mob") {
          throw new Error("Select a monster in the asset library first.");
        }
        value.target = {
          source: "original",
          kind: "mob",
          id: app.palette.ref.id,
        };
        app.changed();
        app.renderEditor();
        app.notice("Drop table now targets the selected monster.");
      }),
    ],
    ref.source === "original"
      ? "Drops apply to a monster's kills. Add conditions to limit a row by time window, class or level."
      : "Custom monsters use the published revision of your own creation.",
  );
}

function targetFields(app, value, ref) {
  return [
    field(
      "Drop table",
      select(
        value.mode,
        [
          ["merge", "Keep the original drops and add mine"],
          ["replace", "Replace the original drops"],
        ],
        (mode) => {
          value.mode = mode;
          app.changed();
        },
      ),
    ),
    field(
      "Source",
      select(
        ref.source,
        [
          ["original", "Original monster"],
          ["custom", "Published custom monster"],
        ],
        (source) => {
          ref.source = source;
          if (source === "custom") ref.revision ??= 1;
          else delete ref.revision;
          app.changed();
          app.renderEditor();
        },
      ),
    ),
    field(
      "Monster ID",
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

function rowsSection(app, value) {
  const rows = value.rows.map((row, index) =>
    rowElement(app, value, row, index),
  );
  const conditional = value.rows.filter((row) => row.condition).length;
  return section(
    "Drop rows",
    [
      value.rows.length
        ? table(["Item", "Chance", "Quantity", "Quest", "Conditions", ""], rows)
        : element("p", {
            class: "hint",
            text: "No extra drops yet. Add a row to give this monster something to drop.",
          }),
      element("p", {
        class: "hint",
        text: `${value.rows.length} of ${MAX_ROWS} rows · ${conditional} conditional`,
      }),
      button("Add drop row", () => addRow(app, value)),
    ],
    "Chance is per kill. 0.01% is one drop in about ten thousand kills.",
  );
}

function addRow(app, value) {
  if (value.rows.length >= MAX_ROWS) {
    throw new Error(`A drop table supports at most ${MAX_ROWS} rows.`);
  }
  value.rows.push({
    itemId:
      app.palette?.ref?.kind === "item" ? Number(app.palette.ref.id) : 2000000,
    chance: 10000,
    minimum: 1,
    maximum: 1,
    questId: 0,
  });
  app.changed();
  app.renderEditor();
}

function rowElement(app, value, row, index) {
  const cells = [
    itemCell(app, row),
    chanceCell(app, row),
    quantityCell(app, row),
    questCell(app, row),
    conditionCell(app, row),
    element("td", {}, [
      button("Remove", () => removeRow(app, value, index), "danger"),
    ]),
  ];
  const tr = element("tr", {}, cells);
  return row.condition ? [tr, conditionRow(app, row)] : [tr];
}

function removeRow(app, value, index) {
  value.rows.splice(index, 1);
  app.changed();
  app.renderEditor();
}

function itemCell(app, row) {
  const cell = element("td", {}, [
    input(row.itemId, (id) => {
      row.itemId = Number(id);
      app.changed();
    }),
    element("small", { class: "hint", text: itemLabel(row.itemId) }),
  ]);
  resolveItemName(app, row.itemId, cell);
  return cell;
}

function chanceCell(app, row) {
  return element("td", {}, [
    number(
      row.chance / 10000,
      (percent) => {
        if (percent === undefined) return;
        row.chance = Math.max(0, Math.min(999999, Math.round(percent * 10000)));
        app.changed();
      },
      { min: 0, max: 99.9999, step: 0.001, "aria-label": "Chance percent" },
    ),
    element("small", {
      class: "hint",
      text: row.chance
        ? `1 in ${Math.round(999999 / row.chance)} kills`
        : "never",
    }),
  ]);
}

function quantityCell(app, row) {
  const range = (key) =>
    number(
      row[key],
      (next) => {
        row[key] = next;
        app.changed();
      },
      { min: 1, "aria-label": `${key} quantity` },
    );
  return element("td", {}, [
    element("div", { class: "form-grid" }, [
      range("minimum"),
      range("maximum"),
    ]),
  ]);
}

function questCell(app, row) {
  return element("td", {}, [
    number(
      row.questId,
      (next) => {
        row.questId = next ?? 0;
        app.changed();
      },
      { min: 0, "aria-label": "Quest requirement" },
    ),
  ]);
}

function conditionCell(app, row) {
  return element("td", {}, [
    element("span", { class: "hint", text: conditionSummary(row.condition) }),
    button(
      row.condition ? "Edit" : "Add",
      () => {
        if (row.condition) delete row.condition;
        else row.condition = {};
        app.changed();
        app.renderEditor();
      },
      "subtle",
    ),
  ]);
}

function conditionRow(app, row) {
  const condition = row.condition;
  const jobs = classField(app, row, condition);
  return element("tr", {}, [
    element("td", { colspan: 6 }, [
      element("div", { class: "form-grid" }, [
        windowField(app, row, "start", "Available from"),
        windowField(app, row, "end", "Available until"),
        levelField(app, row, "minLevel", "Minimum level"),
        levelField(app, row, "maxLevel", "Maximum level"),
      ]),
      field(
        "Only for these classes (leave empty for every class)",
        jobs,
        "Hold Ctrl or Cmd to select more than one class.",
      ),
    ]),
  ]);
}

function classField(app, row, condition) {
  const jobs = element(
    "select",
    { class: "form-select", multiple: true, size: 6, "aria-label": "Classes" },
    JOBS.map(([id, name]) =>
      element("option", { value: String(id), text: `${name} · ${id}` }),
    ),
  );
  for (const option of jobs.options) {
    option.selected = (condition.jobs ?? []).includes(Number(option.value));
  }
  jobs.addEventListener("change", () => {
    ensureCondition(row).jobs = [...jobs.selectedOptions].map((option) =>
      Number(option.value),
    );
    app.changed();
  });
  return jobs;
}

function windowField(app, row, key, label) {
  return field(
    label,
    input(
      row.condition.window?.[key]
        ? toLocalInput(row.condition.window[key])
        : "",
      (value) => {
        const range = (ensureCondition(row).window ??= {
          start: null,
          end: null,
        });
        range[key] = value ? fromLocalInput(value) : null;
        if (!range.start && !range.end) delete row.condition.window;
        app.changed();
      },
      { type: "datetime-local" },
    ),
  );
}

function levelField(app, row, key, label) {
  return field(
    label,
    number(
      row.condition[key],
      (next) => {
        if (next === undefined) delete ensureCondition(row)[key];
        else ensureCondition(row)[key] = next;
        app.changed();
      },
      { min: 1, max: 200, placeholder: "Any" },
    ),
  );
}

/** Editing keeps the condition object alive; an empty one is dropped from the payload. */
function ensureCondition(row) {
  row.condition ??= {};
  return row.condition;
}

function conditionSummary(condition) {
  if (!condition) return "every kill";
  const parts = [
    windowSummary(condition.window),
    jobsSummary(condition.jobs),
    levelSummary(condition),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "every kill";
}

function windowSummary(range) {
  if (!range) return "";
  const from = range.start
    ? `from ${new Date(range.start).toLocaleString()}`
    : "any time";
  const until = range.end
    ? `until ${new Date(range.end).toLocaleString()}`
    : "";
  return [from, until].filter(Boolean).join(" ");
}

function jobsSummary(jobs) {
  if (!jobs?.length) return "";
  return jobs
    .map((id) => JOBS.find(([job]) => job === id)?.[1] ?? id)
    .join(", ");
}

function levelSummary(condition) {
  const limits = [];
  if (condition.minLevel !== undefined) {
    limits.push(`level ${condition.minLevel}+`);
  }
  if (condition.maxLevel !== undefined) {
    limits.push(`level ${condition.maxLevel} or lower`);
  }
  return limits.join(" · ");
}

function itemLabel(itemId) {
  const name = itemNames.get(Number(itemId));
  return name ? `${name} · ${itemId}` : `item ${itemId}`;
}

/** Item names are decoration: resolve once per id and patch the cell in place. */
function resolveItemName(app, itemId, cell) {
  const id = Number(itemId);
  if (!Number.isSafeInteger(id) || id <= 0 || itemNames.has(id)) return;
  itemNames.set(id, null);
  app
    .resolveName(original("item", id))
    .then((name) => {
      itemNames.set(id, name ?? "");
      const label = cell.querySelector("small");
      if (label) label.textContent = itemLabel(id);
    })
    .catch(() => itemNames.set(id, ""));
}

function toLocalInput(ms) {
  const date = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return date.toISOString().slice(0, 16);
}

function fromLocalInput(text) {
  const ms = new Date(text).getTime();
  return Number.isFinite(ms) ? ms : null;
}
