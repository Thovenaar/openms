import { validateDropRow } from "../../client/src/world/drop-system.js";
import { DROP_POLICY } from "../../client/src/world/drop-rules.js";
import { referenceKey } from "./definitions.js";
import { contentError, requireContent } from "./validation.js";

/** Compile one authored table into the per-mob rows the field admits at release time. */
export function compileDrops(row, dependencies, registry) {
  const value = row.definition;
  const target = dependencies.get(referenceKey(value.target));
  requireContent(target, "Drop target was not resolved", "target");
  const mobId =
    value.target.source === "custom"
      ? target.runtimeId
      : Number(value.target.id);
  const items = registry.catalog.ui.items;
  const rows = value.rows.map((entry, index) =>
    compiledRow(entry, index, items),
  );
  const baseRows = registry.catalog.drops?.mobs?.[mobId]?.rows?.length ?? 0;
  requireContent(
    baseRows + rows.length <= DROP_POLICY.maximumRows,
    "Drop table exceeds per-monster limit",
    "rows",
  );
  return {
    kind: "drops",
    target: { ...structuredClone(value.target), mobId },
    mode: value.mode,
    rows,
  };
}

function compiledRow(entry, index, items) {
  const minimum = entry.minimum ?? 1;
  const row = {
    itemId: entry.itemId,
    minimum,
    maximum: entry.maximum ?? minimum,
    questId: entry.questId ?? 0,
    chance: entry.chance,
    status: "supported",
  };
  if (entry.condition !== undefined) {
    row.condition = structuredClone(entry.condition);
  }
  try {
    validateDropRow(row, items);
  } catch (error) {
    throw contentError("INVALID_CONTENT", error.message, `rows/${index}`);
  }
  return row;
}
