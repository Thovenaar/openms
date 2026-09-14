/** Browser and extraction bounds for immutable generated resources. */
export const RESOURCE_LIMITS = Object.freeze({
  resources: 65536,
  resourceBytes: 32 * 1024 * 1024,
  catalogBytes: 64 * 1024 * 1024,
  nodes: 64000000,
});

export const RESOURCE_HASH = /^[a-f0-9]{64}$/;

export function resourceByteLimit(url) {
  return url === "/generated/catalog.json"
    ? RESOURCE_LIMITS.catalogBytes
    : RESOURCE_LIMITS.resourceBytes;
}

/** Only canonical same-origin paths are legal; no query or traversal. */
export function validResourcePath(path) {
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
    !validResourcePath(info.url) ||
    !RESOURCE_HASH.test(info.sha256) ||
    !Number.isSafeInteger(info.bytes) ||
    info.bytes < 1 ||
    info.bytes > resourceByteLimit(info.url)
  ) {
    throw new Error(`Invalid resource descriptor: ${info?.url ?? "unnamed"}`);
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
    throw new Error(`Conflicting resource descriptor: ${node.url}`);
  }
  if (!previous) {
    found.set(node.url, {
      url: node.url,
      sha256: node.sha256,
      bytes: node.bytes,
    });
  }
  if (found.size > RESOURCE_LIMITS.resources) {
    throw new Error("Resource closure limit exceeded");
  }
}

/** Iteratively visit inline metadata without recursive stack growth. */
export function collectDescriptors(root, found, budget) {
  const pending = [root];
  for (let index = 0; index < pending.length; index++) {
    const node = pending[index];
    if (++budget.nodes > RESOURCE_LIMITS.nodes) {
      throw new Error("Resource closure node limit exceeded");
    }
    if (!node || typeof node !== "object") continue;
    if (
      Object.hasOwn(node, "url") &&
      (Object.hasOwn(node, "sha256") || Object.hasOwn(node, "bytes"))
    ) {
      addDescriptor(node, found);
    }
    const values = Object.values(node);
    if (pending.length + values.length > RESOURCE_LIMITS.nodes) {
      throw new Error("Resource closure queue limit exceeded");
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

function validateResponse(response) {
  if (!response) throw new Error("Required resource is missing");
  if (
    response.status !== 200 ||
    response.type === "opaque" ||
    response.redirected
  ) {
    throw new Error(`Unavailable HTTP ${response.status}: ${response.url}`);
  }
  if (!response.body) throw new Error(`Missing response body: ${response.url}`);
}

/** Read a response stream with an encoded-byte ceiling. */
export async function boundedResponse(response, maximum, signal = null) {
  validateResponse(response);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (let index = 0; index <= maximum; index++) {
      if (signal?.aborted) {
        throw new DOMException("Resource request cancelled", "AbortError");
      }
      const part = await reader.read();
      if (part.done) break;
      if (!part.value.byteLength) throw new Error("Empty response chunk");
      length += part.value.byteLength;
      if (length > maximum) {
        throw new Error(`Response exceeds byte bound: ${response.url}`);
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
