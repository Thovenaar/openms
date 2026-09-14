-- Per-instance provenance ledger. Append-only, keyed by the item UID that every
-- profile entry and item_instance row already carries. There is deliberately no
-- foreign key to item_instance: consumed and destroyed instances keep their
-- history after the current-state row is removed (see docs/server/protocol.md).
CREATE TABLE IF NOT EXISTS item_history (
 seq bigserial PRIMARY KEY,
 item_id text NOT NULL CHECK(length(item_id) BETWEEN 1 AND 64),
 template_id integer NOT NULL CHECK(template_id > 0),
 quantity integer NOT NULL CHECK(quantity >= 0),
 event text NOT NULL CHECK(event IN (
  'created','acquired','transferred','released','enhanced','consumed','destroyed','expired')),
 from_owner_id text,
 from_owner_name text,
 to_owner_id text,
 to_owner_name text,
 account_id text,
 actor_id text,
 transaction_id text NOT NULL,
 reason text NOT NULL,
 source text NOT NULL,
 source_id text,
 map_id integer,
 detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS item_history_item ON item_history(item_id,seq);
CREATE INDEX IF NOT EXISTS item_history_transaction ON item_history(transaction_id,item_id);
CREATE INDEX IF NOT EXISTS item_history_from_owner ON item_history(from_owner_id,seq);
CREATE INDEX IF NOT EXISTS item_history_to_owner ON item_history(to_owner_id,seq);
CREATE INDEX IF NOT EXISTS item_history_template ON item_history(template_id,created_at);
CREATE INDEX IF NOT EXISTS item_history_actor ON item_history(actor_id,seq);

-- 001 defines reject_authority_history_mutation(), but its trigger loop only covered
-- the relations that existed at that time. Guarded because legacy adoption replays
-- every numbered script directly before recording migration history.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='item_history_immutable') THEN
  CREATE TRIGGER item_history_immutable BEFORE UPDATE OR DELETE ON item_history
   FOR EACH ROW EXECUTE FUNCTION reject_authority_history_mutation();
 END IF;
END $$;

-- "Where did this instance first appear?" without scanning the whole trail.
CREATE OR REPLACE VIEW item_origin AS
 SELECT DISTINCT ON (item_id)
  item_id,template_id,quantity,source,source_id,map_id,detail,created_at,
  to_owner_id,to_owner_name
 FROM item_history
 WHERE event='created'
 ORDER BY item_id,seq;
