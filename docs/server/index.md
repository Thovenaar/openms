# Run the server

The Bun server owns online characters, field clocks, gameplay admission and PostgreSQL transactions. The browser sends inputs and closed intents; it cannot upload a save or choose rewards. These are development/reference rules, not a reconstruction of Nexon's server. [Feature coverage](offline-parity.md) separates implemented paths from exercised behavior; the [remaining-work audit](remaining-work.md) tracks implementation and gaps against original resources and Cosmic's interface inventory. New systems are written for OpenMS without reusing Cosmic code or scripts.

## Workspace

| Path                 | Owner                                                             |
| -------------------- | ----------------------------------------------------------------- |
| `server/src/`        | HTTP/session admission, content, fields, actions and interactions |
| `server/sql/`        | Durable schema and migrations                                     |
| `server/tools/`      | Development bootstrap and lifecycle tooling                       |
| `shared/`            | Closed protocol, validation and motion checkpoints                |
| `client/src/online/` | Transport, prediction and read-only native presentation           |

## Online development

Install Bun dependencies and [prepare original assets](../README.md#run). PostgreSQL is externally managed; neither Bun launcher starts or stops a database cluster.

**1. Start PostgreSQL.** Install Podman and a Compose provider supporting `up --wait`. On macOS, initialize/start a Podman machine if needed.

```sh
podman compose -f infra/compose.yaml up -d --build --wait --wait-timeout 90
```

The [Compose definition](../../infra/compose.yaml) publishes PostgreSQL only on loopback and retains `openms-postgres-data`. If an older standalone `openms-postgres` container owns that volume, stop it before starting Compose. Do not run two database instances against one volume.

**2. Start the backend and browser in separate terminals.**

```sh
bun run server:dev
bun run client:dev:online
```

Open `http://127.0.0.1:3102` or `http://localhost:3102`. The frontend proxies same-origin `/api/` HTTP/WebSocket requests to the backend and serves existing generated assets. It does not extract assets or run offline release verification on startup.

| Account  | Password   | Role                                    |
| -------- | ---------- | --------------------------------------- |
| `admin`  | `password` | Developer; inspection mutations allowed |
| `player` | `password` | Normal player                           |

Development startup applies the schema and restores bootstrap passwords on every launch. `OPENMS_DEV_PASSWORD` overrides both passwords. Legacy development accounts are renamed in place when the new name is absent; role conflicts fail explicitly. Use a dedicated development database. Registration creates a normal account with an empty roster.

Restart **both** commands after runtime changes, then reload and sign in. The current rules identity includes shared client code. [Restart requirements](../validation-method.md#current-invalidation-and-reuse-constraints) explain which changes invalidate each process.

### Configuration

Scoped `.env.server` and `.env.client` are loaded relative to the repository. Process environment takes precedence. Ignored `.env*.local` files need explicit loading; they are not automatic overlays. `OPENMS_MODE` is process-only, and `NODE_ENV=production` forces production mode.

| File / setting                              | Default                                | Meaning                                         |
| ------------------------------------------- | -------------------------------------- | ----------------------------------------------- |
| `.env.client`: `HOST`, `PORT`               | `127.0.0.1`, `3100`                    | Offline listener                                |
| `.env.client`: `ONLINE_HOST`, `ONLINE_PORT` | `127.0.0.1`, `3102`                    | Online listener                                 |
| `.env.client`: `OPENMS_SERVER_URL`          | `http://127.0.0.1:3200`                | Reachable backend origin                        |
| `.env.server`: `OPENMS_HOST`, `OPENMS_PORT` | `127.0.0.1`, `3200`                    | Backend listener                                |
| `.env.server`: `OPENMS_ORIGIN`              | `http://127.0.0.1:3102`                | Browser origin allowed to authenticate/play     |
| `.env.server`: `DATABASE_URL`               | Dedicated local database on port 55432 | PostgreSQL connection                           |
| `.env.server`: `OPENMS_CONTENT_ROOT`        | `client/public/generated`              | Verified immutable content                      |
| `.env.server`: `OPENMS_POW_BITS`            | `15`                                   | Login/registration proof difficulty, valid 8–24 |
| `.env.server`: `OPENMS_DEV_PASSWORD`        | `password`                             | Bootstrap account password override             |

Compose defaults are `POSTGRES_USER=openms`, `POSTGRES_PASSWORD=openms_local_only`, `POSTGRES_DB=openms`, `POSTGRES_PORT=55432`. Export overrides or pass a private `--env-file` to Compose, then supply a matching `DATABASE_URL` to Bun. Compose and Bun do not load each other's scoped files.

For LAN development, configure reachable listener addresses and `OPENMS_SERVER_URL`, then set `OPENMS_ORIGIN` to the exact browser URL. A wildcard bind address is not a browser origin. Keep privileged development services on a trusted network. Production uses same-origin HTTPS; browser bundles contain no server secrets.

### Development controls

World search/Go, pause/step, physics changes, monster spawning, Character presets, conjure, stats, skills and supported profile edits use the audited HTTP development endpoint. Requests require developer role, development mode, session/CSRF proof, accepted origin and current connection epoch. Normal player sessions cannot use them. Camera/geometry display is local presentation. [Development requests](protocol.md#development-requests) defines the closed operations; [inspection](../inspection-tools.md) explains the UI.

## Troubleshooting

Both launchers write structured development logs to **stdout**, including startup stages, elapsed time, identities, HTTP refusals, WebSocket lifecycle and operation outcomes. Passwords, cookies, tickets and message bodies are excluded from diagnostics.

| Symptom                                    | Check / correction                                                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `403 NOT_ALLOWED` on login or registration | Find `http.rejected`. For `reason: origin-mismatch`, compare request origin with `development.start`'s configured origin. Otherwise check challenge/CSRF proof and session state.   |
| `localhost` works but another host fails   | Loopback development admits `localhost`, `127.0.0.1` and `[::1]` only with the configured scheme/port; cookies remain host-specific. LAN and production origins must match exactly. |
| `CONTENT_MISMATCH` after code changes      | Restart backend and frontend together; reload the browser. Do not bypass the rules/catalog guard.                                                                                   |
| Default credentials fail                   | Confirm the current launcher completed bootstrap against the intended database and check `OPENMS_DEV_PASSWORD`. Role conflicts are explicit startup failures.                       |
| Backend cannot connect to PostgreSQL       | Check Compose health and `DATABASE_URL`; no in-memory fallback exists.                                                                                                              |
| A second tab cannot start                  | One game owner per browser storage origin is intentional. Close the owner or use another isolated browser profile.                                                                  |
| Connection loss or server restart          | Transient reconnect has a 30 s grace; commands freeze. Authentication is process-local, so backend restart requires login again.                                                    |

Stop/start the database explicitly with `podman compose -f infra/compose.yaml stop` / `start`. Ordinary shutdown does not remove the persistent volume.

## Production

Build the online shell with `bun run client:build:online`; launch the backend with `bun run server:start`. The development launcher and bootstrap accounts are not production entry points.

| Gate             | Required deployment behavior                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| HTTPS/WSS        | Same-origin static shell/assets and `/api/`; proxy upgrades, Origin and cookies correctly.                                 |
| Runtime pin      | Set `OPENMS_RULES_HASH` to the verified 64-character lowercase SHA-256 rules identity.                                     |
| Configuration    | Required production `DATABASE_URL` and exact public HTTPS `OPENMS_ORIGIN`; securely provision accounts and persistence.    |
| Static files     | Publish `online.html`, styles, `dist/online/`, generated content; map `/dist/atlas-worker.js` to the online worker output. |
| Session security | Secure HttpOnly SameSite cookies, CSRF checks and one-use tickets; development endpoint absent.                            |
| Recovery         | Migrations, backup/recovery and [adversarial/durability proof](protocol.md#implementation-order-and-required-proof).       |

Keep `/api/` network-only. Do not install the offline service worker for the online shell. Handler coverage and a matching source hash do not certify production readiness or complete original behavior.

## Protocol {#protocol-proposal}

The [protocol](protocol.md) owns session lifetimes, input sequencing, field generations, checkpoints, transactions and recovery. Explicit logout retires the actor immediately and checkpoints it; transient disconnection has a separate grace. Dead logout follows the authored return-map revival policy.

[Review fixes and migration](reliability.md) documents stateless login admission, byte-bounded snapshots, checkpoint recovery and retention, global character names, and market retry policy.

## Reference data

The supplied `../MapleStory-Server` identifies itself as Cosmic. Set `MAPLE_SERVER_REFERENCE` or pass `--server-root` when converting it:

```sh
bun tools/openms.js data server --server-root ../MapleStory-Server --output client/public/generated
```

The converter reads bounded SQL/schema records and script metadata; it neither starts Cosmic nor supplies its account service. [Reference-data coverage](../offline-data.md) records exclusions and [provenance](../inputs.md) distinguishes emulator policy from original executable/WZ evidence.

## Authority boundaries

| Browser may…                                     | Server must…                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| Predict movement and display received state      | Own positions, velocities, field membership and checkpoints           |
| Submit a native action or conversation choice    | Validate identity, requirements, costs, clocks and current generation |
| Display/draft inventory, social and character UI | Commit all affected participants atomically and return receipts       |
| Reconnect using a fresh ticket                   | Restore current authoritative state; never merge offline earnings     |

See [shared integration](../reconstruction-contract.md), [online/offline coverage](offline-parity.md) and [validation boundaries](../validation-method.md#evidence-boundaries).
