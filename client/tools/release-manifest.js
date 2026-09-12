import { resolve, sep } from "node:path";
import { mkdir, realpath } from "node:fs/promises";
import { publishFile } from "./atlas.js";
import { catalog as validateCatalog } from "../src/rendering/stream-validation.js";
import { measureStage } from "./native-evidence.js";
import {
  DELIVERY_LIMITS,
  SHELL_URLS,
  collectDescriptors,
  releaseId,
  resourceByteLimit,
  sha256,
  validateRelease,
  verifyBytes,
} from "../public/offline-manifest.js";

const INTEGRITY_PROGRESS_BATCH = 256;
const INTEGRITY_PROGRESS_MIN_MS = 250;
const INTEGRITY_PROGRESS_INTERVAL_MS = 1000;

/** Bound output to four lines/second, or one/second for slow batches. */
function integrityProgress(progress) {
  let reportedAt = performance.now();
  return (completed, discovered, bytes) => {
    if (!progress) return;
    const now = performance.now();
    const elapsed = now - reportedAt;
    if (
      elapsed < INTEGRITY_PROGRESS_MIN_MS ||
      (completed % INTEGRITY_PROGRESS_BATCH !== 0 &&
        elapsed < INTEGRITY_PROGRESS_INTERVAL_MS)
    ) {
      return;
    }
    reportedAt = now;
    progress(
      `Asset integrity: ${completed} verified, ${discovered} discovered, ${bytes} bytes (discovery continues)`,
    );
  };
}
/** Resolve only the allowlisted shell or canonical generated dependencies. */
async function sourceFile(root, url) {
  const directory =
    url.startsWith("/generated/") ||
    (!["/index.html", "/style.css"].includes(url) && !url.startsWith("/dist/"))
      ? resolve(root, "public")
      : root;
  const filename = await realpath(resolve(directory, `.${url}`));
  if (!filename.startsWith(directory + sep)) {
    throw new Error(`Offline source escapes public directory: ${url}`);
  }
  const file = Bun.file(filename);
  if (file.size < 1 || file.size > resourceByteLimit(url)) {
    throw new Error(`Offline resource exceeds byte bound: ${url}`);
  }
  return new Uint8Array(await file.arrayBuffer());
}

async function publish(root, path, bytes) {
  const filename = resolve(root, "public", `.${path}`);
  await publishFile(filename, bytes);
}

async function snapshot(root, url) {
  const bytes = await sourceFile(root, url);
  const hash = await sha256(bytes);
  const source = `/generated/releases/blobs/${hash}.bin`;
  await publish(root, source, bytes);
  return { url, sha256: hash, bytes: bytes.byteLength, source };
}

/** Unpackaged authored destinations remain named unavailable, not downloadable. */
function collectDestinations(value, packaged, missing) {
  const portals = value.physics?.portals;
  if (!Array.isArray(portals)) return;
  if (portals.length > DELIVERY_LIMITS.resources) {
    throw new Error("Offline portal inventory exceeds bound");
  }
  for (const portal of portals) {
    const value = portal.targetMap;
    if (!Number.isInteger(value) || value < 0 || value >= 999999999) continue;
    const target = String(value).padStart(9, "0");
    if (!packaged.has(target)) missing.add(target);
  }
  if (missing.size > DELIVERY_LIMITS.resources) {
    throw new Error("Unavailable map inventory exceeds bound");
  }
}

/** Referenced labels/quest targets are complete metadata, not promised playable maps. */
function collectMetadataDestinations(catalog, packaged, missing) {
  const dependencies = [
    catalog.serverData?.supportedDependencies?.mapIds ?? [],
  ];
  const quests = Object.values(catalog.quests?.records ?? {});
  if (quests.length > 4096) throw new Error("Offline quest metadata limit");
  for (const quest of quests) dependencies.push(quest.dependencies.mapIds);
  for (const ids of dependencies) {
    collectMapDependencies(ids, packaged, missing);
  }
}

/** Add one bounded original-source map list without changing its sentinel handling. */
function collectMapDependencies(ids, packaged, missing) {
  if (ids.length > DELIVERY_LIMITS.resources) {
    throw new Error("Offline map dependency limit");
  }
  for (const id of ids) {
    if (!Number.isSafeInteger(id) || id < 0 || id > 999999999) {
      throw new Error("Invalid original map dependency");
    }
    if (id === 999999999) continue;
    const key = String(id).padStart(9, "0");
    if (!packaged.has(key)) missing.add(key);
  }
  if (missing.size > DELIVERY_LIMITS.resources) {
    throw new Error("Offline unavailable map limit");
  }
}

/** All schema additions join this queue automatically; no fixed map/category snapshot. */
async function generatedClosure(root, catalog, progress) {
  const found = new Map();
  const budget = { nodes: 0 };
  collectDescriptors(catalog, found, budget);
  const packaged = new Set(Object.keys(catalog.maps));
  const missing = new Set();
  collectMetadataDestinations(catalog, packaged, missing);
  let bytes = 0;
  let completed = 0;
  const report = integrityProgress(progress);
  progress?.(
    `Asset integrity: starting (${found.size} initially discovered resources)`,
  );
  for (const info of found.values()) {
    const data = await sourceFile(root, info.url);
    await verifyBytes(data, info);
    bytes += data.byteLength;
    if (bytes > DELIVERY_LIMITS.totalBytes) {
      throw new Error("Offline release exceeds total byte bound");
    }
    if (info.url.endsWith(".json")) {
      const value = JSON.parse(new TextDecoder().decode(data));
      collectDescriptors(value, found, budget);
      collectDestinations(value, packaged, missing);
    }
    report(++completed, found.size, bytes);
  }
  progress?.(
    `Asset integrity: complete (${completed} resources, ${bytes} bytes)`,
  );
  return {
    resources: [...found.values()],
    unavailableMaps: [...missing].sort(),
  };
}

/** Atomic release publication; optional synchronous progress receives phase lines only. */
export async function prepareRelease(root, progress, timings = {}) {
  progress?.("Asset release: starting catalog validation");
  const catalogStarted = performance.now();
  await mkdir(resolve(root, "public/generated/releases/blobs"), {
    recursive: true,
  });
  const catalogBytes = await sourceFile(root, "/generated/catalog.json");
  const catalog = JSON.parse(new TextDecoder().decode(catalogBytes));
  validateCatalog(catalog);
  if (
    catalog.schemaVersion !== 2 ||
    !catalog.maps ||
    Object.keys(catalog.maps).length > DELIVERY_LIMITS.maps
  ) {
    throw new Error("Offline release requires a complete schema-v2 catalog");
  }
  timings.catalogValidationMs = performance.now() - catalogStarted;
  const closure = await measureStage(timings, "assetIntegrityMs", () =>
    generatedClosure(root, catalog, progress),
  );
  const publicationStarted = performance.now();
  progress?.(
    "Asset release: snapshotting shell and catalog; assembling manifest",
  );
  const resources = await snapshotStartup(root, catalogBytes);
  for (const info of closure.resources) {
    resources.push({ ...info, source: info.url });
  }
  resources.sort((left, right) => left.url.localeCompare(right.url, "en"));
  const manifest = {
    schemaVersion: 1,
    buildId: catalog.buildId,
    resources,
    totalBytes: resources.reduce((total, info) => total + info.bytes, 0),
    maps: Object.entries(catalog.maps).map(([id, info]) => ({
      id,
      name: typeof info.name === "string" ? info.name : id,
    })),
    unavailableMaps: closure.unavailableMaps,
  };
  manifest.releaseId = await releaseId(manifest);
  await validateRelease(manifest);
  const encoded = JSON.stringify(manifest);
  if (
    new TextEncoder().encode(encoded).byteLength > DELIVERY_LIMITS.manifestBytes
  ) {
    throw new Error("Offline manifest exceeds byte bound");
  }
  await publish(
    root,
    `/generated/releases/${manifest.releaseId}.json`,
    encoded,
  );
  await publish(root, "/generated/release.json", encoded);
  timings.releasePublicationMs = performance.now() - publicationStarted;
  progress?.("Asset release: manifest validated and published");
  return manifest;
}

async function snapshotStartup(root, catalogBytes) {
  const resources = [];
  for (const url of SHELL_URLS) resources.push(await snapshot(root, url));
  const catalogHash = await sha256(catalogBytes);
  const catalogSource = `/generated/releases/blobs/${catalogHash}.bin`;
  await publish(root, catalogSource, catalogBytes);
  resources.push({
    url: "/generated/catalog.json",
    sha256: catalogHash,
    bytes: catalogBytes.byteLength,
    source: catalogSource,
  });
  return resources;
}
