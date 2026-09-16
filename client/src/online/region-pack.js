import { boundedResponse, verifyBytes } from "../assets/resource-validation.js";
import {
  decodeRegionPackHeader,
  regionPackClosure,
  validateRegionPack,
  validateRegionPackHeader,
} from "../assets/region-pack.js";
import { storedDescriptor } from "../rendering/gzip-asset.js";

/**
 * Install one map's packed JSON closure into the existing per-file cache. Every
 * member proves its declared length and hash before the first cache mutation, and
 * each keeps its own compressed stream so the persistent cache stays as small as
 * ordinary per-file delivery. The container itself is never cached.
 */
export function installRegionPack(network, pack, targets, signal) {
  validateRegionPack(pack);
  return network.gate.run(
    async () => {
      await network.ready;
      signal.throwIfAborted();
      return installMapPack(network, pack, targets, signal);
    },
    signal,
    true,
  );
}

/**
 * Install one shared container of non-JSON assets. Members are already compressed
 * (PNG, MP3), so they travel as identity members and enter the cache unchanged.
 */
export function installAssetPack(network, pack, signal) {
  validateRegionPack(pack);
  return network.gate.run(
    async () => {
      await network.ready;
      signal.throwIfAborted();
      const { entries, slices } = await openContainer(network, pack, signal);
      await verifyMembers(entries, slices, signal);
      await cacheMembers(network, entries, slices, signal);
      return { members: entries.length };
    },
    signal,
    true,
  );
}

async function installMapPack(network, pack, targets, signal) {
  const { manifest: manifestInfo, minimap: minimapInfo } = targets;
  const { entries, slices } = await openContainer(network, pack, signal);
  const index = entries.findIndex((entry) => entry.url === manifestInfo.url);
  if (index < 0) throw new Error("Region pack omits its manifest");
  const manifestBytes = await expandMember(
    slices[index],
    entries[index],
    signal,
  );
  await verifyBytes(manifestBytes, manifestInfo);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const closure = regionPackClosure(manifestInfo, manifest, minimapInfo);
  validateRegionPackHeader(entries, closure);
  await verifyMembers(entries, slices, signal);
  await cacheMembers(network, entries, slices, signal);
  return { manifest, members: entries.length };
}

/** Fetch, hash-check and frame one container; no member is trusted before this returns. */
async function openContainer(network, pack, signal) {
  const container = new Uint8Array(
    await network.fetchBytes(pack.url, signal, pack.bytes, true),
  );
  await verifyBytes(container, pack);
  signal.throwIfAborted();
  const { entries, offset } = decodeRegionPackHeader(container);
  const slices = [];
  let cursor = offset;
  let unpacked = 0;
  for (const entry of entries) {
    if (cursor + entry.packed > container.byteLength) {
      throw new Error("Truncated region pack member");
    }
    slices.push(container.subarray(cursor, cursor + entry.packed));
    cursor += entry.packed;
    unpacked += entry.raw;
  }
  if (cursor !== container.byteLength) {
    throw new Error("Trailing region pack bytes");
  }
  if (unpacked !== pack.unpackedBytes) {
    throw new Error("Region pack extent mismatch");
  }
  return { entries, slices };
}

/** Each member's own URL restates its hash, so the verified container authenticates itself. */
async function verifyMembers(entries, slices, signal) {
  for (let position = 0; position < entries.length; position++) {
    signal.throwIfAborted();
    const entry = entries[position];
    await verifyBytes(await expandMember(slices[position], entry, signal), {
      url: entry.url,
      sha256: entry.sha256,
      bytes: entry.raw,
    });
  }
}

/** Identity members are stored exactly as delivered; compressed ones are inflated. */
async function expandMember(slice, entry, signal) {
  if (entry.packed === entry.raw) return slice;
  const stream = new Blob([slice])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const bytes = await boundedResponse(new Response(stream), entry.raw, signal);
  if (bytes.byteLength !== entry.raw) {
    throw new Error("Region pack member length mismatch");
  }
  return bytes;
}

/** Storage loss never reports packed members as saved; the plan decides how to stop. */
async function cacheMembers(network, entries, slices, signal) {
  for (let index = 0; index < entries.length; index++) {
    signal.throwIfAborted();
    const entry = entries[index];
    const url = new URL(entry.url, location.origin).href;
    network.writes = network.writes.then(() =>
      network.store(url, storedDescriptor(slices[index], entry.raw)),
    );
    await network.writes;
    if (network.cacheStatus !== "persistent") {
      throw new Error("Region pack storage lost");
    }
  }
}
