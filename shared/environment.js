import { closeSync, openSync, readSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const MAX_ENV_BYTES = 16 * 1024;
const KEYS = Object.freeze({
  server: [
    "DATABASE_URL",
    "OPENMS_ORIGIN",
    "OPENMS_STUDIO_ORIGIN",
    "OPENMS_HOST",
    "OPENMS_PORT",
    "OPENMS_CONTENT_ROOT",
    "OPENMS_RULES_HASH",
    "OPENMS_POW_BITS",
    "OPENMS_DEV_PASSWORD",
  ],
  client: ["ONLINE_HOST", "ONLINE_PORT", "OPENMS_SERVER_URL"],
  studio: [
    "STUDIO_HOST",
    "STUDIO_PORT",
    "OPENMS_SERVER_URL",
    "OPENMS_CLIENT_URL",
    "OPENMS_CONTENT_ROOT",
  ],
});

/** Read at most 16 KiB plus an overflow byte; paths never depend on the working directory. */
function readEnvironment(scope) {
  const path = fileURLToPath(new URL(`../.env.${scope}`, import.meta.url));
  const descriptor = openSync(path, "r");
  const bytes = Buffer.alloc(MAX_ENV_BYTES + 1);
  let length = 0;
  try {
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length);
      if (count === 0) break;
      length += count;
    }
  } finally {
    closeSync(descriptor);
  }
  if (length > MAX_ENV_BYTES) throw new Error(`${path} exceeds 16 KiB`);
  return parseEnv(bytes.toString("utf8", 0, length));
}

/** Host-only configuration: explicit keys, process precedence, no ambient environment mutation. */
export function loadEnvironment(scope) {
  if (!["server", "client", "studio"].includes(scope)) {
    throw new Error("Environment scope must be server, client or studio");
  }
  const defaults = readEnvironment(scope);
  const environment = {};
  for (const key of KEYS[scope]) {
    const value = process.env[key] ?? defaults[key];
    if (value !== undefined) environment[key] = value;
  }
  // A local settings file must never switch production into development mode.
  if (scope === "server") {
    environment.OPENMS_MODE =
      process.env.NODE_ENV === "production"
        ? "production"
        : process.env.OPENMS_MODE;
  }
  return Object.freeze(environment);
}
