import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { sourcePaths } from "./source-options.js";

const MAX_FILES = 32768;
const MAX_FILE_BYTES = 32 * 1024 ** 3;
const SOURCE_PATTERNS = [
  "client/src/**/*.js",
  "client/tools/**/*.js",
  "client/public/*",
  "client/index.html",
  "client/style.css",
  "{bun.lock,package.json,client/package.json,server/package.json}",
];

/** Explicit inputs only: never scan generated, dist, cache, evidence or node_modules. */
export function inputRoots(options, descriptors) {
  return [
    {
      root: options.repository,
      patterns: [
        ...SOURCE_PATTERNS,
        ...descriptors.flatMap((entry) => entry.dependencies),
      ],
      prefix: "",
    },
    { root: options.assets, patterns: ["*.wz"], prefix: "original/" },
    {
      root: sourcePaths(options).gameplayDefinitionsRoot,
      patterns: ["**/*.js", "policy.json"],
      prefix: "gameplay-definitions/",
    },
    {
      root: sourcePaths(options).sqlRoot,
      patterns: ["{tables,data}/**/*.sql"],
      prefix: "reference-sql/",
    },
  ].map((entry) => ({ ...entry, exclude: `${resolve(options.output)}/` }));
}

function allowed(path) {
  return !/(^|\/)(generated|dist|node_modules|artifacts|cache|\.cache|\.git)(\/|$)/.test(
    path,
  );
}

async function pathsFor(roots) {
  const paths = new Map();
  for (const entry of roots) {
    for (const pattern of entry.patterns) {
      if (pattern.startsWith("/") || pattern.split("/").includes("..")) {
        throw new Error(`Unsafe dependency glob: ${pattern}`);
      }
      for await (const path of new Bun.Glob(pattern).scan({
        cwd: entry.root,
        onlyFiles: true,
        followSymlinks: false,
      })) {
        if (!allowed(path)) continue;
        const absolute = resolve(entry.root, path);
        if (entry.exclude && absolute.startsWith(entry.exclude)) continue;
        paths.set(entry.prefix + path, absolute);
        if (paths.size > MAX_FILES) {
          throw new Error(`Smoke watch exceeds ${MAX_FILES} input files`);
        }
      }
    }
  }
  return paths;
}

async function contentHash(path) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > MAX_FILE_BYTES) {
      throw new Error(`Smoke input exceeds byte limit: ${path}`);
    }
    hash.update(chunk);
  }
  return hash.digest("hex");
}

/** Stat is only a hash-work optimization; changes are admitted by content, not mtime. */
export async function scanInputs(roots, previous = new Map()) {
  const next = new Map();
  const changed = [];
  for (const [key, path] of await pathsFor(roots)) {
    const info = await stat(path, { bigint: true });
    const stamp = `${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.ino}`;
    const old = previous.get(key);
    const hash = old?.stamp === stamp ? old.hash : await contentHash(path);
    next.set(key, { stamp, hash });
    if (old?.hash !== hash) changed.push(key);
  }
  for (const key of previous.keys()) if (!next.has(key)) changed.push(key);
  return { next, changed };
}

export function extractionChange(path) {
  if (
    path.startsWith("original/") ||
    path.startsWith("gameplay-definitions/") ||
    path.startsWith("reference-sql/")
  ) {
    return true;
  }
  if (path.startsWith("client/src/assets/")) return true;
  if (!path.startsWith("client/tools/")) return false;
  return !/client\/tools\/(scenarios\/|native-|smoke|dev\.js|browser-|release-manifest\.js)/.test(
    path,
  );
}

/** Unknown/shared changes conservatively select all, with an explicit recorded reason. */
export function selectAffected(descriptors, changes) {
  const selected = new Set();
  const reasons = [];
  for (const path of changes) {
    const matched = descriptors.filter((entry) =>
      entry.dependencies.some((pattern) => new Bun.Glob(pattern).match(path)),
    );
    const shared = extractionChange(path) || matched.length === 0;
    for (const entry of shared ? descriptors : matched) {
      selected.add(entry.name);
    }
    reasons.push({
      path,
      reason: shared ? "shared-or-unknown-input" : "declared-dependency",
      scenarios: (shared ? descriptors : matched).map((entry) => entry.name),
    });
  }
  return { names: [...selected], reasons };
}
