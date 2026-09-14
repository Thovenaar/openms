CREATE TABLE IF NOT EXISTS account (
 id text PRIMARY KEY, name text NOT NULL UNIQUE, password_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('player','developer')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS character (
 id text PRIMARY KEY, account_id text NOT NULL REFERENCES account(id),
 profile jsonb NOT NULL, meso bigint NOT NULL CHECK (meso BETWEEN 0 AND 2147483647),
 revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
 inventory_revision bigint NOT NULL DEFAULT 0 CHECK (inventory_revision >= 0),
 social_revision bigint NOT NULL DEFAULT 0 CHECK (social_revision >= 0),
 fencing_generation bigint NOT NULL DEFAULT 0, lease_owner text, lease_until timestamptz,
 field_instance text, field_epoch text, map_id integer NOT NULL CHECK(map_id BETWEEN 0 AND 999999998),
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Deletion is soft so the append-only history tables keep valid references: a deleted
-- character is excluded from listing, name admission and every lease, which also frees
-- its name slot for reuse.
ALTER TABLE character ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE TABLE IF NOT EXISTS operation_receipt (
 character_id text NOT NULL REFERENCES character(id), operation_id uuid NOT NULL,
 digest text NOT NULL, receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(character_id,operation_id)
);
CREATE TABLE IF NOT EXISTS character_op_log (
 seq bigserial PRIMARY KEY, character_id text NOT NULL REFERENCES character(id),
 operation_id uuid NOT NULL, transaction_id text NOT NULL, kind text NOT NULL,
 effect jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(character_id,operation_id)
);
CREATE TABLE IF NOT EXISTS character_snapshot (
 seq bigserial PRIMARY KEY, character_id text NOT NULL REFERENCES character(id),
 fencing_generation bigint NOT NULL, profile jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS item_instance (
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 64),
 owner_id text NOT NULL REFERENCES character(id), template_id integer NOT NULL,
 quantity integer NOT NULL CHECK(quantity > 0 OR (quantity = 0 AND template_id / 10000 IN (207,233))),
 location text NOT NULL CHECK(location IN ('inventory','equipped')),
 tab integer NOT NULL CHECK(tab BETWEEN 1 AND 5), slot integer NOT NULL,
 revision bigint NOT NULL CHECK(revision >= 0), data jsonb NOT NULL,
 UNIQUE(owner_id,location,tab,slot) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE IF NOT EXISTS entitlement (
 id text PRIMARY KEY, kind text NOT NULL CHECK(kind='drop'),
 granted_transaction text NOT NULL, consumed_transaction text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ledger (
 seq bigserial PRIMARY KEY, transaction_id text NOT NULL,
 account_key text NOT NULL, asset text NOT NULL, delta bigint NOT NULL,
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS outbox (
 seq bigserial PRIMARY KEY, id text NOT NULL UNIQUE, transaction_id text NOT NULL,
 character_id text NOT NULL REFERENCES character(id), event jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS outbox_delivery (
 consumer text PRIMARY KEY, seq bigint NOT NULL CHECK(seq >= 0)
);
CREATE TABLE IF NOT EXISTS development_audit (
 seq bigserial PRIMARY KEY, account_id text NOT NULL REFERENCES account(id),
 character_id text NOT NULL REFERENCES character(id), operation_id uuid NOT NULL,
 action jsonb NOT NULL, status text NOT NULL, code text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION reject_authority_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'authority history is append-only'; END $$;
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['operation_receipt','character_op_log','character_snapshot','ledger','outbox','development_audit'] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname=relation||'_immutable') THEN
   EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_authority_history_mutation()',relation||'_immutable',relation);
  END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION check_ledger_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT asset FROM ledger WHERE transaction_id=NEW.transaction_id GROUP BY asset HAVING sum(delta)<>0) THEN
  RAISE EXCEPTION 'unbalanced economic ledger' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='ledger_balanced') THEN
  CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ledger_balance();
 END IF;
END $$;
