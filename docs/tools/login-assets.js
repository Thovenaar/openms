import { mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { WzArchive } from "../../client/src/assets/wz.js";
import {
  parseImage,
  at,
  resolveNode,
  value,
} from "../../client/src/assets/image.js";
import { decodeCanvas } from "../../client/src/assets/canvas.js";
import { encodePNG } from "../../client/src/assets/png.js";

// Fixed scope: no archive-wide traversal or game-asset extraction receipt changes.
const PATHS = [
  "CharSelect/charInfo",
  "CharSelect/scroll/0/0",
  "CharSelect/scroll/0/1",
  "CharSelect/scroll/0/2",
  "CharSelect/scroll/0/3",
  "NewChar/charName",
  "NewChar/charSet",
  "NewChar/statTb",
  "NewChar/scroll/0/0",
  "NewChar/scroll/0/1",
  "NewChar/scroll/0/2",
  "NewChar/scroll/0/3",
  "NewChar/dice/0",
  "NewChar/dice/1",
  "NewChar/dice/2",
  "NewChar/dice/3",
];
const MAX_CANVAS_PIXELS = 1024 * 1024;
const MAX_INPUT_BYTES = 512 * 1024 * 1024;

async function hashFile(path) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > MAX_INPUT_BYTES) {
      throw new Error("Login input byte limit exceeded");
    }
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest("hex") };
}

async function inspectCanvas(root, path, output) {
  const canvas = resolveNode(at(root, path));
  if (
    canvas.type !== "Canvas" ||
    canvas.width * canvas.height > MAX_CANVAS_PIXELS
  ) {
    throw new Error(`Expected bounded original canvas ${path}`);
  }
  const file = `${path.replaceAll("/", "-")}.png`;
  const pixels = decodeCanvas(canvas).rgba;
  await Bun.write(
    join(output, file),
    encodePNG(canvas.width, canvas.height, pixels),
  );
  return {
    path,
    width: canvas.width,
    height: canvas.height,
    origin: value(canvas, "origin"),
    delay: value(canvas, "delay") ?? null,
    file,
  };
}

async function main() {
  if (process.argv.length > 4) {
    throw new Error(
      "Usage: bun docs/tools/login-assets.js [original-directory] [output-directory]",
    );
  }
  const original = resolve(process.argv[2] ?? "../Maplestory-Client");
  const output = resolve(process.argv[3] ?? "artifacts/login-assets");
  await mkdir(output, { recursive: true });
  const input = join(original, "UI.wz");
  const report = {
    input: "UI.wz:Login.img",
    ...(await hashFile(input)),
    canvases: [],
  };
  const archive = new WzArchive(input);
  try {
    const root = parseImage(archive.imageReader("Login.img"));
    for (const path of PATHS) {
      report.canvases.push(await inspectCanvas(root, path, output));
    }
  } finally {
    archive.close();
  }
  await Bun.write(
    join(output, "canvases.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `Inspected ${report.canvases.length} original login canvases in ${output}`,
  );
}

await main();
