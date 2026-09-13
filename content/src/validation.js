export const CONTENT_LIMITS = Object.freeze({
  documentBytes: 512 * 1024,
  documentNodes: 65536,
  catalogBytes: 64 * 1024 * 1024,
  catalogNodes: 4000000,
  depth: 32,
  assets: 100000,
  placements: 4096,
  objectives: 64,
  frames: 1024,
  imageSide: 2048,
  uploadBytes: 4 * 1024 * 1024,
  contentPerOwner: 4096,
  revisionsPerContent: 10000,
  uploadsPerOwner: 1024,
});

/** Stable error codes are suitable for an API; paths point into an authoring document. */
export function contentError(code, message, path = "") {
  return Object.assign(new Error(message), { code, path });
}

export function requireContent(condition, message, path = "") {
  if (!condition) throw contentError("INVALID_CONTENT", message, path);
}

export function record(value, required, optional = [], path = "") {
  requireContent(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Expected object",
    path,
  );
  const keys = Object.keys(value);
  requireContent(
    required.every((key) => Object.hasOwn(value, key)),
    "Missing required field",
    path,
  );
  requireContent(
    keys.every((key) => required.includes(key) || optional.includes(key)),
    "Unknown field",
    path,
  );
}

export function text(value, maximum = 160, path = "") {
  requireContent(
    typeof value === "string" && value.length > 0 && value.length <= maximum,
    "Invalid text length",
    path,
  );
  requireContent(
    value.isWellFormed() && !value.includes("\u0000"),
    "Invalid Unicode text",
    path,
  );
  return value;
}

export function integer(value, minimum, maximum, path = "") {
  requireContent(
    Number.isSafeInteger(value) &&
      !Object.is(value, -0) &&
      value >= minimum &&
      value <= maximum,
    "Integer outside allowed range",
    path,
  );
  return value;
}

export function list(value, maximum, path = "") {
  requireContent(
    Array.isArray(value) && value.length <= maximum,
    "Array exceeds limit",
    path,
  );
  return value;
}

export function identity(value, path = "") {
  text(value, 64, path);
  requireContent(
    /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value),
    "Invalid identity",
    path,
  );
  return value;
}

export function hash(value, path = "") {
  requireContent(
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    "Expected SHA-256 identity",
    path,
  );
  return value;
}

export function enumeration(value, choices, path = "") {
  requireContent(choices.includes(value), "Unsupported value", path);
  return value;
}

function jsonNode(value, path, pending, depth) {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    requireContent(
      value.isWellFormed() && !value.includes("\u0000"),
      "Invalid JSON string",
      path,
    );
    return;
  }
  if (typeof value === "number") {
    requireContent(
      Number.isFinite(value) && !Object.is(value, -0),
      "Invalid JSON number",
      path,
    );
    return;
  }
  requireContent(typeof value === "object", "Expected JSON value", path);
  const prototype = Object.getPrototypeOf(value);
  requireContent(
    Array.isArray(value) ||
      prototype === Object.prototype ||
      prototype === null,
    "Expected plain JSON object",
    path,
  );
  for (const key of Object.keys(value)) {
    requireContent(
      !["__proto__", "constructor", "prototype"].includes(key),
      "Reserved JSON key",
      path,
    );
    pending.push({
      value: value[key],
      path: `${path}/${key}`,
      depth: depth + 1,
    });
  }
}

/** Bound trees before stringification; repeated references/cycles exhaust the same finite budget. */
export function jsonDocument(
  value,
  {
    maxBytes = CONTENT_LIMITS.documentBytes,
    maxNodes = CONTENT_LIMITS.documentNodes,
  } = {},
) {
  const pending = [{ value, path: "", depth: 0 }];
  for (let index = 0; index < pending.length; index++) {
    const node = pending[index];
    requireContent(
      node.depth <= CONTENT_LIMITS.depth,
      "JSON depth exceeds limit",
      node.path,
    );
    jsonNode(node.value, node.path, pending, node.depth);
    requireContent(pending.length <= maxNodes, "JSON node count exceeds limit");
  }
  const encoded = JSON.stringify(value);
  requireContent(
    Buffer.byteLength(encoded) <= maxBytes,
    "JSON byte size exceeds limit",
  );
  return encoded;
}

export function originalRef(value, kinds, path = "") {
  record(value, ["source", "kind", "id"], ["mapId"], path);
  enumeration(value.source, ["original"], path);
  enumeration(value.kind, kinds, path);
  text(value.id, 160, path);
  if (value.kind === "entity" || value.kind === "npc") {
    requireContent(/^\d{9}$/.test(value.mapId), "Source map is required", path);
  } else {
    requireContent(value.mapId === undefined, "Unexpected source map", path);
  }
}

export function customRef(value, kind, path = "") {
  record(value, ["source", "kind", "id", "revision"], [], path);
  enumeration(value.source, ["custom"], path);
  enumeration(value.kind, [kind], path);
  identity(value.id, path);
  integer(value.revision, 1, CONTENT_LIMITS.revisionsPerContent, path);
}

export function reference(value, kinds, path = "") {
  if (value?.source === "custom") {
    enumeration(value.kind, ["map", "mob", "quest"], path);
    enumeration(value.kind, kinds, path);
    customRef(value, value.kind, path);
  } else originalRef(value, kinds, path);
}
