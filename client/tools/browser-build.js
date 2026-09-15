import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { measureStage } from "./native-evidence.js";
import { loadContent } from "../../server/src/content.js";
import { onlineBuildGraph } from "./online-build-graph.js";
import { onlineShell } from "./online-shell.js";
import { buildStartupPack } from "./startup-pack.js";
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
    "client/tools/dev-online.js",
    "client/tools/browser-build.js",
    "client/tools/native-evidence.js",
    "client/index.html",
    "client/style.css",
    "client/online.css",
    "client/public/openms-icon.png",
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
  progress?.("Online browser: validating rules and existing asset catalog");
  const content = await measureStage(timings, "rulesIdentityMs", () =>
    loadContent({ root: resolve(root, "public/generated") }),
  );
  const sourceBuildId = onlineBuildId(identity, development, content);
  const shell = await onlineShellInputs(content, development);
  progress?.(
    "Online browser: packing common startup files from existing assets",
  );
  const startupPack = await measureStage(timings, "startupPackMs", () =>
    buildStartupPack(
      resolve(root, "public"),
      shell.get("/generated/catalog.json"),
      content.catalogHash,
    ),
  );
  const graph = onlineBuildGraph(root);
  progress?.(
    "Online browser: compiling verified source without an extraction rebuild",
  );
  const result = await measureStage(timings, "compilationMs", () =>
    compileOnline({ development, sourceBuildId, content, graph, startupPack }),
  );
  progress?.(
    `Online browser: compiled ${graph.inputs.size} modules; rechecking identities`,
  );
  await recheckOnlineInputs(identity, content, timings);
  progress?.(`Online browser: publishing ${result.outputs.length} outputs`);
  await publishBrowserOutputs(result.outputs);
  const deployment = await publishOnlineDeployment({
    development,
    sourceBuildId,
    content,
    shell,
    outputs: result.outputs,
    startupPack,
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

function onlineBuildId(identity, development, content) {
  return createHash("sha256")
    .update(
      `${identity}\0online\0${development}\0${content.rulesHash}\0${content.catalogHash}`,
    )
    .digest("hex");
}

async function publishOnlineDeployment(build) {
  if (build.development) return null;
  return emitOnlineDeployment(root, {
    ...build,
    catalog: {
      url: "/generated/catalog.json",
      sha256: build.content.catalogHash,
      bytes: build.shell.get("/generated/catalog.json").byteLength,
    },
  });
}

async function onlineShellInputs(content, development) {
  const shell = new Map([
    [
      "/index.html",
      new TextEncoder().encode(
        await onlineShell(
          await Bun.file(resolve(root, "index.html")).text(),
          development,
        ),
      ),
    ],
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

async function compileOnline({
  development,
  sourceBuildId,
  content,
  graph,
  startupPack,
}) {
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
      "import.meta.OPENMS_STARTUP_PACK": JSON.stringify(startupPack),
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
