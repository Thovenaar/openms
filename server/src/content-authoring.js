import { ContentService, CONTENT_LIMITS, contentError } from "@openms/content";
import { PostgresContentStore } from "@openms/content/postgres";
import {
  manifest,
  entities,
} from "../../client/src/rendering/stream-validation.js";
import { createSimulation } from "../../client/src/physics/simulation.js";
import {
  createMobs,
  compileActions,
} from "../../client/src/combat/offline-mobs.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { validateLife } from "../../client/src/world/life-validation.js";
import { decodePNG } from "../../client/tools/validation-png.js";

/** No extraction/output writes. Reuse the server's verified original-resource reader. */
export function createContentService(database, original) {
  return new ContentService({
    store: new PostgresContentStore(database.sql),
    readJson: original.json.bind(original),
    validateRuntime: validateRuntimeContent,
    inspectImage: inspectContentImage,
  });
}

/** Reuse established geometry/animation consumers before a draft can be published. */
export function validateRuntimeContent(runtime) {
  try {
    if (runtime.kind === "mob") validateMonster(runtime);
    if (runtime.kind === "map") validateMapContent(runtime);
  } catch (error) {
    if (error.code) throw error;
    throw contentError("INVALID_CONTENT", error.message);
  }
}

function validateMonster(runtime) {
  compileActions(runtime.template);
  entities([runtime.visual.entity], runtime.visual);
  if (
    !(runtime.template.info.maxHP > 0) ||
    runtime.template.info.inactive === 1
  ) {
    throw contentError(
      "INVALID_CONTENT",
      "Monster must have positive HP and an active base definition",
    );
  }
}

function validateMapContent(runtime) {
  const scene = manifest(runtime.manifest);
  validateLife(scene.life);
  const spawn = nearestSavedArrival(scene, { x: 0, y: 0, facing: 1 });
  const simulation = createSimulation(scene.physics, spawn);
  const mobs = createMobs(scene.life, simulation);
  for (const mob of mobs) {
    if (mob.id.startsWith("custom:") && !mob.active) {
      throw contentError(
        "INVALID_CONTENT",
        `Custom spawn is inactive: ${mob.inactiveReason}`,
      );
    }
  }
  for (const region of Object.values(runtime.resources)) {
    entities(region.entities, scene);
  }
}

/** Restrict dimensions before full decoding, then verify PNG framing, CRCs and scanlines. */
export function inspectContentImage(bytes) {
  try {
    if (bytes.length < 33) throw new Error("Truncated PNG header");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16),
      height = view.getUint32(20);
    if (
      width < 1 ||
      height < 1 ||
      width > CONTENT_LIMITS.imageSide ||
      height > CONTENT_LIMITS.imageSide
    ) {
      throw new Error("PNG dimensions must be within 1..2048 pixels");
    }
    const decoded = decodePNG(bytes);
    return decoded;
  } catch (error) {
    throw contentError("INVALID_CONTENT", error.message);
  }
}
