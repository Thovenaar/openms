import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { measureStage } from "./native-evidence.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_SOURCE_FILES = 4096;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

/** Exact, length-framed build inputs; shared by the compiler and native scenario gate. */
export async function sourceIdentity() {
  const repository = resolve(root, "..");
  const paths = [
    "bun.lock",
    "package.json",
    "client/package.json",
    "server/package.json",
    "client/tools/dev.js",
    "client/tools/browser-build.js",
    "client/tools/browser-oracle.js",
    "client/tools/release-manifest.js",
    "client/tools/native-evidence.js",
    "client/index.html",
    "client/style.css",
    "client/public/service-worker.js",
    "client/public/offline-manifest.js",
    "client/public/app.webmanifest",
    "client/public/app-icon.svg",
  ];
  const sources = new Bun.Glob("src/**/*.js");
  for await (const path of sources.scan({
    cwd: root,
    onlyFiles: true,
    followSymlinks: false,
    dot: true,
  })) {
    if (paths.length >= MAX_SOURCE_FILES) {
      throw new RangeError(
        "Source identity exceeds its build-input file limit.",
      );
    }
    paths.push(`client/${path.replaceAll("\\", "/")}`);
  }
  paths.sort();
  const hash = createHash("sha256").update("maple-source-v2\0");
  let totalBytes = 0;
  for (const path of paths) {
    const file = Bun.file(resolve(repository, path));
    if (file.size > MAX_SOURCE_BYTES - totalBytes) {
      throw new RangeError(
        "Source identity exceeds its build-input byte limit.",
      );
    }
    const bytes = await file.arrayBuffer();
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_SOURCE_BYTES) {
      throw new RangeError(
        "Source identity exceeds its build-input byte limit.",
      );
    }
    hash.update(`${JSON.stringify(path)}\0${bytes.byteLength}\0`);
    hash.update(new Uint8Array(bytes));
  }
  return hash.digest("hex");
}

/** Rebuild public entrypoints; an optional synchronous progress sink receives phase lines. */
export async function buildBrowser(progress) {
  const timings = {};
  progress?.("Browser build: starting source integrity");
  const sourceBuildId = await measureStage(
    timings,
    "sourceIdentityMs",
    sourceIdentity,
  );
  progress?.(
    "Browser build: source integrity complete; compiling 4 entrypoints",
  );
  const result = await measureStage(timings, "compilationMs", () =>
    Bun.build({
      entrypoints: [
        resolve(root, "src/main.js"),
        resolve(root, "src/rendering/atlas-worker.js"),
        resolve(root, "src/audio/audio-capture-worklet.js"),
        resolve(root, "tools/browser-oracle.js"),
      ],
      target: "browser",
      format: "esm",
      naming: "[name].[ext]",
      sourcemap: "linked",
      outdir: resolve(root, "dist"),
      define: { "import.meta.MAPLE_SOURCE_ID": JSON.stringify(sourceBuildId) },
    }),
  );
  if (!result.success) {
    throw new AggregateError(result.logs, "Browser build failed");
  }
  progress?.(
    "Browser build: compilation complete; rechecking source integrity",
  );
  if (
    (await measureStage(timings, "sourceRecheckMs", sourceIdentity)) !==
    sourceBuildId
  ) {
    throw new Error(
      "Browser build inputs changed during compilation; rebuild required",
    );
  }
  progress?.("Browser build: complete");
  return {
    sourceBuildId,
    timings,
    outputs: result.outputs.map((file) => file.path),
  };
}
