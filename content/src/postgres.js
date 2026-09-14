import {
  CONTENT_LIMITS,
  contentError,
  hash,
  identity,
  integer,
  jsonDocument,
  requireContent,
} from "./validation.js";
import { canonical, digest } from "./digest.js";
import { validateContentRef, validateSave } from "./definitions.js";

const RUNTIME_LIMITS = { maxBytes: 32 * 1024 * 1024, maxNodes: 2000000 };

function missing() {
  throw contentError("CONTENT_NOT_FOUND", "Content revision was not found");
}
function conflict(message) {
  throw contentError("CONTENT_CONFLICT", message);
}

export function contentRow(row) {
  if (!row) return missing();
  return {
    projectId: row.project_id,
    id: row.id,
    revision: row.revision,
    kind: row.kind,
    name: row.name,
    runtimeId: row.runtime_id,
    schemaVersion: row.schema_version,
    baseAssetBuildId: row.base_asset_build_id,
    definition: row.definition,
    status: row.published_at === null ? "draft" : "published",
    publicationHash: row.publication_hash,
    runtime: row.runtime,
  };
}

/** Owner-scoped, append-only revisions. This store never owns or closes the supplied SQL pool. */
export class PostgresContentStore {
  constructor(sql) {
    this.sql = sql;
  }

  async registerBuild(catalog) {
    hash(catalog.buildId);
    const encoded = jsonDocument(catalog, {
      maxBytes: CONTENT_LIMITS.catalogBytes,
      maxNodes: CONTENT_LIMITS.catalogNodes,
    });
    const catalogHash = digest(encoded);
    const existing = await this
      .sql`SELECT catalog_hash FROM content_asset_build WHERE id=${catalog.buildId}`;
    if (existing[0]) {
      if (existing[0].catalog_hash !== catalogHash) {
        conflict("Asset build ID already identifies different catalog bytes");
      }
      return { id: catalog.buildId, catalogHash };
    }
    await this
      .sql`INSERT INTO content_asset_build(id,catalog_hash,catalog) VALUES(${catalog.buildId},${catalogHash},${encoded}) ON CONFLICT(id) DO NOTHING`;
    const rows = await this
      .sql`SELECT catalog_hash FROM content_asset_build WHERE id=${catalog.buildId}`;
    if (rows[0]?.catalog_hash !== catalogHash) {
      conflict("Asset build ID already identifies different catalog bytes");
    }
    return { id: catalog.buildId, catalogHash };
  }

  async build(id) {
    hash(id);
    const rows = await this
      .sql`SELECT catalog,catalog_hash FROM content_asset_build WHERE id=${id}`;
    if (!rows[0]) {
      throw contentError(
        "ASSET_BUILD_NOT_FOUND",
        "Pinned asset build is unavailable",
      );
    }
    requireContent(
      digest(rows[0].catalog) === rows[0].catalog_hash,
      "Stored catalog integrity mismatch",
    );
    return JSON.parse(rows[0].catalog);
  }

  async get(owner, ref) {
    identity(owner);
    validateContentRef(ref);
    const rows = await this
      .sql`SELECT * FROM custom_content WHERE owner_id=${owner} AND project_id=${ref.projectId} AND id=${ref.id} AND revision=${ref.revision}`;
    return contentRow(rows[0]);
  }

  async list(owner, { projectId, offset = 0, limit = 50 }) {
    identity(owner);
    identity(projectId);
    integer(offset, 0, CONTENT_LIMITS.contentPerOwner);
    integer(limit, 1, 100);
    const rows = await this
      .sql`SELECT project_id,id,revision,kind,name,runtime_id,schema_version,base_asset_build_id,published_at,publication_hash FROM (SELECT DISTINCT ON(id) project_id,id,revision,kind,name,runtime_id,schema_version,base_asset_build_id,published_at,publication_hash FROM custom_content WHERE owner_id=${owner} AND project_id=${projectId} ORDER BY id,revision DESC) latest ORDER BY id OFFSET ${offset} LIMIT ${limit}`;
    return rows.map(contentSummary);
  }

  async save(
    owner,
    input,
    { reservedId = () => false, admit = () => {} } = {},
  ) {
    identity(owner);
    const value = validateSave(input);
    const requestHash = digest(canonical(value));
    return this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${owner},742031093))`;
      const replay =
        await tx`SELECT * FROM custom_content WHERE owner_id=${owner} AND operation_id=${value.operationId}`;
      if (replay[0]) {
        if (replay[0].request_hash !== requestHash) {
          conflict("Operation ID was already used for a different edit");
        }
        admit();
        return contentRow(replay[0]);
      }
      const previous =
        await tx`SELECT * FROM custom_content WHERE owner_id=${owner} AND project_id=${value.projectId} AND id=${value.id} ORDER BY revision DESC LIMIT 1`;
      checkPrevious(previous[0], value);
      const runtimeId =
        previous[0]?.runtime_id ??
        (await allocateIdentity(tx, owner, reservedId));
      admit();
      const rows = await insertRevision(tx, owner, {
        ...value,
        requestHash,
        runtimeId,
      });
      return contentRow(rows[0]);
    });
  }

  async publish(owner, ref, runtime, admit = () => {}) {
    identity(owner);
    validateContentRef(ref);
    const publicationHash = digest(canonical(runtime, RUNTIME_LIMITS));
    return this.sql.begin(async (tx) => {
      const rows =
        await tx`SELECT * FROM custom_content WHERE owner_id=${owner} AND project_id=${ref.projectId} AND id=${ref.id} AND revision=${ref.revision} FOR UPDATE`;
      if (!rows[0]) missing();
      if (rows[0].published_at !== null) {
        if (rows[0].publication_hash !== publicationHash) {
          conflict("Published runtime differs from this revision");
        }
        admit();
        return contentRow(rows[0]);
      }
      admit();
      const published =
        await tx`UPDATE custom_content SET published_at=clock_timestamp(),publication_hash=${publicationHash},runtime=${runtime} WHERE owner_id=${owner} AND project_id=${ref.projectId} AND id=${ref.id} AND revision=${ref.revision} RETURNING *`;
      return contentRow(published[0]);
    });
  }

  async putImage(owner, image, admit = () => {}) {
    identity(owner);
    const { bytes, width, height } = image;
    requireContent(
      bytes instanceof Uint8Array &&
        bytes.byteLength > 0 &&
        bytes.byteLength <= CONTENT_LIMITS.uploadBytes,
      "Image byte limit exceeded",
    );
    integer(width, 1, CONTENT_LIMITS.imageSide);
    integer(height, 1, CONTENT_LIMITS.imageSide);
    const id = digest(bytes);
    return this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${owner},742031093))`;
      const existing =
        await tx`SELECT width,height FROM custom_asset_blob WHERE owner_id=${owner} AND id=${id}`;
      if (existing[0]) {
        admit();
        return { id, ...existing[0], mediaType: "image/png" };
      }
      const [count] =
        await tx`SELECT count(*)::integer AS n FROM custom_asset_blob WHERE owner_id=${owner}`;
      if (count.n >= CONTENT_LIMITS.uploadsPerOwner) {
        throw contentError("CONTENT_LIMIT", "Image count limit reached");
      }
      admit();
      await tx`INSERT INTO custom_asset_blob(owner_id,id,media_type,width,height,payload) VALUES(${owner},${id},'image/png',${width},${height},${bytes})`;
      return { id, width, height, mediaType: "image/png" };
    });
  }

  async image(owner, id) {
    identity(owner);
    hash(id);
    const rows = await this
      .sql`SELECT width,height,payload FROM custom_asset_blob WHERE owner_id=${owner} AND id=${id}`;
    if (!rows[0]) {
      throw contentError("ASSET_NOT_FOUND", "Uploaded image was not found");
    }
    const { width, height, payload } = rows[0];
    requireContent(digest(payload) === id, "Stored image integrity mismatch");
    return {
      id,
      width,
      height,
      bytes: new Uint8Array(payload),
      mediaType: "image/png",
    };
  }
}

function contentSummary(row) {
  const summary = contentRow(row);
  delete summary.definition;
  delete summary.runtime;
  return summary;
}

function checkPrevious(previous, value) {
  if ((previous?.revision ?? 0) !== value.expectedRevision) {
    conflict("Draft changed; reload before saving");
  }
  if (previous && previous.kind !== value.kind) {
    conflict("A content identity cannot change kind");
  }
}

async function allocateIdentity(tx, owner, reservedId) {
  const [count] =
    await tx`SELECT count(*)::integer AS n FROM custom_content WHERE owner_id=${owner} AND revision=1`;
  if (count.n >= CONTENT_LIMITS.contentPerOwner) {
    throw contentError("CONTENT_LIMIT", "Content count limit reached");
  }
  for (let attempt = 0; attempt < 128; attempt++) {
    const [row] =
      await tx`SELECT nextval('custom_content_runtime_id')::integer AS id`;
    if (!reservedId(row.id)) return row.id;
  }
  throw contentError(
    "CONTENT_LIMIT",
    "Unable to allocate a collision-free runtime identity",
  );
}

async function insertRevision(tx, owner, value) {
  return tx`INSERT INTO custom_content(owner_id,project_id,id,revision,kind,name,runtime_id,schema_version,base_asset_build_id,definition,operation_id,request_hash) VALUES(${owner},${value.projectId},${value.id},${value.expectedRevision + 1},${value.kind},${value.name},${value.runtimeId},1,${value.baseAssetBuildId},${value.definition},${value.operationId},${value.requestHash}) RETURNING *`;
}
