import {
  CONTENT_LIMITS,
  integer,
  list,
  record,
  requireContent,
} from "./validation.js";
import { validateAssetRef } from "./asset-index.js";

/** Bounded map-local scenery inventory; the selected entity remains in the original region. */
export async function sceneAssets(registry, query) {
  record(query, ["mapId", "offset", "limit"]);
  validateAssetRef({ source: "original", kind: "map", id: query.mapId });
  integer(query.offset, 0, 65536);
  integer(query.limit, 1, 100);
  const manifest = await registry.map(query.mapId);
  const matches = [];
  let total = 0,
    bytes = 0;
  for (const region of list(manifest.regions, 4096)) {
    bytes += region.bytes;
    requireContent(
      bytes <= CONTENT_LIMITS.catalogBytes,
      "Map scenery inventory exceeds byte budget",
    );
    const data = await registry.readJson(region);
    for (const entity of list(data.entities, 8192)) {
      if (entity.kind !== "map") continue;
      if (total >= query.offset && matches.length < query.limit) {
        matches.push({
          source: "original",
          kind: "entity",
          id: entity.id,
          mapId: manifest.id,
          name: entity.source ?? entity.id,
        });
      }
      total++;
      requireContent(total <= 65536, "Map scenery count exceeds limit");
    }
    if (matches.length === query.limit) break;
  }
  return {
    matches,
    offset: query.offset,
    hasMore: matches.length === query.limit,
  };
}
