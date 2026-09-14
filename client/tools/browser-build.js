import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { measureStage } from "./native-evidence.js";
import { loadContent } from "../../server/src/content.js";
import { onlineShell } from "./browser-shell.js";
import { onlineBuildGraph } from "./online-build-graph.js";
import {
  emitOnlineDeployment,
  publishBrowserOutputs,
} from "./online-deployment.js";
import "./environment.js";

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

/** All tool recipes and shared rules are source inputs, never generated world cache inputs. */
async function appendOnlineSources(paths) {
  paths.push("client/online.css", "client/public/openms-icon.png");
  for (const pattern of ["shared/**/*.js", "client/tools/**/*.js"]) {
    const sources = new Bun.Glob(pattern);
    for await (const path of sources.scan({
      cwd: resolve(root, ".."),
      onlyFiles: true,
      followSymlinks: false,
    })) {
      if (paths.length >= MAX_SOURCE_FILES) {
        throw new RangeError("Source file capacity exceeded");
      }
      const name = path.replaceAll("\\", "/");
      if (!paths.includes(name)) paths.push(name);
    }
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
        resolve(root, "src/browser/offline/main.js"),
        resolve(root, "src/rendering/atlas-worker.js"),
        resolve(root, "src/audio/audio-capture-worklet.js"),
        resolve(root, "tools/browser-oracle.js"),
      ],
      target: "browser",
      env: "disable",
      format: "esm",
      naming: "[name].[ext]",
      sourcemap: "linked",
      outdir: resolve(root, "dist"),
      write: false,
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
  await publishBrowserOutputs(result.outputs);
  progress?.("Browser build: complete");
  return {
    sourceBuildId,
    timings,
    outputs: result.outputs.map((file) => file.path),
  };
}

/** Online uses the authored field shell and server content identity. */
export async function buildOnlineBrowser({
  development = false,
  progress,
} = {}) {
  const timings = {};
  progress?.("Online browser: hashing source inputs");
  const identity = await measureStage(
    timings,
    "sourceIdentityMs",
    sourceIdentity,
  );
  const contentRoot = resolve(root, "public/generated");
  progress?.("Online browser: validating rules and existing asset catalog");
  const content = await measureStage(timings, "rulesIdentityMs", () =>
    loadContent({ root: contentRoot }),
  );
  const sourceBuildId = createHash("sha256")
    .update(
      `${identity}\0online\0${development}\0${content.rulesHash}\0${content.catalogHash}`,
    )
    .digest("hex");
  const shell = await onlineShellInputs(content);
  const graph = onlineBuildGraph(root);
  progress?.(
    "Online browser: compiling verified source without offline extraction/release rebuild",
  );
  const result = await measureStage(timings, "compilationMs", () =>
    compileOnline({ development, sourceBuildId, content, graph }),
  );
  progress?.(
    `Online browser: compiled ${graph.inputs.size} modules; rechecking identities`,
  );
  await recheckOnlineInputs(identity, content, timings);
  progress?.(`Online browser: publishing ${result.outputs.length} outputs`);
  await publishBrowserOutputs(result.outputs);
  const deployment = development
    ? null
    : await emitOnlineDeployment(root, {
        sourceBuildId,
        content,
        shell,
        outputs: result.outputs,
        catalog: {
          url: "/generated/catalog.json",
          sha256: content.catalogHash,
          bytes: shell.get("/generated/catalog.json").byteLength,
        },
      });
  return {
    sourceBuildId,
    development,
    rulesHash: content.rulesHash,
    assetBuildId: content.assetBuildId,
    timings,
    deployment,
    html: new TextDecoder().decode(shell.get("/index.html")),
    inputs: [...graph.inputs].sort(),
    outputs: result.outputs.map((file) => file.path),
  };
}

async function onlineShellInputs(content) {
  const shell = new Map([
    ["/index.html", new TextEncoder().encode(await onlineShell(root))],
  ]);
  for (const [url, path] of [
    ["/style.css", "style.css"],
    ["/online.css", "online.css"],
    ["/openms-icon.png", "public/openms-icon.png"],
    ["/generated/catalog.json", "public/generated/catalog.json"],
  ]) {
    shell.set(
      url,
      new Uint8Array(await Bun.file(resolve(root, path)).arrayBuffer()),
    );
  }
  if (
    createHash("sha256")
      .update(shell.get("/generated/catalog.json"))
      .digest("hex") !== content.catalogHash
  ) {
    throw new Error(
      "Online catalog changed during shell capture; rebuild required",
    );
  }
  return shell;
}

async function recheckOnlineInputs(identity, content, timings) {
  const verified = await measureStage(timings, "rulesIntegrityMs", () =>
    loadContent({ root: resolve(root, "public/generated") }),
  );
  if (
    verified.rulesHash !== content.rulesHash ||
    verified.catalogHash !== content.catalogHash
  ) {
    throw new Error("Online rule or catalog inputs changed; rebuild required");
  }
  if ((await sourceIdentity()) !== identity) {
    throw new Error("Online build inputs changed; rebuild required");
  }
}

async function compileOnline({ development, sourceBuildId, content, graph }) {
  const result = await Bun.build({
    entrypoints: [
      resolve(root, "src/browser/online/main.js"),
      resolve(root, "src/rendering/atlas-worker.js"),
      resolve(root, "src/audio/audio-capture-worklet.js"),
    ],
    target: "browser",
    env: "disable",
    format: "esm",
    naming: "[name].[ext]",
    sourcemap: development ? "linked" : "none",
    minify: !development,
    outdir: resolve(root, "dist/online"),
    write: false,
    plugins: [graph.plugin],
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
  if (!graph.inputs.size) {
    throw new Error("Online dependency graph was not observed");
  }
  return result;
}
