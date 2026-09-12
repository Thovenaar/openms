import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hash } from "./atlas.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_RECIPE_FILES = 512;
// Version changes cover orchestration contracts; imports cover transitive implementations.
export const EXTRACTION_RECIPE_VERSION = 2;
const ROOTS = {
  quests: ["quest-data.js", "atlas.js"],
  combat: ["combat-data.js"],
  server: ["server-data.js"],
  ui: ["ui-data.js", "packaging.js", "canvas-tiles.js", "extraction-frames.js"],
  audiovisual: [
    "audiovisual-data.js",
    "packaging.js",
    "canvas-tiles.js",
    "extraction-frames.js",
  ],
  map: [
    "extract.js",
    "extraction-inputs.js",
    "extraction-frames.js",
    "physics-data.js",
    "portal-data.js",
    "life-data.js",
    "reactor-data.js",
    "packaging.js",
    "canvas-tiles.js",
    "../src/assets/canvas.js",
  ],
  hitboxes: ["hitbox-data.js", "atlas.js"],
  loading: [
    "loading-art.js",
    "packaging.js",
    "canvas-tiles.js",
    "extraction-frames.js",
  ],
};
const COMMON = [
  "extraction-state.js",
  "extraction-cache.js",
  "extraction-outputs.js",
  "extraction-recipes.js",
];
/** Resolve only static local source imports; docs/scenarios/browser tooling are not recipes. */
export function extractionRecipes(root = ROOT) {
  const files = new Map();
  const recipes = new Map();
  return async function recipe(name) {
    if (!ROOTS[name]) throw new Error(`Unknown extraction recipe ${name}`);
    if (recipes.has(name)) return recipes.get(name);
    const pending = [...ROOTS[name], ...COMMON].map((file) =>
      resolve(root, "client/tools", file),
    );
    const visited = new Set();
    for (let index = 0; index < pending.length; index++) {
      if (pending.length > MAX_RECIPE_FILES) {
        throw new Error("Extraction recipe graph limit exceeded");
      }
      const path = pending[index];
      if (visited.has(path)) continue;
      visited.add(path);
      const entry = await recipeFile(path, root, files);
      for (const dependency of entry.imports) {
        if (!visited.has(dependency) && !pending.includes(dependency)) {
          pending.push(dependency);
        }
      }
    }
    const sources = [...visited]
      .sort()
      .map((path) => [relative(root, path), files.get(path).sha256]);
    const result = hash(
      Buffer.from(
        JSON.stringify({ version: EXTRACTION_RECIPE_VERSION, name, sources }),
      ),
    );
    recipes.set(name, result);
    return result;
  };
}

async function recipeFile(path, root, files) {
  if (files.has(path)) return files.get(path);
  const local = relative(root, path);
  if (local.startsWith("..") || !local.endsWith(".js")) {
    throw new Error(`Invalid extraction recipe path ${path}`);
  }
  const bytes = Buffer.from(await Bun.file(path).arrayBuffer());
  const imports = [];
  const scanner = new Bun.Transpiler({ loader: "js" });
  // The entry point orchestrates independent units; its imported siblings are not map recipes.
  if (local !== "client/tools/extract.js") {
    for (const entry of scanner.scanImports(bytes.toString())) {
      if (entry.path.startsWith(".")) {
        imports.push(resolve(dirname(path), entry.path));
      }
    }
  }
  const result = { sha256: hash(bytes), imports };
  files.set(path, result);
  return result;
}
