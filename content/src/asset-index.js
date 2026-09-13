import {
  CONTENT_LIMITS,
  contentError,
  enumeration,
  hash,
  integer,
  jsonDocument,
  record,
  requireContent,
  text,
} from "./validation.js";

export const ASSET_KINDS = Object.freeze([
  "map",
  "mob",
  "quest",
  "item",
  "sound",
  "bundle",
]);

function addRows(rows, kind, values) {
  const entries = Object.entries(values ?? {});
  requireContent(
    entries.length + rows.length <= CONTENT_LIMITS.assets,
    "Asset index exceeds limit",
  );
  for (const [id, value] of entries) {
    rows.push({ source: "original", kind, id, name: value.name ?? id });
  }
}

/** Search names are metadata; resolution uses kind plus stable identity within a pinned build. */
export function indexCatalog(catalog) {
  hash(catalog?.buildId, "buildId");
  requireContent(
    catalog.schemaVersion === 2,
    "Unsupported base catalog version",
  );
  jsonDocument(catalog, {
    maxBytes: CONTENT_LIMITS.catalogBytes,
    maxNodes: CONTENT_LIMITS.catalogNodes,
  });
  const rows = [];
  addRows(rows, "map", catalog.maps);
  for (const row of rows) {
    row.name = catalog.mapNames?.[Number(row.id)] ?? row.id;
  }
  addRows(rows, "mob", catalog.monsters);
  addRows(rows, "quest", catalog.quests?.records);
  addRows(rows, "item", catalog.ui?.items);
  addRows(rows, "bundle", catalog.ui?.bundles);
  const groups = Object.entries(catalog.audiovisual?.sounds ?? {});
  requireContent(groups.length <= 1024, "Sound group limit exceeded");
  for (const [group, sounds] of groups) {
    const entries = Object.entries(sounds);
    requireContent(
      entries.length + rows.length <= CONTENT_LIMITS.assets,
      "Sound index exceeds limit",
    );
    for (const [name] of entries) {
      rows.push({
        source: "original",
        kind: "sound",
        id: `${group}/${name}`,
        name,
      });
    }
  }
  return rows.sort((a, b) =>
    `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`, "en"),
  );
}

export function searchAssets(rows, query) {
  record(query, ["kind", "query", "offset", "limit"]);
  enumeration(query.kind, ASSET_KINDS);
  requireContent(
    typeof query.query === "string" && query.query.length <= 120,
    "Search text exceeds limit",
  );
  integer(query.offset, 0, CONTENT_LIMITS.assets);
  integer(query.limit, 1, 100);
  const needle = query.query.toLowerCase();
  const matches = [];
  let total = 0;
  for (const row of rows) {
    if (
      row.kind !== query.kind ||
      !`${row.id} ${row.name}`.toLowerCase().includes(needle)
    ) {
      continue;
    }
    if (total >= query.offset && matches.length < query.limit) {
      matches.push({ ...row });
    }
    total++;
  }
  return { matches, total, offset: query.offset };
}

export function assetNotFound(ref) {
  throw contentError(
    "ASSET_NOT_FOUND",
    `Asset is unavailable in this build: ${ref.kind}/${ref.id}`,
  );
}

export function validateAssetRef(ref) {
  record(ref, ["source", "kind", "id"], ["mapId"]);
  enumeration(ref.source, ["original"]);
  enumeration(ref.kind, [...ASSET_KINDS, "npc", "entity"]);
  text(ref.id, 160);
  validateAssetId(ref);
  if (ref.kind === "entity" || ref.kind === "npc") {
    requireContent(/^\d{9}$/.test(ref.mapId), "Source map is required");
  } else requireContent(ref.mapId === undefined, "Unexpected source map");
}

function validateAssetId(ref) {
  if (ref.kind === "map") {
    requireContent(/^\d{9}$/.test(ref.id), "Map IDs use nine digits");
  }
  if (["mob", "npc", "quest", "item"].includes(ref.kind)) {
    requireContent(
      /^[1-9]\d{0,8}$/.test(ref.id),
      "Expected numeric original identity",
    );
  }
  for (const part of ref.id.split("/")) {
    requireContent(
      !["__proto__", "constructor", "prototype"].includes(part),
      "Reserved asset identity",
    );
  }
}
