# Quick Start

Go from a fresh checkout to a local multiplayer server, browser client and optional Studio dashboard. Run commands from the repository root unless a step says otherwise. This guide uses the checked-in development defaults; [production](#production) has separate requirements.

## Online development

### 1. Install prerequisites

You need Git, [Bun](https://bun.sh), [Podman](https://podman.io), a Compose provider supporting `up --wait` (such as Docker Compose), and `curl`/`unzip` for the asset download. Step 3 downloads the original MapleStory v83 archives; see [inputs and provenance](../inputs.md). Use a desktop browser with a viewport of at least **800 × 600**.

Check that the tools are available:

```sh
git --version
bun --version
podman --version
podman compose version
```

On macOS or Windows, create the Podman machine once, then start it when stopped:

```sh
podman machine init
podman machine start
```

If a machine already exists, skip `init`; if it is already running, skip `start`. Linux can run Podman directly. The Compose provider must support the `--wait` and `--wait-timeout` flags used below.

### 2. Get the repository and install dependencies

```sh
git clone https://github.com/tensorfish/openms.git
cd openms
bun install --frozen-lockfile
```

For an existing checkout, enter its root and run the install command. The repository includes [`.env.server`](../../.env.server), [`.env.client`](../../.env.client) and [`.env.studio`](../../.env.studio); no environment-file copy or editing is needed for the default local setup. These files configure long-running services. Extraction and other one-shot tools take [named flags](../coding-style.md#cli-configuration).

### 3. Extract the original content

Download [Maplestory-Assets.zip](http://bucket.openms.dev/Maplestory-Assets.zip) and unzip it from the repository root:

```sh
curl --fail --location --output ../Maplestory-Assets.zip \
  http://bucket.openms.dev/Maplestory-Assets.zip
unzip -n ../Maplestory-Assets.zip -d .. -x '__MACOSX/*'
```

The ZIP contains a top-level `Maplestory-Client/` directory. Extracting into `..` places it beside the repository, at `../Maplestory-Client`; `-n` preserves files already present. The exclusion skips macOS metadata. If you already have the original archives, use their existing directory and skip the download.

Point `--assets` at the directory that directly contains the original v83 archives, including `Map.wz`, `Character.wz` and `String.wz`. For the default sibling layout:

```text
parent/
  openms/
  Maplestory-Client/
    Map.wz
    Character.wz
    String.wz
    ...the remaining original WZ archives
```

Run:

```sh
bun tools/openms.js extract --assets ../Maplestory-Client
```

Replace `../Maplestory-Client` with your actual archive directory when needed. The other inputs are already in the repository:

| Input | Purpose | Optional override |
| --- | --- | --- |
| `infra/gameplay-definitions/` | NPC/portal and other gameplay script definitions, plus `policy.json` | `--gameplay-definitions-root DIR` |
| `infra/sql/` | Reference shop, drop, crafting, card and cash records | `--sql-root DIR` |

No Cosmic checkout, Java source, Java hashes or full server configuration is required. Extraction parses these local definitions alongside the WZ data; it does not connect to PostgreSQL or execute the imported scripts/SQL.

Wait for **`Extraction succeeded`** before starting the backend. The command publishes `client/public/generated/catalog.json` and the resources it references, including artwork and compiled gameplay data. It packages the default map selection and supported dependency closure; see [asset delivery](../asset-delivery.md) for other selections. The catalog is the entry point shared by the backend, game client and Studio.

This is an initial setup step. Reuse the existing generated content for runtime-only edits; rerun extraction when its source inputs change. The normal command is incremental, and its cache defaults to `client/.cache/extraction`. You do not need a separate `data server` conversion command before starting the game.

### 4. Start PostgreSQL

```sh
podman compose -f infra/compose.yaml up -d --build --wait --wait-timeout 90
```

[Compose](../../infra/compose.yaml) builds the pinned PostgreSQL image, starts it, and waits for database health. On an empty volume, PostgreSQL creates the `openms` database and user. The default connection in `.env.server` is:

```text
postgres://openms:openms_local_only@127.0.0.1:55432/openms
```

These are published local development credentials. PostgreSQL data is retained in the `openms-postgres-data` volume. If an older standalone `openms-postgres` container uses that same volume, stop it before starting Compose. The Bun launchers connect to PostgreSQL; they do not start a database process.

### 5. Initialize or update the database schema

Run the migration CLI against the same database configured in `.env.server`:

```sh
bun run migrate --database-url postgres://openms:openms_local_only@127.0.0.1:55432/openms
```

The equivalent workspace command is `bun tools/openms.js migrate --database-url URL`. The CLI reads the numbered PostgreSQL scripts directly in `infra/sql/`; `--sql-root DIR` selects another SQL directory. It requires `--database-url` explicitly and does not read `.env.server` or ambient environment variables. No generated assets or running backend are needed to migrate.

On its first run, the CLI creates the **`migrations` table inside PostgreSQL** to record each script's version, filename, SHA-256 and application time. Migration history is kept in that database table. Scripts run in numeric order, with pending changes in one transaction. Unchanged applied scripts are skipped; a changed applied script or failed SQL statement stops the run. Existing development databases created by the old startup runner are adopted by replaying the idempotent scripts once and recording them, preserving their data.

Run this command on initial setup and after pulling changes that add SQL scripts. Database creation in Compose creates the database/user; `migrate` creates or updates the application schema. The `infra/sql/tables/` and `infra/sql/data/` directories remain gameplay reference inputs for extraction and are excluded from migration.

### 6. Start the backend

In one terminal, leave this running:

```sh
bun run server:dev
```

The launcher performs the following automatically:

1. Loads `.env.server`, reads the generated catalog and verifies the content it loads.
2. Connects to PostgreSQL and checks the `migrations` table against the schema version required by this runtime. Startup does not create tables or run SQL scripts.
3. Creates or restores the `admin` and `player` development accounts. If an account has no characters, it creates a starter character.
4. Registers the asset catalog in `content_asset_build`, loads any active Studio world release, and starts the authoritative server on **http://127.0.0.1:3200**.

Wait for **`authoritative server ready`**. A missing or incompatible schema fails startup with `MIGRATIONS_REQUIRED`; complete step 5, then restart. Development account provisioning remains part of `server:dev`; schema migration belongs exclusively to the CLI.

### 7. Start the game client and sign in

In a **second terminal**, from the repository root:

```sh
bun run client:dev:online
```

Wait for **`online client ready`**, then open **http://127.0.0.1:3102**.

| Account | Password | Role |
| --- | --- | --- |
| `admin` | `password` | Developer; inspection mutations allowed |
| `player` | `password` | Normal player |

Select the starter character to enter the game. **Register** creates a normal account with an empty roster; create a character afterward. `OPENMS_DEV_PASSWORD` in the server service configuration overrides both bootstrap passwords, and each `server:dev` launch restores them. Existing characters are retained. Legacy development accounts are renamed in place when the new name is absent; role conflicts fail explicitly.

The frontend builds its browser code, serves generated assets, and proxies same-origin `/api/` HTTP and WebSocket requests to port 3200. Backend startup and frontend startup reuse the extraction from step 3. The browser does not connect to PostgreSQL.

### 8. Open Studio when you want to author content

In an optional **third terminal**:

```sh
bun run studio:dev
```

Open **http://127.0.0.1:3103** and sign in with the same accounts. Studio uses `.env.studio` and a separate listener. It needs the backend, database and generated content; the game client can be stopped while authoring.

Custom maps, mobs, quests and uploaded PNGs are saved in PostgreSQL. To make published creations playable, an `admin` user activates a selection in **Shared world** while the world is idle. The original generated assets remain the shared base. See the [Studio guide](studio.md) for authoring and activation.

## How the pieces connect

```mermaid
flowchart TD
  WZ[Original v83 WZ archives] --> Extract[Extraction]
  Definitions[Gameplay definitions and reference SQL] --> Extract
  Extract --> Generated[client/public/generated]
  Generated --> Server[Bun server: 3200]
  Generated --> Client[Game frontend: 3102]
  Generated --> Studio[Studio: 3103]
  SQL[Numbered SQL files in infra/sql] --> Migrate[migrate CLI]
  Migrate -->|Schema and migrations table| DB[(PostgreSQL: 55432)]
  Server -->|Durable state| DB
  DB -->|Accounts, progress and custom content| Server
  Browser[Game browser] --> Client
  Client -->|HTTP and WebSocket API| Server
  Studio -->|HTTP authoring API| Server
```

| Location | What it owns |
| --- | --- |
| `infra/gameplay-definitions/`, `infra/sql/tables/`, `infra/sql/data/` | Repository-owned inputs for content compilation |
| `client/public/generated/` | Generated original catalog, visuals and compiled gameplay definitions read by the services |
| `infra/sql/*.sql` | PostgreSQL schema scripts applied explicitly by `migrate` |
| PostgreSQL `migrations` table | Applied script versions, filenames, checksums and timestamps |
| PostgreSQL | Accounts, character progress, transactions, Studio revisions/uploads and world releases; also the registered asset catalog |

Original artwork stays in generated files. The server reads gameplay definitions from that generated package, combines them with the active custom world release from PostgreSQL, and controls online dialogue, movement, rewards and transactions. The client sends inputs and choices, renders the server's responses, and fetches original visuals from the frontend. [Reference data](#reference-data) explains why the current extraction packages both visuals and gameplay data.

## Stop and return later

Stop the Bun processes with **Ctrl-C**, then stop the database:

```sh
podman compose -f infra/compose.yaml stop
```

To resume after an ordinary stop, start the Podman machine first if needed, then:

```sh
podman compose -f infra/compose.yaml up -d --wait --wait-timeout 90
```

Run `migrate` if SQL scripts have changed since the last run. Then run `server:dev`, `client:dev:online` and optionally `studio:dev` again in separate terminals. Reuse the existing extracted content and database volume. Do not use `down --volumes` for an ordinary stop: it deletes the saved database.

After runtime changes, restart the backend and affected frontend, reload and sign in again. The current rules identity includes shared client code, so game runtime changes require both backend and game frontend to restart. [Restart requirements](../validation-method.md#current-invalidation-and-reuse-constraints) explain the boundaries; input changes require a new extraction.

## Workspace

| Path                 | Owner                                                             |
| -------------------- | ----------------------------------------------------------------- |
| `server/src/`        | HTTP/session admission, content, fields, actions and interactions |
| `infra/sql/*.sql` | Durable schema scripts, applied by the migration CLI |
| `tools/migrate.js` | Explicit database migration entry point |
| `server/tools/`      | Development bootstrap and lifecycle tooling                       |
| `infra/gameplay-definitions/`, `infra/sql/tables/`, `infra/sql/data/` | Local gameplay definitions and reference SQL used during content compilation |
| `shared/`            | Closed protocol, validation and motion checkpoints                |
| `client/src/online/` | Transport, prediction and read-only native presentation           |
| `content/` | `@openms/content`: original-asset lookup, private custom definitions, revisions and publishing |
| `studio/` | `@openms/studio`: asset library, map/mob/quest editors and shared-world release dashboard |

The runtime is implemented by OpenMS. These are development/reference rules, not a reconstruction of Nexon's server. [Feature coverage](offline-parity.md) and the [remaining-work audit](remaining-work.md) describe current support.

[Custom content](content.md) documents the database authoring API, asset-build pins and supported map/mob/quest contracts. Start `bun run studio:dev` and open [Studio](studio.md) at `http://127.0.0.1:3103` to author and publish. It has its own listener and `.env.studio`; the game client is optional for authoring. A developer explicitly activates selected publications for the shared world; saving or publishing alone leaves the live world unchanged.

## Configuration

Scoped `.env.server`, `.env.client` and `.env.studio` are loaded relative to the repository. Process environment takes precedence. Ignored `.env*.local` files need explicit loading; they are not automatic overlays. `OPENMS_MODE` is process-only, and `NODE_ENV=production` forces production mode.

| File / setting                              | Default                                | Meaning                                         |
| ------------------------------------------- | -------------------------------------- | ----------------------------------------------- |
| `.env.client`: `HOST`, `PORT`               | `127.0.0.1`, `3100`                    | Offline listener                                |
| `.env.client`: `ONLINE_HOST`, `ONLINE_PORT` | `127.0.0.1`, `3102`                    | Online listener                                 |
| `.env.client`: `OPENMS_SERVER_URL`          | `http://127.0.0.1:3200`                | Reachable backend origin                        |
| `.env.studio`: `STUDIO_HOST`, `STUDIO_PORT` | `127.0.0.1`, `3103` | Dedicated Studio listener |
| `.env.studio`: `OPENMS_SERVER_URL` | `http://127.0.0.1:3200` | Studio's backend API origin |
| `.env.studio`: `OPENMS_CLIENT_URL` | `http://127.0.0.1:3102` | Public game link in Studio |
| `.env.studio`: `OPENMS_CONTENT_ROOT` | `client/public/generated` | Same original extraction as the backend |
| `.env.server`: `OPENMS_HOST`, `OPENMS_PORT` | `127.0.0.1`, `3200`                    | Backend listener                                |
| `.env.server`: `OPENMS_ORIGIN`              | `http://127.0.0.1:3102`                | Browser origin allowed to authenticate/play     |
| `.env.server`: `OPENMS_STUDIO_ORIGIN` | `http://127.0.0.1:3103` | Separate browser origin for sessions and authoring |
| `.env.server`: `DATABASE_URL`               | Dedicated local database on port 55432 | PostgreSQL connection                           |
| `.env.server`: `OPENMS_CONTENT_ROOT`        | `client/public/generated`              | Verified immutable content                      |
| `.env.server`: `OPENMS_POW_BITS`            | `15`                                   | Login/registration proof difficulty, valid 8–24 |
| `.env.server`: `OPENMS_DEV_PASSWORD`        | `password`                             | Bootstrap account password override             |

Compose defaults are `POSTGRES_USER=openms`, `POSTGRES_PASSWORD=openms_local_only`, `POSTGRES_DB=openms`, `POSTGRES_PORT=55432`. Export overrides or pass a private `--env-file` to Compose, then supply a matching `DATABASE_URL` to Bun. Compose and Bun do not load each other's scoped files.

For LAN development, configure reachable listener addresses and `OPENMS_SERVER_URL`, then set `OPENMS_ORIGIN` to the exact game browser URL and `OPENMS_STUDIO_ORIGIN` to Studio's separate public origin. Set Studio's `OPENMS_CLIENT_URL` to the public game origin. A wildcard bind address is not a browser origin. Keep privileged development services on a trusted network. Production uses HTTPS with each frontend proxying its own API requests; browser bundles contain no server secrets.

### Development controls

World search/Go, pause/step, physics changes, monster spawning, Character presets, conjure, stats, skills and supported profile edits use the audited HTTP development endpoint. Requests require developer role, development mode, session/CSRF proof, accepted origin and current connection epoch. Normal player sessions cannot use them. Camera/geometry display is local presentation. [Development requests](protocol.md#development-requests) defines the closed operations; [inspection](../inspection-tools.md) explains the UI.

## Troubleshooting

Both launchers write structured development logs to **stdout**, including startup stages, elapsed time, identities, HTTP refusals, WebSocket lifecycle and operation outcomes. Structured diagnostics exclude passwords, cookies, tickets and message bodies. The development launcher separately prints its bootstrap credentials to the terminal.

| Symptom                                    | Check / correction                                                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `403 NOT_ALLOWED` on login or registration | Find `http.rejected`. For `reason: origin-mismatch`, compare request origin with `development.start`'s configured origin. Otherwise check challenge/CSRF proof and session state.   |
| `localhost` works but another host fails   | Loopback development admits `localhost`, `127.0.0.1` and `[::1]` only with the configured scheme/port; cookies remain host-specific. LAN and production origins must match exactly. |
| `CONTENT_MISMATCH` after code changes      | Restart backend and frontend together; reload the browser. Do not bypass the rules/catalog guard.                                                                                   |
| Default credentials fail                   | Confirm the current launcher completed bootstrap against the intended database and check `OPENMS_DEV_PASSWORD`. Role conflicts are explicit startup failures.                       |
| Missing catalog or WZ file | Check the `--assets` directory and complete extraction before launching; the backend expects `client/public/generated/catalog.json`. |
| Compose rejects `--wait` | Install/select a Compose provider supporting `up --wait` and `--wait-timeout`; check `podman compose version`. |
| `MIGRATIONS_REQUIRED` at backend startup | Run `bun run migrate --database-url URL` against the backend database, then restart. Both development and production startup only check the schema. |
| Backend cannot connect to PostgreSQL       | Check Compose health and `DATABASE_URL`; no in-memory fallback exists.                                                                                                              |
| A second tab cannot start                  | One game owner per browser storage origin is intentional. Close the owner or use another isolated browser profile.                                                                  |
| Connection loss or server restart          | Transient reconnect has a 30 s grace; commands freeze. Authentication is process-local, so backend restart requires login again.                                                    |

Stop/start the database explicitly with `podman compose -f infra/compose.yaml stop` / `start`. Ordinary shutdown does not remove the persistent volume.

## Production

Apply database updates with `bun run migrate --database-url URL`, build the online shell with `bun run client:build:online`, then launch the backend with `bun run server:start`. The development launcher and bootstrap accounts are not production entry points.

| Gate             | Required deployment behavior                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| HTTPS/WSS        | Game origin serves its static shell/assets and proxies `/api/` to the backend, including upgrades, Origin and cookies. |
| Studio | Separate HTTPS origin routes to `bun run studio:start`; configure exact `OPENMS_STUDIO_ORIGIN` on the backend. See [Studio settings](studio.md#build-routing-and-validation). |
| Runtime pin      | Set `OPENMS_RULES_HASH` to the verified 64-character lowercase SHA-256 rules identity.                                     |
| Configuration    | Required production `DATABASE_URL` and exact public HTTPS `OPENMS_ORIGIN`; securely provision accounts and persistence.    |
| Static files     | Publish `online.html`, styles, `dist/online/`, generated content; map `/dist/atlas-worker.js` to the online worker output. |
| Session security | Secure HttpOnly SameSite cookies, CSRF checks and one-use tickets; development endpoint absent.                            |
| Recovery         | Explicit migration, backup/recovery and [adversarial/durability proof](protocol.md#implementation-order-and-required-proof).       |

Keep `/api/` network-only. Do not install the offline service worker for the online shell. Handler coverage and a matching source hash do not certify production readiness or complete original behavior.

## Protocol {#protocol-proposal}

The [protocol](protocol.md) owns session lifetimes, input sequencing, field generations, checkpoints, transactions and recovery. Explicit logout retires the actor immediately and checkpoints it; transient disconnection has a separate grace. Dead logout follows the authored return-map revival policy.

[Review fixes and migration](reliability.md) documents stateless login admission, byte-bounded snapshots, checkpoint recovery and retention, global character names, and market retry policy.

## Reference data

The imported Cosmic SQL is retained under `infra/sql/tables/` and `infra/sql/data/` (see [SQL ownership](../../infra/sql/README.md)) and [`infra/gameplay-definitions/`](../../infra/gameplay-definitions/README.md). These are the defaults; optional `--sql-root` and `--gameplay-definitions-root` flags select other local snapshots. No external checkout, Java files or server configuration is read:

```sh
bun tools/openms.js data server --output /tmp/openms-reference-data
```

The converter reads bounded SQL/schema records and script metadata; it neither starts Cosmic nor supplies its account service. [Reference-data coverage](../offline-data.md) records exclusions and [provenance](../inputs.md) distinguishes emulator policy from original executable/WZ evidence.

The current extraction command builds a playable offline content package as well as artwork. Shop/drop rows select required item visuals, and supported NPC routes select map, portrait, dialogue-art and quest dependencies. That is why reference conversion currently participates in extraction. Online dialogue execution, purchase admission, reward calculation and transactions belong to the server; browser presentation sends choices and displays server responses. Packaging static definitions is separate from permission to execute them. A future split into independent artwork extraction and server-content compilation must preserve that dependency inventory and the offline package; relocating the definitions removes the external server dependency while preserving the offline content build.

## Authority boundaries

| Browser may…                                     | Server must…                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| Predict movement and display received state      | Own positions, velocities, field membership and checkpoints           |
| Submit a native action or conversation choice    | Validate identity, requirements, costs, clocks and current generation |
| Display/draft inventory, social and character UI | Commit all affected participants atomically and return receipts       |
| Reconnect using a fresh ticket                   | Restore current authoritative state; never merge offline earnings     |

See [shared integration](../reconstruction-contract.md), [online/offline coverage](offline-parity.md) and [validation boundaries](../validation-method.md#evidence-boundaries).
