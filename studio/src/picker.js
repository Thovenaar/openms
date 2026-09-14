import { element, field, input, number } from "./dom.js";
import { original } from "./models.js";

const RESULT_LIMIT = 12;
const MAX_NPC_MAPS = 16;
const SEARCH_DELAY = 120;
const npcMaps = new Map();
const labels = new Map();

const NAMES = {
  mob: "Monster",
  npc: "NPC",
  item: "Item",
  quest: "Quest",
  map: "Map",
  sound: "Sound",
  bundle: "UI bundle",
};

function label(kind) {
  return NAMES[kind] ?? kind;
}

/** Search rows by the same text authors type: stable ID or readable name. */
export function matchRows(rows, query, limit = RESULT_LIMIT) {
  const needle = String(query ?? "")
    .trim()
    .toLowerCase();
  const matches = needle
    ? rows.filter((row) =>
        `${row.ref.id} ${row.name}`.toLowerCase().includes(needle),
      )
    : rows;
  return matches.slice(0, limit);
}

function identity(ref) {
  return [
    ref.source,
    ref.kind,
    ref.id,
    ref.mapId ?? "",
    ref.revision ?? "",
  ].join(":");
}

/** Resolve one identity's readable name per session; a missing name stays silent. */
export function assetLabel(app, ref) {
  const key = identity(ref);
  if (!labels.has(key)) {
    labels.set(
      key,
      app.resolveName(ref).then((name) => name ?? ""),
    );
  }
  return labels.get(key);
}

async function loadNpcs(app, mapId) {
  const { manifest } = await app.api.resolve(original("map", mapId));
  return Object.values(manifest.life.templates)
    .filter((row) => row.kind === "npc")
    .map((row) => ({
      ref: original("npc", String(Number(row.originalId)), mapId),
      name: row.name,
    }));
}

/** Map manifests are immutable per build; one bounded cache keeps map switching cheap. */
function npcRows(app, mapId) {
  if (!npcMaps.has(mapId)) {
    if (npcMaps.size >= MAX_NPC_MAPS) {
      npcMaps.delete(npcMaps.keys().next().value);
    }
    npcMaps.set(mapId, loadNpcs(app, mapId));
  }
  return npcMaps.get(mapId);
}

/** Catalog search and map-scoped NPC search return one shape: `{ ref, name }`. */
function sourceFor(app, options) {
  if (options.kind === "npc") {
    return async (query) => matchRows(await npcRows(app, options.mapId), query);
  }
  return async (query) => {
    const result = await app.api.post("assets/search", {
      buildId: app.api.config.assetBuildId,
      query: { kind: options.kind, query, offset: 0, limit: RESULT_LIMIT },
    });
    return result.matches.map((row) => ({
      ref: original(row.kind, row.id),
      name: row.name,
    }));
  };
}

function schedule(ctx, query) {
  clearTimeout(ctx.timer);
  ctx.timer = setTimeout(() => search(ctx, query), SEARCH_DELAY);
}

function renderResults(ctx, rows) {
  ctx.results.replaceChildren(
    ...(rows.length
      ? rows.map((row) => resultButton(ctx, row))
      : [
          element("p", {
            class: "hint",
            text: "No matches. Try another name or ID.",
          }),
        ]),
  );
}

async function search(ctx, query) {
  const generation = ++ctx.generation;
  ctx.results.hidden = false;
  ctx.results.replaceChildren(
    element("p", { class: "hint", text: "Searching…" }),
  );
  try {
    const rows = await ctx.source(query);
    if (generation === ctx.generation) renderResults(ctx, rows);
  } catch (error) {
    if (generation === ctx.generation) {
      ctx.results.replaceChildren(
        element("p", { class: "hint", text: error.message }),
      );
    }
  }
}

function showName(ctx, name, id) {
  ctx.chosen = true;
  ctx.current.textContent = name
    ? `${name} · ${id}`
    : `${label(ctx.options.kind)} ${id}`;
}

function resultButton(ctx, row) {
  return element(
    "button",
    {
      type: "button",
      class: "picker-result",
      onclick: () => {
        ctx.options.choose({ ...row.ref });
        showName(ctx, row.name, row.ref.id);
        ctx.results.hidden = true;
        ctx.search.value = "";
      },
    },
    [
      element("strong", { text: row.name ?? row.ref.id }),
      element("small", { text: `${label(row.ref.kind)} · ${row.ref.id}` }),
    ],
  );
}

function showCurrent(ctx) {
  const { value, kind, mapId } = ctx.options;
  if (!value) {
    ctx.current.textContent = `No ${label(kind).toLowerCase()} selected`;
    return;
  }
  ctx.current.textContent = `${label(kind)} ${value}`;
  assetLabel(ctx.app, original(kind, value, mapId)).then((name) => {
    if (!ctx.chosen && name) showName(ctx, name, value);
  });
}

function dismiss(ctx) {
  ctx.search.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    ctx.results.hidden = true;
    ctx.search.blur();
  });
  ctx.search.addEventListener("focus", () => {
    if (!ctx.results.childElementCount) search(ctx, "");
  });
  ctx.box.addEventListener("focusout", (event) => {
    if (!ctx.box.contains(event.relatedTarget)) ctx.results.hidden = true;
  });
}

function collapse(ctx) {
  ctx.search.hidden = true;
  return element("button", {
    type: "button",
    class: "btn btn-ghost-secondary picker-toggle",
    text: "Change",
    onclick: () => {
      ctx.search.hidden = !ctx.search.hidden;
      if (ctx.search.hidden) return;
      ctx.search.focus();
      search(ctx, "");
    },
  });
}

/**
 * Name/ID search over the pinned original collection, replacing free-form identity
 * fields. `choose` receives the selected `{ source, kind, id }` reference.
 */
export function assetSearch(app, options) {
  const ctx = {
    app,
    options,
    generation: 0,
    timer: null,
    chosen: false,
    current: element("small", { class: "picker-current" }),
    results: element("div", { class: "picker-results", hidden: true }),
  };
  ctx.source = sourceFor(app, options);
  ctx.search = input("", (query) => schedule(ctx, query), {
    placeholder: `Search ${label(options.kind).toLowerCase()} by name or ID`,
    "aria-label": `Search ${label(options.kind)}`,
    autocomplete: "off",
  });
  const children = [ctx.current];
  if (options.compact) children.push(collapse(ctx));
  children.push(ctx.search, ctx.results);
  ctx.box = element(
    "div",
    { class: `picker${options.compact ? " picker-compact" : ""}` },
    children,
  );
  dismiss(ctx);
  showCurrent(ctx);
  return ctx.box;
}

function customField(app, ref, kind, change) {
  const choices = app.rows.filter(
    (row) => row.status === "published" && row.kind === kind,
  );
  const select = element(
    "select",
    {
      class: "form-select",
      onchange: (event) => {
        ref.id = event.target.value;
        const match = choices.find((row) => row.id === ref.id);
        if (match) ref.revision = match.revision;
        change();
      },
    },
    choices.map((row) =>
      element("option", {
        value: row.id,
        text: `${row.name} · r${row.revision}`,
      }),
    ),
  );
  select.value = ref.id;
  return element("div", { class: "picker-pair" }, [
    field(
      "Published creation",
      select,
      choices.length
        ? ""
        : `Publish a ${kind} in this project to reference it here.`,
    ),
    field(
      "Published revision",
      number(
        ref.revision ?? 1,
        (next) => {
          ref.revision = next ?? 1;
          change();
        },
        { min: 1 },
      ),
    ),
  ]);
}

function npcField(app, ref, change) {
  const assign = (mutate) => {
    mutate();
    change();
  };
  return element("div", { class: "picker-pair" }, [
    field(
      "Source map",
      assetSearch(app, {
        kind: "map",
        value: ref.mapId,
        choose: (next) =>
          assign(() => {
            ref.mapId = next.id;
            ref.id = "";
          }),
      }),
    ),
    field(
      "NPC",
      assetSearch(app, {
        kind: "npc",
        mapId: ref.mapId,
        value: ref.id,
        choose: (next) =>
          assign(() => {
            ref.id = next.id;
          }),
      }),
    ),
  ]);
}

/** Original identities search the pinned catalog; custom ones select a published revision. */
export function referenceField(app, ref, kind, change) {
  if (ref.source === "custom") return customField(app, ref, kind, change);
  if (kind === "npc") return npcField(app, ref, change);
  return field(
    label(kind),
    assetSearch(app, {
      kind,
      value: ref.id,
      choose: (next) => {
        ref.id = next.id;
        change();
      },
    }),
  );
}
