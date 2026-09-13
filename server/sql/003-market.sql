DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM authority_migration WHERE id='openms-market') THEN RETURN; END IF;
 ALTER TABLE item_instance DROP CONSTRAINT item_instance_location_check;
 ALTER TABLE item_instance ADD CONSTRAINT item_instance_location_check
  CHECK(location IN ('inventory','equipped','locker','gift','storage','market','market-transfer'));
 ALTER TABLE item_instance DROP CONSTRAINT item_instance_container_scope;
 ALTER TABLE item_instance ADD CONSTRAINT item_instance_container_scope
  CHECK((location IN ('gift','market') AND length(container_id) BETWEEN 1 AND 64)
   OR (location NOT IN ('gift','market') AND container_id=''));
 CREATE TABLE market_listing (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES character(id),
  kind text NOT NULL CHECK(kind IN ('sale','wanted','auction')),
  item_id integer NOT NULL, price integer NOT NULL CHECK(price>0),
  expires_at bigint NOT NULL, realm text NOT NULL,
  summary jsonb NOT NULL
 );
 CREATE INDEX market_browse ON market_listing(realm,kind,id);
 CREATE INDEX market_owner ON market_listing(owner_id,id);
 CREATE INDEX market_expiry ON market_listing(expires_at,id);
 INSERT INTO authority_migration(id) VALUES('openms-market');
END $$;
