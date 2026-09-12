import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function port(value, fallback) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 65535) {
    throw new Error("Server port must be an integer in 1..65535");
  }
  return result;
}

function configuredOrigin(environment, development) {
  const origin = new URL(
    environment.OPENMS_ORIGIN ??
      (development ? "http://127.0.0.1:3102" : "https://invalid.invalid"),
  );
  if (
    origin.origin !== origin.href.slice(0, -1) ||
    origin.username ||
    origin.password
  ) {
    throw new Error("OPENMS_ORIGIN must be an exact origin without a path");
  }
  if (
    !development &&
    (origin.protocol !== "https:" || origin.hostname === "invalid.invalid")
  ) {
    throw new Error("Production requires an explicit HTTPS OPENMS_ORIGIN");
  }
  if (
    development &&
    !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
  ) {
    throw new Error("Development origin must be loopback");
  }
  return origin.origin;
}

/** HTTP is allowed only for explicit loopback development; production needs TLS origin. */
export function serverConfig(environment = Bun.env) {
  const development = environment.OPENMS_MODE === "development";
  const origin = configuredOrigin(environment, development);
  if (!environment.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must point to PostgreSQL; no in-memory economy fallback",
    );
  }
  if (!/^postgres(ql)?:\/\//.test(environment.DATABASE_URL)) {
    throw new Error("DATABASE_URL must use PostgreSQL");
  }
  if (
    !development &&
    !/^[a-f0-9]{64}$/.test(environment.OPENMS_RULES_HASH ?? "")
  ) {
    throw new Error("Production requires a reviewed SHA-256 OPENMS_RULES_HASH");
  }
  return Object.freeze({
    development,
    origin,
    hostname: development
      ? "127.0.0.1"
      : (environment.OPENMS_HOST ?? "127.0.0.1"),
    port: port(environment.OPENMS_PORT, 3200),
    databaseUrl: environment.DATABASE_URL,
    contentRoot:
      environment.OPENMS_CONTENT_ROOT ??
      resolve(ROOT, "client/public/generated"),
    expectedRulesHash: environment.OPENMS_RULES_HASH ?? null,
    secureCookie: !development,
    sessionMs: 12 * 60 * 60 * 1000,
    reconnectMs: 30_000,
    maxSessions: 1024,
    maxConnections: 128,
  });
}
