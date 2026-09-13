# Run the client

The browser client uses JavaScript, JSDoc, Bun, and PixiJS. Offline play runs locally; online play shares presentation and gameplay rules with the [authoritative Bun server](server/index.md). The supported target is a desktop viewport of **800 × 600 or larger**.

## Run

From the repository root, install dependencies and extract the original assets once:

```sh
bun install --frozen-lockfile
MAPLE_ASSETS=../Maplestory-Client MAPLE_SERVER_REFERENCE=../MapleStory-Server bun tools/openms.js extract
```

Set `MAPLE_ASSETS` to the original client and `MAPLE_SERVER_REFERENCE` to the supplied Cosmic checkout. The paths above match this workspace; the converter's legacy fallback is `/Users/k/Development/tensorfish/Cosmic`. See [inputs and provenance](inputs.md) and `bun tools/openms.js extract --help` for source overrides. Original binaries and generated artwork are not included in Git.

Then start the mode you need:

| Mode          | Command                      | Default URL             | State owner               |
| ------------- | ---------------------------- | ----------------------- | ------------------------- |
| Offline       | `bun run client:dev:offline` | `http://127.0.0.1:3100` | Local IndexedDB profile   |
| Online        | `bun run client:dev:online`  | `http://127.0.0.1:3102` | Bun server and PostgreSQL |
| Documentation | `bun run dev:docs`           | `http://localhost:5173` | Markdown in `docs/`       |

Extraction is incremental. Reuse the successful extraction receipt for unchanged assets; runtime-only edits do not require full conversion. See [asset delivery](asset-delivery.md).

## Online development

[Start PostgreSQL and the backend](server/index.md#online-development), then run the online client in another terminal:

```sh
bun run server:dev
bun run client:dev:online
```

| Account  | Password   | Permission                |
| -------- | ---------- | ------------------------- |
| `admin`  | `password` | Development administrator |
| `player` | `password` | Ordinary player           |

`OPENMS_DEV_PASSWORD` can override the bootstrap password. Each development launch restores these credentials. Both launchers log startup, requests, refusals and connection events to stdout; see [troubleshooting](server/index.md#troubleshooting) for origin, cookie and content-identity failures.

Register creates a normal player account. Character creation follows **name → appearance → starting stats**. The server issues each dice result and validates the selected roll on creation. [Login and creation recovery](login-creation-recovery.md) records the exact original assets and placements.

One game tab may own a browser storage origin at a time. Use separate browser profiles or isolated contexts for two-player checks. [Session ownership](browser-session.md) explains the boundary. Online play does not import an offline save or keep earning progress while disconnected.

## Controls

Click empty map space to focus the game. KeyConfig can change these recovered defaults.

| Action                      | Default input                        |
| --------------------------- | ------------------------------------ |
| Move / climb / portal       | Arrow keys; Up at a supported portal |
| Jump / drop through         | Alt / Down + Alt                     |
| Attack / pick up            | Control / Z                          |
| Item / Equip / Stat / Skill | I / E / S / K                        |
| MiniMap / Quest / Set Key   | M / Q / Backslash                    |
| Chat / close top window     | Enter / Escape                       |

The [UI guide](ingame-ui.md) covers focus, original windows, tooltips and modal rules. The [inspection guide](inspection-tools.md) covers World, Character, Diagnostics, Agent and Settings; online mutations require server authorization. Agent control is opt-in. Audio unlocks after a trusted pointer or key input; saved mute/volume preferences are retained.

## Structure

| Code                                                                                            | Responsibility                                                 | Contract                                       |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| `client/src/main.js`, `ingame.js`                                                               | Offline integration and presentation ownership                 | [Integration](reconstruction-contract.md)      |
| `client/src/online/`                                                                            | Transport, prediction, native UI adapters and received state   | [Protocol](server/protocol.md)                 |
| `client/src/physics/`, `shared/motion.js`                                                       | Shared 30 ms movement and checkpoints                          | [Movement parity](movement-parity.md)          |
| `client/src/ui/`, `input/`, `rendering/`, `audio/`                                              | Original interface, input, scene and audio                     | [UI](ingame-ui.md) · [Streaming](streaming.md) |
| `client/src/character/`, `combat/`, `skills/`, `items/`, `quests/`, `npc/`, `world/`, `social/` | Shared gameplay consumers and local authorities                | [Feature inventory](server/offline-parity.md)  |
| `client/src/profile/`                                                                           | Schema 8 validation, migrations and offline transactions       | [Saves](offline-saves.md)                      |
| `client/src/assets/`, `client/tools/`                                                           | Bounded decoding, extraction, development and validation tools | [Asset evidence](asset-evidence.md)            |
| `server/src/`, `server/sql/`, `shared/`                                                         | Online authority, persistence and closed protocol              | [Server](server/index.md)                      |

`client/public/generated/` and `client/dist/` are generated and ignored. Asset caches and character saves have separate ownership; deleting browser site data can remove both.

## Evidence and results

Use the [gameplay guide](offline-gameplay.md) for implemented local behavior, [online/offline coverage](server/offline-parity.md) for authority and gaps, and [validation results](validation.md) for scoped proof. Recovered motion uses the same **30 ms** quantum in both modes; 100% walking uses **125 px/s**, with the original jump coefficient **555 px/s** before gravity integration.

Choose checks from the [validation method](validation-method.md), rather than running every scenario for each edit. `bun tools/openms.js scenario list` lists available native cases without opening a browser.

## Documentation conventions

The [documentation guide](documentation-guide.md) owns writing, navigation, diagrams and maintenance. The [integration contract](reconstruction-contract.md) owns subsystem boundaries; [coding style](coding-style.md) applies to every handwritten JavaScript change. Historical reports retain their measured source identities in the [archive](archive/index.md).

## Documentation site

```sh
bun run dev:docs
bun run docs:build
bun run docs:preview
```

The site builds without game assets. See [site maintenance](documentation-guide.md#site-and-diagrams) for routes, Mermaid rendering and checks.
