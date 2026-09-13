# openms.dev server

The Bun server owns online characters, field simulation, gameplay admissions and PostgreSQL transactions. The [online browser](../README.md#online-development) sends inputs and closed intents; it does not upload an offline save or choose authoritative results. The [offline client](../README.md) remains independent.

This is a development/reference rules runtime, **not an original Nexon server reconstruction or a production certification**. The [protocol](protocol.md) records the wire contract and required safety properties. [Measured validation](../validation.md) is the authority for what has actually been exercised; the presence of handlers is not evidence that every action, field or failure mode has passed.

## Workspace

[`server/package.json`](../../server/package.json) declares the private Bun workspace. Runtime ownership is split between HTTP/session admission, immutable content, the field owner, action/interaction adapters and PostgreSQL persistence. Shared protocol validation and fixed-step motion live in `shared/`; browser rendering remains under `client/`.

```sh
bun install --frozen-lockfile
```

## Online development

Prepare the original assets and authorized reference data using the [client extraction setup](../README.md#run). PostgreSQL is exclusively externally managed with Podman: neither JavaScript development nor production startup creates, initializes, starts or stops a cluster. Install Podman and a Compose provider supporting `up --wait` (for example, Docker Compose); `podman compose version` must work. On macOS/Windows, run `podman machine init` once and `podman machine start` when the machine is stopped.

From the repository root:

```sh
podman compose -f infra/compose.yaml up -d --build --wait --wait-timeout 90
```

[`infra/compose.yaml`](../../infra/compose.yaml) builds the existing `Containerfile` from the official `docker.io/library/postgres:18.6-bookworm` image. PostgreSQL 18 stores its cluster under `/var/lib/postgresql/18/docker`; the named `openms-postgres-data` volume mounts at `/var/lib/postgresql`, not the pre-18 `/var/lib/postgresql/data` path. Only loopback is published. The TCP readiness healthcheck gates `up --wait` before Bun starts.

Already using the previous standalone `openms-postgres` container? Stop it with `podman stop openms-postgres` **before** running Compose. Compose reuses the same named volume; never run two PostgreSQL instances against it. No container or volume removal is required.

Compose accepts these exported variables, or an explicit `--env-file /path/to/private.env` before `up`:

| Variable            | Default             |
| ------------------- | ------------------- |
| `POSTGRES_USER`      | `openms`            |
| `POSTGRES_PASSWORD`  | `openms_local_only`  |
| `POSTGRES_DB`        | `openms`            |
| `POSTGRES_PORT`      | `55432`             |

Defaults match `.env.server`. If overridden, supply the corresponding `DATABASE_URL` to the Bun server (`postgres://USER:PASSWORD@127.0.0.1:PORT/DB`; URL-encode credentials as needed). Compose's `--env-file` is not loaded by Bun; scoped `.env.server`/`.env.client` are not loaded by Compose. Keep private overrides outside tracked files; ignored `.env*.local` files require explicit loading.

Stop/start ownership stays with the operator:

```sh
podman compose -f infra/compose.yaml stop
podman compose -f infra/compose.yaml up -d --wait --wait-timeout 90
```

The container has a 90-second graceful stop timeout. Stopping Bun leaves PostgreSQL running. Compose `stop` and `down` retain the named volume; **`down --volumes` deletes database data**. Initialization variables apply to an **empty volume only**; changing `POSTGRES_PASSWORD` does not rotate an existing database password. These published development credentials are never production credentials. Existing user data under `server/.cache/postgres` is untouched and is **not automatically migrated**; plan any deliberate transfer separately.

Then run the server and online client in separate terminals:

```sh
bun run server:dev
bun run client:dev:online
```

Open **http://127.0.0.1:3102** or **http://localhost:3102** by default. The browser development server builds the online shell and proxies `/api/` HTTP/WebSocket traffic to the Bun runtime, whose default listener is **127.0.0.1:3200**. Both listener addresses and ports are configurable below. Restart both commands and reload the page after source or configuration changes so their rules identities match. It serves already-generated immutable assets; it does not run extraction or the offline release-verification pipeline on every launch.

Only one game tab can start per browser profile and site origin. A duplicate tab offers **Try again** after the owner closes; changing focus or reconnecting keeps the owner's slot. Use separate browser profiles/isolated contexts for multiplayer testing. The [shared online/offline startup lock](../browser-session.md) runs before login or save access.

Server startup applies the database schema automatically. The launcher provides **`admin` / `password`** (developer controls) and **`player` / `password`** (normal player). Passwords reset to these defaults on every launch; `OPENMS_DEV_PASSWORD` optionally overrides the password for both. When the new name is absent, the corresponding `dev_developer` or `dev_player` account is renamed in place, preserving its account ID and characters. An existing account with a conflicting role is refused. This existing bootstrap always applies to the selected `DATABASE_URL`, so the launcher must only point at a dedicated development database. No `OPENMS_PG_BIN` or `OPENMS_PG_PORT` defaults or local-cluster fallback remain.

Both commands print development progress to stdout: startup stages and elapsed time, build/content identities, HTTP method/path/status, socket connections and closures, map joins/leaves, and command outcomes. Logs exclude request bodies, cookies, tickets and query strings; the development launcher explicitly prints its bootstrap credentials. Static asset requests and movement packets are not logged individually. See [the login and shared-map correction](../login-shared-map.md).

**Login/registration returning403 `NOT_ALLOWED` on localhost:** the browser sends `Origin: http://localhost:3102`, while the tracked backend setting names `http://127.0.0.1:3102`. Previously that mismatch rejected both credential endpoints before checking the password, even though the proxy served the page successfully. Explicit development mode now accepts the exact `localhost`, `127.0.0.1` and `[::1]` origins when the configured origin is one of those loopback hosts; the scheme and port must still match. This applies to credential requests, authenticated HTTP actions and gameplay WebSocket admission. Cookies remain host-specific, so changing hosts requires signing in there. IPv6 also requires a listener reachable on that address. Production and non-loopback development configurations retain a single exact origin.

An origin rejection now prints `http.rejected` with `reason:"origin-mismatch"` and the request's `origin`; compare it with `development.start`'s configured `origin`. A generic `NOT_ALLOWED` without that reason can still mean a missing/expired login cookie or invalid CSRF proof. The focused regression `bun test server/test/login-origin.test.js server/test/development-log.test.js server/test/development-accounts.test.js server/test/proof-of-work.test.js server/test/registration.test.js server/test/creation-roll.test.js` covers default credentials, registration and gameplay upgrade admission through the actual HTTP/auth handlers, strict foreign-origin rejection, existing proof/CSRF rules and secret-free diagnostics. Its database and upgrade boundaries are test doubles; it does not start PostgreSQL, open a browser or establish gameplay acceptance.

Host tools load the repository-root `.env.server` or `.env.client` by module-relative path, independently of working directory. Process environment takes precedence; client programmatic `hostname`/`port` options take precedence over both. Listener addresses apply in development as well as production; blank addresses and out-of-range ports fail rather than falling back to another listener.

| File | Listener | Address key/default | Port key/default |
| --- | --- | --- | --- |
| `.env.client` | Offline development client | `HOST=127.0.0.1` | `PORT=3100` |
| `.env.client` | Online development client | `ONLINE_HOST=127.0.0.1` | `ONLINE_PORT=3102` |
| `.env.server` | Backend | `OPENMS_HOST=127.0.0.1` | `OPENMS_PORT=3200` |

`.env.client` also admits `OPENMS_SERVER_URL=http://127.0.0.1:3200`: the reachable backend HTTP origin, not a wildcard bind address. `.env.server` admits `DATABASE_URL`, `OPENMS_ORIGIN`, `OPENMS_HOST`, `OPENMS_PORT`, `OPENMS_CONTENT_ROOT`, `OPENMS_RULES_HASH`, `OPENMS_POW_BITS` and `OPENMS_DEV_PASSWORD`. Tracked defaults retain the dedicated local PostgreSQL database, 15 proof-of-work bits and `OPENMS_ORIGIN=http://127.0.0.1:3102`.

For LAN use, bind the listeners to a local interface address or an explicit wildcard (`0.0.0.0`/`::`), set `OPENMS_SERVER_URL` to the backend's reachable address/port, and set `OPENMS_ORIGIN` to the **exact URL origin used by the browser**, such as `http://192.168.1.20:3102`. A wildcard listener is not a browser origin. IPv6 URL literals need brackets, for example `http://[::1]:3122`, while the bind value is `::1`. The online proxy still rejects foreign WebSocket Origins, and the backend still enforces its configured origin policy described above. Development HTTP and privileged development accounts must only be exposed on trusted, firewall-restricted networks, never the public internet.

Client listener/proxy settings configure development serving; production builds use same-origin `/api/` and `/generated/` behind deployment-managed HTTPS. Server secrets and arbitrary environment variables are not bundled into the browser. `.env*.local` files are ignored by version control but **not automatically read**. The owned `smoke` validation server deliberately pins loopback independently of these interactive-client settings.

`OPENMS_MODE` is accepted only from the process environment, never a checked-in scoped file. `NODE_ENV=production` forces production mode and cannot enable development. The development launcher refuses production mode. PostgreSQL connectivity is required and failure stays explicit; there is no in-memory economy fallback.

The original login's **Register** button opens a Windows95-themed popup backed by `POST /api/v1/accounts`. Sign in and sign up both require a single-use hashcash challenge from `GET /api/v1/challenge` (default15 leading zero bits, `OPENMS_POW_BITS` overrides within8..24), submitted with that challenge's `loginToken` as `csrfToken`. The server consumes the proof before password work. Registration creates only a player account and opens an empty roster; duplicate/validation errors remain in the popup for retry. Launcher development accounts still receive their separate starter characters. After authentication, the original character-selection scene shows account-owned characters in pages of three. Explorer creation follows name → appearance → starting stats. The restored dice step uses original retained artwork, with `POST /api/v1/character-roll` issuing the stats on the server. Final creation requires that session's current `rollId` and matching integer stats in `4..13`, totalling25, alongside the validated original starting cosmetics. See the [recovery guide](../login-creation-recovery.md) for recovered placement, browser policies and executable checks.

The online shell does not open `ProfileStore`, import IndexedDB characters, install an offline service worker or merge disconnected earnings. Connection loss freezes online admission. Reconnect uses a fresh one-use ticket and server-owned state, not an offline continuation.

Authentication sessions and one-use tickets are process-local (session lifetime12h; ticket lifetime30s). Restart requires login again; durable character/economy recovery is separate. The reconnect grace is30s, not offline permission or invulnerability.

Online startup and field downloads use the shared original mushroom loading presentation while real asynchronous work prepares the browser surface, content, avatar and native game interface. It is decoration and status, not a fabricated percentage or a readiness authority. Native UI resources must be prepared before publication and matching transport readiness; stale preparations cannot replace the retained complete field. Field/network readiness is separate from modal gameplay blocking: a modal blocks movement and competing actions, but must not block its own revive confirmation from sending the authoritative request.

Explicit logout immediately removes the actor from simulation, unlike transient-disconnect grace. It fences pending durable work, checkpoints the final character and releases its writer lease. A dead logout applies the ordinary authored `returnMap`/portal0 revival policy and restores HP50 capped by maximum HP before saving. See [session lifecycle](protocol.md#transport-and-session-lifecycle) for transfer readiness and recovery boundaries.

### Development controls

Map search/Go, character presets and scalar edits, monster selection/spawn, pause/step and physics changes are **requests to the authority**, not local gameplay setters. `POST /api/v1/development` requires explicit development mode, developer role, session, CSRF proof, an allowed browser origin under the policy above and the current connection epoch. Requests are bounded, validated and audited. Normal player accounts cannot use these controls; the gameplay socket has no development action variant. Camera and geometry display remain local presentation. See the [closed development request contract](protocol.md#development-requests).

## Production

Do not expose the development launcher or its bootstrap accounts. Production runs the runtime behind an HTTPS/WSS reverse proxy with the static online shell and immutable assets on the **same origin**. Proxy `/api/` including WebSocket upgrades; preserve the browser Origin and cookies. TLS termination belongs at that trusted ingress; do not expose the plaintext upstream publicly.

Build the production online browser separately:

```sh
bun run client:build:online
```

This builds with development mutation UI disabled. Deploy `client/online.html`, its styles, `client/dist/online/` outputs and the verified `/generated/` content. Serve the atlas worker at `/dist/atlas-worker.js` by an explicit alias or copy from `client/dist/online/atlas-worker.js`; the loopback development server provides this mapping, but a production static host must configure it. Keep `/api/` network-only and do not install the offline service worker for this shell.

Configuration:

| Variable                     | Purpose                                                                                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | Required PostgreSQL connection; use production credentials and managed persistence/backups.                                                                                                                    |
| `OPENMS_ORIGIN` | Required exact public HTTPS origin in production, without a path; development defaults to `http://127.0.0.1:3102` and accepts its exact loopback aliases on the same scheme/port as described above. LAN origins remain exact. |
| `OPENMS_HOST`, `OPENMS_PORT` | Runtime listener in both modes; defaults to loopback and `3200`. |
| `OPENMS_CONTENT_ROOT`        | Validated generated catalog/content directory; defaults to `client/public/generated`.                                                                                                                          |
| `OPENMS_RULES_HASH`          | Required production pin: exactly 64 lowercase hexadecimal SHA-256 characters, compared with the verified runtime rules identity before listening. A matching hash is not a review or proof of native behavior. |
| `OPENMS_MODE` | Process-only mode; explicit `development` enables development admission on the configured listener. `NODE_ENV=production` forces production regardless of this value. Never deploy the development launcher. |

With production environment values provisioned securely and the matching shell/content deployed, launch the runtime directly:

```sh
bun run server:start
```

Do not use `server:dev` in production; it explicitly selects development mode and bootstraps credentials.

Production uses Secure HttpOnly SameSite cookies, exact-origin admission, CSRF protection and one-use play tickets. The development endpoint is absent there, not merely hidden in the UI. Pin and review rules/content versions, provision accounts deliberately, apply migrations, protect database credentials, set up backups and recovery, and run the [adversarial and durability gates](protocol.md#implementation-order-and-required-proof) before release. Unsupported controllers/content must fail admission, not silently substitute invented behavior. Current development policies are not automatically approved production rules.

### Current coverage limits

The [online/offline parity inventory](offline-parity.md) maps shared presentation and rules to server owners, records the NPC/quest corrections and distinguishes inspected implementation from focused browser proof. Online adapters include storage, cash catalog commerce, guild/alliance and family; the former exclusions here were stale. Skills use the shared `SkillSystem` controller families through a paid server phase, rather than the former four-skill whitelist. NPC ambient actions and speech now use a shared server-selected clock and authored line.

Authority is not blanket content coverage. Learned skills and original artwork still require an admitted controller, prerequisites, costs, cooldowns and applicable movement/weapon conditions. Missing scripted portal routes, consumable revival controllers and other unsupported content fail admission. Development/reference combat, mob, drop, progression and economic policies remain distinct from missing original-server rules. The parity inventory is not a claim that every controller or transaction was exercised online.

Field admission rejects missing active-mob incoming statistics and unsupported/disease mob attack controllers rather than skipping authoritative damage. Contact only considers active, nonfaulted mobs; supported authored attacks retain bounded clocks/areas and their impact delay. Evasion/nonpositive results publish visible zero-damage MISS events, with the same 1500 ms repeat-hit protection as positive hits and no recoil. Magic Guard separates HP/MP loss from the displayed generated magnitude. No minimum-damage floor is invented; original server-policy fidelity remains unproved.

## Protocol {#protocol-proposal}

The [authoritative browser-game protocol](protocol.md) defines closed client intents, server observations, motion checkpoints, field generations, economic receipts and bounded recovery. Its historical proposal anchor is retained for existing links. Required proof is separate from implemented handlers.

## Reference data

The authorized Cosmic checkout is an external **server reference**, not original Nexon source. `MAPLE_SERVER_REFERENCE` selects that checkout; [input provenance](../inputs.md) records the distinction.

```sh
bun tools/openms.js data server --help
bun tools/openms.js data server --server-root /path/to/Cosmic --output /path/to/generated
```

[`client/tools/server-data.js`](../../client/tools/server-data.js) reads bounded SQL/schema records and script metadata into immutable content. It does not start Cosmic, execute its SQL or supply its account service. See [reference-data coverage](../offline-data.md) for supported records and excluded bootstrap credentials.

## Authority boundaries

- Online state belongs to the server and PostgreSQL. Browser IndexedDB [saves](../offline-saves.md) remain offline-only.
- Online peer entities are server observations; the [offline UI](../ingame-ui.md) and [local character controls](../offline-profile.md) do not become a backend API.
- Supported authored NPC/quest programs require bounded authoritative adapters. Unsupported behavior stays unavailable: [quest provenance](../ingame-quests.md) and [portal evidence](../ingame-portals.md).
- Shared recovered motion does not establish original server damage, AI, drops, progression or economic rules. Development/reference policy is versioned separately.
- Prediction needs the explicit server-only [motion checkpoint](protocol.md#motion-checkpoints), not a client position upload. Same-kernel imports alone do not prove complete rewind equivalence.
- See the [integration contract](../offline-integration-contract.md), [evidence boundaries](../validation-method.md#evidence-boundaries) and [JavaScript coding policy](../coding-style.md).
