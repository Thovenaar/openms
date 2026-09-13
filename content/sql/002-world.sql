CREATE TABLE IF NOT EXISTS content_world_release (
 generation bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id text NOT NULL, project_id text NOT NULL,
 operation_id uuid NOT NULL UNIQUE,
 request_hash text NOT NULL,
 selection jsonb NOT NULL,
 catalog text NOT NULL CHECK(octet_length(catalog) BETWEEN 1 AND 8388608),
 catalog_hash text NOT NULL CHECK(catalog_hash ~ '^[a-f0-9]{64}$'),
 resources text[] NOT NULL CHECK(cardinality(resources) <= 512),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS content_world_resource (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),
 media_type text NOT NULL CHECK(media_type IN ('application/json','image/png')),
 payload bytea NOT NULL CHECK(octet_length(payload) BETWEEN 1 AND 33554432)
);
CREATE TABLE IF NOT EXISTS content_world_head (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 generation bigint NOT NULL REFERENCES content_world_release(generation)
);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='content_world_release_immutable') THEN
  CREATE TRIGGER content_world_release_immutable BEFORE UPDATE OR DELETE ON content_world_release FOR EACH ROW EXECUTE FUNCTION protect_content_asset();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='content_world_resource_immutable') THEN
  CREATE TRIGGER content_world_resource_immutable BEFORE UPDATE OR DELETE ON content_world_resource FOR EACH ROW EXECUTE FUNCTION protect_content_asset();
 END IF;
END $$;
