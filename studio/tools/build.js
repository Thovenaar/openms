import { resolve } from "node:path";

export async function buildStudio({ write = false } = {}) {
  const root = resolve(import.meta.dir, "..");
  const result = await Bun.build({
    entrypoints: [
      resolve(root, "src/main.js"),
      resolve(root, "../client/src/rendering/atlas-worker.js"),
    ],
    outdir: resolve(root, "dist"),
    target: "browser",
    env: "disable",
    format: "esm",
    naming: "[name].[ext]",
    minify: true,
    write,
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "Studio build failed");
  }
  const assets = new Map();
  for (const output of result.outputs) {
    assets.set(`/studio/${output.path.split("/").at(-1)}`, {
      bytes: await output.arrayBuffer(),
      type: "text/javascript",
    });
  }
  for (const [path, type] of [
    ["index.html", "text/html"],
    ["style.css", "text/css"],
  ]) {
    assets.set(path === "index.html" ? "/studio/" : `/studio/${path}`, {
      bytes: await Bun.file(resolve(root, path)).arrayBuffer(),
      type,
    });
  }
  return assets;
}

if (import.meta.main) {
  await buildStudio({ write: true });
  console.log("Studio browser bundle built in studio/dist");
}
