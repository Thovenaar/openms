# openms.dev

A browser reconstruction of MapleStory v83, with a Bun server and PostgreSQL persistence.

## Quick Start

Follow the **[Quick Start](docs/server/index.md)** for prerequisites, a fresh checkout, asset extraction, explicit database migration and your first login.

With Bun, Podman, a Compose provider, `curl` and `unzip` installed, run from the repository root. On macOS/Windows, initialize and start the Podman machine first as described in Quick Start.

```sh
bun install --frozen-lockfile
curl --fail --location --output ../Maplestory-Assets.zip \
  http://bucket.openms.dev/Maplestory-Assets.zip
unzip -n ../Maplestory-Assets.zip -d .. -x '__MACOSX/*'
bun tools/openms.js extract --assets ../Maplestory-Client
podman compose -f infra/compose.yaml up -d --build --wait --wait-timeout 90
bun run migrate --database-url postgres://openms:openms_local_only@127.0.0.1:55432/openms
```

[Maplestory-Assets.zip](http://bucket.openms.dev/Maplestory-Assets.zip) contains `Maplestory-Client/`; the commands above unpack it beside the repository. `--assets` points directly to that WZ directory. Gameplay definitions and reference SQL are included in `infra/gameplay-definitions/` and `infra/sql/`; no Cosmic checkout is needed. `migrate` executes the numbered PostgreSQL files directly in `infra/sql/`, while asset extraction reads only its `tables/` and `data/` reference directories. See [SQL ownership and migration behavior](infra/sql/README.md).

Then leave each command running in a **separate terminal**:

```sh
bun run server:dev
```

```sh
bun run client:dev:online
```

Open **http://127.0.0.1:3102**. Sign in with `admin` / `password` or `player` / `password`. Run `migrate` before initial startup and after SQL updates. Applied scripts are tracked in PostgreSQL's `migrations` table. Backend startup checks the schema and provisions development accounts; it does not run migrations. The checked-in `.env.server` and `.env.client` configure these local defaults.

Optional: run `bun run studio:dev` in another terminal and open **http://127.0.0.1:3103**. Studio has its own `.env.studio` and stores custom content in PostgreSQL.

[Quick Start, configuration and troubleshooting](docs/server/index.md) · [Client modes and controls](docs/README.md) · [Studio](docs/server/studio.md) · [Validation](docs/validation-method.md)
