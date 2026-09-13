# openms.dev documentation

openms.dev reconstructs an original-asset browser client with JavaScript, JSDoc, Bun, and PixiJS. Documentation is organized by service: the offline/online **Client** and the authoritative Bun **Server**. Recovered behavior, development/reference rules, measured results, and missing capabilities remain explicitly distinguished.

## Client

[Open the client documentation](README.md) for independent offline setup (`bun run client:dev:offline`) and [online development](README.md#online-development) (`bun run client:dev:online`).

- **Architecture:** [subsystem contracts](reconstruction-contract.md), [scene and inspection APIs](scene-contract.md), [agent experiments](agent-interface.md), and [offline integration](offline-integration-contract.md).
- **Assets and streaming:** [decoding evidence](asset-evidence.md), [inventory](ingame-inventory.md), [delivery](asset-delivery.md), and [streaming](streaming.md).
- **Physics:** [motion evidence](physics-evidence.md), [options](physics-options.md), [refinements](physics-refinements.md), [geometry](hitboxes.md), and [avatar actions](avatar-actions.md).
- **UI:** [login and creation recovery](login-creation-recovery.md), [in-game windows](ingame-ui.md), [binding actions](offline-binding-actions.md), and [audio/effects](ingame-audiovisual.md).
- **Offline gameplay:** [scope and acceptance](offline-gameplay.md), [combat](offline-combat.md), [skills](skills.md), [quests](ingame-quests.md), [character development](offline-profile.md), [saves](offline-saves.md), and [portals](ingame-portals.md).
- **Evidence and validation:** [original client findings](client-evidence.md), [Windows reference gaps](windows-reference-captures.md), [validation procedure](validation-method.md), and [measured results](validation.md).

## Server

[Open the server documentation](server/index.md) for workspace status, reference-data inputs, and authority boundaries.

- **Workspace:** the private Bun server package and its current implementation status.
- **Reference data:** the authorized Cosmic checkout and the client-side conversion tools that consume it.
- **Authority boundaries:** online observations and intent-only commands stay separate from local peers and IndexedDB saves.
- **Protocol:** [authoritative web protocol](server/protocol.md), with server-owned transitions, transactional economy and a separately authenticated development endpoint.

Run `bun run server:dev` for the loopback server and `bun run client:dev:online` for the original-asset online browser. PostgreSQL and extracted content are required. See [setup and production gates](server/index.md); development/reference policies are not original-server fidelity or measured security guarantees.

The [online/offline parity inventory](server/offline-parity.md) maps native features to server ownership and records NPC/quest verification. [Login recovery](login-creation-recovery.md) documents the selected-character spotlight, banner, creation layout and dice evidence.

[Browser session ownership](browser-session.md) allows one game tab per shared browser storage origin, for both clients.

## Project guidance

Follow the [JavaScript coding style](coding-style.md) and [input provenance](inputs.md). Authoritative Markdown and raw evidence stay at their existing repository paths; the site publishes client pages under `/client/` and server pages under `/server/`. Repository-file links continue to target the actual Git remote. Historical captures, identities, and benchmark counts are not renamed or reinterpreted.

## Run this site

From the repository root:

```sh
bun install --frozen-lockfile
bun run dev:docs
```

Offline and documentation development commands retain `dev:<service>[:mode]`; online entry points are `server:dev` and `client:dev:online`. For a documentation production build and local inspection, use `bun run docs:build`, then `bun run docs:preview`. The site is rooted in `docs/`; generated output and cache stay under `docs/.vitepress/`.
