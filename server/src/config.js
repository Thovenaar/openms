import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { POW_MIN_BITS, POW_MAX_BITS } from "../../shared/proof-of-work.js";
import { loadEnvironment } from "../../shared/environment.js";

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
  if (development && !["http:", "https:"].includes(origin.protocol)) {
    throw new Error("Development OPENMS_ORIGIN must use HTTP or HTTPS");
  }
  return origin.origin;
}

function proofBits(value) {
  const bits = value === undefined ? 15 : Number(value);
  if (!Number.isSafeInteger(bits)) {
    throw new Error("OPENMS_POW_BITS must be an integer");
  }
  return Math.max(POW_MIN_BITS, Math.min(POW_MAX_BITS, bits));
}

/** Explicit development mode allows HTTP origins; production requires HTTPS. */
export function serverConfig(environment = loadEnvironment("server")) {
  const development = environment.OPENMS_MODE === "development";
  const origin = configuredOrigin(environment, development);
  const hostname = environment.OPENMS_HOST ?? "127.0.0.1";
  if (typeof hostname !== "string" || !hostname.trim()) {
    throw new Error(
      "OPENMS_HOST must be a non-empty bind hostname or IP address",
    );
  }
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
    hostname,
    port: port(environment.OPENMS_PORT, 3200),
    databaseUrl: environment.DATABASE_URL,
    contentRoot:
      environment.OPENMS_CONTENT_ROOT ??
      resolve(ROOT, "client/public/generated"),
    expectedRulesHash: environment.OPENMS_RULES_HASH ?? null,
    secureCookie: !development,
    powBits: proofBits(environment.OPENMS_POW_BITS),
    sessionMs: 12 * 60 * 60 * 1000,
    reconnectMs: 30_000,
    maxSessions: 1024,
    maxConnections: 128,
  });
}
