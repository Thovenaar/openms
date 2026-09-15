import { boundedResponse, verifyBytes } from "../assets/resource-validation.js";
import {
  STARTUP_PACK_LIMITS,
  validateStartupPack,
} from "../assets/startup-pack.js";

/** Fill the existing per-file cache before catalog/UI work opens any game connection. */
export async function prepareStartupPack(network, pack, catalogHash, signal) {
  validateStartupPack(pack, catalogHash);
  await network.ready;
  signal.throwIfAborted();
  if (network.releaseControlled() || network.cacheStatus !== "persistent") {
    return { status: "cache-unavailable" };
  }
  if (network.cacheByteLimit < pack.unpackedBytes) {
    return { status: "insufficient-cache" };
  }
  let missing = 0;
  for (const info of pack.members) {
    const url = new URL(info.url, location.origin).href;
    if (network.cacheEntries.get(url) !== info.bytes) missing++;
  }
  // Indexed hits still undergo ordinary byte/hash verification when consumed.
  if (missing <= STARTUP_PACK_LIMITS.individualFiles) {
    return { status: missing ? "individual" : "retained", missing };
  }
  return network.gate.run(
    () => installStartupPack(network, pack, signal),
    signal,
  );
}

async function installStartupPack(network, pack, signal) {
  network.activity?.plan([pack]);
  const owner = network.activity?.begin("resource", pack.url, pack.bytes);
  try {
    const bytes = await unpackStartupPack(network, pack, signal);
    // Validate every member before the first cache mutation; never install a partial corrupt pack.
    let offset = 0;
    for (const info of pack.members) {
      signal.throwIfAborted();
      await verifyBytes(bytes.subarray(offset, offset + info.bytes), info);
      offset += info.bytes;
    }
    const status = await cacheMembers(network, pack, bytes, signal);
    return { status, files: pack.members.length, bytes: pack.bytes };
  } finally {
    network.activity?.end(owner);
  }
}

async function unpackStartupPack(network, pack, signal) {
  const encoded = await network.fetchBytes(pack.url, signal, pack.bytes);
  await verifyBytes(encoded, pack);
  signal.throwIfAborted();
  const stream = new Blob([encoded])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const bytes = await boundedResponse(
    new Response(stream),
    pack.unpackedBytes,
    signal,
  );
  if (bytes.byteLength !== pack.unpackedBytes) {
    throw new Error("Truncated startup pack");
  }
  return bytes;
}

async function cacheMembers(network, pack, bytes, signal) {
  let offset = 0;
  for (const info of pack.members) {
    signal.throwIfAborted();
    const member = bytes.subarray(offset, offset + info.bytes);
    const url = new URL(info.url, location.origin).href;
    network.writes = network.writes.then(() => network.store(url, member));
    await network.writes;
    offset += info.bytes;
    if (
      network.cacheStatus !== "persistent" ||
      network.cacheByteLimit < pack.unpackedBytes
    ) {
      return "storage-lost";
    }
  }
  return "downloaded";
}
