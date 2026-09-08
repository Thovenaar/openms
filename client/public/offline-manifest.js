/** Local browser delivery policy; these bounds are not original game constants. */
export const DELIVERY_LIMITS = Object.freeze({
  resources: 65536,
  resourceBytes: 32 * 1024 * 1024,
  manifestBytes: 16 * 1024 * 1024,
  totalBytes: 8 * 1024 * 1024 * 1024,
  nodes: 20000000,
  maps: 512,
  releases: 64,
  clients: 256,
});
export const SHELL_URLS = Object.freeze([
  "/index.html",
  "/style.css",
  "/dist/main.js",
  "/dist/atlas-worker.js",
  "/dist/audio-capture-worklet.js",
  "/service-worker.js",
  "/offline-manifest.js",
  "/app.webmanifest",
  "/app-icon.svg",
]);
export const HASH = /^[a-f0-9]{64}$/;

/** Only canonical same-origin paths are legal; no query, traversal, or redirects. */
export function validPath(path) {
  if (typeof path !== "string" || !/^\/[a-zA-Z0-9/_.-]+$/.test(path)) {
    return false;
  }
  const parts = path.split("/");
  return !parts.some(
    (part, index) => index > 0 && (!part || part === "." || part === ".."),
  );
}

export function validateDescriptor(info) {
  if (
    !info ||
    !validPath(info.url) ||
    !HASH.test(info.sha256) ||
    !Number.isSafeInteger(info.bytes) ||
    info.bytes < 1 ||
    info.bytes > DELIVERY_LIMITS.resourceBytes
  ) {
    throw new Error(
      `Invalid offline resource descriptor: ${info?.url ?? "unnamed"}`,
    );
  }
  return info;
}

function addDescriptor(node, found) {
  validateDescriptor(node);
  if (!node.url.startsWith("/generated/")) {
    throw new Error(`Non-generated catalog dependency: ${node.url}`);
  }
  const previous = found.get(node.url);
  if (
    previous &&
    (previous.sha256 !== node.sha256 || previous.bytes !== node.bytes)
  ) {
    throw new Error(`Conflicting offline descriptor: ${node.url}`);
  }
  if (!previous) {
    found.set(node.url, {
      url: node.url,
      sha256: node.sha256,
      bytes: node.bytes,
    });
  }
  if (found.size > DELIVERY_LIMITS.resources) {
    throw new Error("Offline closure resource limit exceeded");
  }
}

/** Iteratively visit every inline metadata field, including nested descriptor metadata. */
export function collectDescriptors(root, found, budget) {
  const pending = [root];
  for (let index = 0; index < pending.length; index++) {
    const node = pending[index];
    if (++budget.nodes > DELIVERY_LIMITS.nodes) {
      throw new Error("Offline closure node limit exceeded");
    }
    if (!node || typeof node !== "object") continue;
    if (
      Object.hasOwn(node, "url") &&
      (Object.hasOwn(node, "sha256") || Object.hasOwn(node, "bytes"))
    ) {
      addDescriptor(node, found);
    }
    const values = Object.values(node);
    if (pending.length + values.length > DELIVERY_LIMITS.nodes) {
      throw new Error("Offline closure queue limit exceeded");
    }
    for (const value of values) {
      if (value && typeof value === "object") pending.push(value);
    }
  }
}

export async function sha256(buffer) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function verifyBytes(buffer, info) {
  if (buffer.byteLength !== info.bytes) {
    throw new Error(`Wrong byte length: ${info.url}`);
  }
  if ((await sha256(buffer)) !== info.sha256) {
    throw new Error(`SHA-256 mismatch: ${info.url}`);
  }
}

/** Hash the deterministic manifest payload, not its self-identifying releaseId. */
export async function releaseId(manifest) {
  const payload = { ...manifest };
  delete payload.releaseId;
  return sha256(new TextEncoder().encode(JSON.stringify(payload)));
}

function validateInventory(manifest) {
  const limits = {
    resources: DELIVERY_LIMITS.resources,
    maps: DELIVERY_LIMITS.maps,
    unavailableMaps: DELIVERY_LIMITS.resources,
  };
  for (const [key, limit] of Object.entries(limits)) {
    if (!Array.isArray(manifest[key]) || manifest[key].length > limit) {
      throw new Error(`Invalid offline ${key} inventory`);
    }
  }
  const maps = new Set();
  for (const map of manifest.maps) {
    if (
      !map ||
      !/^\d{9}$/.test(map.id) ||
      typeof map.name !== "string" ||
      maps.has(map.id)
    ) {
      throw new Error("Invalid offline map identity");
    }
    maps.add(map.id);
  }
  for (const id of manifest.unavailableMaps) {
    if (!/^\d{9}$/.test(id)) throw new Error("Invalid unavailable map ID");
  }
}

function validateSource(info) {
  validateDescriptor(info);
  if (!validPath(info.source)) {
    throw new Error(`Invalid offline resource source: ${info.url}`);
  }
  const immutable =
    /^\/generated\/[a-zA-Z0-9/_-]+\/[a-f0-9]{64}\.[a-z0-9]+$/.test(info.url);
  const snapshot = `/generated/releases/blobs/${info.sha256}.bin`;
  if (!(immutable && info.source === info.url) && info.source !== snapshot) {
    throw new Error(`Unversioned offline source: ${info.url}`);
  }
}

export async function validateRelease(manifest) {
  if (
    manifest?.schemaVersion !== 1 ||
    !HASH.test(manifest.releaseId) ||
    !HASH.test(manifest.buildId)
  ) {
    throw new Error("Unsupported offline release manifest");
  }
  validateInventory(manifest);
  const urls = new Set();
  let bytes = 0;
  for (const info of manifest.resources) {
    validateSource(info);
    if (urls.has(info.url)) {
      throw new Error(`Duplicate offline resource: ${info.url}`);
    }
    urls.add(info.url);
    bytes += info.bytes;
  }
  for (const url of [...SHELL_URLS, "/generated/catalog.json"]) {
    if (!urls.has(url)) throw new Error(`Incomplete app shell: ${url}`);
  }
  if (
    bytes !== manifest.totalBytes ||
    bytes > DELIVERY_LIMITS.totalBytes ||
    (await releaseId(manifest)) !== manifest.releaseId
  ) {
    throw new Error("Offline release digest/size mismatch");
  }
  return manifest;
}

/** Require a readable successful response before acquiring its stream lock. */
function validateResponse(response) {
  if (!response) throw new Error("Required offline resource is missing");
  if (
    response.status !== 200 ||
    response.type === "opaque" ||
    response.redirected
  ) {
    throw new Error(`Unavailable HTTP ${response.status}: ${response.url}`);
  }
  if (!response.body) throw new Error(`Missing response body: ${response.url}`);
}

/** Stream with a hard encoded-byte ceiling before allocating the final contiguous buffer. */
export async function boundedResponse(response, maximum, signal = null) {
  validateResponse(response);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (let index = 0; index <= maximum; index++) {
      if (signal?.aborted) {
        throw new DOMException("Offline operation cancelled", "AbortError");
      }
      const part = await reader.read();
      if (part.done) break;
      if (!part.value.byteLength) {
        throw new Error("Empty download stream chunk");
      }
      length += part.value.byteLength;
      if (length > maximum) {
        throw new Error(`Offline response exceeds byte bound: ${response.url}`);
      }
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel(error);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
