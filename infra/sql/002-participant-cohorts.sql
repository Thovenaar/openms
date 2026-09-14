CREATE TABLE IF NOT EXISTS authority_migration (
 id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM authority_migration WHERE id='participant-cohorts') THEN
  RETURN;
 END IF;

 ALTER TABLE item_instance ALTER COLUMN owner_id DROP NOT NULL;
 ALTER TABLE item_instance ADD COLUMN account_owner_id text REFERENCES account(id);
 ALTER TABLE item_instance ADD COLUMN container_id text NOT NULL DEFAULT '';
 ALTER TABLE item_instance DROP CONSTRAINT item_instance_location_check;
 ALTER TABLE item_instance ADD CONSTRAINT item_instance_location_check
  CHECK(location IN ('inventory','equipped','locker','gift','storage'));
 ALTER TABLE item_instance ADD CONSTRAINT item_instance_owner_scope
  CHECK((location='storage' AND owner_id IS NULL AND account_owner_id IS NOT NULL)
   OR (location<>'storage' AND owner_id IS NOT NULL AND account_owner_id IS NULL));
 ALTER TABLE item_instance ADD CONSTRAINT item_instance_container_scope
  CHECK((location='gift' AND length(container_id) BETWEEN 1 AND 64)
   OR (location<>'gift' AND container_id=''));
 ALTER TABLE item_instance DROP CONSTRAINT item_instance_owner_id_location_tab_slot_key;
 ALTER TABLE item_instance ADD CONSTRAINT item_instance_character_position
  UNIQUE(owner_id,location,container_id,tab,slot) DEFERRABLE INITIALLY DEFERRED;
 ALTER TABLE item_instance ADD CONSTRAINT item_instance_account_position
  UNIQUE(account_owner_id,location,tab,slot) DEFERRABLE INITIALLY DEFERRED;
 CREATE INDEX item_instance_account_owner ON item_instance(account_owner_id);

 CREATE TABLE account_storage (
  account_id text PRIMARY KEY REFERENCES account(id), state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(state->>'id'=account_id), CHECK(state->>'schemaVersion'='1'),
  CHECK(jsonb_typeof(state->'items')='array' AND jsonb_array_length(state->'items')=0)
 );
 CREATE TABLE social_name (
  kind text NOT NULL CHECK(kind IN ('guild','alliance')),
  name text NOT NULL CHECK(name=lower(name) AND length(name) BETWEEN 1 AND 32),
  group_id text NOT NULL CHECK(length(group_id) BETWEEN 1 AND 64),
  PRIMARY KEY(kind,name), UNIQUE(kind,group_id)
 );
 CREATE INDEX character_social_name ON character(lower(profile->>'name')) WHERE deleted_at IS NULL;

 -- Existing cash JSON becomes canonical ownership exactly once. A conflicting UID
 -- aborts the migration instead of discarding either owner's economic state.
 INSERT INTO item_instance(id,owner_id,template_id,quantity,location,tab,slot,revision,data)
 SELECT item->>'uid',c.id,(item->>'id')::integer,(item->>'count')::integer,
  'locker',(item->>'id')::integer/1000000,(item->>'slot')::integer,c.inventory_revision,item
 FROM character c CROSS JOIN LATERAL jsonb_array_elements(c.profile->'cash'->'locker') item;
 INSERT INTO item_instance(id,owner_id,template_id,quantity,location,container_id,tab,slot,revision,data)
 SELECT item->>'uid',c.id,(item->>'id')::integer,(item->>'count')::integer,
  'gift',gift->>'uid',(item->>'id')::integer/1000000,ordinal::integer,c.inventory_revision,item
 FROM character c CROSS JOIN LATERAL jsonb_array_elements(c.profile->'cash'->'gifts') gift
 CROSS JOIN LATERAL jsonb_array_elements(gift->'items') WITH ORDINALITY contents(item,ordinal);

 INSERT INTO ledger(transaction_id,account_key,asset,delta,reason)
 SELECT 'cash-baseline:'||owner_id,owner_id,'item:'||template_id,sum(quantity),'cash-baseline'
 FROM item_instance WHERE location IN ('locker','gift') GROUP BY owner_id,template_id HAVING sum(quantity)<>0
 UNION ALL
 SELECT 'cash-baseline:'||owner_id,'system','item:'||template_id,-sum(quantity),'cash-baseline'
 FROM item_instance WHERE location IN ('locker','gift') GROUP BY owner_id,template_id HAVING sum(quantity)<>0;
 INSERT INTO ledger(transaction_id,account_key,asset,delta,reason)
 SELECT 'cash-baseline:'||c.id,c.id,balance.key,balance.value::bigint,'cash-baseline'
 FROM character c CROSS JOIN LATERAL jsonb_each_text(c.profile->'cash'->'balances') balance
 WHERE balance.value::bigint<>0
 UNION ALL
 SELECT 'cash-baseline:'||c.id,'system',balance.key,-balance.value::bigint,'cash-baseline'
 FROM character c CROSS JOIN LATERAL jsonb_each_text(c.profile->'cash'->'balances') balance
 WHERE balance.value::bigint<>0;

 UPDATE character c SET profile=jsonb_set(
  jsonb_set(c.profile,'{cash,locker}','[]'::jsonb),'{cash,gifts}',
  COALESCE((SELECT jsonb_agg(jsonb_set(gift,'{items}','[]'::jsonb) ORDER BY ordinal)
   FROM jsonb_array_elements(c.profile->'cash'->'gifts') WITH ORDINALITY gifts(gift,ordinal)), '[]'::jsonb)
 );
 INSERT INTO social_name(kind,name,group_id)
 SELECT DISTINCT groups.kind,lower(groups.value->>'name'),groups.value->>'id'
 FROM character c CROSS JOIN LATERAL
  (VALUES ('guild',c.profile->'social'->'guild'),('alliance',c.profile->'social'->'alliance')) groups(kind,value)
 WHERE c.deleted_at IS NULL AND jsonb_typeof(groups.value)='object';

 INSERT INTO authority_migration(id) VALUES('participant-cohorts');
 CREATE TRIGGER authority_migration_immutable BEFORE UPDATE OR DELETE ON authority_migration
  FOR EACH ROW EXECUTE FUNCTION reject_authority_history_mutation();
END $$;
