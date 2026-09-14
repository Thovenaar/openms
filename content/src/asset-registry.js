import {
  assetNotFound,
  indexCatalog,
  searchAssets,
  validateAssetRef,
} from "./asset-index.js";
import { CONTENT_LIMITS, list, requireContent } from "./validation.js";

/** Resource I/O is injected: callers retain their existing hash/length/path verification. */
export class AssetRegistry {
  constructor({ catalog, readJson }) {
    this.rows = indexCatalog(catalog);
    this.catalog = structuredClone(catalog);
    this.readJson = readJson;
    this.buildId = catalog.buildId;
  }

  search(query) {
    return searchAssets(this.rows, query);
  }

  async map(id) {
    const descriptor = this.catalog.maps[id];
    if (!descriptor) assetNotFound({ kind: "map", id });
    const manifest = await this.readJson(descriptor);
    requireContent(
      manifest.id === id && manifest.schemaVersion === 2,
      "Map identity mismatch",
    );
    return manifest;
  }

  async resolve(ref) {
    validateAssetRef(ref);
    let result;
    if (ref.kind === "map") {
      result = {
        name: this.catalog.mapNames?.[Number(ref.id)] ?? ref.id,
        manifest: await this.map(ref.id),
      };
    } else if (ref.kind === "mob") result = await this.monster(ref);
    else if (ref.kind === "npc") result = await this.npc(ref);
    else if (ref.kind === "entity") result = await this.entity(ref);
    else result = await this.catalogResource(ref);
    return {
      ...structuredClone(result),
      ref: { ...ref },
      baseAssetBuildId: this.buildId,
    };
  }

  async monster(ref) {
    const entry = this.catalog.monsters?.[ref.id];
    if (!entry) assetNotFound(ref);
    const manifest = await this.map(entry.mapId);
    const template = manifest.life?.templates[entry.template];
    const renderable = manifest.life?.renderables[entry.template];
    requireContent(
      template?.kind === "mob" && renderable,
      "Monster has no usable artwork",
    );
    requireContent(
      Number(template.originalId) === entry.id,
      "Monster template identity mismatch",
    );
    return {
      name: entry.name,
      template,
      visual: visualResources(renderable.entity, manifest),
    };
  }

  /** Read-only aggregation for browsing: stats, original drops, spawn maps and quests. */
  async monsterDetail(ref) {
    const monster = await this.monster(ref);
    const id = String(ref.id);
    return {
      ref: { ...ref },
      name: monster.name,
      stats: statSummary(monster.template.info),
      visual: monster.visual,
      sourceMapId: this.catalog.monsters?.[id]?.mapId ?? null,
      drops: dropRows(this.catalog, id),
      spawns: spawnMaps(this.catalog, id),
      quests: questRefs(this.catalog, id),
    };
  }

  async npc(ref) {
    const manifest = await this.map(ref.mapId);
    const key = `npc:${ref.id.padStart(7, "0")}`;
    const template = manifest.life?.templates[key];
    if (!template || template.kind !== "npc") assetNotFound(ref);
    const placements = list(
      manifest.life.placements,
      CONTENT_LIMITS.placements,
    );
    const placement = placements.find((entry) => entry.template === key);
    if (!placement) assetNotFound(ref);
    const entity = await this.findEntity(manifest, placement.id);
    return {
      name: template.name,
      template,
      visual: visualResources(entity, manifest),
    };
  }

  async entity(ref) {
    const manifest = await this.map(ref.mapId);
    const entity = await this.findEntity(manifest, ref.id);
    requireContent(
      entity.kind === "map",
      "Only scenery can be reused as a map decoration",
    );
    return { visual: visualResources(entity, manifest) };
  }

  async findEntity(manifest, id) {
    let bytes = 0;
    for (const region of list(manifest.regions, 4096)) {
      bytes += region.bytes;
      requireContent(
        Number.isSafeInteger(bytes) && bytes <= CONTENT_LIMITS.catalogBytes,
        "Source map region lookup exceeds byte budget",
      );
      const value = await this.readJson(region);
      requireContent(
        value.id === region.id && value.schemaVersion === 2,
        "Region identity mismatch",
      );
      const entity = list(value.entities, 8192).find((row) => row.id === id);
      if (entity) return entity;
    }
    return assetNotFound({ kind: "entity", id });
  }

  async catalogResource(ref) {
    if (ref.kind === "sound") return this.sound(ref);
    const records = {
      item: this.catalog.ui?.items,
      quest: this.catalog.quests?.records,
      bundle: this.catalog.ui?.bundles,
    };
    const value = records[ref.kind]?.[ref.id];
    if (!value) assetNotFound(ref);
    if (ref.kind === "quest") return { record: value };
    const descriptor = ref.kind === "bundle" ? value : value.descriptor;
    if (!descriptor) assetNotFound(ref);
    return { record: value, bundle: await this.readJson(descriptor) };
  }

  sound(ref) {
    const [group, name, extra] = ref.id.split("/");
    const descriptor =
      !extra && this.catalog.audiovisual?.sounds?.[group]?.[name];
    if (!descriptor) assetNotFound(ref);
    return { descriptor };
  }
}

/** Stats a mob author can override; only original numeric values are copied. */
const MOB_STATS = [
  "maxHP",
  "maxMP",
  "level",
  "exp",
  "PADamage",
  "PDDamage",
  "MADamage",
  "MDDamage",
  "acc",
  "eva",
  "pushed",
  "speed",
  "bodyAttack",
  "undead",
];

function statSummary(info) {
  const stats = {};
  for (const key of MOB_STATS) {
    if (Number.isFinite(info?.[key])) stats[key] = info[key];
  }
  return stats;
}

function dropRows(catalog, mobId) {
  const items = catalog.ui?.items ?? {};
  const rows = catalog.drops?.mobs?.[mobId]?.rows ?? [];
  return list(rows, 512).map((row) => ({
    itemId: row.itemId,
    itemName: items[row.itemId]?.name ?? String(row.itemId),
    minimum: row.minimum ?? 1,
    maximum: row.maximum ?? row.minimum ?? 1,
    questId: row.questId ?? 0,
    chance: row.chance,
  }));
}

function spawnMaps(catalog, mobId) {
  const rows = catalog.spawns?.mobs?.[mobId] ?? [];
  return list(rows, 1024).map((row) => ({
    mapId: row.mapId,
    mapName: catalog.mapNames?.[Number(row.mapId)] ?? row.mapId,
    count: row.count ?? 1,
  }));
}

function questRefs(catalog, mobId) {
  const records = catalog.quests?.records ?? {};
  const rows = catalog.quests?.content?.mobs?.[mobId] ?? [];
  return list(rows, 256).map((id) => ({
    id: String(id),
    name: records[id]?.name ?? String(id),
  }));
}

/** Borrow precisely the entity's resources; atlas coordinates never become authoring identities. */
export function visualResources(entity, manifest) {
  const textures = Object.create(null),
    atlases = Object.create(null);
  const actions = Object.values(entity.actions);
  requireContent(actions.length <= 128, "Action count exceeds limit");
  for (const frames of actions) {
    for (const frame of list(frames, 4096)) {
      for (const part of list(frame.parts, 128)) {
        const texture = manifest.textures[part.texture];
        const atlas = manifest.atlases[texture?.atlas];
        requireContent(texture && atlas, "Missing sprite resource");
        textures[part.texture] = texture;
        atlases[texture.atlas] = atlas;
      }
    }
  }
  return { entity, textures, atlases };
}
