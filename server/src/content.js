import { createHash } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  catalog as validateCatalog,
  manifest as validateManifest,
} from "../../client/src/rendering/stream-validation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const MAX_CACHED_MAPS = 128;
const MAX_RULE_FILES = 4096;
const MAX_RULE_BYTES = 64 * 1024 * 1024;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Hash the exact server/shared rule implementation, including reused client kernels. */
async function rulesIdentity(assetBuildId) {
  const paths = [];
  for (const [directory, pattern] of [
    ["server/src", "**/*.js"],
    ["server/sql", "**/*.sql"],
    ["shared", "**/*.js"],
    ["client/src", "**/*.js"],
  ]) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan({
      cwd: resolve(REPOSITORY, directory),
      onlyFiles: true,
    })) {
      if (paths.length >= MAX_RULE_FILES) {
        throw new Error("Rules file capacity exceeded");
      }
      paths.push(`${directory}/${path}`);
    }
  }
  paths.sort();
  const hash = createHash("sha256").update(
    `openms-rules-v1\0${assetBuildId}\0`,
  );
  let total = 0;
  for (const path of paths) {
    const file = Bun.file(resolve(REPOSITORY, path));
    if (file.size > MAX_RULE_BYTES - total) {
      throw new Error("Rules byte capacity exceeded");
    }
    const bytes = await file.arrayBuffer();
    total += bytes.byteLength;
    if (total > MAX_RULE_BYTES) throw new Error("Rules byte capacity exceeded");
    hash.update(`${path}\0${bytes.byteLength}\0`);
    hash.update(new Uint8Array(bytes));
  }
  return hash.digest("hex");
}

/** Original generated content is admitted by size, SHA-256 and canonical containment. */
export class ServerContent {
  constructor(root) {
    this.root = root;
    this.maps = new Map();
    this.pendingMaps = new Map();
  }

  async json(descriptor) {
    if (
      !descriptor ||
      !/^\/generated\/(maps|references|bundles|regions)\/[a-f0-9]{64}\.json$/.test(
        descriptor.url,
      )
    ) {
      throw new Error("Invalid server content descriptor");
    }
    if (
      !Number.isSafeInteger(descriptor.bytes) ||
      descriptor.bytes < 1 ||
      descriptor.bytes > MAX_JSON_BYTES
    ) {
      throw new Error("Server content byte limit exceeded");
    }
    if (!/^[a-f0-9]{64}$/.test(descriptor.sha256)) {
      throw new Error("Invalid content hash");
    }
    const filename = await realpath(
      resolve(this.root, descriptor.url.slice("/generated/".length)),
    );
    if (!filename.startsWith(this.root + sep)) {
      throw new Error("Content escaped generated root");
    }
    const file = Bun.file(filename);
    if (file.size !== descriptor.bytes) {
      throw new Error("Content length mismatch");
    }
    const bytes = await file.arrayBuffer();
    if (
      bytes.byteLength !== descriptor.bytes ||
      digest(new Uint8Array(bytes)) !== descriptor.sha256
    ) {
      throw new Error("Content integrity mismatch");
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }

  async map(value) {
    if (
      !Number.isSafeInteger(Number(value)) ||
      !/^\d{1,9}$/.test(String(value))
    ) {
      throw new Error("Invalid map identity");
    }
    const id = String(Number(value)).padStart(9, "0");
    const cached = this.maps.get(id);
    if (cached) return cached;
    if (this.pendingMaps.has(id)) return this.pendingMaps.get(id);
    if (this.maps.size + this.pendingMaps.size >= MAX_CACHED_MAPS) {
      throw new Error("Server field content capacity exceeded");
    }
    const pending = this.loadMap(id);
    this.pendingMaps.set(id, pending);
    try {
      return await pending;
    } finally {
      this.pendingMaps.delete(id);
    }
  }

  async loadMap(id) {
    const descriptor = this.catalog.maps[id];
    if (!descriptor) throw new Error("Map is not in the admitted catalog");
    const manifest = validateManifest(await this.json(descriptor));
    if (manifest.id !== id) throw new Error("Map descriptor identity mismatch");
    nearestSavedArrival(manifest, { x: 0, y: 0, facing: 1 });
    this.maps.set(id, manifest);
    return manifest;
  }
}

/** Load once before listening. No input extraction or browser/offline-release rebuild. */
export async function loadContent(options = {}) {
  const root = await realpath(
    options.root ?? resolve(REPOSITORY, "client/public/generated"),
  );
  const content = new ServerContent(root);
  const file = Bun.file(resolve(root, "catalog.json"));
  if (file.size < 1 || file.size > MAX_JSON_BYTES) {
    throw new Error("Catalog byte limit exceeded");
  }
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_JSON_BYTES) {
    throw new Error("Catalog byte limit exceeded");
  }
  content.catalogHash = digest(new Uint8Array(bytes));
  content.catalog = validateCatalog(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  content.assetBuildId = content.catalog.buildId;
  content.rulesHash = await rulesIdentity(content.assetBuildId);
  content.items = content.catalog.ui.items;
  await content.map(content.catalog.defaultMap);
  return content;
}
