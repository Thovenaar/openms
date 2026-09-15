import { validateDescriptor, RESOURCE_HASH } from "./resource-validation.js";

/** Gzip of concatenated members, in index order. No executable/archive paths. */
export const STARTUP_PACK_LIMITS = Object.freeze({
  files: 770,
  bytes: 128 * 1024 * 1024,
  individualFiles: 4,
});

/** The index travels with the compiled client; the fresh server selects its catalog. */
function validateHeader(pack) {
  if (
    pack?.version !== 1 ||
    !RESOURCE_HASH.test(pack.sha256) ||
    pack.url !== `/generated/startup/${pack.sha256}.bin` ||
    !Number.isSafeInteger(pack.bytes) ||
    pack.bytes < 1 ||
    pack.bytes > STARTUP_PACK_LIMITS.bytes ||
    !Array.isArray(pack.members) ||
    pack.members.length < 1 ||
    pack.members.length > STARTUP_PACK_LIMITS.files
  ) {
    throw new Error("Invalid startup pack");
  }
}

export function validateStartupPack(pack, catalogHash) {
  validateHeader(pack);
  const seen = new Set();
  let bytes = 0;
  for (const info of pack.members) {
    validateDescriptor(info);
    if (!info.url.startsWith("/generated/") || seen.has(info.url)) {
      throw new Error("Invalid startup pack member");
    }
    seen.add(info.url);
    bytes += info.bytes;
  }
  if (bytes !== pack.unpackedBytes || bytes > STARTUP_PACK_LIMITS.bytes) {
    throw new Error("Startup pack exceeds its unpacked byte bound");
  }
  const catalog = pack.members.find(
    (info) => info.url === "/generated/catalog.json",
  );
  if (!catalog || catalog.sha256 !== catalogHash) {
    throw new Error("Startup pack catalog does not match the server");
  }
  return pack;
}
