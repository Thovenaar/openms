import { canonical, digest, contentError } from "@openms/content";
import {
  identity,
  integer,
  list,
  record,
  requireContent,
} from "../../content/src/validation.js";
import { validateContentRef } from "@openms/content";

const JSON_LIMITS = { maxBytes: 32 * 1024 * 1024, maxNodes: 2000000 };
const MAX_RELEASE_BYTES = 64 * 1024 * 1024;

export function validateRelease(value) {
  record(value, ["projectId", "refs", "expectedGeneration", "operationId"]);
  identity(value.projectId);
  integer(value.expectedGeneration, 0, Number.MAX_SAFE_INTEGER);
  requireContent(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value.operationId,
    ),
    "Invalid release operation ID",
  );
  const ids = new Set();
  for (const ref of list(value.refs, 128)) {
    record(ref, ["id", "revision"]);
    validateContentRef({ projectId: value.projectId, ...ref });
    requireContent(!ids.has(ref.id), "Duplicate release selection");
    ids.add(ref.id);
  }
  return value;
}

/** The complete dependency closure must agree on one immutable revision per identity. */
async function releaseRows(service, owner, input, buildId) {
  const refs = [...input.refs],
    rows = new Map();
  for (let index = 0; index < refs.length; index++) {
    const ref = refs[index],
      prior = rows.get(ref.id);
    if (prior) {
      requireContent(
        prior.revision === ref.revision,
        "Release selects conflicting revisions",
        ref.id,
      );
      continue;
    }
    const row = await service.published(owner, {
      projectId: input.projectId,
      id: ref.id,
      revision: ref.revision,
    });
    requireContent(
      row.baseAssetBuildId === buildId,
      "Rebase this content to the server's current extracted build before activating",
      ref.id,
    );
    requireContent(
      digest(canonical(row.runtime, JSON_LIMITS)) === row.publicationHash,
      "Published content integrity mismatch",
      ref.id,
    );
    rows.set(row.id, row);
    for (const dependency of row.runtime.dependencies) {
      if (
        !refs.some(
          (entry) =>
            entry.id === dependency.id &&
            entry.revision === dependency.revision,
        )
      ) {
        refs.push(dependency);
      }
      requireContent(refs.length <= 128, "Release dependency limit exceeded");
    }
  }
  for (const row of rows.values()) {
    for (const dependency of row.runtime.dependencies) {
      requireContent(
        rows.get(dependency.id)?.publicationHash === dependency.publicationHash,
        "Dependency publication integrity mismatch",
      );
    }
  }
  return [...rows.values()].sort((a, b) => a.runtimeId - b.runtimeId);
}

export async function prepareRelease(service, owner, input, original) {
  validateRelease(input);
  const rows = await releaseRows(service, owner, input, original.assetBuildId);
  const context = { resources: new Map(), bytes: 0 };
  const overlay = await collectOverlay(rows, {
    service,
    owner,
    context,
    assetBuildId: original.assetBuildId,
  });
  return {
    overlay,
    resources: context.resources,
    selection: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      revision: row.revision,
      runtimeId: row.runtimeId,
      publicationHash: row.publicationHash,
    })),
  };
}

async function collectOverlay(rows, { service, owner, context, assetBuildId }) {
  const overlay = {
    schemaVersion: 1,
    baseAssetBuildId: assetBuildId,
    maps: {},
    baseMaps: {},
    mapNames: {},
    monsters: {},
    quests: {},
    mobNames: {},
    drops: {},
    dialogues: {},
  };
  for (const row of rows) {
    await addReleaseRow(row, overlay, { service, owner, context });
  }
  for (const row of rows.filter((entry) => entry.kind === "mob")) {
    const map = rows.find(
      (entry) =>
        entry.kind === "map" &&
        entry.runtime.manifest.life.templates[row.runtime.template.key],
    );
    if (map) {
      overlay.monsters[row.runtimeId] = {
        id: row.runtimeId,
        name: row.name,
        template: row.runtime.template.key,
        mapId: String(map.runtimeId),
      };
    }
  }
  return overlay;
}

function addReleaseRow(row, overlay, { service, owner, context }) {
  if (row.kind === "map") {
    return releaseMap(row, service, owner, { context, overlay });
  }
  if (row.kind === "quest") overlay.quests[row.runtimeId] = row.runtime.record;
  if (row.kind === "mob") overlay.mobNames[row.runtimeId] = row.name;
  if (row.kind === "drops") addDropTable(row, overlay);
  if (row.kind === "dialogue") addDialogue(row, overlay);
}

function addDropTable(row, overlay) {
  const id = row.runtime.target.mobId;
  requireContent(
    !Object.hasOwn(overlay.drops, id),
    "Release selects conflicting drop tables for one monster",
    row.id,
  );
  overlay.drops[id] = { mode: row.runtime.mode, rows: row.runtime.rows };
}

function addDialogue(row, overlay) {
  const id = row.runtime.npcId;
  requireContent(
    !Object.hasOwn(overlay.dialogues, id),
    "Release selects conflicting conversations for one NPC",
    row.id,
  );
  overlay.dialogues[id] = {
    start: row.runtime.start,
    nodes: row.runtime.nodes,
  };
}

async function releaseMap(row, service, owner, { context, overlay }) {
  const manifest = structuredClone(row.runtime.manifest);
  for (const atlas of Object.values(manifest.atlases)) {
    if (!atlas.url.startsWith("/api/v1/custom-content/images/")) continue;
    const image = await service.store.image(owner, atlas.sha256);
    const descriptor = addResource(context, image.bytes, "image/png");
    requireContent(
      descriptor.sha256 === atlas.sha256 && descriptor.bytes === atlas.bytes,
      "Uploaded atlas identity mismatch",
    );
    atlas.url = descriptor.url;
  }
  for (const region of manifest.regions) {
    if (!region.url.startsWith("/api/v1/custom-content/regions/")) continue;
    const value = row.runtime.resources[region.sha256];
    requireContent(
      value && digest(canonical(value)) === region.sha256,
      "Published region integrity mismatch",
    );
    Object.assign(region, addJSON(context, value));
  }
  const descriptor = addJSON(context, manifest);
  const base = await service.registry(row.baseAssetBuildId);
  overlay.maps[manifest.id] = {
    ...descriptor,
    neighbors: base.catalog.maps[row.definition.base.id].neighbors,
  };
  overlay.mapNames[row.runtimeId] = row.name;
  overlay.baseMaps[row.runtimeId] = row.definition.base.id;
}

function addJSON(context, value) {
  return addResource(
    context,
    new TextEncoder().encode(canonical(value, JSON_LIMITS)),
    "application/json",
  );
}

function addResource(context, bytes, mediaType) {
  const sha256 = digest(bytes);
  if (!context.resources.has(sha256)) {
    context.bytes += bytes.byteLength;
    if (context.bytes > MAX_RELEASE_BYTES || context.resources.size >= 512) {
      throw contentError(
        "CONTENT_LIMIT",
        "World release exceeds resource budget",
      );
    }
    context.resources.set(sha256, { bytes, mediaType });
  }
  return {
    url: `/api/v1/world-content/resources/${sha256}`,
    sha256,
    bytes: bytes.byteLength,
  };
}
