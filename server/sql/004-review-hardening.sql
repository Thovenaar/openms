-- Old migrations are replayed at startup and may recreate this cache's trigger.
-- Economic history remains immutable; sampled continuous-state checkpoints are disposable.
DROP TRIGGER IF EXISTS character_snapshot_immutable ON character_snapshot;
CREATE INDEX IF NOT EXISTS ledger_transaction_asset ON ledger(transaction_id,asset);
CREATE INDEX IF NOT EXISTS character_snapshot_recent ON character_snapshot(character_id,seq DESC);

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM authority_migration WHERE id='openms-review-hardening') THEN RETURN; END IF;
 IF EXISTS (SELECT 1 FROM character WHERE deleted_at IS NULL GROUP BY lower(profile->>'name') HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Active character names conflict; resolve duplicate case-insensitive names before migration'
   USING ERRCODE='23505';
 END IF;
 CREATE UNIQUE INDEX character_active_name ON character(lower(profile->>'name')) WHERE deleted_at IS NULL;
 ALTER TABLE market_listing ADD COLUMN retry_at bigint NOT NULL DEFAULT 0;
 ALTER TABLE market_listing ADD COLUMN retry_count integer NOT NULL DEFAULT 0 CHECK(retry_count BETWEEN 0 AND 10);
 CREATE INDEX market_due_attempt ON market_listing((GREATEST(expires_at,retry_at)),id);
 INSERT INTO authority_migration(id) VALUES('openms-review-hardening');
END $$;
