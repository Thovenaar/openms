import { DROP_POLICY } from "../../client/src/world/drop-rules.js";
import {
  enumeration,
  integer,
  list,
  record,
  reference,
  requireContent,
} from "./validation.js";

/** Authoring bounds for one document; runtime ceilings stay in the field drop policy. */
const DROP_LIMITS = Object.freeze({
  rows: 64,
  chance: 999999,
  jobs: 6,
  job: 9999,
  level: 200,
  identity: 999999999,
});

/** Mob drop tables author per-item chance, quantity and explicit gating conditions. */
export function validateDropDefinition(value) {
  record(value, ["target", "mode", "rows"]);
  reference(value.target, ["mob"], "target");
  requireContent(
    value.target.source !== "original" ||
      /^[1-9]\d{0,8}$/.test(value.target.id),
    "Expected numeric original monster identity",
    "target/id",
  );
  enumeration(value.mode, ["merge", "replace"], "mode");
  const rows = list(value.rows, DROP_LIMITS.rows, "rows");
  for (const [index, row] of rows.entries()) {
    validateRow(row, `rows/${index}`);
  }
}

function validateRow(row, path) {
  record(
    row,
    ["itemId", "chance"],
    ["minimum", "maximum", "questId", "condition"],
    path,
  );
  integer(row.itemId, 0, DROP_LIMITS.identity, `${path}/itemId`);
  integer(row.chance, 0, DROP_LIMITS.chance, `${path}/chance`);
  if (row.minimum !== undefined) {
    integer(row.minimum, 1, DROP_POLICY.mesoLimit, `${path}/minimum`);
  }
  if (row.maximum !== undefined) {
    integer(row.maximum, 1, DROP_POLICY.mesoLimit, `${path}/maximum`);
  }
  requireContent(
    (row.maximum ?? row.minimum ?? 1) >= (row.minimum ?? 1),
    "Drop quantity range is inverted",
    path,
  );
  if (row.questId !== undefined) {
    integer(row.questId, 0, DROP_LIMITS.identity, `${path}/questId`);
  }
  if (row.condition !== undefined) {
    validateCondition(row.condition, `${path}/condition`);
  }
}

function validateCondition(condition, path) {
  record(condition, [], ["window", "jobs", "minLevel", "maxLevel"], path);
  requireContent(
    Object.keys(condition).length > 0,
    "Drop condition has no gate",
    path,
  );
  if (condition.window !== undefined) {
    record(condition.window, ["start", "end"], [], `${path}/window`);
    for (const key of ["start", "end"]) {
      integer(
        condition.window[key],
        0,
        Number.MAX_SAFE_INTEGER,
        `${path}/window/${key}`,
      );
    }
    requireContent(
      condition.window.start < condition.window.end,
      "Drop window is empty or inverted",
      `${path}/window`,
    );
  }
  if (condition.jobs !== undefined) {
    const jobs = list(condition.jobs, DROP_LIMITS.jobs, `${path}/jobs`);
    requireContent(jobs.length > 0, "Empty drop job filter", `${path}/jobs`);
    for (const job of jobs) integer(job, 0, DROP_LIMITS.job, `${path}/jobs`);
    requireContent(
      new Set(jobs).size === jobs.length,
      "Duplicate drop job filter",
      `${path}/jobs`,
    );
  }
  for (const key of ["minLevel", "maxLevel"]) {
    if (condition[key] !== undefined) {
      integer(condition[key], 1, DROP_LIMITS.level, `${path}/${key}`);
    }
  }
  requireContent(
    condition.minLevel === undefined ||
      condition.maxLevel === undefined ||
      condition.maxLevel >= condition.minLevel,
    "Drop level range is inverted",
    path,
  );
}
