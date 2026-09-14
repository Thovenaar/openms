import { resolve, dirname, join, sep } from "node:path";
import { mkdir, mkdtemp, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { WzArchive } from "../src/assets/wz.js";
import { parseImage } from "../src/assets/image.js";
import { inventoryOptions } from "./source-options.js";

const MAX_NODES = 2000000;
const MAX_IMAGES = 20000;
const DOMAINS = [
  "UI",
  "Map",
  "Mob",
  "Npc",
  "Sound",
  "Effect",
  "String",
  "Etc",
  "Item",
  "Skill",
  "Character",
];
const MAPS = new Set([
  "100000000",
  "100000001",
  "103040000",
  "108000500",
  "120000000",
  "200090500",
  "211040000",
  "230000000",
]);

function selectImage(archive, path) {
  if (archive !== "Map") return true;
  if (["MapHelper.img", "Effect.img", "Physics.img"].includes(path)) {
    return true;
  }
  const match = /^Map\/Map\d\/(\d{9})\.img$/.exec(path);
  return Boolean(match && MAPS.has(match[1]));
}

/** Metadata only: encoded image/audio bytes are counted, never copied into docs. */
function recordNode(node, path) {
  const record = { path, type: node.type };
  if (node.value !== undefined) record.value = node.value;
  if (node.type === "Sound_DX8") {
    record.value = {
      ...node.value,
      formatData: node.value.formatData.toString("hex"),
    };
  }
  if (node.type === "Canvas") {
    for (const key of ["width", "height", "format", "scale"]) {
      record[key] = node[key];
    }
  }
  if (node.data) record.encodedBytes = node.data.length;
  return record;
}

function inspectImage(root, archive) {
  const queue = [{ node: root, path: "" }];
  const rows = [];
  const counts = { nodes: 0, canvases: 0, sounds: 0, retained: 0 };
  for (let index = 0; index < queue.length; index++) {
    if (index >= MAX_NODES) {
      throw new Error("Original IMG inventory exceeds node bound");
    }
    const { node, path } = queue[index];
    counts.nodes++;
    if (node.type === "Canvas") counts.canvases++;
    if (node.type === "Sound_DX8") counts.sounds++;
    if (archive !== "Character" || path === "" || /^info(?:\/|$)/.test(path)) {
      rows.push(recordNode(node, path));
      counts.retained++;
    }
    for (const child of Object.values(node.children)) {
      queue.push({
        node: child,
        path: path ? `${path}/${child.name}` : child.name,
      });
    }
    if (queue.length > MAX_NODES) {
      throw new Error("Original IMG inventory queue exceeds bound");
    }
  }
  return { roots: Object.keys(root.children), counts, rows };
}

/** Smaller branch members let read-only researchers inspect one original component. */
async function writeBranches(data, path, directory) {
  const branches = new Map();
  for (const row of data.rows) {
    if (!row.path) continue;
    const key = row.path.split("/")[0];
    if (!branches.has(key)) branches.set(key, []);
    branches.get(key).push(row);
  }
  const base = resolve(directory, path);
  if (!base.startsWith(directory + sep)) {
    throw new Error("Unsafe IMG branch path");
  }
  await mkdir(base, { recursive: true });
  for (const [key, rows] of branches) {
    const destination = resolve(base, `${key}.json`);
    if (!destination.startsWith(base + sep)) {
      throw new Error("Unsafe original branch path");
    }
    await Bun.write(
      destination,
      JSON.stringify({ source: path, branch: key, rows }, null, 2),
    );
  }
}
async function imageReport(archive, path, directory) {
  const reader = archive.imageReader(path);
  const sha256 = new Bun.CryptoHasher("sha256")
    .update(reader.bytes)
    .digest("hex");
  const name = archive.domain;
  const root = parseImage(reader);
  const data = inspectImage(root, name);
  const destination = resolve(directory, `${path}.json`);
  if (!destination.startsWith(directory + sep)) {
    throw new Error("Unsafe original IMG path");
  }
  await mkdir(dirname(destination), { recursive: true });
  await Bun.write(
    destination,
    JSON.stringify({ source: `${name}.wz:${path}`, sha256, ...data }, null, 2),
  );
  await writeBranches(data, path, directory);
  return { path, sha256, roots: data.roots, ...data.counts };
}

async function compressReports(directory, output) {
  const temporary = `${output}.tmp`;
  try {
    const process = Bun.spawn(
      ["tar", "-czf", temporary, "-C", directory, "."],
      { stdout: "pipe", stderr: "pipe" },
    );
    const error = await new Response(process.stderr).text();
    if ((await process.exited) !== 0) {
      throw new Error(`Evidence archive failed: ${error}`);
    }
    await rename(temporary, output);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Complete IMG traversal for selected domains; per-IMG JSON is losslessly archived. */
async function archiveReport(name, source, output) {
  const directory = await mkdtemp(join(tmpdir(), "maple-ingame-inventory-"));
  const report = {
    archive: `${name}.wz`,
    metadataArchive: null,
    complete: false,
    images: [],
    omittedImages: [],
    failures: [],
  };
  let archive;
  let failurePath = report.archive;
  try {
    archive = new WzArchive(join(source, report.archive));
    archive.domain = name;
    for (const [path, entry] of archive.entries) {
      if (entry.type !== 4) continue;
      if (
        report.images.length +
          report.omittedImages.length +
          report.failures.length >=
        MAX_IMAGES
      ) {
        failurePath = path;
        throw new Error("Original archive exceeds image inventory bound");
      }
      if (!selectImage(name, path)) {
        report.omittedImages.push(path);
        continue;
      }
      try {
        report.images.push(await imageReport(archive, path, directory));
      } catch (error) {
        report.failures.push({ path, error: String(error) });
      }
    }
    failurePath = `${name}.tar.gz`;
    await compressReports(directory, join(output, failurePath));
    report.metadataArchive = failurePath;
  } catch (error) {
    report.failures.push({ path: failurePath, error: String(error) });
  } finally {
    archive?.close();
    await rm(directory, { recursive: true });
  }
  report.complete = report.failures.length === 0;
  await Bun.write(
    join(output, `${name}.json`),
    JSON.stringify(report, null, 2) + "\n",
  );
  return report;
}

export async function inventoryInGame(source, output) {
  await mkdir(output, { recursive: true });
  const index = {
    schemaVersion: 1,
    complete: false,
    source,
    scope:
      "All IMG in UI/Mob/Npc/Sound/Effect/String/Etc/Item/Skill/Character. Map: eight acceptance maps plus MapHelper/Effect/Physics. Every selected IMG tree visited; Character retains info metadata only, all other selected nodes retained. No canvas/audio decode. No behavioral defaults inferred from property names.",
    metadataPath:
      "Read <archive>.tar.gz:<original IMG path>.json; per-archive index lists roots, counts and source SHA-256.",
    archives: [],
  };
  for (const name of DOMAINS) {
    const report = await archiveReport(name, source, output);
    const counts = report.images.reduce(
      (total, image) => {
        for (const key of ["nodes", "canvases", "sounds", "retained"]) {
          total[key] += image[key];
        }
        return total;
      },
      { nodes: 0, canvases: 0, sounds: 0, retained: 0 },
    );
    index.archives.push({
      archive: report.archive,
      complete: report.complete,
      failures: report.failures,
      images: report.images.length,
      omitted: report.omittedImages.length,
      ...counts,
    });
    console.log(JSON.stringify(index.archives.at(-1)));
  }
  index.complete = index.archives.every((archive) => archive.complete);
  await Bun.write(
    join(output, "index.json"),
    JSON.stringify(index, null, 2) + "\n",
  );
  if (!index.complete) {
    throw new Error(
      `Incomplete in-game inventory; see failures in ${join(output, "index.json")}`,
    );
  }
}

if (import.meta.main) {
  const options = inventoryOptions(
    process.argv.slice(2),
    "docs/ingame-inventory",
  );
  if (options.help) {
    console.log(
      "bun client/tools/ingame-inventory.js [--assets DIR] [--output DIR]",
    );
  } else await inventoryInGame(options.assets, options.output);
}
