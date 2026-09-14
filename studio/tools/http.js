import { resolve } from "node:path";
import { buildStudio } from "./build.js";
import { createStaticResources } from "../../client/tools/static-resources.js";

/** Closed static surface: no filesystem URL mapping or authoring secrets enter the browser bundle. */
export async function createStudioHttp(config) {
  const assets = await buildStudio();
  // Studio serves its own shell from the bundle; this helper only exposes /generated.
  const resources = createStaticResources({
    root: resolve(import.meta.dir, "../../client"),
    generatedRoot: config.contentRoot,
    html: "",
  });
  return async (request) => {
    const url = new URL(request.url);
    const path = url.pathname === "/" ? "/studio/" : url.pathname;
    if (path.startsWith("/api/")) return proxy(request, config);
    if (path.startsWith("/generated/")) return resources.fetch(request);
    if (request.method !== "GET" || url.search) {
      return new Response("Not found", { status: 404 });
    }
    if (path === "/studio") {
      return Response.redirect(new URL("/studio/", url), 302);
    }
    if (path === "/studio/settings.json") {
      return Response.json(
        { clientUrl: config.clientUrl },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const asset = assets.get(path);
    return asset
      ? new Response(asset.bytes, {
          headers: {
            "Content-Type": asset.type,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        })
      : new Response("Not found", { status: 404 });
  };
}

function authoringRoute(request) {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/v1/custom-content/")) {
    return ["GET", "POST"].includes(request.method);
  }
  if (["/api/v1/config", "/api/v1/challenge"].includes(path)) {
    return request.method === "GET";
  }
  return (
    path === "/api/v1/session" && ["POST", "DELETE"].includes(request.method)
  );
}

/** Preserve browser Origin/cookies/CSRF. The backend separately admits the configured Studio origin. */
async function proxy(request, config) {
  if (!authoringRoute(request)) {
    return new Response("Not found", { status: 404 });
  }
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  for (const name of ["host", "connection", "upgrade"]) headers.delete(name);
  try {
    return await fetch(new URL(url.pathname + url.search, config.upstream), {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : request.body,
      redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
    });
  } catch (error) {
    console.error("Studio backend request failed:", error.message);
    return Response.json(
      { code: "SERVER_BUSY" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
