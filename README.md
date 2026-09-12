# openms.dev

A browser reconstruction of MapleStory v83, with a Bun server and PostgreSQL persistence.

## Quick start

Requires [Bun](https://bun.sh), [Podman](https://podman.io) and a Compose provider supporting `up --wait` (e.g. Docker Compose). Check with `podman compose version`.

On macOS/Windows: `podman machine init` once, then `podman machine start` when stopped.

Already running the old `openms-postgres` container? Stop it first with `podman stop openms-postgres`; Compose reuses `openms-postgres-data`.

From the repository root, using your [original v83 assets and authorized Cosmic checkout](docs/inputs.md) (not included):

```sh
bun install --frozen-lockfile
MAPLE_ASSETS=/path/to/v83 MAPLE_SERVER_REFERENCE=/path/to/Cosmic \
  bun tools/openms.js extract
podman compose -f infra/compose.yaml up -d --build --wait --wait-timeout 90
```

Run in **separate terminals**:

```sh
bun run server:dev
```

```sh
bun run client:dev:online
```

Open **http://127.0.0.1:3102**. Log in as `dev_developer` or `dev_player` with the passwords printed by the server. Schema setup is automatic.

## Configuration

- [`.env.server`](.env.server) and [`.env.client`](.env.client) load automatically; exported variables override them.
- Database defaults: `openms` user/database, `openms_local_only` password, `127.0.0.1:55432`. **Development only.**
- Override Compose's `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` or `POSTGRES_PORT` via exported variables or `--env-file`; set the server's `DATABASE_URL` to match. Existing database passwords are not changed by these variables.
- Optional `OPENMS_DEV_PASSWORD` fixes both development account passwords; otherwise they reset randomly on each server launch.

Stop the database: `podman compose -f infra/compose.yaml down`. Data is retained; `down --volumes` deletes it.

Offline client: `bun run client:dev:offline` → **http://127.0.0.1:3100** (after extraction; no database/server).

[Client docs](docs/README.md) · [Server setup and production](docs/server/index.md) · [Validation](docs/validation.md)
