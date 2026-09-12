import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { measureStage } from "./native-evidence.js";
import { loadContent } from "../../server/src/content.js";

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
  await appendOnlineSources(paths);
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

/** Online shell/shared rules are build inputs, not an extraction recipe or asset cache. */
async function appendOnlineSources(paths) {
  paths.push(
    "client/online.html",
    "client/online.css",
    "client/tools/dev-online.js",
    "client/tools/build-online.js",
  );
  const sources = new Bun.Glob("shared/**/*.js");
  for await (const path of sources.scan({
    cwd: resolve(root, ".."),
    onlyFiles: true,
    followSymlinks: false,
  })) {
    if (paths.length >= MAX_SOURCE_FILES) {
      throw new RangeError("Source file capacity exceeded");
    }
    paths.push(path.replaceAll("\\", "/"));
  }
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

/** Build an independent online shell; production compilation removes its dev mutation UI. */
export async function buildOnlineBrowser({
  development = false,
  progress,
} = {}) {
  const timings = {};
  const identity = await measureStage(
    timings,
    "sourceIdentityMs",
    sourceIdentity,
  );
  const contentRoot = resolve(root, "public/generated");
  const content = await measureStage(timings, "rulesIdentityMs", () =>
    loadContent({ root: contentRoot }),
  );
  const sourceBuildId = createHash("sha256")
    .update(
      `${identity}\0online\0${development}\0${content.rulesHash}\0${content.catalogHash}`,
    )
    .digest("hex");
  progress?.(
    "Online browser: compiling verified source without offline extraction/release rebuild",
  );
  const result = await measureStage(timings, "compilationMs", () =>
    compileOnline(development, sourceBuildId, content),
  );
  if ((await sourceIdentity()) !== identity) {
    throw new Error("Online build inputs changed; rebuild required");
  }
  const verified = await measureStage(timings, "rulesIntegrityMs", () =>
    loadContent({ root: contentRoot }),
  );
  if (
    verified.rulesHash !== content.rulesHash ||
    verified.catalogHash !== content.catalogHash
  ) {
    throw new Error("Online rule or catalog inputs changed; rebuild required");
  }
  return {
    sourceBuildId,
    development,
    timings,
    outputs: result.outputs.map((file) => file.path),
  };
}

async function compileOnline(development, sourceBuildId, content) {
  const result = await Bun.build({
    entrypoints: [
      resolve(root, "src/online/main.js"),
      resolve(root, "src/rendering/atlas-worker.js"),
      resolve(root, "src/audio/audio-capture-worklet.js"),
    ],
    target: "browser",
    format: "esm",
    naming: "[name].[ext]",
    sourcemap: development ? "linked" : "none",
    minify: !development,
    outdir: resolve(root, "dist/online"),
    define: {
      "import.meta.MAPLE_SOURCE_ID": JSON.stringify(sourceBuildId),
      "import.meta.OPENMS_DEVELOPMENT": JSON.stringify(development),
      "import.meta.OPENMS_RULES_HASH": JSON.stringify(content.rulesHash),
      "import.meta.OPENMS_ASSET_BUILD_ID": JSON.stringify(content.assetBuildId),
      "import.meta.OPENMS_CATALOG_HASH": JSON.stringify(content.catalogHash),
    },
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "Online browser build failed");
  }
  return result;
}
