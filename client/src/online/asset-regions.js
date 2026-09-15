import { entries, array, LIMITS } from "../rendering/stream-validation.js";

const VICTORIA = "WorldMap010";
const NAMES = { WorldMap000: "Maple Island", [VICTORIA]: "Victoria Island" };

/** Original WorldMap membership, including its child maps, defines regional downloads. */
export function assetRegions(catalog, metadata) {
  const groups = new Map(),
    membership = new Map(),
    districts = new Map();
  const worlds = metadata.worldMaps;
  authoredMembership(catalog, worlds, membership, districts);
  for (const [id, descriptor] of entries(catalog.maps, LIMITS.maps)) {
    if (!descriptor.url.startsWith("/generated/")) continue;
    const root = membership.get(id) ?? inferredRegion(id, districts);
    membership.set(id, root);
    if (!groups.has(root)) {
      groups.set(root, {
        id: root,
        name:
          NAMES[root] ?? `Region around ${catalog.mapNames[Number(id)] ?? id}`,
        maps: [],
      });
    }
    groups.get(root).maps.push(id);
  }
  return { groups, membership, defaultRegion: VICTORIA };
}

function authoredMembership(catalog, worlds, membership, districts) {
  for (const [key, world] of entries(worlds, 256)) {
    if (key === "WorldMap") continue;
    const root = regionalRoot(key, worlds);
    for (const spot of array(world.spots, 4096)) {
      for (const number of array(spot.maps, LIMITS.maps)) {
        const id = String(number).padStart(9, "0");
        if (catalog.maps[id]) membership.set(id, root);
        const district = Math.floor(number / 1000000);
        if (!districts.has(district)) districts.set(district, root);
        else if (districts.get(district) !== root) {
          districts.set(district, null);
        }
      }
    }
  }
}

/** Include unlisted Victoria interiors/job rooms; other interiors inherit a known district. */
function inferredRegion(id, districts) {
  if (Number(id) >= 100000000 && Number(id) < 110000000) return VICTORIA;
  return districts.get(Math.floor(Number(id) / 1000000)) ?? `map:${id}`;
}

function regionalRoot(key, worlds) {
  let root = key;
  for (let depth = 0; depth < 256; depth++) {
    const parent = worlds[root]?.parent;
    if (!parent || parent === "WorldMap" || !worlds[parent]) return root;
    root = parent;
  }
  throw new Error("World map parent cycle");
}
