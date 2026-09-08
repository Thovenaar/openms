import { resolve } from "node:path";
import { WzArchive } from "../src/assets/wz.js";
import { parseImage } from "../src/assets/image.js";
import { annotatePhysicsOption } from "./physics-option-evidence.js";

const MAX_IMAGES = 100000;
const MAX_NODES = 2000000;
const MAX_OPTIONS = 100000;
const MAX_VALUES = 100000;
const SAMPLE_PATHS = 8;
const ARCHIVES = [
  "Map",
  "Skill",
  "Character",
  "Morph",
  "Item",
  "Mob",
  "TamingMob",
  "Npc",
  "Reactor",
  "Etc",
  "UI",
  "Effect",
  "Sound",
  "String",
  "Quest",
  "Base",
];
const CANDIDATE =
  /speed|jump|swim|fly|float|friction|force|drag|gravity|fall|slip|mass|move|push|pull|knock|impact|accel|water|ladder|rope|foothold|slope|morph|ride|dash|teleport|climb|flow|bounce|cant|forbid|limit|(^|\/)fs$/i;

/** Inventory all metadata, not artwork pixels. Original paths use # for numeric segments.
 * @param {string} archive @param {string} image @param {string} path */
function selected(archive, image, path) {
  if (archive === "Map") {
    if (image === "Physics.img") return true;
    if (!/^Map\/Map\d\//.test(image)) return CANDIDATE.test(path);
    return (
      !/^(\d+|back|life|reactor|miniMap|ToolTip)(\/|$)/.test(path) ||
      CANDIDATE.test(path)
    );
  }
  if (archive === "Morph" || archive === "TamingMob") return true;
  return /(^|\/)(info|level|common)(\/|$)/.test(path) || CANDIDATE.test(path);
}

/** @param {Map<string, any>} options @param {string} source @param {string} path @param {any} value */
function record(options, source, path, value) {
  const normalized = `${source}/${path}`.replace(
    /(^|\/)\d+(?=\/|\.img|$)/g,
    "$1#",
  );
  let option = options.get(normalized);
  if (!option) {
    if (options.size >= MAX_OPTIONS) {
      throw new Error("Option inventory exceeds limit");
    }
    option = {
      path: normalized,
      count: 0,
      values: new Map(),
      minimum: null,
      maximum: null,
      samplePaths: [],
      candidate: CANDIDATE.test(path),
      status: "unknown",
      consumers: [],
      default: "unrecovered",
      precedence: "unrecovered",
    };
    options.set(normalized, option);
  }
  option.count++;
  const key = JSON.stringify(value);
  if (!option.values.has(key) && option.values.size >= MAX_VALUES) {
    throw new Error(`Distinct value inventory exceeds limit: ${normalized}`);
  }
  option.values.set(key, (option.values.get(key) ?? 0) + 1);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Nonfinite option ${source}/${path}`);
    }
    option.minimum =
      option.minimum === null ? value : Math.min(option.minimum, value);
    option.maximum =
      option.maximum === null ? value : Math.max(option.maximum, value);
  }
  if (option.samplePaths.length < SAMPLE_PATHS) {
    option.samplePaths.push(`${source}/${path}`);
  }
}

/** @param {any} root @param {string[]} origin @param {Map<string, any>} options @param {any} coverage */
function inspect(root, origin, options, coverage) {
  const queue = [{ node: root, path: "" }];
  const seen = new Set();
  for (let index = 0; index < queue.length; index++) {
    if (index >= MAX_NODES) {
      throw new Error(`Image traversal exceeds ${MAX_NODES} nodes`);
    }
    const { node, path } = queue[index];
    if (seen.has(node)) throw new Error(`Cyclic metadata ${path}`);
    seen.add(node);
    coverage.nodes++;
    if (Object.hasOwn(node, "value")) {
      coverage.values++;
      if (selected(origin[0], origin[1], path)) {
        record(options, `${origin[0]}.wz/${origin[1]}`, path, node.value);
        coverage.selectedValues++;
      }
    }
    const children = Object.values(node.children);
    if (queue.length + children.length > MAX_NODES) {
      throw new Error("Image queue exceeds node limit");
    }
    for (const child of children) {
      queue.push({
        node: child,
        path: path ? `${path}/${child.name}` : child.name,
      });
    }
  }
}

/** @param {string} source @param {string} name @param {Map<string, any>} options */
function scanArchive(source, name, options) {
  const archive = new WzArchive(resolve(source, `${name}.wz`));
  const coverage = {
    archive: `${name}.wz`,
    entries: archive.entries.size,
    images: 0,
    parsedImages: 0,
    nodes: 0,
    values: 0,
    selectedValues: 0,
    failures: [],
  };
  try {
    if (archive.entries.size > MAX_IMAGES) {
      throw new Error("Archive entry limit exceeded");
    }
    for (const entry of archive.entries.values()) {
      if (entry.type !== 4) continue;
      coverage.images++;
      try {
        inspect(
          parseImage(archive.imageReader(entry.path)),
          [name, entry.path],
          options,
          coverage,
        );
        coverage.parsedImages++;
      } catch (error) {
        coverage.failures.push({ path: entry.path, error: String(error) });
      }
    }
  } finally {
    archive.close();
  }
  console.log(JSON.stringify(coverage));
  return coverage;
}

/** Read-only original WZ experiment; no build, formatter or test suite.
 * @param {string} source @param {string} output */
export async function inventoryPhysics(source, output) {
  const options = new Map();
  const coverage = [];
  for (const name of ARCHIVES) {
    coverage.push(scanArchive(source, name, options));
  }
  const rows = [];
  for (const option of options.values()) {
    annotatePhysicsOption(option);
    option.values = Array.from(option.values, ([value, count]) => ({
      value: JSON.parse(value),
      count,
    }));
    rows.push(option);
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));
  await Bun.write(
    output,
    JSON.stringify(
      {
        schemaVersion: 1,
        source,
        binaryOnlyOptions: rows.some((row) =>
          /\/foothold\/.*\/drag$/.test(row.path),
        )
          ? []
          : [
              {
                path: "Map.wz/Map/Map*/#.img/foothold/#/#/#/drag",
                count: 0,
                values: [],
                default: 0,
                consumers: ["00a43e7b", "009b23f2"],
                status: "supported",
                precedence:
                  "No supplied instances. Nonzero input uses hundredths; zero preserves constructor drag1. Ground dynamics multiplies map drag before clamps and below-one scaling; see physics-refinements.md",
              },
            ],
        globalPhysicsPath: "Map.wz/Physics.img",
        selection:
          "All non-art/actor map sections; all info/level/common metadata; movement-name candidates anywhere; all Morph and TamingMob metadata. All IMG trees traversed, artwork bytes not decoded. # replaces numeric path segments; samplePaths bounded to eight, values/counts untruncated.",
        coverage,
        options: rows,
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  const source =
    process.argv[2] ??
    Bun.env.MAPLE_ASSETS ??
    "/Users/k/Development/tensorfish/Maplestory-Client";
  const output = process.argv[3] ?? "docs/physics-options.json";
  await inventoryPhysics(source, output);
}
