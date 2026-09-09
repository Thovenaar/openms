import { resolve, dirname, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { prepareRelease } from "./release-manifest.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_SOURCE_FILES = 4096;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

/**
 * Hash sorted repository-relative paths and exact build-input bytes, not mtimes.
 * Length-framed entries prevent ambiguous path/content concatenations. This is
 * independent of the extracted catalog buildId and creates no generated source.
 * @returns {Promise<string>} Lowercase SHA-256 source/dependency identity.
 */
async function sourceIdentity() {
  const repository = resolve(root, "..");
  const paths = [
    "bun.lock",
    "package.json",
    "client/package.json",
    "server/package.json",
    "client/tools/dev.js",
    "client/tools/browser-oracle.js",
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
  const hash = createHash("sha256").update("maple-source-v1\0");
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

/** Resolve only public entry files, browser bundles and generated assets. */
function resourcePath(path) {
  if (path === "/") path = "/index.html";
  if (path === "/index.html" || path === "/style.css") {
    return { filename: resolve(root, `.${path}`), directory: root };
  }
  if (
    [
      "/service-worker.js",
      "/offline-manifest.js",
      "/app.webmanifest",
      "/app-icon.svg",
    ].includes(path)
  ) {
    const directory = resolve(root, "public");
    return { filename: resolve(directory, `.${path}`), directory };
  }
  let directory;
  let relative;
  if (path.startsWith("/generated/")) {
    directory = resolve(root, "public/generated");
    relative = path.slice("/generated/".length);
  } else if (path.startsWith("/dist/")) {
    directory = resolve(root, "dist");
    relative = path.slice("/dist/".length);
  } else return null;
  const filename = resolve(directory, relative);
  if (!filename.startsWith(directory + sep)) return null;
  return { filename, directory };
}
/** Prepare large text once; HTTP coding does not change verified, decoded asset bytes. */
async function prepareHttpEncoding(release) {
  const encoded = new Map();
  let retainedBytes = 0;
  const candidates = release.resources
    .filter(
      (info) =>
        info.bytes >= 65536 && /\.(json|js|css|html|svg)$/.test(info.url),
    )
    .sort((left, right) => right.bytes - left.bytes);
  for (const info of candidates) {
    const resource = resourcePath(info.url);
    if (!resource) throw new Error(`Unservable release resource: ${info.url}`);
    const file = Bun.file(resource.filename);
    const body = Bun.gzipSync(await file.arrayBuffer(), { level: 6 });
    if (
      body.byteLength >= file.size ||
      retainedBytes + body.byteLength > 16777216
    ) {
      continue;
    }
    encoded.set(resource.filename, {
      body,
      size: file.size,
      modified: file.lastModified,
    });
    retainedBytes += body.byteLength;
  }
  return encoded;
}

function acceptsGzip(header) {
  for (const token of (header ?? "").toLowerCase().split(",")) {
    const [name, ...parameters] = token.trim().split(";");
    if (name.trim() !== "gzip") continue;
    const quality = parameters.find((value) => value.trim().startsWith("q="));
    const weight = quality === undefined ? 1 : Number(quality.trim().slice(2));
    return Number.isFinite(weight) && weight > 0 && weight <= 1;
  }
  return false;
}

function selectEncoding(filename, file, request) {
  const cached = httpEncoding.get(filename);
  return cached?.size === file.size &&
    cached.modified === file.lastModified &&
    acceptsGzip(request.headers.get("accept-encoding"))
    ? cached.body
    : null;
}

/** Canonicalize paths before serving, so a generated-asset symlink cannot expose private input. */
async function serveFile(resource, request) {
  let filename;
  try {
    filename = await realpath(resource.filename);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    return new Response("Not found. Run bun run extract for original assets.", {
      status: 404,
    });
  }
  if (!filename.startsWith(resource.directory + sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  const file = Bun.file(filename);
  const immutable =
    /[/\\](atlases|regions|maps|references|bundles|audio|releases|blobs)[/\\][a-f0-9]{64}\.(png|json|mp3|wav|bin)$/.test(
      filename,
    );
  const encoded = selectEncoding(filename, file, request);
  const headers = {
    "Content-Type": file.type,
    "Content-Length": String(encoded ? encoded.byteLength : file.size),
    "Service-Worker-Allowed": "/",
    Vary: "Accept-Encoding",
    "Cache-Control": immutable
      ? "public, max-age=31536000, immutable"
      : "no-store",
  };
  if (encoded) headers["Content-Encoding"] = "gzip";
  return new Response(request.method === "HEAD" ? null : (encoded ?? file), {
    headers,
  });
}
/** Handle only GET/HEAD and reject malformed URL encodings before touching the filesystem. */
async function fetchAsset(request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  let path;
  try {
    path = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response("Invalid path", { status: 400 });
  }
  if (path.includes("\0")) return new Response("Invalid path", { status: 400 });
  const resource = resourcePath(path);
  if (!resource) return new Response("Not found", { status: 404 });
  return serveFile(resource, request);
}
const result = await Bun.build({
  entrypoints: [
    resolve(root, "src/main.js"),
    resolve(root, "src/atlas-worker.js"),
    resolve(root, "src/audio-capture-worklet.js"),
    resolve(root, "tools/browser-oracle.js"),
  ],
  target: "browser",
  format: "esm",
  naming: "[name].[ext]",
  sourcemap: "linked",
  outdir: resolve(root, "dist"),
  define: {
    "import.meta.MAPLE_SOURCE_ID": JSON.stringify(await sourceIdentity()),
  },
});
if (!result.success) {
  throw new AggregateError(result.logs, "Browser build failed");
}
const release = await prepareRelease(root);
const httpEncoding = await prepareHttpEncoding(release);
console.log(
  `Offline release ${release.releaseId}: ${release.resources.length} resources, ${release.totalBytes} bytes, ${release.maps.length} maps`,
);
const port = Number(Bun.env.PORT ?? 3100);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer from 1 to 65535");
}
const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: fetchAsset });
console.log(`Maple client ready at ${server.url}`);
