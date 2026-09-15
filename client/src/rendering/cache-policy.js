import { LIMITS } from "./stream-validation.js";

export const CACHE_POLICY = Object.freeze({
  fallbackBytes: 192 * 1024 * 1024,
  quotaFraction: 0.8,
  estimateTimeoutMs: 2000,
});

/** Origin quota is approximate and shared; leave 20% headroom and subtract non-cache usage. */
export function cacheBudget(estimate, cacheBytes) {
  if (!validEstimate(estimate)) return CACHE_POLICY.fallbackBytes;
  const { quota, usage } = estimate;
  const other = Math.max(0, usage - cacheBytes);
  return Math.max(
    0,
    Math.min(
      LIMITS.cacheBytes,
      Math.floor(quota * CACHE_POLICY.quotaFraction - other),
    ),
  );
}

function validEstimate(estimate) {
  return (
    Number.isFinite(estimate?.quota) &&
    estimate.quota > 0 &&
    Number.isFinite(estimate.usage) &&
    estimate.usage >= 0
  );
}

export async function estimateCacheBudget(storage, cacheBytes) {
  if (!storage?.estimate) {
    return { bytes: CACHE_POLICY.fallbackBytes, status: "unsupported" };
  }
  let timer;
  try {
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("Storage estimate timed out")),
        CACHE_POLICY.estimateTimeoutMs,
      );
    });
    const estimate = await Promise.race([storage.estimate(), timeout]);
    return {
      bytes: cacheBudget(estimate, cacheBytes),
      status: validEstimate(estimate) ? "estimated" : "invalid",
    };
  } catch (error) {
    return {
      bytes: CACHE_POLICY.fallbackBytes,
      status: `unavailable: ${error.message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Permission may remain pending; the caller never waits for it to finish startup. */
export async function requestCachePersistence(storage, publish) {
  if (!storage?.persisted || !storage.persist) {
    publish("unsupported");
    return;
  }
  try {
    publish("checking");
    if (await storage.persisted()) {
      publish("granted");
      return;
    }
    publish("requested");
    publish((await storage.persist()) ? "granted" : "best-effort");
  } catch (error) {
    publish(`unavailable: ${error.message}`);
  }
}
