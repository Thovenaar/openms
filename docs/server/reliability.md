# Review fixes and migration

The review fixes retain one authoritative Bun process, PostgreSQL ownership and the existing bounded browser streaming pipeline. No new service is required.

## Persistence and deployment

`server/sql/004-review-hardening.sql` runs through the existing startup migration transaction. It adds the ledger transaction/asset index, the character snapshot lookup index, the unique active character name index and market retry metadata/index. Test a database backup before production rollout; ordinary index creation can block writes, so schedule this migration during a maintenance window for an established database. No running development or production database was migrated as part of the code edit.

Active names must be unique under PostgreSQL `lower(profile->>'name')`. Migration stops with a value-free error if existing duplicates need resolution; it does not rename or delete characters. An operator can identify affected records using the following query in their authorized database session, then resolve them with the character owners before retrying startup:

```sql
SELECT id, account_id
FROM character
WHERE deleted_at IS NULL
  AND lower(profile->>'name') IN (
    SELECT lower(profile->>'name') FROM character
    WHERE deleted_at IS NULL
    GROUP BY lower(profile->>'name') HAVING count(*) > 1
  );
```

The current `character.profile` continues to receive changed continuous state at the one-second checkpoint cadence, behind the writer fence. Unchanged profiles skip their update. `character_snapshot` is a diagnostic cache: at most one changed-state sample per minute, retaining 60 samples per character. The snapshot immutable trigger is removed; economic ledgers, receipts, operation logs and audits remain immutable. Existing excess snapshots drain by at most 128 rows per character checkpoint; inactive characters' existing history is left intact until they checkpoint. This change does not prune receipts or economic history, nor implement the prospective log-replay recovery design in the protocol document. Current loading still hydrates the materialized character and canonical item rows.

A failed periodic checkpoint quarantines and disconnects only the affected actor. Gateway maintenance drains admitted work, attempts the final logout checkpoint and releases its lease even if persistence still fails. Other players keep their field. Reentry loads durable state through ordinary admission; a persistent database outage can still prevent reentry, and unsaved continuous state can be lost if the final checkpoint also fails. Committed economy remains authoritative. `checkpoint.failed` records the actor ID and stable error code, never a profile or credentials.

## Admission and delivery

Signed prelogin cookies and proof challenges remove anonymous memory reservations and the shared-proxy challenge quota. Only verified proofs occupy the bounded replay cache until expiry; expensive password work remains separately capped. Invalid proofs do not invalidate someone else's challenge. Cookie, origin, CSRF, proof owner and expiry checks remain mandatory. Tokens and replay state are process-local and restart revokes them. No forwarded address header is trusted. Public ingress still needs its ordinary connection/request limits; stateless issuance is not a claim of resistance to unlimited network traffic.

Snapshots split array views by actual UTF-8 frame size including metadata. Oversized entity deltas fall back to a snapshot before changing the baseline. Existing frame, aggregate and part ceilings remain. Browser asset downloads have a 30-second idle timeout and a five-minute total timeout; cancellation and failure release request capacity. These limits are explicit engineering policy.

Market expiry keeps eight-lot batches but durably postpones individual failures with exponential backoff capped at five minutes. A missing listing does not abort the remaining batch. Details are in [market authority](market.md).

## Focused validation

The relevant executable checks are `server/test/proof-of-work.test.js`, `login-origin.test.js`, `registration.test.js`, `character-creation.test.js`, `lifecycle.test.js`, `publication.test.js`, `database.test.js`, and `client/test/stream-network.test.js`, plus the existing affected market, field-retirement and transport contracts. PostgreSQL checks use `OPENMS_TEST_DATABASE_URL` only as an administrative connection: the harness creates and drops uniquely named disposable databases, never resets that supplied database. They exercise real uniqueness races, migration restart, snapshot retention and writer fences, query planning, ledger immutability/balance, and market backoff.

No asset extraction, browser smoke suite, production migration or production-scale load test is required to establish these domain fixes. None is implied by passing the targeted checks.
