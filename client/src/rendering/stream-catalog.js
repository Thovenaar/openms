import {
  boundedResponse,
  resourceByteLimit,
  RESOURCE_HASH,
  sha256,
} from "../assets/resource-validation.js";

const CATALOG = "/generated/catalog.json";

/** The fresh server hash selects the catalog; its mutable URL is never a freshness claim. */
export async function loadCatalog(network, expectedHash, signal) {
  if (!RESOURCE_HASH.test(expectedHash)) {
    throw new Error("Invalid server catalog hash");
  }
  return network.gate.run(async () => {
    await network.ready;
    signal.throwIfAborted();
    const url = new URL(CATALOG, location.origin).href;
    const owner = network.activity?.begin("resource", url);
    try {
      let bytes = await cachedCatalog(network, url, expectedHash, signal);
      const cached = Boolean(bytes);
      if (!bytes) {
        bytes = await network.fetchBytes(
          CATALOG,
          signal,
          resourceByteLimit(CATALOG),
        );
        if ((await sha256(bytes)) !== expectedHash) {
          throw new Error("Server catalog identity mismatch");
        }
      } else network.hits++;
      signal.throwIfAborted();
      network.catalogBytes = bytes.byteLength;
      network.writes = network.writes.then(() =>
        network.store(url, bytes, cached),
      );
      await network.writes;
      signal.throwIfAborted();
      return JSON.parse(new TextDecoder().decode(bytes));
    } finally {
      network.activity?.end(owner);
    }
  }, signal);
}

/** A stale or damaged catalog gets one verified replacement; unchanged bytes stay local. */
async function cachedCatalog(network, url, expectedHash, signal) {
  if (network.releaseControlled() || !network.cache) return null;
  const response = await network.cache.match(url);
  if (!response) return null;
  try {
    const bytes = await boundedResponse(
      response,
      resourceByteLimit(CATALOG),
      signal,
    );
    if ((await sha256(bytes)) === expectedHash) return bytes;
  } catch (error) {
    if (signal.aborted) throw error;
    // Invalid stored response bodies are replaced just like a stale catalog hash.
  }
  signal.throwIfAborted();
  network.writes = network.writes.then(() => network.invalidate(url));
  await network.writes;
  return null;
}
