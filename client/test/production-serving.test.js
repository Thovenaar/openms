import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStaticResources } from "../tools/static-resources.js";
import { OnlineProxy } from "../tools/dev-online.js";

let root, resources;
const generated = `/generated/maps/${"a".repeat(64)}.json`;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openms-production-serving-"));
  const siteRoot = join(root, "dist/online/site");
  for (const path of [
    "/style.css",
    "/openms-icon.png",
    "/dist/online/main.js",
    "/dist/online/atlas-worker.js",
    "/generated/catalog.json",
    "/deployment.json",
  ]) {
    await Bun.write(join(siteRoot, path), `production ${path}`);
  }
  await Bun.write(join(root, "public", generated), "generated asset");
  resources = createStaticResources({
    root,
    siteRoot,
    html: "<main>game</main>",
  });
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

function request(path, method = "GET") {
  return resources.fetch(new Request(`http://localhost${path}`, { method }));
}

test("production serves its published shell, catalog, bundles and worker aliases", async () => {
  expect(await (await request("/")).text()).toBe("<main>game</main>");
  for (const path of [
    "/style.css",
    "/openms-icon.png",
    "/dist/online/main.js",
    "/generated/catalog.json",
    "/deployment.json",
  ]) {
    expect(await (await request(path)).text()).toBe(`production ${path}`);
  }
  expect(await (await request("/dist/atlas-worker.js")).text()).toBe(
    "production /dist/online/atlas-worker.js",
  );
  await Bun.write(join(root, "dist/online/main.js"), "development rebuild");
  expect(await (await request("/dist/online/main.js")).text()).toBe(
    "production /dist/online/main.js",
  );
});

test("production retains generated mounts, HEAD support and static path boundaries", async () => {
  const asset = await request(generated);
  expect(await asset.text()).toBe("generated asset");
  expect(asset.headers.get("Cache-Control")).toContain("immutable");
  const head = await request("/dist/online/main.js", "HEAD");
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  expect(head.headers.get("Content-Length")).toBe("31");
  expect((await request("/.env.client")).status).toBe(404);
  expect(
    (await request("/dist/online/..%2f..%2f..%2f.env.client")).status,
  ).toBe(404);
  expect((await request("/style.css", "POST")).status).toBe(405);
});

test("production relay admits HTTPS only for the preserved public Host", () => {
  const proxy = new OnlineProxy({ production: true }, null, () => {});
  const target = new URL("http://game.example/api/v1/play");
  expect(proxy.acceptsOrigin("https://game.example", target)).toBe(true);
  for (const origin of [
    null,
    "null",
    "https://other.example",
    "https://game.example:8443",
    "https://game.example/",
  ]) {
    expect(proxy.acceptsOrigin(origin, target)).toBe(false);
  }
  expect(
    proxy.acceptsOrigin(
      "https://game.example",
      new URL("http://localhost:3102/api/v1/play"),
    ),
  ).toBe(false);
});

test("development relay still requires the exact HTTP origin", () => {
  const proxy = new OnlineProxy({ production: false }, null, () => {});
  const target = new URL("http://localhost:3102/api/v1/play");
  expect(proxy.acceptsOrigin("http://localhost:3102", target)).toBe(true);
  expect(proxy.acceptsOrigin("https://localhost:3102", target)).toBe(false);
});
