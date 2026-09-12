import { resolve, dirname, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { prepareRelease } from "./release-manifest.js";
import { buildBrowser } from "./browser-build.js";
import { measureStage } from "./native-evidence.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

function selectEncoding(filename, file, request, encodings) {
  const cached = encodings.get(filename);
  return cached?.size === file.size &&
    cached.modified === file.lastModified &&
    acceptsGzip(request.headers.get("accept-encoding"))
    ? cached.body
    : null;
}

/** Canonicalize paths before serving, so a generated-asset symlink cannot expose private input. */
async function serveFile(resource, request, encodings) {
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
  const encoded = selectEncoding(filename, file, request, encodings);
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
async function fetchAsset(request, encodings) {
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
  return serveFile(resource, request, encodings);
}
/** Percent counts four completed startup stages, not estimated duration or discovered assets. */
function startupProgress(sink) {
  const started = performance.now();
  let completed = 0;
  return {
    line(message) {
      sink?.(
        `[${completed * 25}% +${((performance.now() - started) / 1000).toFixed(2)}s] ${message}`,
      );
    },
    complete(message) {
      completed++;
      this.line(message);
    },
  };
}
async function compileDevelopment(state) {
  const started = performance.now();
  const timings = {};
  const progress = startupProgress(state.progress);
  state.startup = progress;
  progress.line(
    "Starting: browser build, release verification, HTTP encoding, listener (4 stages)",
  );
  const build = await measureStage(timings, "browserBuildMs", () =>
    buildBrowser(progress.line),
  );
  progress.complete(
    `Browser build complete (${timings.browserBuildMs.toFixed(1)}ms)`,
  );
  const release = await measureStage(timings, "releaseMs", () =>
    prepareRelease(root, progress.line, timings),
  );
  progress.complete(`Release complete (${timings.releaseMs.toFixed(1)}ms)`);
  const encodings = await measureStage(timings, "httpEncodingMs", () =>
    prepareHttpEncoding(release),
  );
  progress.complete(
    `HTTP encoding complete (${encodings.size} resources; ${timings.httpEncodingMs.toFixed(1)}ms)`,
  );
  state.encodings = encodings;
  state.identity = {
    sourceBuildId: build.sourceBuildId,
    assetBuildId: release.buildId,
    releaseId: release.releaseId,
    elapsedMs: performance.now() - started,
    timings: { ...build.timings, ...timings },
  };
  progress.line(
    `Offline release ${release.releaseId}: ${release.resources.length} resources, ${release.totalBytes} bytes, ${release.maps.length} maps`,
  );
  return { ...state.identity };
}

async function rebuildDevelopment(state) {
  if (state.pending) return state.pending;
  state.pending = compileDevelopment(state);
  try {
    const identity = await state.pending;
    if (state.listening) {
      state.startup.complete("Rebuilt client ready on the owned listener");
    }
    return identity;
  } finally {
    state.pending = null;
  }
}

/** One owned server; optional synchronous progress keeps programmatic callers quiet. */
export async function startDevServer(options = {}) {
  const port = Number(options.port ?? Bun.env.PORT ?? 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  const state = {
    encodings: new Map(),
    identity: null,
    pending: null,
    progress: options.progress,
  };
  await rebuildDevelopment(state);
  const listeningAt = performance.now();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: (request) => fetchAsset(request, state.encodings),
  });
  state.identity.timings.listenerMs = performance.now() - listeningAt;
  state.identity.elapsedMs += state.identity.timings.listenerMs;
  state.listening = true;
  state.startup.complete(`openms.dev offline client ready at ${server.url}`);
  return {
    server,
    rebuild: () => rebuildDevelopment(state),
    identity: () => ({ ...state.identity }),
  };
}

if (import.meta.main) {
  await startDevServer({ progress: (message) => console.log(message) });
}
