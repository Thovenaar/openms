# openms.dev server

The Bun server owns online characters, field simulation, gameplay admissions and PostgreSQL transactions. The [online browser](../README.md#online-development) sends inputs and closed intents; it does not upload an offline save or choose authoritative results. The [offline client](../README.md) remains independent.

This is a development/reference rules runtime, **not an original Nexon server reconstruction or a production certification**. The [protocol](protocol.md) records the wire contract and required safety properties. [Measured validation](../validation.md) is the authority for what has actually been exercised; the presence of handlers is not evidence that every action, field or failure mode has passed.

## Workspace

[`server/package.json`](../../server/package.json) declares the private Bun workspace. Runtime ownership is split between HTTP/session admission, immutable content, the field owner, action/interaction adapters and PostgreSQL persistence. Shared protocol validation and fixed-step motion live in `shared/`; browser rendering remains under `client/`.

```sh
bun install --frozen-lockfile
```

## Online development

Prepare the original assets and authorized reference data using the [client extraction setup](../README.md#run), then run these in separate terminals from the repository root:

```sh
bun run server:dev
bun run client:dev:online
```

Open **http://127.0.0.1:3102**. The browser development server builds the online shell and proxies `/api/` HTTP/WebSocket traffic to the Bun runtime on loopback port **3200**. Restart after source changes. It serves already-generated immutable assets; it does not run extraction or the offline release-verification pipeline on every launch.

The launcher creates `dev_developer` and `dev_player` if absent and resets their passwords on each launch. `OPENMS_DEV_PASSWORD` supplies an explicit password for both; otherwise generated passwords are printed only in the terminal. `OPENMS_PG_BIN` selects the PostgreSQL binary directory and `OPENMS_PG_PORT` selects the owned database listener (default `55432`). This bootstrap applies even when `DATABASE_URL` is supplied, which is why the launcher must only point at a dedicated development database.

The server requires PostgreSQL. `DATABASE_URL` selects an existing database; without it the development launcher owns a local PostgreSQL cluster under `server/.cache` when PostgreSQL tools are installed. It must fail explicitly if those prerequisites are absent—there is no in-memory economy fallback. Use a dedicated development database, never production data. The launcher prints development credentials; use them in the Win95 online sign in window. Credentials are server-side, not compiled into the browser bundle.

Accounts are also created at `POST /api/v1/accounts` from that same window. Sign in and sign up both require a single-use hashcash challenge from `GET /api/v1/challenge` (default 15 leading zero bits, `OPENMS_POW_BITS` overrides within 8..24) so credential endpoints stay expensive for automated spam; the server consumes the challenge before any password work and never distinguishes an expired, reused or wrong challenge. Registration provisions one default level-1 beginner character in the same durable operation, so a new account can enter the world immediately. After authentication the client shows the account's characters in a spotlight carousel; entering the world takes the selected character directly—there is no world or channel selection. An account can also create further characters from the same window: `POST /api/v1/characters` accepts a `4..13` name, four stats of `4..13` totalling 25 (the packaged baseline total) and packaged catalog cosmetics, then inserts the level-1 beginner atomically under the account row lock.

The online shell does not open `ProfileStore`, import IndexedDB characters, install an offline service worker or merge disconnected earnings. Connection loss freezes online admission. Reconnect uses a fresh one-use ticket and server-owned state, not an offline continuation.

Authentication sessions and one-use tickets are process-local (session lifetime12h; ticket lifetime30s). Restart requires login again; durable character/economy recovery is separate. The reconnect grace is30s, not offline permission or invulnerability.

### Development controls

Map search/Go, character presets and scalar edits, monster selection/spawn, pause/step and physics changes are **requests to the authority**, not local gameplay setters. `POST /api/v1/development` requires explicit development mode, developer role, session, CSRF proof, exact loopback origin and the current connection epoch. Requests are bounded, validated and audited. Normal player accounts cannot use these controls; the gameplay socket has no development action variant. Camera and geometry display remain local presentation. See the [closed development request contract](protocol.md#development-requests).

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
| `OPENMS_ORIGIN`              | Required exact public HTTPS origin in production, without a path; development defaults to `http://127.0.0.1:3102`.                                                                                             |
| `OPENMS_HOST`, `OPENMS_PORT` | Runtime listener; defaults to loopback and `3200`.                                                                                                                                                             |
| `OPENMS_CONTENT_ROOT`        | Validated generated catalog/content directory; defaults to `client/public/generated`.                                                                                                                          |
| `OPENMS_RULES_HASH`          | Required production pin: exactly 64 lowercase hexadecimal SHA-256 characters, compared with the verified runtime rules identity before listening. A matching hash is not a review or proof of native behavior. |
| `OPENMS_MODE`                | Only explicit `development` enables the loopback development namespace. Leave it unset for production; do not deploy the development launcher.                                                                 |

With production environment values provisioned securely and the matching shell/content deployed, launch the runtime directly:

```sh
bun server/src/index.js
```

Do not use `server:dev` in production; it explicitly selects development mode and bootstraps credentials.

Production uses Secure HttpOnly SameSite cookies, exact-origin admission, CSRF protection and one-use play tickets. The development endpoint is absent there, not merely hidden in the UI. Pin and review rules/content versions, provision accounts deliberately, apply migrations, protect database credentials, set up backups and recovery, and run the [adversarial and durability gates](protocol.md#implementation-order-and-required-proof) before release. Unsupported controllers/content must fail admission, not silently substitute invented behavior. Current development policies are not automatically approved production rules.

### Current coverage limits

Authority is not blanket controller coverage. The current field adapter rejects active skill casts that lack a headless authoritative cast controller; a learned skill record or original animation does not implement its gameplay. Scripted portal routes and consumable revival also require explicit controllers and are rejected when unavailable. The v1 protocol excludes guild administration, family, cash commerce, storage, mail and markets. UI availability must follow these admissions, not invent local outcomes. Development/reference combat, mob, drop and progression policies remain distinct from missing original-server rules.

The current headless skill adapter admits the Power Strike/Slash Blast variants `1001004,1001005,11001002,11001003`; teleport IDs `2101002,2201002,2301001,12101003` from the shared teleport rules; and self-state families `derived-stats,hyper-body,maple-warrior,echo,booster,speed-infusion,invincible,magic-guard` from the supported skill-state catalog. Each still requires learned rank, authored content, prerequisites, costs, cooldowns and applicable movement/weapon conditions. Other target/form/script controllers remain explicitly unavailable. This is an implementation inventory, not a claim that each controller was exercised online.

Field admission rejects missing active-mob incoming statistics and unsupported/disease mob attack controllers rather than skipping authoritative damage. Supported authored attacks retain bounded clocks/areas; original server-policy fidelity remains unproved.

## Protocol {#protocol-proposal}

The [authoritative browser-game protocol](protocol.md) defines closed client intents, server observations, motion checkpoints, field generations, economic receipts and bounded recovery. Its historical proposal anchor is retained for existing links. Required proof is separate from implemented handlers.

## Reference data

The authorized Cosmic checkout is an external **server reference**, not original Nexon source. `MAPLE_SERVER_REFERENCE` selects that checkout; [input provenance](../inputs.md) records the distinction.

```sh
bun run data:server --help
bun run data:server --server-root /path/to/Cosmic --output /path/to/generated
```

[`client/tools/server-data.js`](../../client/tools/server-data.js) reads bounded SQL/schema records and script metadata into immutable content. It does not start Cosmic, execute its SQL or supply its account service. See [reference-data coverage](../offline-data.md) for supported records and excluded bootstrap credentials.

## Authority boundaries

- Online state belongs to the server and PostgreSQL. Browser IndexedDB [saves](../offline-saves.md) remain offline-only.
- Online peer entities are server observations; the [offline UI](../ingame-ui.md) and [local character controls](../offline-profile.md) do not become a backend API.
- Supported authored NPC/quest programs require bounded authoritative adapters. Unsupported behavior stays unavailable: [quest provenance](../ingame-quests.md) and [portal evidence](../ingame-portals.md).
- Shared recovered motion does not establish original server damage, AI, drops, progression or economic rules. Development/reference policy is versioned separately.
- Prediction needs the explicit server-only [motion checkpoint](protocol.md#motion-checkpoints), not a client position upload. Same-kernel imports alone do not prove complete rewind equivalence.
- See the [integration contract](../offline-integration-contract.md), [evidence boundaries](../validation-method.md#evidence-boundaries) and [JavaScript coding policy](../coding-style.md).
