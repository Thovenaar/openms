// Regenerate the retained original-physics evidence files under docs/ from the supplied
// Map.wz. Values are decoded by the production extraction helper, never transcribed.
//
// Usage: bun client/tools/regenerate-physics-evidence.js [--assets ../Maplestory-Client]
import { resolve } from "node:path";
import { WzArchive } from "../src/assets/wz.js";
import { parseImage } from "../src/assets/image.js";
import { readPhysicsData } from "./physics-data.js";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

const source = resolve(option("assets", "../Maplestory-Client"));
const archive = new WzArchive(resolve(source, "Map.wz"));
try {
  const physics = parseImage(archive.imageReader("Physics.img"));
  const globalsMap = readPhysicsData(
    parseImage(archive.imageReader("Map/Map1/100000000.img")),
    physics,
  );
  const globals = {
    schemaVersion: 1,
    source: "Map.wz/Physics.img",
    decoder: "client/src/assets/image.js parseImage",
    consumer: "client/tools/physics-data.js readPhysicsData",
    globals: globalsMap.globals,
  };
  await Bun.write(
    new URL(
      "../../docs/ghidra-physics-motion/wz-globals.json",
      import.meta.url,
    ),
    JSON.stringify(globals, null, 2) + "\n",
  );

  const tower = readPhysicsData(
    parseImage(archive.imageReader("Map/Map2/200081100.img")),
    physics,
  );
  const collision = {
    schemaVersion: 1,
    source: "Map.wz/Map/Map2/200081100.img",
    decoder: "client/src/assets/image.js parseImage",
    consumer: "client/tools/physics-data.js readPhysicsData",
    footholds: tower.footholds,
    map: tower.map,
  };
  await Bun.write(
    new URL(
      "../../docs/ghidra-physics-refinements/200081100-collision.json",
      import.meta.url,
    ),
    JSON.stringify(collision, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      globals: Object.keys(globals.globals).length,
      footholds: tower.footholds.length,
    }),
  );
} finally {
  archive.close();
}
