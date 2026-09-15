# openms.dev

NOTE: THIS PROJECT IS STILL IN DEVELOPMENT PHASE AND WILL UNDERGO SIGNIFICANT CHANGES.

A browser reconstruction of MapleStory v83, built with JavaScript, PixiJS, Bun and PostgreSQL. It uses original WZ artwork and recovered client behavior, with [modern combat formulas](docs/combat-formulas.md) applied to the v83 content.

## Quick Start

### 1. Install the prerequisites

You need **Bun**, **Git**, **Podman**, a **Compose provider**, `curl` and `unzip`. Use a desktop browser with a viewport of at least 800 × 600.

On macOS with [Homebrew](https://brew.sh/):

```sh
brew install oven-sh/bun/bun podman docker-compose git
podman machine init
podman machine start
```

Skip `podman machine init` if you already have a machine, and skip `start` if it is running. For other platforms, follow the [prerequisite instructions](docs/index.md), then continue below in a Unix-style shell.

### 2. Clone and install

```sh
git clone https://github.com/tensorfish/openms.git
cd openms
bun install --frozen-lockfile
cp -n .env.server.example .env.server
cp -n .env.client.example .env.client
cp -n .env.studio.example .env.studio
```

Run the remaining commands from this **`openms` directory**. The copy commands create local settings without overwriting existing files. Edit `.env.server`, `.env.client` and `.env.studio` as needed; Git ignores them and `.env`. Only the `.example` templates are tracked.

### 3. Download and prepare the game assets

```sh
curl --fail --location --output ../Maplestory-Assets.zip \
  http://bucket.openms.dev/Maplestory-Assets.zip
unzip -n ../Maplestory-Assets.zip -d .. -x '__MACOSX/*'
bun extract --assets [DIR]
```

Wait for **`Extraction succeeded`** before continuing, might take a few minutes, this is to optimize the assets for the web. Extraction writes the prepared content to `client/public/generated/`. If you already have the original assets, point `--assets` at the directory containing the WZ files.

Gameplay definitions and reference SQL are included in the repository. No separate server-source checkout is needed. Reuse the extracted assets on later launches.

### 4. Start the database

```sh
podman compose -f infra/compose.yaml up -d --build --wait --wait-timeout 90
bun run migrate --database-url postgres://openms:openms_local_only@127.0.0.1:55432/openms
```

PostgreSQL keeps your saved characters in a persistent volume. Run the migration command on first setup and after SQL updates; previously applied migrations are skipped.

### 5. Start the game and sign in

**Terminal 1 — server:**

```sh
bun run server:dev
```

Wait for **`authoritative server ready`** and leave this terminal running.

**Terminal 2 — client:** open another terminal in the same `openms` directory, then run:

```sh
bun run client:dev
```

Wait for **`online client ready`**, then open **[the game](http://127.0.0.1:3102)**. Sign in and select the starter character:

| Account  | Password   | Access                         |
| -------- | ---------- | ------------------------------ |
| `player` | `password` | Play the game                  |
| `admin`  | `password` | Play and use development tools |

These accounts are created by `server:dev` for local development. Click empty map space to focus the game: **arrow keys** move, **Alt** jumps, **Control** attacks, **Z** picks up items, and **I** opens inventory. [All controls](docs/development.md#controls).

**Next launch:** start the Podman machine if needed, start the database with the Compose command above, then run the server and client in separate terminals. After game-code changes, restart both processes and reload the browser. See [troubleshooting](docs/development.md#troubleshooting) if startup or login fails.

### Production

Run `bun run server:prod` and `bun run client:prod` in separate terminals. The client command builds without the development sidebar and keeps serving the files at `http://127.0.0.1:3102` by default. Configure the production database and public routing first; follow the [production setup](docs/development.md#production). Production server startup does not create or reset admin accounts.

### Optional: open Studio

Keep the database and server running. In another terminal:

```sh
bun run studio:dev
```

Open **[Studio](http://127.0.0.1:3103)** and sign in with `admin` / `password` to create custom maps, mobs and quests. Follow the [custom content guide](docs/custom-content.md) to publish and activate them.

## Current features

The tables describe implemented features. Supported content varies by skill, quest, item and map; see [detailed coverage](docs/server/offline-parity.md) and [validation results](docs/validation.md).

### Client

| Feature                    | Current support                                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original visuals and audio | WZ map layers, character equipment, NPCs, monsters, UI artwork, animations, music and sound effects.                                                                    |
| Login and characters       | Registration, login, character selection, and character creation with appearance choices and server-issued starting-stat rolls.                                         |
| Movement                   | Walking, jumping, climbing, dropping through platforms and supported portals. Local character coordinates and immediate airborne movement skills, including Flash Jump. |
| Combat presentation        | Attacks, supported skill effects, projectiles, summons, damage numbers, status effects and knockback; per-pile Meso Explosion animations.                               |
| Character windows          | Inventory, equipment, stats, skills, AP/SP allocation, skill macros and item tooltips.                                                                                  |
| NPCs and quests            | Dialogue choices, quest markers, journal, tracker, shops and storage for supported content.                                                                             |
| Trading and markets        | Player trade, Cash Shop, locker, gifts and Maple Trading System (MTS) interfaces. External payment services are not included.                                           |
| Multiplayer and social UI  | Remote players, chat, whispers, buddies, blacklist, parties, guilds, alliances, family and messenger.                                                                   |
| Navigation and preferences | MiniMap, WorldMap, quick slots, configurable keys, volume/mute settings and saved options.                                                                              |
| Pets and mounts            | Supported pet activation, hunger, hatching and mount presentation; some lifecycle actions remain incomplete.                                                            |
| Development tools          | World/character inspection, map search, character presets and authorized development controls.                                                                          |

### Server

| Feature                    | Current support                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts and persistence   | Authentication, character rosters, saved progress and PostgreSQL-backed transactions with explicit schema migrations.                                                                       |
| Shared world               | Field membership, remote-player updates, NPC ambient actions/speech, and connection recovery.                                                                                               |
| Movement validation        | Observes client-owned character coordinates, checks movement against context, and disconnects sufficiently suspicious movement. Controls exceptional relocations such as field transitions. |
| Combat                     | Validates skill eligibility, costs and timing; calculates damage using modern formulas; owns HP, statuses, supported monster behavior and rewards.                                          |
| Party gameplay             | Party membership, supported party buffs/healing, shared kill credit and rewards. Shared Door access remains incomplete.                                                                     |
| Items and mesos            | Inventory/equipment, supported item use and enhancement, drops, pickup and committed meso consumption.                                                                                      |
| NPCs and quests            | Supported dialogue programs, quest eligibility/progress, timers, rewards, shops and storage. Unsupported script operations are refused.                                                     |
| Trading and economy        | Atomic player trades; Cash Shop catalog/locker/gifts; MTS fixed-price sales, wanted orders, auctions, carts and item custody.                                                               |
| Social systems             | Chat recipient routing, buddies, blacklist, fame, parties, guilds/alliances, boards, family and messenger.                                                                                  |
| Field interactions         | Supported portals, revival, seats, expressions, pets and ordinary reactor transitions/rewards.                                                                                              |
| Custom content             | PostgreSQL-backed map, mob and quest drafts, immutable revisions, PNG uploads, asset-build pins and activated world releases.                                                               |
| Development administration | Developer-only world and character changes, monster spawning and diagnostics through validated server requests.                                                                             |

Remaining gaps include parts of quest/job progression, special monster AI and bosses, complex event scripts, pet equipment, marriage, and external payment/channel services. See the [remaining-work inventory](docs/server/remaining-work.md).

## Repository packages

The root package manages four Bun workspaces:

| Package           | Location                        | Purpose                                                                                         |
| ----------------- | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `openms.dev`      | [Repository root](package.json) | Workspace dependencies, shared commands, migrations and documentation tooling.                  |
| `@openms/client`  | [client/](client/)              | PixiJS browser game, WZ extraction, rendering, input, audio and online presentation.            |
| `@openms/server`  | [server/](server/)              | Bun HTTP/WebSocket server, gameplay authority, accounts and persistence.                        |
| `@openms/content` | [content/](content/)            | Content definitions, original-asset resolution, PostgreSQL revisions and world-release storage. |
| `@openms/studio`  | [studio/](studio/)              | Browser editor for custom maps, mobs and quests, with previews and publishing.                  |

Supporting directories: [shared/](shared/) contains common protocol, movement and combat rules; [infra/](infra/) contains PostgreSQL setup, migrations and gameplay inputs; [tools/](tools/) contains repository commands; [docs/](docs/) contains guides and recovered behavior evidence.

## Documentation

[Documentation site](https://docs.openms.dev/) · [Quick Start](docs/index.md) · [Server](docs/development.md#server) · [Client](docs/development.md#client) · [Custom content](docs/custom-content.md) · [Validation](docs/validation-method.md)

## License

Copyright (C) 2026 Tensorfish

OpenMS is free software: you can redistribute it and/or modify it under the terms of the [GNU General Public License](LICENSE) as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

OpenMS is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the [GNU General Public License](LICENSE) for more details.

MapleStory and its original artwork, audio and data remain the property of their respective owners. This license covers the OpenMS source code, not those assets.
