import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { hash, publishFile, resource } from "./atlas.js";
import { verifyBytes } from "../src/assets/resource-validation.js";
import {
  REGION_PACK_LIMITS,
  encodeRegionPackHeader,
  regionPackClosure,
  validateRegionPack,
} from "../src/assets/region-pack.js";
import { assetRegions } from "../src/online/asset-regions.js";
import { visualBundle } from "../src/rendering/stream-validation.js";

const STATE_SCHEMA = 1;
/** Pack identity changes only with the bytes it is built from; bump to invalidate every pack. */
const PACK_VERSION = 2;
const PROGRESS_INTERVAL = 64;
/** Shared containers are grouped by regional ownership and filled to this bound. */
const CONTAINER_BYTES = 6 * 1024 * 1024;
const CONTAINER_MIX_BYTES = CONTAINER_BYTES / 2;

function descriptorFields(info) {
  return { url: info.url, sha256: info.sha256, bytes: info.bytes };
}

/**
 * A map manifest and its minimap descriptor fully determine the closure, because
 * every member is content-addressed. An unchanged pair therefore reuses its blob
 * and its collected asset list without reading any packaged bytes. Bump
 * PACK_VERSION whenever the closure or asset-collection rule changes, so a
 * reused entry cannot keep a stale asset list.
 */
function packIdentity(info, minimap) {
  return hash(
    Buffer.from(
      JSON.stringify({
        version: PACK_VERSION,
        map: descriptorFields(info),
        minimap: minimap ? descriptorFields(minimap) : null,
      }),
    ),
  );
}

async function readState(statePath) {
  try {
    const file = Bun.file(statePath);
    if (!(await file.exists())) return null;
    const state = await file.json();
    if (
      state?.schemaVersion !== STATE_SCHEMA ||
      !state.packs ||
      typeof state.packs !== "object" ||
      Array.isArray(state.packs)
    ) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

async function memberBytes(generatedRoot, info) {
  const file = Bun.file(
    resolve(generatedRoot, info.url.slice("/generated/".length)),
  );
  if (file.size !== info.bytes) {
    throw new Error(`Region pack member size mismatch: ${info.url}`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  await verifyBytes(bytes, info);
  return bytes;
}

function mobTemplates(manifest) {
  return Object.values(manifest.life?.templates ?? {}).filter(
    (template) => template.kind === "mob",
  );
}

function familySounds(catalog, template) {
  const family =
    catalog.audiovisual?.combat?.sounds?.Mob?.[Number(template.originalId)];
  return Object.values(family ?? {});
}

/** Resident mob families are the only shared sounds a map can reach. */
function soundAssets(catalog, manifest) {
  const sounds = [];
  for (const template of mobTemplates(manifest)) {
    for (const sound of familySounds(catalog, template)) {
      if (sound.available && sound.descriptor) sounds.push(sound.descriptor);
    }
  }
  return sounds;
}

/** A map's minimap bundle carries its own artwork, exactly as the runtime closure does. */
async function bundleAtlases(generatedRoot, catalog, id) {
  const descriptor = catalog.ui?.minimaps?.[id]?.descriptor;
  if (!descriptor) return [];
  const bytes = await memberBytes(generatedRoot, descriptor);
  const bundle = visualBundle(JSON.parse(new TextDecoder().decode(bytes)));
  return Object.values(bundle.atlases);
}

/** Non-JSON closure members stay per file unless a shared container carries them. */
async function mapAssets(generatedRoot, catalog, id, manifest) {
  const assets = Object.values(manifest.atlases);
  const bgm = catalog.audiovisual?.maps?.[id]?.bgm;
  if (bgm) assets.push(bgm);
  assets.push(...(await bundleAtlases(generatedRoot, catalog, id)));
  assets.push(...soundAssets(catalog, manifest));
  return assets.map(descriptorFields);
}

async function buildOne(context) {
  const { generatedRoot, id, info, minimap, catalog } = context;
  const manifestBytes = await memberBytes(generatedRoot, info);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  let closure;
  try {
    closure = regionPackClosure(info, manifest, minimap);
  } catch {
    // A closure outside the pack bounds keeps its ordinary per-file delivery.
    return null;
  }
  const entries = [];
  const packed = [];
  let unpacked = 0;
  for (const entry of closure) {
    const raw =
      entry.url === info.url
        ? manifestBytes
        : await memberBytes(generatedRoot, entry);
    const stream = Bun.gzipSync(raw, { level: 6 });
    entries.push({
      url: entry.url,
      sha256: entry.sha256,
      raw: raw.byteLength,
      packed: stream.byteLength,
    });
    packed.push(stream);
    unpacked += raw.byteLength;
  }
  const blob = Buffer.concat([encodeRegionPackHeader(entries), ...packed]);
  if (blob.byteLength > REGION_PACK_LIMITS.blobBytes) return null;
  const pack = validateRegionPack({
    ...(await resource(generatedRoot, "packs", "bin", blob)),
    unpackedBytes: unpacked,
  });
  return {
    pack,
    members: closure.length,
    assets: await mapAssets(generatedRoot, catalog, id, manifest),
  };
}

/** Only a complete, already-published blob is reusable; anything else rebuilds. */
async function reusablePack(generatedRoot, pack) {
  try {
    validateRegionPack(pack);
    const file = Bun.file(
      resolve(generatedRoot, pack.url.slice("/generated/".length)),
    );
    if (!(await file.exists()) || file.size !== pack.bytes) return null;
    await verifyBytes(new Uint8Array(await file.arrayBuffer()), pack);
    return pack;
  } catch {
    return null;
  }
}

/** Reuse a verified blob for an unchanged closure, otherwise build and remember it. */
async function packFor(context) {
  const { generatedRoot, id, info, minimap, reusable, evidence, catalog } =
    context;
  const identity = packIdentity(info, minimap);
  const candidate = reusable[id];
  if (candidate?.identity === identity && candidate.assets) {
    const pack = await reusablePack(generatedRoot, candidate.pack);
    if (pack) {
      reusable[id] = { ...candidate, pack };
      evidence.reused++;
      return { pack, members: candidate.members, assets: candidate.assets };
    }
  }
  const built = await buildOne({
    generatedRoot,
    id,
    info,
    minimap,
    catalog,
  });
  if (!built) return null;
  reusable[id] = {
    identity,
    pack: built.pack,
    members: built.members,
    assets: built.assets,
  };
  evidence.rebuilt++;
  return built;
}

function accept(evidence, built) {
  evidence.maps++;
  evidence.members += built.members;
  evidence.unpackedBytes += built.pack.unpackedBytes;
  evidence.blobBytes += built.pack.bytes;
}

/** Every packaged map gets one blob; a changed closure alone is recompressed. */
async function packAll(context) {
  const { generatedRoot, catalog, reusable, evidence, progress } = context;
  const packs = {};
  const perMap = new Map();
  const ids = Object.keys(catalog.maps).sort();
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index];
    const info = catalog.maps[id];
    if (!info?.url?.startsWith("/generated/")) continue;
    const minimap = catalog.ui?.minimaps?.[id]?.descriptor ?? null;
    const built = await packFor({
      generatedRoot,
      id,
      info,
      minimap,
      reusable,
      evidence,
      catalog,
    });
    if (built) {
      packs[id] = built.pack;
      perMap.set(id, built.assets);
      accept(evidence, built);
    } else {
      evidence.skipped++;
    }
    if (progress && (index + 1) % PROGRESS_INTERVAL === 0) {
      progress(`Region packs: ${index + 1}/${ids.length} maps examined`);
    }
  }
  return { packs, perMap };
}

/** Original WorldMap membership decides which assets a region can reach. */
async function regionMembership(generatedRoot, catalog) {
  const descriptor = catalog.ui?.bundles?.WorldMap;
  if (!descriptor) return null;
  const bytes = await memberBytes(generatedRoot, descriptor);
  const world = visualBundle(JSON.parse(new TextDecoder().decode(bytes)));
  if (!world.metadata?.worldMaps) return null;
  return assetRegions(catalog, world.metadata).membership;
}

/** One row per unique asset, carrying the exact set of regions that can reach it. */
function collectAssets(perMap, membership) {
  const assets = new Map();
  for (const [mapId, list] of perMap) {
    const region = membership?.get(mapId) ?? `map:${mapId}`;
    for (const info of list) {
      let row = assets.get(info.url);
      if (!row) {
        row = { info, regions: new Set() };
        assets.set(info.url, row);
      }
      row.regions.add(region);
    }
  }
  return assets;
}

function regionKey(row) {
  return [...row.regions].sort().join(",");
}

/** Stable identity of the whole shared-asset set, so unchanged builds reuse containers. */
function assetDigest(rows) {
  return hash(
    Buffer.from(
      JSON.stringify(
        rows.map((row) => [
          row.info.url,
          row.info.sha256,
          row.info.bytes,
          regionKey(row),
        ]),
      ),
    ),
  );
}

/**
 * Narrow ownership first, so a region's own artwork stays together and only
 * genuinely global assets share a container with everything else.
 */
function orderAssets(rows) {
  return [...rows].sort((a, b) => {
    if (a.regions.size !== b.regions.size) {
      return a.regions.size - b.regions.size;
    }
    return regionKey(a).localeCompare(regionKey(b), "en");
  });
}

function chunkAssets(rows) {
  const chunks = [];
  let current = null;
  for (const row of rows) {
    const key = regionKey(row);
    if (current) {
      const full =
        current.bytes + row.info.bytes > CONTAINER_BYTES ||
        current.items.length >= REGION_PACK_LIMITS.members;
      if (
        full ||
        (current.key !== key && current.bytes > CONTAINER_MIX_BYTES)
      ) {
        chunks.push(current);
        current = null;
      }
    }
    current ??= { key, bytes: 0, items: [] };
    current.items.push(row);
    current.bytes += row.info.bytes;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Non-JSON members are already compressed, so they travel as identity members. */
async function buildContainer(generatedRoot, chunk) {
  const entries = [];
  const packed = [];
  let unpacked = 0;
  for (const row of chunk.items) {
    const raw = await memberBytes(generatedRoot, row.info);
    entries.push({
      url: row.info.url,
      sha256: row.info.sha256,
      raw: raw.byteLength,
      packed: raw.byteLength,
    });
    packed.push(raw);
    unpacked += raw.byteLength;
  }
  const blob = Buffer.concat([encodeRegionPackHeader(entries), ...packed]);
  const descriptor = validateRegionPack({
    ...(await resource(generatedRoot, "packs", "bin", blob)),
    unpackedBytes: unpacked,
  });
  return { descriptor, items: chunk.items.map((row) => row.info.url) };
}

async function reusableContainers(generatedRoot, previous, digest) {
  if (previous?.digest !== digest) return null;
  const containers = previous.containers ?? {};
  const links = previous.links ?? {};
  for (const pack of Object.values(containers)) {
    validateRegionPack(pack);
    const file = Bun.file(
      resolve(generatedRoot, pack.url.slice("/generated/".length)),
    );
    if (!(await file.exists()) || file.size !== pack.bytes) return null;
  }
  return { containers, links };
}

async function sharedContainers(context) {
  const { generatedRoot, rows, previous, progress } = context;
  const digest = assetDigest(rows);
  const reused = await reusableContainers(generatedRoot, previous, digest);
  if (reused) return { ...reused, digest, reused: true };
  const containers = {};
  const links = {};
  for (const chunk of chunkAssets(orderAssets(rows))) {
    const built = await buildContainer(generatedRoot, chunk);
    containers[built.descriptor.url] = built.descriptor;
    for (const url of built.items) links[url] = built.descriptor.url;
    progress?.(`Shared asset containers: ${Object.keys(containers).length}`);
  }
  return { containers, links, digest, reused: false };
}

const PACK_FILE = /\.(?:bin|json)(?:\.gz)?$/;

/** Blobs are content-addressed and never overwritten, so a rebuild must retire the ones it replaced. */
async function pruneStale(generatedRoot, index, descriptor) {
  const directory = resolve(generatedRoot, "packs");
  const keep = new Set([
    descriptor.url.slice(descriptor.url.lastIndexOf("/") + 1),
    ...Object.values(index.packs).map((pack) =>
      pack.url.slice(pack.url.lastIndexOf("/") + 1),
    ),
    ...Object.values(index.containers).map((pack) =>
      pack.url.slice(pack.url.lastIndexOf("/") + 1),
    ),
  ]);
  const names = await readdir(directory);
  let removed = 0;
  for (const name of names) {
    if (!PACK_FILE.test(name)) continue;
    if (keep.has(name) || keep.has(name.replace(/\.gz$/, ""))) continue;
    await rm(resolve(directory, name));
    removed++;
  }
  return removed;
}

async function publishIndex(context) {
  const { generatedRoot, index } = context;
  const bytes = Buffer.from(JSON.stringify(index));
  if (bytes.byteLength > REGION_PACK_LIMITS.indexBytes) {
    throw new Error("Region pack index exceeds its byte bound");
  }
  return resource(generatedRoot, "packs", "json", bytes);
}

async function writeState(statePath, state) {
  await mkdir(dirname(statePath), { recursive: true });
  await publishFile(statePath, Buffer.from(JSON.stringify(state)));
}

/** Map packs first, then the shared asset containers they depend on. */
async function assemblePacks(context) {
  const { generatedRoot, statePath, catalog, progress } = context;
  const previous = await readState(statePath);
  const reusable = previous?.packs ?? {};
  const evidence = {
    maps: 0,
    reused: 0,
    rebuilt: 0,
    skipped: 0,
    members: 0,
    unpackedBytes: 0,
    blobBytes: 0,
  };
  const { packs, perMap } = await packAll({
    generatedRoot,
    catalog,
    reusable,
    evidence,
    progress,
  });
  const membership = await regionMembership(generatedRoot, catalog);
  const rows = [...collectAssets(perMap, membership).values()];
  const shared = await sharedContainers({
    generatedRoot,
    rows,
    previous: previous?.shared ?? null,
    progress,
  });
  return { reusable, evidence, packs, rows, shared };
}

/**
 * Publish one aggregated blob per packaged map, one shared blob per grouped asset
 * set, and a catalog-bound index. Existing extraction, the catalog and every
 * per-file resource stay untouched.
 */
export async function buildRegionPacks(options) {
  const { generatedRoot, statePath, catalog, progress } = options;
  const catalogBuildId = catalog.buildId;
  if (typeof catalogBuildId !== "string" || !catalogBuildId) {
    throw new Error("Region packs require a catalog build identity");
  }
  await mkdir(resolve(generatedRoot, "packs"), { recursive: true });
  const { reusable, evidence, packs, rows, shared } = await assemblePacks({
    generatedRoot,
    statePath,
    catalog,
    progress,
  });
  const index = {
    schemaVersion: 1,
    catalog: catalogBuildId,
    packs,
    containers: shared.containers,
    assets: shared.links,
  };
  const descriptor = await publishIndex({ generatedRoot, index });
  const pruned = await pruneStale(generatedRoot, index, descriptor);
  await writeState(statePath, {
    schemaVersion: STATE_SCHEMA,
    catalog: catalogBuildId,
    index: descriptor,
    packs: reusable,
    shared: {
      digest: shared.digest,
      containers: shared.containers,
      links: shared.links,
    },
  });
  return {
    index: descriptor,
    ...evidence,
    containers: Object.keys(shared.containers).length,
    containerBytes: Object.values(shared.containers).reduce(
      (sum, pack) => sum + pack.bytes,
      0,
    ),
    containerReused: shared.reused,
    pruned,
    assets: Object.keys(shared.links).length,
    assetBytes: rows.reduce((sum, row) => sum + row.info.bytes, 0),
  };
}
