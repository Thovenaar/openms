import { canonical, digest } from "./digest.js";
import { contentError, hash, requireContent } from "./validation.js";

/** Immutable release snapshots and resources; the one mutable pointer selects the live release. */
export class WorldContentStore {
  constructor(sql) {
    this.sql = sql;
  }

  async current() {
    const rows = await this
      .sql`SELECT r.* FROM content_world_head h JOIN content_world_release r USING(generation) WHERE h.singleton=true`;
    return rows[0] ? releaseRow(rows[0]) : null;
  }

  async resource(id) {
    hash(id);
    const rows = await this
      .sql`SELECT media_type,payload FROM content_world_resource WHERE id=${id}`;
    if (!rows[0]) {
      throw contentError("ASSET_NOT_FOUND", "World resource is unavailable");
    }
    const bytes = new Uint8Array(rows[0].payload);
    requireContent(digest(bytes) === id, "World resource integrity mismatch");
    return { bytes, mediaType: rows[0].media_type };
  }

  async save(owner, input, prepared, admit) {
    const requestHash = digest(canonical({ owner, ...input }));
    const encoded = canonical(prepared.overlay, {
      maxBytes: 8388608,
      maxNodes: 1000000,
    });
    return this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(742031094)`;
      const [replay] =
        await tx`SELECT * FROM content_world_release WHERE operation_id=${input.operationId}`;
      const [head] =
        await tx`SELECT generation FROM content_world_head WHERE singleton=true`;
      if (replay) {
        requireContent(
          replay.request_hash === requestHash,
          "Release operation was reused for a different request",
        );
        if (Number(head?.generation) !== Number(replay.generation)) {
          throw contentError(
            "CONTENT_CONFLICT",
            "A newer release is already active",
          );
        }
        await admit(tx);
        return releaseRow(replay);
      }
      if (Number(head?.generation ?? 0) !== input.expectedGeneration) {
        throw contentError(
          "CONTENT_CONFLICT",
          "Active release changed; reload before activating",
        );
      }
      await admit(tx);
      for (const [id, resource] of prepared.resources) {
        await tx`INSERT INTO content_world_resource(id,media_type,payload) VALUES(${id},${resource.mediaType},${resource.bytes}) ON CONFLICT(id) DO NOTHING`;
      }
      const ids = [...prepared.resources.keys()];
      const [row] =
        await tx`INSERT INTO content_world_release(owner_id,project_id,operation_id,request_hash,selection,catalog,catalog_hash,resources) VALUES(${owner},${input.projectId},${input.operationId},${requestHash},${JSON.stringify(prepared.selection)}::text::jsonb,${encoded},${digest(encoded)},ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::text::jsonb))) RETURNING *`;
      await tx`INSERT INTO content_world_head(singleton,generation) VALUES(true,${row.generation}) ON CONFLICT(singleton) DO UPDATE SET generation=EXCLUDED.generation`;
      return releaseRow(row);
    });
  }
}

function releaseRow(row) {
  requireContent(
    digest(row.catalog) === row.catalog_hash,
    "World catalog integrity mismatch",
  );
  return {
    generation: Number(row.generation),
    ownerId: row.owner_id,
    projectId: row.project_id,
    selection: row.selection,
    encoded: row.catalog,
    overlay: JSON.parse(row.catalog),
    descriptor: {
      url: `/api/v1/world-content/catalog/${row.catalog_hash}`,
      sha256: row.catalog_hash,
      bytes: Buffer.byteLength(row.catalog),
    },
    resources: row.resources,
  };
}
