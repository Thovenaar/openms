import { canonical, digest } from "./digest.js";
import { referenceKey } from "./definitions.js";
import { mergeVisual } from "./appearance.js";
import { requireContent } from "./validation.js";

/** Reuse original descriptors; only modified/new regions are held in the database publication. */
export async function compileMap(row, context) {
  const base = context.dependencies.get(referenceKey(row.definition.base));
  const manifest = structuredClone(base.manifest);
  const resources = Object.create(null);
  manifest.id = String(row.runtimeId).padStart(9, "0");
  manifest.source = `custom:${row.projectId}/${row.id}@${row.revision}`;
  manifest.provenance = {
    source: "custom",
    base: row.definition.base,
    buildId: row.baseAssetBuildId,
  };
  if (row.definition.bounds) {
    manifest.bounds = structuredClone(row.definition.bounds);
    Object.assign(manifest.physics.map, {
      VRLeft: manifest.bounds.left,
      VRTop: manifest.bounds.top,
      VRRight: manifest.bounds.right,
      VRBottom: manifest.bounds.bottom,
    });
  }
  if (row.definition.footholds) {
    manifest.physics.footholds = structuredClone(row.definition.footholds);
  }
  if (row.definition.ladders) {
    manifest.physics.ladders = structuredClone(row.definition.ladders);
  }
  manifest.life.mapId = manifest.id;
  await removeScenery(row, manifest, resources, context);
  await addScenery(row, manifest, resources, context);
  addSpawns(row, manifest, context.dependencies);
  return { kind: "map", manifest, resources };
}

function regionResource(row, resources, value) {
  const encoded = canonical(value);
  const sha256 = digest(encoded);
  resources[sha256] = value;
  return {
    url: `/api/v1/custom-content/regions/${row.projectId}/${row.id}/${row.revision}/${sha256}`,
    sha256,
    bytes: Buffer.byteLength(encoded),
  };
}

async function removeScenery(row, manifest, resources, context) {
  const missing = new Set(row.definition.removeEntities ?? []);
  if (!missing.size) return;
  for (const region of manifest.regions) {
    const value = structuredClone(await context.registry.readJson(region));
    let changed = false;
    value.entities = value.entities.filter((entity) => {
      if (!missing.has(entity.id)) return true;
      requireContent(
        entity.kind === "map",
        "Use the domain owner to remove NPCs or portals",
      );
      missing.delete(entity.id);
      changed = true;
      return false;
    });
    if (changed) Object.assign(region, regionResource(row, resources, value));
  }
  requireContent(missing.size === 0, "A removed scenery entity does not exist");
}

async function addScenery(row, manifest, resources, context) {
  const entities = [];
  for (const placement of row.definition.entities) {
    const visual = await context.appearance(placement.appearance);
    mergeVisual(manifest, visual);
    entities.push({
      ...visual.entity,
      id: `custom:${placement.id}`,
      kind: "map",
      x: placement.x,
      y: placement.y,
      z: placement.z,
      flip: placement.flip,
      order: 200000 + entities.length,
    });
  }
  if (!entities.length) return;
  const bounds = artworkBounds(entities, manifest.textures);
  const id = "custom-additions";
  const descriptor = regionResource(row, resources, {
    schemaVersion: 2,
    id,
    entities,
  });
  manifest.regions.push({
    id,
    bounds,
    always: true,
    atlases: Object.keys(manifest.atlases),
    ...descriptor,
  });
}

function addSpawns(row, manifest, dependencies) {
  const missing = new Set(row.definition.removeSpawns ?? []);
  manifest.life.placements = manifest.life.placements.filter((placement) => {
    if (!missing.has(placement.id)) return true;
    requireContent(placement.kind === "mob", "Only mob spawns can be removed");
    missing.delete(placement.id);
    return false;
  });
  requireContent(missing.size === 0, "A removed spawn does not exist");
  const footholds = new Set(
    manifest.physics.footholds.map((foothold) => foothold.id),
  );
  for (const spawn of row.definition.spawns) {
    requireContent(
      footholds.has(spawn.foothold),
      "Spawn references a missing foothold",
      spawn.id,
    );
    const resolved = dependencies.get(referenceKey(spawn.mob));
    const mob = spawn.mob.source === "custom" ? resolved.runtime : resolved;
    const key = mob.template.key;
    mergeVisual(manifest, mob.visual);
    manifest.life.templates[key] = structuredClone(mob.template);
    manifest.life.renderables[key] = {
      entity: mob.visual.entity,
      atlases: Object.keys(mob.visual.atlases),
      bounds: artworkBounds(
        [{ ...mob.visual.entity, x: 0, y: 0 }],
        mob.visual.textures,
      ),
    };
    manifest.life.placements.push(spawnPlacement(spawn, mob.template));
  }
  requireContent(
    manifest.life.placements.length <= 4096,
    "Combined life placement limit exceeded",
  );
}

function spawnPlacement(spawn, template) {
  return {
    id: `custom:${spawn.id}`,
    kind: "mob",
    template: template.key,
    source: "custom",
    authored: {
      id: template.originalId,
      type: "m",
      x: spawn.x,
      y: spawn.y,
      cy: spawn.y,
      fh: spawn.foothold,
      rx0: spawn.range.left,
      rx1: spawn.range.right,
      f: spawn.facing === 1 ? 0 : 1,
      hide: 0,
      mobTime: 0,
    },
  };
}

function artworkBounds(entities, textures) {
  const bounds = {
    left: Infinity,
    top: Infinity,
    right: -Infinity,
    bottom: -Infinity,
  };
  for (const entity of entities) {
    for (const frames of Object.values(entity.actions)) {
      for (const frame of frames) includeFrame(bounds, entity, frame, textures);
    }
  }
  requireContent(
    Object.values(bounds).every(Number.isFinite),
    "Artwork has no finite bounds",
  );
  return bounds;
}

function includeFrame(bounds, entity, frame, textures) {
  for (const part of frame.parts) {
    const texture = textures[part.texture];
    requireContent(texture, "Artwork texture is missing");
    const x = entity.x + (entity.flip ? -part.x - texture.width : part.x);
    const y = entity.y + part.y;
    bounds.left = Math.min(bounds.left, x);
    bounds.top = Math.min(bounds.top, y);
    bounds.right = Math.max(bounds.right, x + texture.width);
    bounds.bottom = Math.max(bounds.bottom, y + texture.height);
  }
}
