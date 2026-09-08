import { resolve } from "node:path";
import { WzArchive } from "../src/assets/wz.js";
import { parseImage } from "../src/assets/image.js";
import { decodeCanvas } from "../src/assets/canvas.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const source = resolve(
  option(
    "--assets",
    Bun.env.MAPLE_ASSETS ?? "/Users/k/Development/tensorfish/Maplestory-Client",
  ),
);
const names = option("--archives", "Map,Character,UI").split(",");
const report = {
  source,
  archives: [],
  canvasFormats: {},
  compressionEnvelopes: {},
  decodedExamples: {},
  failures: [],
  startedAt: new Date().toISOString(),
};
const started = performance.now();
let peakRSS = 0;
for (const name of names) {
  if (!/^[A-Za-z]+$/.test(name))
    throw new Error("Archive name must be alphabetic");
  const archive = new WzArchive(resolve(source, `${name}.wz`));
  const counts = {
    archive: name,
    entries: archive.entries.size,
    images: 0,
    parsed: 0,
    canvases: 0,
  };
  report.archives.push(counts);
  try {
    for (const entry of archive.entries.values()) {
      if (entry.type & 1) continue;
      counts.images++;
      try {
        const root = parseImage(archive.imageReader(entry.path));
        counts.parsed++;
        const walk = (node, path) => {
          if (node.type === "Canvas") {
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
            if (!report.decodedExamples[exampleKey]) {
              const result = decodeCanvas(node);
              report.decodedExamples[exampleKey] = {
                path: `${name}.wz:${entry.path}/${path}`,
                width: result.width,
                height: result.height,
                rgbaBytes: result.rgba.length,
                sha256: new Bun.CryptoHasher("sha256")
                  .update(result.rgba)
                  .digest("hex"),
              };
            }
          }
          for (const [key, child] of Object.entries(node.children))
            walk(child, path ? `${path}/${key}` : key);
        };
        walk(root, "");
      } catch (error) {
        report.failures.push({
          path: `${name}.wz:${entry.path}`,
          error: error.message,
        });
      }
      peakRSS = Math.max(peakRSS, process.memoryUsage.rss());
      if (counts.images % 100 === 0) {
        await Bun.sleep(0);
        Bun.gc(false);
      }
    }
  } finally {
    archive.close();
  }
  console.log(counts);
}
report.durationMs = performance.now() - started;
report.peakSampledRSS = peakRSS;
report.scope =
  "Every IMG payload in the named original archives checksum-checked and parsing attempted; unsupported entries are failures. Canvas metadata from parsed images counted; first original canvas per format/scale/compression envelope inflated and pixel-decoded. Not all canvases pixel-decoded; no original-client screenshot comparison.";
await Bun.write(
  "docs/archive-scan.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log({
  formats: report.canvasFormats,
  examples: report.decodedExamples,
  failures: report.failures.length,
  durationMs: report.durationMs,
  peakRSS,
});
if (report.failures.length) process.exitCode = 1;
