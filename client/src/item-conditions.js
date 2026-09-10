const MAX_CONDITIONS = 32;
const MAX_CONDITION_FIELDS = 8;
const MAX_MAP_ID = 999999999;

function integer(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function retainConditionType(conditions, row) {
  if (row.type === 0) {
    const start = row.sMap ?? 0,
      end = row.eMap ?? 0;
    if (!integer(start, MAX_MAP_ID) || !integer(end, MAX_MAP_ID)) {
      throw new Error("Invalid original item condition map range");
    }
    conditions.areas.push({ start, end });
  } else if (row.type === 2 && row.inParty === 1) {
    conditions.party = true;
  } else {
    conditions.unavailable ??= `Original item condition type ${row.type} has no local controller`;
  }
}

function retainConditionFields(conditions, row, fields) {
  for (const field of fields) {
    if (
      field === "type" ||
      (row.type === 0 && (field === "sMap" || field === "eMap")) ||
      (row.type === 2 && field === "inParty")
    ) {
      continue;
    }
    conditions.unavailable ??= `Original item condition field ${field} has no recovered consumer`;
  }
}

/** Cosmic StatEffect.CardItemupStats: inclusive area union AND same-map party hunting.
 * Retain the authored object, including malformed records; never invent an eMap repair.
 * Original0238 has only type0/2; other condition types need their actual controller.
 */
export function prepareItemConditions(source) {
  if (source === undefined) return null;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Invalid original item condition metadata");
  }
  const keys = Object.keys(source);
  if (keys.length > MAX_CONDITIONS) {
    throw new Error("Original item condition budget exceeded");
  }
  const conditions = { source, areas: [], party: false, unavailable: null };
  for (const key of keys) {
    const row = source[key];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("Invalid original item condition record");
    }
    const fields = Object.keys(row);
    if (fields.length > MAX_CONDITION_FIELDS) {
      throw new Error("Original item condition field budget exceeded");
    }
    retainConditionType(conditions, row);
    retainConditionFields(conditions, row, fields);
  }
  return conditions;
}

/** Context is preallocated by the owning field; no arrays or callbacks during arbitration. */
export function itemConditionsMatch(conditions, context) {
  if (!conditions) return true;
  if (!context || !integer(context.mapId, MAX_MAP_ID)) return false;
  if (conditions.party && context.partyHunting !== true) return false;
  if (conditions.areas.length === 0) return true;
  for (let index = 0; index < conditions.areas.length; index++) {
    const range = conditions.areas[index];
    if (context.mapId >= range.start && context.mapId <= range.end) return true;
  }
  return false;
}
