# openms.dev server

The server workspace is reserved; **no backend is implemented**. The playable application is the [offline client](../README.md). This section documents the actual workspace and reference-data boundaries, not a proposed server architecture.

## Workspace

[`server/package.json`](../../server/package.json) declares the private Bun workspace `@openms.dev/server` with ES modules. It currently contains no runtime entry point, server scripts, or dependencies.

Install the repository workspaces from the project root:

```sh
bun install --frozen-lockfile
```

There is no `dev:server` command or backend listener. `bun run dev:client:offline` serves the offline browser application; `bun run dev:docs` serves this documentation. Neither starts a gameplay server.

## Reference data

The authorized Cosmic checkout is an external **server reference**, not this workspace's implementation and not original Nexon client source. `MAPLE_SERVER_REFERENCE` selects that checkout; [input provenance](../inputs.md) records the original/reference distinction.

Current extraction lives in [`client/tools/server-data.js`](../../client/tools/server-data.js) and supports:

```sh
bun run data:server --help
bun run data:server --server-root /path/to/Cosmic --output /path/to/generated
```

The converter reads bounded SQL/schema records and script metadata, producing content-addressed data for the offline client. It does not start Cosmic, execute SQL, or supply an account/database service. See the client's [reference-data contract and coverage](../offline-data.md) for supported records, excluded bootstrap credentials, limits, and exact output identities.

## Authority boundaries

- Character saves belong to browser IndexedDB, not a backend database: [persistence contract](../offline-saves.md).
- Local peers and social interactions are explicit offline simulation, not network connections: [in-game UI](../ingame-ui.md) and [character controls](../offline-profile.md).
- Supported authored NPC and portal programs execute through bounded local adapters. Unsupported server behavior remains unavailable: [quests](../ingame-quests.md) and [portals](../ingame-portals.md).
- Recovered client behavior does not establish original server rules or Windows-runtime parity: [integration contract](../offline-integration-contract.md) and [validation boundaries](../validation-method.md#evidence-boundaries).

The [shared JavaScript coding policy](../coding-style.md) applies to this workspace as well. Any implemented backend must be documented with its actual commands, interfaces, ownership, and executed evidence; the current client contracts must not be presented as an existing server API.
