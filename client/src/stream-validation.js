/** Browser engineering limits, not recovered game constants. */
export const LIMITS = Object.freeze({
  fetches: 4,
  decodes: 2,
  queue: 256,
  resourceBytes: 32 * 1024 * 1024,
  gpuBytes: 192 * 1024 * 1024,
  cpuBytes: 192 * 1024 * 1024,
  cacheBytes: 192 * 1024 * 1024,
  cacheEntries: 2048,
  uploadBytes: 16 * 1024 * 1024,
  uploadMs: 4,
  maps: 512,
  regions: 4096,
  textures: 65536,
  entities: 8192,
  actions: 128,
  frames: 4096,
  parts: 4096,
  sprites: 65536,
  atlasSide: 2048,
});

/** Reject corrupt boundaries before allocating renderer resources. */
export function finite(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Nonfinite asset coordinate");
  }
}
export function bounds(value) {
  if (!value) throw new Error("Missing bounds");
  for (const key of ["left", "top", "right", "bottom"]) finite(value[key]);
  if (value.right <= value.left || value.bottom <= value.top) {
    throw new Error("Unordered bounds");
  }
}
export function entries(value, limit) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object dictionary");
  }
  const result = Object.entries(value);
  if (result.length > limit) {
    throw new Error("Dictionary exceeds resource limit");
  }
  return result;
}
export function array(value, limit) {
  if (!Array.isArray(value) || value.length > limit) {
    throw new Error("Invalid bounded array");
  }
  return value;
}
export function resource(info) {
  if (
    !info ||
    !/^\/generated\/[a-zA-Z0-9/_.-]+$/.test(info.url) ||
    !/^[a-f0-9]{64}$/.test(info.sha256) ||
    !Number.isInteger(info.bytes) ||
    info.bytes <= 0 ||
    info.bytes > LIMITS.resourceBytes
  ) {
    throw new Error("Invalid content-addressed resource");
  }
}
export function catalog(value) {
  if (value?.schemaVersion !== 2 || typeof value.buildId !== "string") {
    throw new Error("Catalog version must be 2");
  }
  for (const [, map] of entries(value.maps, LIMITS.maps)) {
    resource(map);
    array(map.neighbors, LIMITS.maps);
    for (const id of map.neighbors) {
      if (typeof id !== "string") throw new Error("Invalid neighbor ID");
    }
  }
  if (!Object.hasOwn(value.maps, value.defaultMap)) {
    throw new Error("Default map unavailable");
  }
  return value;
}
function atlasDictionary(value) {
  for (const [, atlas] of entries(value.atlases, LIMITS.textures)) {
    resource(atlas);
    for (const key of ["width", "height"]) {
      if (
        !Number.isInteger(atlas[key]) ||
        atlas[key] < 1 ||
        atlas[key] > LIMITS.atlasSide
      ) {
        throw new Error("Unsupported atlas dimensions");
      }
    }
  }
}
function textureDictionary(value) {
  for (const [, texture] of entries(value.textures, LIMITS.textures)) {
    const atlas = value.atlases[texture.atlas];
    if (!atlas) throw new Error("Unknown texture atlas");
    for (const key of ["x", "y", "width", "height"]) {
      if (
        !Number.isInteger(texture[key]) ||
        texture[key] < (key === "x" || key === "y" ? 0 : 1)
      ) {
        throw new Error("Invalid atlas rectangle");
      }
    }
    if (
      texture.x + texture.width > atlas.width ||
      texture.y + texture.height > atlas.height
    ) {
      throw new Error("Atlas rectangle overflow");
    }
  }
}
function regionDescriptors(value) {
  const ids = new Set();
  for (const region of array(value.regions, LIMITS.regions)) {
    resource(region);
    bounds(region.bounds);
    if (
      typeof region.id !== "string" ||
      ids.has(region.id) ||
      typeof region.always !== "boolean"
    ) {
      throw new Error("Invalid region ID/visibility");
    }
    ids.add(region.id);
    for (const id of array(region.atlases, LIMITS.textures)) {
      if (!Object.hasOwn(value.atlases, id)) {
        throw new Error("Unknown region atlas");
      }
    }
  }
}
export function manifest(value) {
  if (value?.schemaVersion !== 2 || typeof value.id !== "string") {
    throw new Error("Map version must be 2");
  }
  bounds(value.bounds);
  finite(value.camera?.x);
  finite(value.camera?.y);
  atlasDictionary(value);
  textureDictionary(value);
  regionDescriptors(value);
  entities(value.actors, value);
  return value;
}

/** Independent UI/effect resources retain the existing entity and atlas contracts. */
export function visualBundle(value) {
  if (
    value?.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    !value.metadata ||
    typeof value.metadata !== "object" ||
    Array.isArray(value.metadata)
  ) {
    throw new Error("Invalid visual bundle");
  }
  atlasDictionary(value);
  textureDictionary(value);
  entities(value.entities, value);
  return value;
}
function alpha(value) {
  if (value === undefined) return;
  finite(value);
  if (value < 0 || value > 1) throw new Error("Invalid original alpha");
}
function sourceSize(value) {
  if (!value) return;
  for (const key of ["width", "height"]) {
    if (
      !Number.isInteger(value[key]) ||
      value[key] <= 0 ||
      value[key] > 32768
    ) {
      throw new Error("Invalid logical source canvas dimensions");
    }
  }
}
function frame(value, map, background) {
  finite(value.delay);
  if (value.delay < 0) {
    throw new Error("Invalid animation duration");
  }
  alpha(value.alphaEnd);
  frameParts(value, map, background);
}
/** Validate original canvas extent and each atlas-backed frame part. */
function frameParts(value, map, background) {
  const parts = array(value.parts, LIMITS.parts);
  sourceSize(value.sourceSize);
  if (
    background &&
    (!parts.length || (parts.length > 1 && !value.sourceSize))
  ) {
    throw new Error("Tiled backgrounds require their original sourceSize");
  }
  for (const part of parts) {
    if (!Object.hasOwn(map.textures, part.texture)) {
      throw new Error("Unknown part texture");
    }
    for (const key of ["x", "y", "z"]) finite(part[key]);
    alpha(part.opacity);
  }
}
function background(value) {
  if (!Number.isInteger(value.type) || value.type < 0 || value.type > 7) {
    throw new Error("Unsupported background mode");
  }
  for (const key of ["rx", "ry", "cx", "cy"]) finite(value[key]);
  if (value.cx < 0 || value.cy < 0) {
    throw new Error("Negative background spacing");
  }
}
/** Validate action collections and the initial action after entity metadata. */
function entityActions(entity, map) {
  for (const [, frames] of entries(entity.actions, LIMITS.actions)) {
    if (!array(frames, LIMITS.frames).length) throw new Error("Empty action");
    for (const value of frames) {
      frame(value, map, entity.background);
    }
  }
  if (!Object.hasOwn(entity.actions, entity.action)) {
    throw new Error("Missing initial action");
  }
}
export function entities(values, map) {
  const ids = new Set();
  for (const entity of array(values, LIMITS.entities)) {
    if (typeof entity.id !== "string" || ids.has(entity.id)) {
      throw new Error("Invalid entity identity");
    }
    ids.add(entity.id);
    if (!Number.isSafeInteger(entity.order) || entity.order < 0) {
      throw new Error("Missing global entity draw order");
    }
    if (
      ![
        "map",
        "character",
        "ui",
        "portal",
        "mob",
        "npc",
        "effect",
        "reactor",
      ].includes(entity.kind)
    ) {
      throw new Error("Unsupported entity kind");
    }
    for (const key of ["x", "y", "z"]) finite(entity[key]);
    alpha(entity.opacity);
    if (entity.background) background(entity.background);
    entityActions(entity, map);
  }
  return values;
}
