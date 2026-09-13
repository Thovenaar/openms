import { resolve } from "node:path";
import { loadEnvironment } from "../../shared/environment.js";

const ROOT = resolve(import.meta.dir, "../..");

function httpOrigin(value, key) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(`${key} must be an exact HTTP(S) origin`);
  }
  return url.origin;
}

function listener(options, environment) {
  const hostname = options.hostname ?? environment.STUDIO_HOST ?? "127.0.0.1";
  if (typeof hostname !== "string" || !hostname.trim()) {
    throw new Error("STUDIO_HOST must be a non-empty hostname or IP address");
  }
  const port = Number(options.port ?? environment.STUDIO_PORT ?? 3103);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("STUDIO_PORT must be in 1..65535");
  }
  return { hostname, port };
}

/** Host-only settings; only the public game link is sent to the browser. */
export function studioConfig(
  options = {},
  environment = loadEnvironment("studio"),
) {
  return {
    ...listener(options, environment),
    upstream: httpOrigin(
      options.upstream ??
        environment.OPENMS_SERVER_URL ??
        "http://127.0.0.1:3200",
      "OPENMS_SERVER_URL",
    ),
    clientUrl: httpOrigin(
      options.clientUrl ??
        environment.OPENMS_CLIENT_URL ??
        "http://127.0.0.1:3102",
      "OPENMS_CLIENT_URL",
    ),
    contentRoot: resolve(
      ROOT,
      options.contentRoot ??
        environment.OPENMS_CONTENT_ROOT ??
        "client/public/generated",
    ),
  };
}
