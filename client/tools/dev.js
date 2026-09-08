import { resolve, dirname, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Resolve only public entry files, browser bundles and generated assets. */
function resourcePath(path) {
  if (path === "/") path = "/index.html";
  if (path === "/index.html" || path === "/style.css") {
    return { filename: resolve(root, `.${path}`), directory: root };
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
/** Canonicalize paths before serving, so a generated-asset symlink cannot expose private input. */
async function serveFile(resource, method) {
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
    /[/\\](atlases|regions|maps|references|bundles|audio)[/\\][a-f0-9]{64}\.(png|json|mp3|wav)$/.test(
      filename,
    );
  return new Response(method === "HEAD" ? null : file, {
    headers: {
      "Content-Type": file.type,
      "Cache-Control": immutable
        ? "public, max-age=31536000, immutable"
        : "no-store",
    },
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
  return serveFile(resource, request.method);
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
});
if (!result.success) {
  throw new AggregateError(result.logs, "Browser build failed");
}
const port = Number(Bun.env.PORT ?? 3100);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer from 1 to 65535");
}
const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: fetchAsset });
console.log(`Maple client ready at ${server.url}`);
