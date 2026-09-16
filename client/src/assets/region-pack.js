import { RESOURCE_HASH, validateDescriptor } from "./resource-validation.js";

/**
 * One packaged map's JSON closure travels as one self-describing container
 * instead of hundreds of per-file requests. Each member keeps its own gzip
 * stream, so the persistent cache stores exactly the compact bytes a per-file
 * `.gz` delivery would have stored. The container itself is never cached.
 */
export const REGION_PACK_LIMITS = Object.freeze({
  maps: 1024,
  members: 1024,
  assets: 32768,
  containers: 4096,
  headerBytes: 256 * 1024,
  unpackedBytes: 16 * 1024 * 1024,
  blobBytes: 8 * 1024 * 1024,
  indexBytes: 8 * 1024 * 1024,
});

/** 8-byte magic followed by a big-endian uint32 header length. */
export const REGION_PACK_MAGIC = "OPENMSRP";
export const REGION_PACK_PREFIX = 12;

const PACK_URL = /^\/generated\/packs\/[a-f0-9]{64}\.bin$/;
const MAP_ID = /^\d{9}$/;

/** Positive safe integers inside an inclusive delivery bound. */
function bounded(value, maximum) {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

/** The blob is named by its container SHA-256, so URL and content hash cannot disagree. */
export function validateRegionPack(pack) {
  if (
    !pack ||
    typeof pack.url !== "string" ||
    !PACK_URL.test(pack.url) ||
    !RESOURCE_HASH.test(pack.sha256 ?? "")
  ) {
    throw new Error("Invalid region pack");
  }
  if (pack.url !== `/generated/packs/${pack.sha256}.bin`) {
    throw new Error("Region pack URL does not match its hash");
  }
  if (!bounded(pack.bytes, REGION_PACK_LIMITS.blobBytes)) {
    throw new Error("Invalid region pack byte length");
  }
  if (!bounded(pack.unpackedBytes, REGION_PACK_LIMITS.unpackedBytes)) {
    throw new Error("Invalid region pack unpacked length");
  }
  return pack;
}

function member(info) {
  validateDescriptor(info);
  return { url: info.url, sha256: info.sha256, bytes: info.bytes };
}

/** Manifest first, then authored region order, then the optional minimap bundle. */
export function regionPackClosure(manifestInfo, manifest, minimapInfo) {
  const members = [member(manifestInfo)];
  for (const region of manifest?.regions ?? []) members.push(member(region));
  if (minimapInfo) members.push(member(minimapInfo));
  if (members.length > REGION_PACK_LIMITS.members) {
    throw new Error("Region pack member limit exceeded");
  }
  let bytes = 0;
  for (const entry of members) bytes += entry.bytes;
  if (bytes > REGION_PACK_LIMITS.unpackedBytes) {
    throw new Error("Region pack byte limit exceeded");
  }
  return members;
}

/** Header entries repeat each member's trusted identity plus its packed extent. */
export function encodeRegionPackHeader(entries) {
  const header = new TextEncoder().encode(JSON.stringify({ members: entries }));
  if (header.byteLength > REGION_PACK_LIMITS.headerBytes) {
    throw new Error("Region pack header exceeds its byte bound");
  }
  const prefix = new Uint8Array(REGION_PACK_PREFIX + header.byteLength);
  for (let index = 0; index < REGION_PACK_MAGIC.length; index++) {
    prefix[index] = REGION_PACK_MAGIC.charCodeAt(index);
  }
  new DataView(prefix.buffer).setUint32(
    REGION_PACK_MAGIC.length,
    header.byteLength,
  );
  prefix.set(header, REGION_PACK_PREFIX);
  return prefix;
}

/** Magic and header extent, before any parsed value is trusted. */
function readPrefix(bytes) {
  if (bytes.byteLength < REGION_PACK_PREFIX) {
    throw new Error("Truncated region pack header");
  }
  for (let index = 0; index < REGION_PACK_MAGIC.length; index++) {
    if (bytes[index] !== REGION_PACK_MAGIC.charCodeAt(index)) {
      throw new Error("Invalid region pack magic");
    }
  }
  const length = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    REGION_PACK_PREFIX,
  ).getUint32(REGION_PACK_MAGIC.length);
  if (
    length < 2 ||
    length > REGION_PACK_LIMITS.headerBytes ||
    REGION_PACK_PREFIX + length > bytes.byteLength
  ) {
    throw new Error("Invalid region pack header length");
  }
  return length;
}

/** Every generated member is content addressed, so its URL independently restates its hash. */
function contentAddressed(url, sha256) {
  const name = url.slice(url.lastIndexOf("/") + 1);
  const dot = name.indexOf(".");
  return dot > 0 && name.slice(0, dot) === sha256;
}

function validateEntry(entry) {
  if (
    typeof entry?.url !== "string" ||
    !entry.url.startsWith("/generated/") ||
    !RESOURCE_HASH.test(entry.sha256 ?? "") ||
    !contentAddressed(entry.url, entry.sha256)
  ) {
    throw new Error("Invalid region pack member");
  }
  if (
    !bounded(entry.raw, REGION_PACK_LIMITS.unpackedBytes) ||
    !bounded(entry.packed, REGION_PACK_LIMITS.blobBytes)
  ) {
    throw new Error("Invalid region pack member extent");
  }
}

/** The header is untrusted input: bound it and every entry before slicing anything. */
export function decodeRegionPackHeader(bytes) {
  const length = readPrefix(bytes);
  let header;
  try {
    header = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(REGION_PACK_PREFIX, REGION_PACK_PREFIX + length),
      ),
    );
  } catch {
    throw new Error("Corrupt region pack header");
  }
  const entries = header?.members;
  if (
    !Array.isArray(entries) ||
    entries.length < 1 ||
    entries.length > REGION_PACK_LIMITS.members
  ) {
    throw new Error("Invalid region pack member list");
  }
  for (const entry of entries) validateEntry(entry);
  return { entries, offset: REGION_PACK_PREFIX + length };
}

/** The container must describe exactly the closure the catalog and manifest declare. */
export function validateRegionPackHeader(entries, closure) {
  if (entries.length !== closure.length) {
    throw new Error("Region pack closure mismatch");
  }
  let unpacked = 0;
  for (let index = 0; index < closure.length; index++) {
    const entry = entries[index];
    const expected = closure[index];
    if (
      entry.url !== expected.url ||
      entry.sha256 !== expected.sha256 ||
      entry.raw !== expected.bytes
    ) {
      throw new Error("Region pack member identity mismatch");
    }
    unpacked += entry.raw;
  }
  if (unpacked > REGION_PACK_LIMITS.unpackedBytes) {
    throw new Error("Region pack byte limit exceeded");
  }
  return entries;
}

function validatePacks(packs) {
  for (const [id, pack] of Object.entries(packs)) {
    if (!MAP_ID.test(id)) throw new Error("Invalid region pack map identity");
    validateRegionPack(pack);
  }
}

function validateContainers(containers) {
  for (const [url, pack] of Object.entries(containers)) {
    validateRegionPack(pack);
    if (url !== pack.url) throw new Error("Invalid asset container identity");
  }
}

function validateAssets(assets, containers, packs) {
  for (const [url, container] of Object.entries(assets)) {
    if (
      !url.startsWith("/generated/") ||
      !containers[container] ||
      packs[url] !== undefined
    ) {
      throw new Error("Invalid shared asset container reference");
    }
  }
}

function indexShape(index, containers, assets) {
  return (
    dictionary(index?.packs, REGION_PACK_LIMITS.maps) &&
    dictionary(containers, REGION_PACK_LIMITS.containers) &&
    dictionary(assets, REGION_PACK_LIMITS.assets)
  );
}

function indexVersion(index) {
  return index?.schemaVersion === 1 && RESOURCE_HASH.test(index.catalog ?? "");
}

/** The index binds to one catalog build, so stale packs are never mixed with fresh descriptors. */
export function validateRegionPackIndex(index, catalogBuildId) {
  const containers = index?.containers ?? {};
  const assets = index?.assets ?? {};
  if (!indexShape(index, containers, assets) || !indexVersion(index)) {
    throw new Error("Invalid region pack index");
  }
  if (index.catalog !== catalogBuildId) {
    throw new Error("Region pack index does not match the catalog");
  }
  validatePacks(index.packs);
  validateContainers(containers);
  validateAssets(assets, containers, index.packs);
  return index;
}

/** The shared container that carries one non-JSON asset, or null when it stays per file. */
export function assetContainer(index, url) {
  const container = index.assets?.[url];
  return container ? (index.containers?.[container] ?? null) : null;
}

function dictionary(value, maximum) {
  return (
    value !== undefined &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length <= maximum
  );
}
