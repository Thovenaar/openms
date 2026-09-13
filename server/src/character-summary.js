import {
  array,
  enumeration,
  id,
  integer,
  number,
  record,
  string,
  u32,
  validate,
  protocolError,
} from "../../shared/schema.js";
import { equippedSlots } from "../../client/src/items/inventory-model.js";

const summarySchema = record({
  id,
  name: string(/^[\s\S]{1,32}$/u, 32),
  level: number(1, 200),
  job: u32,
  fame: integer,
  stats: record({
    str: number(1, Number.MAX_SAFE_INTEGER),
    dex: number(1, Number.MAX_SAFE_INTEGER),
    int: number(1, Number.MAX_SAFE_INTEGER),
    luk: number(1, Number.MAX_SAFE_INTEGER),
  }),
  gender: enumeration(0, 1),
  appearance: record({
    skin: number(0, 255),
    face: number(0, 99999),
    hair: number(0, 99999),
  }),
  equipment: array(
    record({ id: number(1000000, 1999999), slot: number(-199, -1) }),
    32,
    0,
    (item) => item?.slot,
  ),
});

/** Equipment comes from authoritative item rows, not the item-free character profile cache. */
export function characterSummary(characterId, profile, equipment, items) {
  if (!profile || typeof profile !== "object") {
    throw protocolError("INVALID_MESSAGE");
  }
  if (!Array.isArray(equipment) || equipment.length > 32) {
    throw protocolError("INVALID_MESSAGE");
  }
  const summary = validate(
    {
      id: characterId,
      name: profile.name,
      level: profile.level,
      job: profile.job,
      fame: profile.fame,
      stats: {
        str: profile.str,
        dex: profile.dex,
        int: profile.int,
        luk: profile.luk,
      },
      gender: profile.gender,
      appearance: { ...profile.appearance },
      equipment: equipment.map((item) => ({ id: item?.id, slot: item?.slot })),
    },
    summarySchema,
  );
  for (const item of summary.equipment) {
    const template = items[item.id];
    if (!template || !equippedSlots(template).includes(item.slot)) {
      throw protocolError("INVALID_MESSAGE");
    }
  }
  return summary;
}
