import { protocolError } from "../../shared/schema.js";
import { actorEntity } from "./field-views.js";

const MAX_ENTITIES = 2048;
const MAX_PART_ENTITIES = 128;
const MAX_PART_BYTES = 48 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const MAX_PARTS = 64;

/** Snapshot-equivalent observable data only, sized before any prepare packet is published. */
export function travelPreview(world, target, traveler) {
  const entities = world.entities({ field: target });
  const replacement = actorEntity(traveler);
  const index = entities.findIndex((entity) => entity.id === traveler.id);
  if (index < 0) entities.push(replacement);
  else entities[index] = replacement;
  if (entities.length > MAX_ENTITIES) throw protocolError("SERVER_BUSY");
  const chunks = [];
  let chunk = [],
    bytes = 0,
    total = MAX_PARTS * 2;
  for (const entity of entities) {
    const size = Buffer.byteLength(JSON.stringify(entity)) + 1;
    total += size;
    if (size > MAX_PART_BYTES || total > MAX_TOTAL_BYTES) {
      throw protocolError("SERVER_BUSY");
    }
    if (
      chunk.length &&
      (bytes + size > MAX_PART_BYTES || chunk.length >= MAX_PART_ENTITIES)
    ) {
      chunks.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push(entity);
    bytes += size;
  }
  if (chunk.length || !chunks.length) chunks.push(chunk);
  if (chunks.length > MAX_PARTS) throw protocolError("SERVER_BUSY");
  return chunks.map((entries, part) => ({
    serverTick: target.tick,
    part,
    parts: chunks.length,
    entities: entries,
  }));
}

export function publishTravelPreview(world, actor, transition) {
  const chunks = travelPreview(
    world,
    transition.target,
    transition.skillCandidate ?? actor,
  );
  for (const preparation of chunks) {
    world.publish(actor, {
      type: "transition",
      transitionId: transition.transitionId,
      phase: "prepare",
      sourceEpoch: transition.source.epoch,
      destination: transition.reference,
      requiredContent: [
        world.content.catalog.maps[transition.target.manifest.id].sha256,
      ],
      deadline: transition.deadline,
      code: "OK",
      preparation,
    });
  }
}
