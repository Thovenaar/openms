import { destroyFieldReactors } from "./field-reactors.js";

/** Synchronous retirement only after every authority owner has released its field. */
export function canRetireField(world, field) {
  if (
    field.characters.size ||
    field.entryReservations ||
    field.travelReservations ||
    field.dropReservations ||
    field.drops.size ||
    field.reactors.pending
  ) {
    return false;
  }
  for (const actor of world.actors.values()) {
    if (actorRetainsField(actor, field)) return false;
  }
  return true;
}

/** Field Map order is LRU. Occupied or in-flight fields never lose identity or state. */
export function retireIdleField(world) {
  for (const [key, field] of world.fields) {
    if (world.fieldLoads.has(key) || !canRetireField(world, field)) continue;
    destroyFieldReactors(field);
    world.fields.delete(key);
    field.retired = true;
    field.mobs.length = 0;
    field.npcs.clear();
    field.published.clear();
    world.log?.("field.retired", { map: field.mapId, instance: field.id });
    return true;
  }
  return false;
}

export function touchField(world, key, field, retain) {
  world.fields.delete(key);
  world.fields.set(key, field);
  if (retain) field.entryReservations = (field.entryReservations ?? 0) + 1;
  return field;
}

function actorRetainsField(actor, field) {
  if (
    actor.field === field ||
    actor.transition?.source === field ||
    actor.transition?.target === field
  ) {
    return true;
  }
  const door = actor.skills?.worldController.door;
  if (
    door?.remainingMs > 0 &&
    [door.source.mapId, door.town.mapId].some(
      (id) => Number(id) === field.mapId,
    )
  ) {
    return true;
  }
  return false;
}
