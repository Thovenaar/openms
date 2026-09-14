import { resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";

const MAX_ENCODING_BYTES = 16 * 1024 * 1024;
const MAX_TEXT_BYTES = 64 * 1024 * 1024;
const MIN_ENCODING_BYTES = 65536;
const MAX_ENCODING_ENTRIES = 4096;
const SHELL = new Map([
  ["/index.html", "."],
  ["/style.css", "."],
  ["/online.css", "."],
  ["/openms-icon.png", "public"],
]);
const WORKERS = new Set([
  "/dist/atlas-worker.js",
  "/dist/audio-capture-worklet.js",
]);
const HASH_RESOURCE =
  /^\/generated\/(?:[a-z][a-z0-9-]*\/)+[a-f0-9]{64}\.(?:png|json|mp3|wav|bin)$/;

/** Resolve the online shell, compiled bundles and immutable generated resources. */
function resourcePath(path, options) {
  const { root } = options;
  if (path === "/") path = "/index.html";
  const shell = SHELL.get(path);
  const dist = "/dist/online/";
  let directory, relative;
  if (shell) {
    directory = resolve(root, shell);
    relative = `.${path}`;
  } else if (path.startsWith("/generated/")) {
    directory = options.generatedRoot ?? resolve(root, "public/generated");
    relative = path.slice("/generated/".length);
  } else if (WORKERS.has(path)) {
    directory = resolve(root, "dist/online");
    relative = path.slice("/dist/".length);
  } else if (path.startsWith(dist)) {
    directory = resolve(root, `.${dist}`);
    relative = path.slice(dist.length);
  } else return null;
  const filename = resolve(directory, relative);
  if (!filename.startsWith(directory + sep)) return null;
  return { filename, directory, immutable: HASH_RESOURCE.test(path) };
}

function acceptsGzip(header) {
  if (!header || header.length > 4096) return false;
  for (const token of header.toLowerCase().split(",")) {
    const [name, ...parameters] = token.trim().split(";");
    if (name.trim() !== "gzip") continue;
    const quality = parameters.find((value) => value.trim().startsWith("q="));
    const weight = quality === undefined ? 1 : Number(quality.trim().slice(2));
    return Number.isFinite(weight) && weight > 0 && weight <= 1;
  }
  return false;
}

/** One bounded gzip cache per listener. Cache residency never changes encoded response bytes. */
class HttpEncodings {
  constructor() {
    this.entries = new Map();
    this.bytes = 0;
  }
  get size() {
    return this.entries.size;
  }
  async prepare(filename, file) {
    if (
      file.size < MIN_ENCODING_BYTES ||
      file.size > MAX_TEXT_BYTES ||
      !/\.(json|js|css|html|svg)$/.test(filename)
    ) {
      return null;
    }
    const cached = this.entries.get(filename);
    if (cached?.size === file.size && cached.modified === file.lastModified) {
      return cached.body;
    }
    if (cached) {
      this.bytes -= cached.body.byteLength;
      this.entries.delete(filename);
    }
    const size = file.size,
      modified = file.lastModified;
    const bytes = await file.arrayBuffer();
    const current = Bun.file(filename);
    if (
      bytes.byteLength !== size ||
      current.size !== size ||
      current.lastModified !== modified
    ) {
      throw new Error("Static resource changed during HTTP encoding");
    }
    const body = Bun.gzipSync(bytes, { level: 6 });
    if (body.byteLength >= size) return null;
    this.retain(filename, body, size, modified);
    return body;
  }
  retain(filename, body, size, modified) {
    if (
      this.bytes + body.byteLength <= MAX_ENCODING_BYTES &&
      this.size < MAX_ENCODING_ENTRIES
    ) {
      const previous = this.entries.get(filename);
      if (previous) this.bytes -= previous.body.byteLength;
      this.entries.set(filename, { body, size, modified });
      this.bytes += body.byteLength;
    }
  }
}

/** Canonicalize both roots and targets, rejecting symlink escapes before reading bytes. */
async function canonicalResource(target) {
  try {
    const [filename, directory] = await Promise.all([
      realpath(target.filename),
      realpath(target.directory),
    ]);
    if (!filename.startsWith(directory + sep)) {
      return new Response("Forbidden", { status: 403 });
    }
    return filename;
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    return new Response(
      "Content unavailable; use the existing extraction setup",
      { status: 404 },
    );
  }
}

function responseHeaders(file, immutable, encoded) {
  return {
    "Content-Type": file.type,
    "Content-Length": String(encoded ? encoded.byteLength : file.size),
    "Cache-Control": immutable
      ? "public, max-age=31536000, immutable"
      : "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    Vary: "Accept-Encoding",
    ...(encoded ? { "Content-Encoding": "gzip" } : {}),
  };
}

/** Decode once before resource resolution; unsupported methods never touch the filesystem. */
function requestPath(request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }
  let path;
  try {
    path = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response("Invalid path", { status: 400 });
  }
  return path.includes("\0")
    ? new Response("Invalid path", { status: 400 })
    : path;
}

/** Serve the online shell without release installation or persistent browser caches. */
export function createStaticResources(options) {
  const encodings = new HttpEncodings();
  if (typeof options.html !== "string") {
    throw new Error("Static resources require the online browser shell");
  }
  const html = new Blob([options.html], { type: "text/html;charset=utf-8" });
  return {
    encodings,
    async fetch(request) {
      const path = requestPath(request);
      if (path instanceof Response) return path;
      if (path === "/" || path === "/index.html") {
        return new Response(request.method === "HEAD" ? null : html, {
          headers: responseHeaders(html, false, null),
        });
      }
      const target = resourcePath(path, options);
      if (!target) return new Response("Not found", { status: 404 });
      const filename = await canonicalResource(target);
      if (filename instanceof Response) return filename;
      const file = Bun.file(filename);
      const encoded = acceptsGzip(request.headers.get("accept-encoding"))
        ? await encodings.prepare(filename, file)
        : null;
      return new Response(
        request.method === "HEAD" ? null : (encoded ?? file),
        {
          headers: responseHeaders(file, target.immutable, encoded),
        },
      );
    },
  };
}
