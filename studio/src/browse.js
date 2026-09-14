import {
  element,
  button,
  input,
  select,
  table,
  section,
  empty,
} from "./dom.js";
import { original } from "./models.js";
import { thumbnail, bundleVisual } from "./thumbnails.js";

const BROWSE_LIMIT = 12;
const THUMB_SIZE = 64;
const DETAIL_THUMB = 120;
const DETAIL_STAGES = 8;
const DETAIL_QUESTS = 24;
const KINDS = [
  ["mob", "Mobs"],
  ["item", "Items"],
  ["map", "Maps"],
  ["quest", "Quests"],
];
const GLYPHS = { mob: "♟", item: "◈", map: "▧", quest: "◇" };
const STAT_LABELS = [
  ["maxHP", "HP"],
  ["maxMP", "MP"],
  ["level", "Level"],
  ["exp", "EXP"],
  ["PADamage", "Physical attack"],
  ["PDDamage", "Physical defense"],
  ["MADamage", "Magic attack"],
  ["MDDamage", "Magic defense"],
  ["acc", "Accuracy"],
  ["eva", "Avoidability"],
  ["pushed", "Knockback"],
  ["speed", "Speed"],
];

export async function openBrowse(app) {
  app.show("browse");
  renderBrowse(app);
  if (!app.browseLoaded) await refreshBrowse(app, true);
}

export function renderBrowse(app) {
  app.browseSelected = null;
  app.browseHost.replaceChildren(
    element("p", {
      class: "intro",
      text: "Browse the original world by picture and name, then make it yours.",
    }),
    browseControls(app),
    element("div", { class: "browse-columns" }, [
      browseGrid(app),
      browseDetail(app),
    ]),
  );
}

function browseControls(app) {
  const search = input(
    app.browseQuery,
    (value) => {
      app.browseQuery = value;
    },
    { placeholder: "Search by name or ID", "aria-label": "Search the world" },
  );
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") app.run(() => refreshBrowse(app, true));
  });
  return element("div", { class: "browse-controls" }, [
    select(
      app.browseKind,
      KINDS,
      (kind) => {
        app.browseKind = kind;
        app.run(() => refreshBrowse(app, true));
      },
      { "aria-label": "Content kind" },
    ),
    search,
    button("Search", () => app.run(() => refreshBrowse(app, true))),
    element("span", { class: "hint", text: browseSummary(app) }),
    element("div", { class: "pagination" }, [
      button(
        "← Previous",
        () => app.run(() => pageBrowse(app, -1)),
        "secondary",
      ),
      button("Next →", () => app.run(() => pageBrowse(app, 1)), "secondary"),
    ]),
  ]);
}

function browseSummary(app) {
  if (!app.browseLoaded) return "Looking through the original collection…";
  if (!app.browseTotal) return "No matches. Try another kind or name.";
  return `${app.browseTotal} matches · showing ${app.browseOffset + 1}–${app.browseOffset + app.browseRows.length}`;
}

function browseGrid(app) {
  const grid = element("div", { class: "browse-grid" });
  app.browseGrid = grid;
  renderBrowseResults(app);
  return grid;
}

function browseDetail(app) {
  const host = element("aside", { class: "browse-detail" });
  app.browseDetail = host;
  host.append(
    empty(
      "Choose something to inspect",
      "Stats, drops, spawns and quests appear here.",
    ),
  );
  return host;
}

async function refreshBrowse(app, reset) {
  if (reset) app.browseOffset = 0;
  const result = await app.api.post("assets/search", {
    buildId: app.api.config.assetBuildId,
    query: {
      kind: app.browseKind,
      query: app.browseQuery,
      offset: app.browseOffset,
      limit: BROWSE_LIMIT,
    },
  });
  app.browseRows = result.matches;
  app.browseTotal = result.total;
  app.browseLoaded = true;
  renderBrowse(app);
}

async function pageBrowse(app, direction) {
  const next = app.browseOffset + direction * BROWSE_LIMIT;
  if (next < 0) return;
  if (
    direction > 0 &&
    app.browseOffset + app.browseRows.length >= app.browseTotal
  ) {
    return;
  }
  app.browseOffset = next;
  await refreshBrowse(app, false);
}

function browseCard(app, row) {
  const thumb = element("span", {
    class: `browse-thumb ${row.kind}`,
    text: GLYPHS[row.kind] ?? "✦",
  });
  const card = element(
    "button",
    {
      type: "button",
      class: "browse-card",
      onclick: () => app.run(() => openDetail(app, row)),
    },
    [
      thumb,
      element("span", { class: "browse-name" }, [
        element("strong", { text: row.name }),
        element("small", { text: `${row.kind} · ${row.id}` }),
      ]),
    ],
  );
  return { card, thumb };
}

function renderBrowseResults(app) {
  const grid = app.browseGrid;
  if (!grid) return;
  if (!app.browseRows.length) {
    grid.replaceChildren(
      empty("Nothing here yet", "Try another name or kind."),
    );
    return;
  }
  const entries = app.browseRows.map((row) => {
    const { card, thumb } = browseCard(app, row);
    return { card, thumb, row };
  });
  grid.replaceChildren(...entries.map((entry) => entry.card));
  fillThumbnails(app, entries);
}

async function fillThumbnails(app, entries) {
  const queue = [...entries];
  const workers = Array.from({ length: Math.min(4, queue.length) }, () =>
    fillWorker(app, queue),
  );
  await Promise.all(workers);
}

async function fillWorker(app, queue) {
  for (let entry = queue.shift(); entry; entry = queue.shift()) {
    await fillThumb(app, entry);
  }
}

async function fillThumb(app, entry) {
  try {
    const visual = await resolveVisual(app, entry.row);
    if (!visual) return;
    const canvas = await thumbnail(visual, THUMB_SIZE);
    entry.thumb.replaceChildren(canvas);
  } catch {
    // A missing thumbnail keeps the kind glyph.
  }
}

async function resolveVisual(app, row) {
  const asset = await app.api.resolve(original(row.kind, row.id));
  if (asset.visual) return asset.visual;
  if (asset.bundle) {
    return bundleVisual(
      asset.bundle,
      row.kind === "item" ? "/icon" : "/default",
    );
  }
  return null;
}

async function openDetail(app, row) {
  app.browseSelected = row;
  const host = app.browseDetail;
  if (!host) return;
  host.replaceChildren(
    element("p", { class: "hint", text: `Loading ${row.name}…` }),
  );
  try {
    if (row.kind === "mob") {
      renderMobDetail(app, host, await monsterDetail(app, row));
      return;
    }
    const asset = await app.api.resolve(original(row.kind, row.id));
    if (row.kind === "quest") renderQuestDetail(host, asset.record);
    else if (row.kind === "map") renderMapDetail(host, row, asset);
    else renderAssetDetail(host, row, asset);
  } catch (error) {
    host.replaceChildren(element("p", { class: "hint", text: error.message }));
  }
}

function monsterDetail(app, row) {
  return app.api.post("assets/monster", {
    buildId: app.api.config.assetBuildId,
    ref: original("mob", row.id),
  });
}

function detailHeading(name, subtitle) {
  return element("div", { class: "browse-heading" }, [
    element("h2", { text: name }),
    element("small", { text: subtitle }),
  ]);
}

function detailPicture(visual, size) {
  const host = element("div", { class: "browse-picture" });
  if (visual) {
    thumbnail(visual, size)
      .then((canvas) => host.replaceChildren(canvas))
      .catch(() => {});
  }
  return host;
}

function statList(stats) {
  const list = element("dl", { class: "stat-list" });
  for (const [key, label] of STAT_LABELS) {
    if (stats[key] === undefined) continue;
    list.append(
      element("dt", { text: label }),
      element("dd", { text: String(stats[key]) }),
    );
  }
  if (!list.childElementCount) {
    list.append(element("dd", { class: "hint", text: "No published stats." }));
  }
  return list;
}

function chanceText(chance) {
  if (!chance) return "never";
  const percent = Number((chance / 10000).toFixed(3));
  return `${percent}% · 1 in ${Math.round(999999 / chance)}`;
}

function dropsSection(drops) {
  if (!drops.length) {
    return section("Original drops", [
      element("p", {
        class: "hint",
        text: "This monster has no extracted drop rows.",
      }),
    ]);
  }
  const rows = drops.map((row) =>
    element("tr", {}, [
      element("td", {}, [
        element("strong", { text: row.itemName }),
        element("small", { class: "hint", text: ` · ${row.itemId}` }),
      ]),
      element("td", { text: chanceText(row.chance) }),
      element("td", {
        text:
          row.minimum === row.maximum
            ? String(row.minimum)
            : `${row.minimum}–${row.maximum}`,
      }),
      element("td", { text: row.questId ? String(row.questId) : "—" }),
    ]),
  );
  return section(
    "Original drops",
    [table(["Item", "Chance", "Quantity", "Quest"], rows)],
    "Chance is per kill in the original extracted table.",
  );
}

function spawnsSection(spawns) {
  if (!spawns.length) {
    return section("Spawns in", [
      element("p", {
        class: "hint",
        text: "No spawn index is loaded for this build. Re-run extraction to index where monsters appear.",
      }),
    ]);
  }
  return section(
    "Spawns in",
    spawns.map((row) =>
      element("p", {
        text: `${row.mapName} · ${row.mapId} · ${row.count} spawn${row.count === 1 ? "" : "s"}`,
      }),
    ),
  );
}

function questsSection(quests) {
  if (!quests.length) {
    return section("Referenced by quests", [
      element("p", {
        class: "hint",
        text: "No original quest references this monster.",
      }),
    ]);
  }
  return section(
    "Referenced by quests",
    quests
      .slice(0, DETAIL_QUESTS)
      .map((row) => element("p", { text: `${row.name} · ${row.id}` })),
  );
}

function mobActions(app, detail) {
  return element("div", { class: "tool-grid" }, [
    button("Create a custom mob", () =>
      app.run(() =>
        app.createFrom("mob", (definition) => {
          definition.base = original("mob", detail.ref.id);
        }),
      ),
    ),
    button(
      "Edit its drops",
      () =>
        app.run(() =>
          app.createFrom("drops", (definition) => {
            definition.target = original("mob", detail.ref.id);
          }),
        ),
      "secondary",
    ),
  ]);
}

function renderMobDetail(app, host, detail) {
  host.replaceChildren(
    detailHeading(detail.name, `Monster · ${detail.ref.id}`),
    element("div", { class: "browse-detail-body" }, [
      detailPicture(detail.visual, DETAIL_THUMB),
      statList(detail.stats),
    ]),
    dropsSection(detail.drops),
    spawnsSection(detail.spawns),
    questsSection(detail.quests),
    mobActions(app, detail),
  );
}

function stageSummary(stage, index) {
  const kills = (stage.check?.mobs ?? [])
    .map((row) => `${row.id} ×${row.count ?? 1}`)
    .join(", ");
  const items = (stage.check?.items ?? [])
    .map((row) => `${row.id} ×${row.count ?? 1}`)
    .join(", ");
  const goals = [
    kills && `Defeat ${kills}`,
    items && `Collect ${items}`,
  ].filter(Boolean);
  const text = (stage.say?.pages?.[0]?.text ?? "").slice(0, 120);
  return element("p", {
    text: `Stage ${index + 1}: ${goals.join(" · ") || "Talk to the NPC"} — “${text}”`,
  });
}

function renderQuestDetail(host, record) {
  const stages = record?.stages ?? [];
  host.replaceChildren(
    detailHeading(
      record?.name ?? String(record?.id ?? "Quest"),
      `Quest · ${record?.id ?? ""}`,
    ),
    section(
      `Stages (${stages.length})`,
      stages.length
        ? stages.slice(0, DETAIL_STAGES).map(stageSummary)
        : [element("p", { class: "hint", text: "This quest has no stages." })],
    ),
    element("p", {
      class: "hint",
      text: "Original quest records are read-only. Create a custom quest to author your own version.",
    }),
  );
}

function itemFacts(record) {
  return element("p", {
    text:
      [record.category, record.description].filter(Boolean).join(" · ") ||
      "No description.",
  });
}

/** Authored placements, grouped by monster, are already in the resolved manifest. */
function spawnCounts(manifest) {
  const life = manifest.life;
  const counts = new Map();
  if (!life) return [];
  for (const placement of life.placements) {
    if (placement.kind !== "mob") continue;
    const id = String(placement.authored.id);
    const name = life.templates[placement.template]?.name ?? id;
    const current = counts.get(id);
    counts.set(id, { id, name, count: (current ? current.count : 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

function renderMapDetail(host, row, asset) {
  const mobs = spawnCounts(asset.manifest);
  host.replaceChildren(
    detailHeading(asset.name ?? row.name, `Map · ${row.id}`),
    section(
      `Monsters (${mobs.length})`,
      mobs.length
        ? mobs.slice(0, 40).map((mob) =>
            element("p", {
              text: `${mob.name} · ${mob.id} · ${mob.count} spawn${mob.count === 1 ? "" : "s"}`,
            }),
          )
        : [
            element("p", {
              class: "hint",
              text: "This map authors no monster spawns.",
            }),
          ],
    ),
    element("p", {
      class: "hint",
      text: "Open a monster in World to see every map it spawns in.",
    }),
  );
}

function renderAssetDetail(host, row, asset) {
  const record = asset.record ?? {};
  host.replaceChildren(
    detailHeading(record.name ?? row.name, `${row.kind} · ${row.id}`),
    ...(row.kind === "item"
      ? [
          detailPicture(bundleVisual(asset.bundle, "/icon"), DETAIL_THUMB),
          itemFacts(record),
        ]
      : []),
    element("p", {
      class: "hint",
      text: "This original asset can be referenced from the editors.",
    }),
  );
}
