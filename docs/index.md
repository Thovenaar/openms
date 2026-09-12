# openms.dev documentation

openms.dev reconstructs an original-asset browser client with JavaScript, JSDoc, Bun, and PixiJS. Documentation is organized by service: the implemented offline **Client** and the reserved **Server** workspace. Recovered behavior, local policy, measured results, and missing capabilities remain explicitly distinguished.

## Client

[Open the client documentation](README.md) for setup and `bun run dev:client:offline`.

- **Architecture:** [subsystem contracts](reconstruction-contract.md), [scene and inspection APIs](scene-contract.md), [agent experiments](agent-interface.md), and [offline integration](offline-integration-contract.md).
- **Assets and streaming:** [decoding evidence](asset-evidence.md), [inventory](ingame-inventory.md), [delivery](asset-delivery.md), and [streaming](streaming.md).
- **Physics:** [motion evidence](physics-evidence.md), [options](physics-options.md), [refinements](physics-refinements.md), [geometry](hitboxes.md), and [avatar actions](avatar-actions.md).
- **UI:** [in-game windows](ingame-ui.md), [binding actions](offline-binding-actions.md), and [audio/effects](ingame-audiovisual.md).
- **Offline gameplay:** [scope and acceptance](offline-gameplay.md), [combat](offline-combat.md), [skills](skills.md), [quests](ingame-quests.md), [character development](offline-profile.md), [saves](offline-saves.md), and [portals](ingame-portals.md).
- **Evidence and validation:** [original client findings](client-evidence.md), [Windows reference gaps](windows-reference-captures.md), [validation procedure](validation-method.md), and [measured results](validation.md).

## Server

[Open the server documentation](server/index.md) for workspace status, reference-data inputs, and authority boundaries.

- **Workspace:** the private Bun server package and its current implementation status.
- **Reference data:** the authorized Cosmic checkout and the client-side conversion tools that consume it.
- **Authority boundaries:** why local peers, IndexedDB saves, and supported offline scripts are not a network backend.
- **Proposal:** [authoritative web protocol](server/protocol.md), with intent-only commands, shared rules, server-owned transitions and transactional economy.

There is no implemented backend or server development command. Server-reference data does not imply an operating server.

## Project guidance

Follow the [JavaScript coding style](coding-style.md) and [input provenance](inputs.md). Authoritative Markdown and raw evidence stay at their existing repository paths; the site publishes client pages under `/client/` and server pages under `/server/`. Repository-file links continue to target the actual Git remote. Historical captures, identities, and benchmark counts are not renamed or reinterpreted.

## Run this site

From the repository root:

```sh
bun install --frozen-lockfile
bun run dev:docs
```

Development commands follow `dev:<service>[:mode]`. For a production build and local inspection, use `bun run docs:build`, then `bun run docs:preview`. The site is rooted in `docs/`; generated output and cache stay under `docs/.vitepress/`.
