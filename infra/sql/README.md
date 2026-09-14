# SQL scripts

This directory contains two separately consumed SQL families:

| Location | Dialect and owner | How it is used |
| --- | --- | --- |
| Numbered `*.sql` files directly in this directory | OpenMS PostgreSQL schema | Applied explicitly by the `migrate` CLI |
| `tables/` and `data/` | Imported Cosmic MySQL reference definitions | Parsed into gameplay data during asset extraction; never executed by `migrate` |

## Initialize or update PostgreSQL

Start PostgreSQL, then run:

```sh
bun run migrate --database-url postgres://openms:openms_local_only@127.0.0.1:55432/openms
```

The equivalent command is `bun tools/openms.js migrate --database-url URL`. Use the URL for the same database as the server's `DATABASE_URL`. The CLI requires an explicit `--database-url`; it does not read `.env.server`, create a database, seed accounts, load WZ files or start application services. `--sql-root DIR` overrides the repository-relative default `infra/sql`.

There is no repository migration-history directory. The CLI creates the **`migrations` table in PostgreSQL** on its first run; it stores `version`, `filename`, `sha256` and `applied_at`. The CLI selects only the numbered SQL files directly in the selected directory, in consecutive numeric order starting at `001`. It validates existing history, skips applied files with matching hashes, and runs pending files in one transaction under an advisory lock. Failed SQL rolls back the pending changes and history together. Concurrent runners serialize. Applied files must not be edited or removed; add the next numbered SQL file for a later change.

The current files are:

1. `001-authority.sql`: accounts, characters, owned items, receipts, ledger and audit tables.
2. `002-participant-cohorts.sql`: account storage and participant ownership upgrades.
3. `003-market.sql`: market listings and escrow ownership.
4. `004-review-hardening.sql`: indexes, character names, market retries and checkpoint retention.
5. `005-content.sql`: asset-build records, custom definitions and uploaded assets.
6. `006-world.sql`: published world releases, resources and the active release pointer.

These scripts previously lived in `server/sql/` and `content/sql/`. For an existing database without the new `migrations` table, the CLI replays the idempotent scripts once and records them. Existing rows and the legacy `authority_migration` guards are retained. Back up an established database before schema updates, and stop the old server version during adoption because it still has a startup migration runner.

Both development and production startup now check the database schema without executing SQL files or creating migration history. A missing/incompatible schema reports `MIGRATIONS_REQUIRED` and tells the developer to run the CLI. Development account provisioning remains in `server:dev`. When adding a schema change, also update the runtime's required version in [`server/src/database-schema.js`](../../server/src/database-schema.js).

The runner bounds the directory to 512 entries and 256 migration files, each at most 1 MiB and 16 MiB in aggregate. SQL must be UTF-8 and filenames consecutive; symlinked SQL files are refused. Migration statements must use the runner's transaction; do not add transaction-control statements. Lock waits are limited to 15 seconds and individual statements to 60 seconds.

A focused check uses disposable databases and never migrates the database supplied as its administration connection:

```sh
bun server/tools/check-migrations.js --database-url postgres://openms:openms_local_only@127.0.0.1:55432/openms
```

## Gameplay reference SQL

`tables/` contains 24 schema scripts and `data/` contains 13 data scripts copied byte-for-byte from the supplied Cosmic checkout at revision `fec53bc7714dc0f1ae3f50b2986cdf2727e0912a`, under `src/main/resources/db/`. [manifest.json](manifest.json) records each imported path, byte count and SHA-256; [LICENSE](LICENSE) retains the upstream license. The manifest covers these imported reference files, not OpenMS's numbered PostgreSQL scripts.

The content converter parses selected game-data tables into JSON: shops, drops, crafting, monster cards and cash data. The admin-bootstrap script is retained for source completeness and inventory only; its credentials and account/character rows are excluded from published game data. Compose does not mount or execute these files.

Extraction defaults to this SQL root and reads only `tables/` and `data/`. Gameplay scripts and settings default to [`infra/gameplay-definitions/`](../gameplay-definitions/README.md). Override these inputs independently with `--sql-root DIR` and `--gameplay-definitions-root DIR`; no external server checkout is required.

```sh
bun tools/openms.js data server --output /tmp/openms-reference-data
bun tools/openms.js extract --assets ../Maplestory-Client
```

Generated provenance retains the imported relative SQL paths. To update the reference snapshot, copy the intended upstream SQL files, retain the license, update their manifest with the actual revision/hashes, and run the scoped converter tests. PostgreSQL schema evolution uses new numbered root SQL files and the `migrations` table independently of this imported snapshot.
