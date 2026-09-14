CREATE TABLE IF NOT EXISTS content_asset_build (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),
 catalog_hash text NOT NULL CHECK(catalog_hash ~ '^[a-f0-9]{64}$'),
 catalog text NOT NULL CHECK(octet_length(catalog) <= 67108864),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS custom_content_runtime_id MINVALUE 800000000 MAXVALUE 899999998 START 800000000 NO CYCLE;
CREATE TABLE IF NOT EXISTS custom_content (
 owner_id text NOT NULL, project_id text NOT NULL, id text NOT NULL,
 revision integer NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 kind text NOT NULL CHECK(kind IN ('map','mob','quest')),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 runtime_id integer NOT NULL CHECK(runtime_id BETWEEN 800000000 AND 899999998),
 schema_version integer NOT NULL CHECK(schema_version=1),
 base_asset_build_id text NOT NULL REFERENCES content_asset_build(id),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
 operation_id uuid NOT NULL, request_hash text NOT NULL,
 published_at timestamptz, publication_hash text, runtime jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,project_id,id,revision),
 UNIQUE(owner_id,operation_id), UNIQUE(runtime_id,revision),
 CHECK((published_at IS NULL AND publication_hash IS NULL AND runtime IS NULL)
    OR (published_at IS NOT NULL AND publication_hash ~ '^[a-f0-9]{64}$' AND runtime IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS custom_content_project ON custom_content(owner_id,project_id,id,revision DESC);
CREATE TABLE IF NOT EXISTS custom_asset_blob (
 owner_id text NOT NULL, id text NOT NULL CHECK(id ~ '^[a-f0-9]{64}$'),
 media_type text NOT NULL CHECK(media_type='image/png'),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 2048),
 height integer NOT NULL CHECK(height BETWEEN 1 AND 2048),
 payload bytea NOT NULL CHECK(octet_length(payload) BETWEEN 1 AND 4194304),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,id)
);
CREATE OR REPLACE FUNCTION protect_content_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.published_at IS NOT NULL THEN RAISE EXCEPTION 'content revisions are immutable'; END IF;
 IF (to_jsonb(OLD)-ARRAY['published_at','publication_hash','runtime']) IS DISTINCT FROM
    (to_jsonb(NEW)-ARRAY['published_at','publication_hash','runtime']) OR NEW.published_at IS NULL
 THEN RAISE EXCEPTION 'only publishing a draft is permitted'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION protect_content_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'content assets are immutable'; END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='custom_content_immutable') THEN
  CREATE TRIGGER custom_content_immutable BEFORE UPDATE OR DELETE ON custom_content FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='content_asset_build_immutable') THEN
  CREATE TRIGGER content_asset_build_immutable BEFORE UPDATE OR DELETE ON content_asset_build FOR EACH ROW EXECUTE FUNCTION protect_content_asset();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='custom_asset_blob_immutable') THEN
  CREATE TRIGGER custom_asset_blob_immutable BEFORE UPDATE OR DELETE ON custom_asset_blob FOR EACH ROW EXECUTE FUNCTION protect_content_asset();
 END IF;
END $$;
