import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = await Bun.build({
  entrypoints: [resolve(root, "src/main.js")],
  target: "browser",
  format: "esm",
  sourcemap: "linked",
  outdir: resolve(root, "dist"),
});
if (!result.success)
  throw new AggregateError(result.logs, "Browser build failed");
const port = Number(Bun.env.PORT ?? 3100);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", { status: 405 });
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Invalid path", { status: 400 });
    }
    const base = path.startsWith("/generated/")
      ? resolve(root, "public")
      : path.startsWith("/dist/")
        ? root
        : root;
    const allowed = path === "/" ? "/index.html" : path;
    if (
      !(
        allowed === "/index.html" ||
        allowed === "/style.css" ||
        allowed.startsWith("/dist/") ||
        allowed.startsWith("/generated/")
      )
    )
      return new Response("Not found", { status: 404 });
    const filename = resolve(base, `.${allowed}`);
    if (!filename.startsWith(base + sep))
      return new Response("Forbidden", { status: 403 });
    const file = Bun.file(filename);
    if (!(await file.exists()))
      return new Response(
        "Not found. Run bun run extract for original assets.",
        { status: 404 },
      );
    return new Response(request.method === "HEAD" ? null : file, {
      headers: { "Content-Type": file.type, "Cache-Control": "no-store" },
    });
  },
});
console.log(`Maple client ready at ${server.url}`);
