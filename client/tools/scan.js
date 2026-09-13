import { resolve } from "node:path";
import { WzArchive } from "../src/assets/wz.js";
import { parseImage } from "../src/assets/image.js";
import { decodeCanvas } from "../src/assets/canvas.js";
import { inspectProperty, propertyInventory } from "./scan-properties.js";

/** Read a required CLI option value rather than accepting a missing argument. */
function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}
/** Count metadata and decode the first original example of each compression/format combination. */
function inspectCanvas(node, path, context) {
  const { report, counts } = context;
  counts.canvases++;
  const key = `${node.format}/${node.scale}`;
  report.canvasFormats[key] = (report.canvasFormats[key] ?? 0) + 1;
  const data = node.data;
  const envelope =
    data.length >= 2 &&
    (data[0] & 15) === 8 &&
    ((data[0] << 8) + data[1]) % 31 === 0
      ? "zlib"
      : "encrypted-chunks";
  report.compressionEnvelopes[envelope] =
    (report.compressionEnvelopes[envelope] ?? 0) + 1;
  const exampleKey = `${key}/${envelope}`;
  if (report.decodedExamples[exampleKey]) return;
  const result = decodeCanvas(node);
  report.decodedExamples[exampleKey] = {
    path: `${context.imagePath}/${path}`,
    width: result.width,
    height: result.height,
    rgbaBytes: result.rgba.length,
    sha256: new Bun.CryptoHasher("sha256").update(result.rgba).digest("hex"),
  };
}
/** Parsed nodes consume input bytes; use the IMG byte count as a finite visit bound. */
function scanNodes(root, byteLimit, context) {
  const stack = [{ node: root, path: "" }];
  const visited = new Set();
  for (let count = 0; stack.length && count <= byteLimit; count++) {
    const { node, path } = stack.pop();
    if (visited.has(node)) throw new Error("Cyclic IMG child traversal");
    visited.add(node);
    if (context.report.inventoryProperties) {
      inspectProperty(node, path, context);
    }
    if (node.type === "Canvas") inspectCanvas(node, path, context);
    const children = Object.entries(node.children);
    for (let i = children.length - 1; i >= 0; i--) {
      const [key, child] = children[i];
      stack.push({ node: child, path: path ? `${path}/${key}` : key });
    }
  }
  if (stack.length) throw new Error("IMG scan exceeds byte-derived node limit");
}
/** Retain per-image failure isolation and the original checksum-before-parse behavior. */
function scanImage(archive, entry, context) {
  context.counts.images++;
  context.imagePath = `${context.counts.archive}.wz:${entry.path}`;
  if (context.report.inventoryProperties) {
    context.counts.imagesInventory.push({
      path: entry.path,
      size: entry.size,
      checksum: entry.checksum,
    });
  }
  try {
    const root = parseImage(archive.imageReader(entry.path));
    context.counts.parsed++;
    scanNodes(root, entry.size, context);
  } catch (error) {
    context.report.failures.push({
      path: context.imagePath,
      error: error.message,
    });
  }
  context.report.peakSampledRSS = Math.max(
    context.report.peakSampledRSS,
    process.memoryUsage.rss(),
  );
}
/** Own one archive descriptor and release it even when scanning fails. */
async function scanArchive(name, report) {
  if (!/^[A-Za-z]+$/.test(name)) {
    throw new Error("Archive name must be alphabetic");
  }
  const archive = new WzArchive(resolve(report.source, `${name}.wz`));
  const counts = {
    archive: name,
    entries: archive.entries.size,
    images: 0,
    parsed: 0,
    canvases: 0,
  };
  report.archives.push(counts);
  if (report.inventoryProperties) propertyInventory(counts);
  const context = { counts, report, imagePath: "" };
  try {
    for (const entry of archive.entries.values()) {
      if (entry.type & 1) continue;
      scanImage(archive, entry, context);
      if (counts.images % 100 === 0) {
        await Bun.sleep(0);
        Bun.gc(false);
      }
    }
  } finally {
    archive.close();
  }
  console.log({
    archive: name,
    images: counts.images,
    parsed: counts.parsed,
    canvases: counts.canvases,
    propertyNames: counts.propertyNames,
  });
}
/** Run the original-archive inventory without following reference links or retaining IMG trees. */
async function main() {
  const args = process.argv.slice(2);
  const source = resolve(
    option(
      args,
      "--assets",
      Bun.env.MAPLE_ASSETS ??
        "/Users/k/Development/tensorfish/Maplestory-Client",
    ),
  );
  const names = option(args, "--archives", "Map,Character,UI").split(",");
  const report = {
    source,
    inventoryProperties: args.includes("--properties"),
    archives: [],
    canvasFormats: {},
    compressionEnvelopes: {},
    decodedExamples: {},
    failures: [],
    startedAt: new Date().toISOString(),
    peakSampledRSS: 0,
  };
  const started = performance.now();
  for (const name of names) await scanArchive(name, report);
  report.durationMs = performance.now() - started;
  report.scope =
    "Every IMG payload in the named original archives checksum-checked and parsing attempted; unsupported entries are failures. Canvas metadata from parsed images counted; first original canvas per format/scale/compression envelope inflated and pixel-decoded. Not all canvases pixel-decoded; no original-client screenshot comparison.";
  await Bun.write(
    option(args, "--output", "docs/archive-scan.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log({
    formats: report.canvasFormats,
    examples: report.decodedExamples,
    failures: report.failures.length,
    durationMs: report.durationMs,
    peakRSS: report.peakSampledRSS,
  });
  if (report.failures.length) process.exitCode = 1;
}
await main();
