import { resolve, sep } from "node:path";
import { mkdir, realpath, rename } from "node:fs/promises";
import {
  DELIVERY_LIMITS,
  SHELL_URLS,
  collectDescriptors,
  releaseId,
  sha256,
  validateRelease,
  verifyBytes,
} from "../public/offline-manifest.js";

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
  if (file.size < 1 || file.size > DELIVERY_LIMITS.resourceBytes) {
    throw new Error(`Offline resource exceeds byte bound: ${url}`);
  }
  return new Uint8Array(await file.arrayBuffer());
}

async function publish(root, path, bytes) {
  const filename = resolve(root, "public", `.${path}`);
  await Bun.write(`${filename}.tmp`, bytes);
  await rename(`${filename}.tmp`, filename);
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

/** All schema additions join this queue automatically; no fixed map/category snapshot. */
async function generatedClosure(root, catalog) {
  const found = new Map();
  const budget = { nodes: 0 };
  collectDescriptors(catalog, found, budget);
  const packaged = new Set(Object.keys(catalog.maps));
  const missing = new Set();
  let bytes = 0;
  for (const info of found.values()) {
    const data = await sourceFile(root, info.url);
    await verifyBytes(data, info);
    bytes += data.byteLength;
    if (bytes > DELIVERY_LIMITS.totalBytes) {
      throw new Error("Offline release exceeds total byte bound");
    }
    if (!info.url.endsWith(".json")) continue;
    const value = JSON.parse(new TextDecoder().decode(data));
    collectDescriptors(value, found, budget);
    collectDestinations(value, packaged, missing);
  }
  return {
    resources: [...found.values()],
    unavailableMaps: [...missing].sort(),
  };
}

/** Run after the final Bun build. A single atomic pointer exposes immutable snapshots. */
export async function prepareRelease(root) {
  await mkdir(resolve(root, "public/generated/releases/blobs"), {
    recursive: true,
  });
  const catalogBytes = await sourceFile(root, "/generated/catalog.json");
  const catalog = JSON.parse(new TextDecoder().decode(catalogBytes));
  if (
    catalog.schemaVersion !== 2 ||
    !catalog.maps ||
    Object.keys(catalog.maps).length > DELIVERY_LIMITS.maps
  ) {
    throw new Error("Offline release requires a complete schema-v2 catalog");
  }
  const closure = await generatedClosure(root, catalog);
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
  return manifest;
}
