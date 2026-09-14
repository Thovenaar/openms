import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStudioHttp } from "../tools/http.js";
import { createStaticResources } from "../../client/tools/static-resources.js";
import { OnlineHttp } from "../../server/src/http.js";

const fixture = { backend: null, studio: null, root: null };

beforeAll(async () => {
  fixture.root = await mkdtemp(join(tmpdir(), "openms-studio-http-"));
  await Bun.write(join(fixture.root, "example.json"), '{"original":true}');
  fixture.backend = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      return Response.json(
        {
          path: new URL(request.url).pathname,
          method: request.method,
          origin: request.headers.get("origin"),
          cookie: request.headers.get("cookie"),
          csrf: request.headers.get("x-csrf-token"),
          bytes: (await request.arrayBuffer()).byteLength,
        },
        {
          headers: {
            "Set-Cookie": "openms_session=fixture; HttpOnly; SameSite=Strict",
            "Cache-Control": "no-store",
          },
        },
      );
    },
  });
  fixture.studio = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 4 * 1024 * 1024,
    fetch: await createStudioHttp({
      upstream: fixture.backend.url.origin,
      clientUrl: "http://127.0.0.1:3102",
      contentRoot: fixture.root,
    }),
  });
});

afterAll(async () => {
  fixture.studio?.stop(true);
  fixture.backend?.stop(true);
  if (fixture.root) await rm(fixture.root, { recursive: true, force: true });
});

function request(path, options) {
  return fetch(new URL(path, fixture.studio.url), options);
}

test("dedicated listener serves dashboard, worker and original resources without a game listener", async () => {
  for (const path of [
    "/",
    "/studio/",
    "/studio/main.js",
    "/studio/style.css",
    "/studio/tabler.min.css",
    "/studio/atlas-worker.js",
  ]) {
    const response = await request(path);
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  }
  const settings = await request("/studio/settings.json");
  expect(await settings.json()).toEqual({ clientUrl: "http://127.0.0.1:3102" });
  const original = await request("/generated/example.json");
  expect(await original.json()).toEqual({ original: true });
  const head = await request("/generated/example.json", { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  for (const path of [
    "/.env.studio",
    "/studio/tools/config.js",
    "/service-worker.js",
    "/generated/%2e%2e%2f.env.studio",
  ]) {
    expect((await request(path)).status).toBe(404);
  }
});

test("authoring proxy retains browser Origin, session, CSRF and image bytes above the game command limit", async () => {
  const response = await request("/api/v1/custom-content/images", {
    method: "POST",
    headers: {
      Origin: fixture.studio.url.origin,
      Cookie: "openms_session=fixture",
      "X-CSRF-Token": "fixture-csrf",
      "Content-Type": "image/png",
    },
    body: new Uint8Array(32768),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain(
    "openms_session=fixture",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    path: "/api/v1/custom-content/images",
    method: "POST",
    origin: fixture.studio.url.origin,
    cookie: "openms_session=fixture",
    csrf: "fixture-csrf",
    bytes: 32768,
  });
  for (const [path, method] of [
    ["config", "GET"],
    ["challenge", "GET"],
    ["session", "POST"],
    ["session", "DELETE"],
  ]) {
    expect((await request(`/api/v1/${path}`, { method })).status).toBe(200);
  }
  for (const path of [
    "accounts",
    "characters",
    "development",
    "play",
    "play-ticket",
  ]) {
    expect((await request(`/api/v1/${path}`, { method: "POST" })).status).toBe(
      404,
    );
  }
});

test("Studio is absent from backend and game static routes", async () => {
  const backend = new OnlineHttp({
    config: {},
    auth: {},
    content: {},
    gateway: {},
  });
  const game = createStaticResources({
    root: resolve(import.meta.dir, "../../client"),
    online: true,
    html: "game",
  });
  for (const path of ["/studio", "/studio/", "/studio/main.js"]) {
    const input = new Request(`http://localhost${path}`);
    expect((await backend.fetch(input, {})).status).toBe(404);
    expect((await game.fetch(input)).status).toBe(404);
  }
});
