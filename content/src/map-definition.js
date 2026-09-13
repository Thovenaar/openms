import {
  CONTENT_LIMITS,
  enumeration,
  identity,
  integer,
  list,
  originalRef,
  record,
  reference,
  requireContent,
} from "./validation.js";
import { rectangle, validateAppearance } from "./definitions.js";

/** Maps inherit a pinned original scene, with explicit scenery and spawn additions. */
export function validateMap(value) {
  record(
    value,
    ["base", "entities", "spawns"],
    ["bounds", "footholds", "ladders", "removeEntities", "removeSpawns"],
    "definition",
  );
  originalRef(value.base, ["map"], "base");
  if (value.bounds !== undefined) rectangle(value.bounds, "bounds");
  uniqueRows(
    list(value.entities, CONTENT_LIMITS.placements, "entities"),
    validateEntity,
  );
  uniqueRows(
    list(value.spawns, CONTENT_LIMITS.placements, "spawns"),
    validateSpawn,
  );
  if (value.footholds !== undefined) validateFootholds(value.footholds);
  if (value.ladders !== undefined) {
    uniqueRows(list(value.ladders, 1024), validateLadder);
  }
  for (const key of ["removeEntities", "removeSpawns"]) {
    if (value[key] === undefined) continue;
    const ids = list(value[key], CONTENT_LIMITS.placements, key);
    requireContent(new Set(ids).size === ids.length, "Duplicate removal", key);
    for (const id of ids) {
      requireContent(
        typeof id === "string" && id.length <= 160,
        "Invalid removal identity",
        key,
      );
    }
  }
}

function uniqueRows(rows, validate) {
  const ids = new Set();
  for (const row of rows) {
    validate(row);
    requireContent(
      !ids.has(row.id),
      "Duplicate placement identity",
      String(row.id),
    );
    ids.add(row.id);
  }
}

function position(value) {
  integer(value.x, -1000000, 1000000, "x");
  integer(value.y, -1000000, 1000000, "y");
}

function validateEntity(value) {
  record(value, ["id", "appearance", "x", "y", "z", "flip"]);
  identity(value.id);
  position(value);
  integer(value.z, -1000000, 1000000, "z");
  enumeration(value.flip, [true, false], "flip");
  validateAppearance(value.appearance);
}

function validateSpawn(value) {
  record(value, ["id", "mob", "x", "y", "foothold", "range", "facing"]);
  identity(value.id);
  reference(value.mob, ["mob"], "mob");
  position(value);
  integer(value.foothold, 1, 65535, "foothold");
  enumeration(value.facing, [-1, 1], "facing");
  record(value.range, ["left", "right"]);
  integer(value.range.left, -1000000, 1000000);
  integer(value.range.right, -1000000, 1000000);
  requireContent(
    value.range.left <= value.x && value.x <= value.range.right,
    "Spawn outside patrol range",
  );
}

function validateFootholds(rows) {
  uniqueRows(list(rows, 4096, "footholds"), validateFoothold);
  const ids = new Set(rows.map((row) => row.id));
  for (const row of rows) {
    for (const link of [row.prev, row.next]) {
      requireContent(
        link === 0 || ids.has(link),
        "Missing foothold link",
        String(row.id),
      );
    }
  }
}

function validateFoothold(row) {
  record(row, ["id", "layer", "group", "x1", "y1", "x2", "y2", "prev", "next"]);
  integer(row.id, 1, 65535);
  integer(row.layer, 0, 7);
  integer(row.group, 0, 65535);
  for (const key of ["x1", "y1", "x2", "y2"]) {
    integer(row[key], -1000000, 1000000);
  }
  for (const key of ["prev", "next"]) integer(row[key], 0, 65535);
  requireContent(
    row.x1 !== row.x2 || row.y1 !== row.y2,
    "Zero-length foothold",
  );
}

function validateLadder(row) {
  record(row, ["id", "x", "y1", "y2", "ladder", "uf", "page"]);
  integer(row.id, 0, 65535);
  for (const key of ["x", "y1", "y2"]) integer(row[key], -1000000, 1000000);
  for (const key of ["ladder", "uf"]) enumeration(row[key], [0, 1]);
  integer(row.page, 0, 7);
  requireContent(row.y1 < row.y2, "Inverted ladder");
}
