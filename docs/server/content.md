# Custom content: `@openms/content`

`content/` is the private Bun workspace package for database-backed map, mob, quest, monster-drop-table and NPC-conversation authoring. It provides an original-asset registry, closed authoring documents, revision storage and publication compilers. The server exposes it through authenticated `/api/v1/custom-content/` routes. The [`@openms/studio` dashboard](studio.md) runs on its own origin (default `http://127.0.0.1:3103`), serving previews and proxying authoring requests independently of the game client.

Publishing creates a validated, immutable private runtime revision. A developer can explicitly activate selected publications as a shared-world release. The server and clients load that release from PostgreSQL alongside the unchanged extracted catalog. Authoring rewards never grants rewards to a player's live character; normal quest transactions remain authoritative.

## Storage and ownership

| Table                 | Contents                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `content_asset_build` | Immutable original catalog snapshots, build IDs and catalog hashes                                           |
| `custom_content`      | Owner/project/content identity, append-only draft revisions, definitions and immutable compiled publications |
| `custom_asset_blob`   | Owner-scoped, content-addressed PNG uploads, stored as their exact bytes                                     |
| `content_world_release` | Immutable release selection, dependency closure, catalog overlay and resource hashes |
| `content_world_resource` | Immutable compiled JSON and promoted PNG bytes used by shared releases |
| `content_world_head` | One transactional pointer to the selected shared-world release |

The package's [authoring migration](../../infra/sql/005-content.sql), [world migration](../../infra/sql/006-world.sql) and [content-kind migration](../../infra/sql/007-content-kinds.sql) are applied explicitly by `bun run migrate --database-url URL`, with history in the PostgreSQL `migrations` table. They create their own tables and runtime-ID sequence; they do not modify original asset files or original reference-data tables. Uploads, definitions, modified map regions and compiled records are all stored in PostgreSQL. `client/public/generated/` remains an input.

The authenticated account owns every read and write. Projects are namespaces within an account, not collaborative teams. The API derives ownership from the session; caller-supplied owner IDs are rejected. Ordinary accounts may author private content without developer gameplay privileges. POST requests require the accepted Origin and session CSRF token; mutations recheck session admission inside the committing transaction. Image and publication responses use `no-store`.

## Identity, updates and publication

An original reference is `{ source: "original", kind, id }`. IDs are strings: maps use nine digits, numeric mob/item/quest/NPC IDs use unpadded decimal strings. NPCs and scenery entities also require the source `mapId`. Names are search labels and never bind dependencies.

A custom reference is `{ source: "custom", kind, id, revision }`. It resolves inside the current owner's project. Publication requires referenced custom revisions to be published against the same original build. The compiler records their publication hashes and rejects cycles or conflicting revisions of the same dependency.

Every definition has a `baseAssetBuildId`. Startup retains the current catalog under that ID. Re-extraction with a new ID adds a new catalog snapshot. Existing definitions and publications retain their old ID; they do not silently pick up renamed assets, changed geometry, artwork or gameplay stats. Registering different catalog bytes under an existing build ID fails.

The snapshot stores metadata and descriptors, **not copies of all original PNG/MP3/JSON resources**. Retain the content-addressed files referenced by old builds in the configured generated-resource root. Deleting an old file can break an old publication; this package does not archive extraction output or change extraction cleanup. Missing or hash-mismatched original resources fail through the server's verified reader.

To upgrade content, save a new revision with the new build ID, update custom dependencies to revisions published on that build, then publish. Upgrade dependencies first. This is an explicit rebase and validation operation; automatic migrations and visual diff tools are not included.

An active release must match the server's current extracted build, including at startup. Keep that original build deployed until the release can be safely retired or migrated. Startup fails explicitly if a different build is deployed under an active release. Existing quest-progress protections can prevent retiring a release; migrating those player records across asset builds requires a separate administrative migration, which Studio does not provide yet. The dashboard edits the pinned build; changing the build ID currently uses the authoring API.

Saves use `expectedRevision` and a UUID `operationId`. The first save expects revision 0; each later save appends a revision. Two edits based on the same revision cannot both commit. Retrying the same operation and payload returns the existing revision; reusing the operation for a different edit returns `CONTENT_CONFLICT`. Published revisions cannot be edited or deleted, including through direct SQL updates. Saving after publication appends a new draft while the old publication remains usable.

Custom runtime IDs are allocated from 800000000–899999998, checked against the pinned original catalog, and retained across revisions. A runtime consumer must scope that stable ID to its selected publication; mixing revisions of one identity in a world is unsupported.

## Shared-world activation

Activation is separate from saving and publishing. Only a developer account may select a release, and the world must be idle: no connected or reconnecting characters, joins, active character leases, map loads, retained drops or unfinished field activity. Ordinary accounts can author and publish privately. They cannot activate content for other players.

A release selects exact published revisions from one owner/project and includes their complete custom dependency closure. All selected revisions must match the server's current original asset build. The server verifies publication hashes, materializes the map manifests/regions and promoted uploaded images, then atomically records the release and updates the database head. The installed overlay adds custom IDs; it cannot override an original map, monster or quest identity. Authored drop tables and conversations are keyed by their original or custom target identity and deliberately extend or replace that target instead. Every selected resource is verified by SHA-256. Failed compilation or admission leaves the previous release selected.

The runtime supports one authoritative world process per database. The activation gate blocks joins while replacing the release. Do not run multiple independent world processes against one database; distributed release propagation is not implemented. The lease check is an additional protection, not a distributed process-coordination protocol.

New clients receive `worldContent` in `/api/v1/config`. They verify the original catalog as before, fetch the hash-pinned database overlay, and pin `worldContentHash` in both handshake directions. A stale client fails the identity guard and must reload. The original asset/rules/catalog hashes remain independent from the selected release. Restart restores the database head without regenerating or rebuilding base assets.

Activated maps appear in the **Community maps** menu for all players. Entry uses the closed `content.enter` command, normal server-owned travel preparation, a durable location transaction and a destination baseline. The client supplies only an active custom map ID. Custom mobs use existing authoritative combat; custom quests appear at their inherited NPCs and use existing objective/reward transactions. Inherited map portals still use their original destinations.

Activating another release replaces the full selection; an empty selection deactivates custom content. A map cannot be changed or removed while a saved character is inside it. A quest cannot be changed or removed after any character has progress for its identity; use a new quest identity instead. These restrictions avoid silently invalidating locations or rewriting earned progress. Keep required older revisions selected until these conditions are resolved.

World catalogs/resources are available through `/api/v1/world-content/catalog/:hash` and `/api/v1/world-content/resources/:hash` only while selected. Activation intentionally makes the selected content available to game clients; unrelated private drafts and uploads remain authenticated. API content is `no-store` and is excluded from the renderer's persistent cache. A release is bounded to 128 creations including dependencies, 512 resources, 64 MiB of materialized resources and an 8 MiB catalog overlay. Historical rows remain immutable; archival/garbage collection is not implemented.

## Authoring contracts

The executable schemas are in [definitions.js](../../content/src/definitions.js), [map-definition.js](../../content/src/map-definition.js), [quest-definition.js](../../content/src/quest-definition.js), [drop-definition.js](../../content/src/drop-definition.js) and [dialogue-definition.js](../../content/src/dialogue-definition.js). Unknown fields and arbitrary scripts are rejected.

| Kind     | Supported authoring                                                                                                                                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mob      | Derive from an original mob; override supported stats while retaining its original animation/combat definition; optionally supply a new PNG sheet with explicit actions, delays, origins and body rectangles               |
| Map      | Derive from an original map; add original scenery/mob appearances or uploaded decorations; add original/custom mob spawns; remove scenery or mob placements; replace bounds, footholds and ladders                         |
| Quest    | Choose original NPC endpoints, level limits, completed-quest prerequisites, hunt/collect objectives, fixed EXP/meso/item rewards and plain dialogue; hunt targets and prerequisites may reference custom published content |
| Drops    | Extend or replace one original/custom monster's drop rows with explicit item, chance, quantity, quest gate and optional window/job/level conditions; items resolve against the pinned catalog, and the merged table stays within the field row limit |
| Dialogue | Replace one original NPC's conversation with up to sixteen plain-text nodes, dense node IDs and bounded options whose targets are existing nodes or an end |

Map publication reuses unchanged original descriptors. Modified/new regions become database resources. Geometry and animation are checked using the existing simulation/rendering validators, including whether added mobs are active on valid footholds. Existing NPCs, portals, backgrounds and other inherited map systems remain inherited; authoring custom portals/NPC behavior and starting from a blank map are not implemented.

New monster artwork currently requires a base with no authored attack animations. Supply every action required by that base, with a body rectangle on every frame. Cross-borrowing another original monster's appearance while retaining different combat geometry is rejected. Pick that original monster as the base when reusing its appearance and behavior. No arbitrary AI, new skills, scripts, audio uploads or custom item definitions are accepted in this version.

Uploads support 8-bit noninterlaced RGB/RGBA/grayscale PNGs accepted by the existing decoder. Indexed, animated and transparency-chunk PNG variants are rejected. Raw upload bytes remain unchanged; frame texture identities use the extractor's width/height/RGBA hash convention.

## API

All paths below are relative to `/api/v1/custom-content/`. Obtain `assetBuildId` and `csrfToken` from the existing session/config flow. JSON POSTs use `Content-Type: application/json`; each listed body also includes `csrfToken`.

| Method/path                                | Body or result                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| POST `assets/search`                       | `{ buildId, query: { kind, query, offset, limit } }`; returns `{ matches, total, offset }`                 |
| POST `assets/resolve`                      | `{ buildId, ref }`; returns verified original metadata and available visual/resource descriptors           |
| POST `assets/scene` | `{ buildId, query: { mapId, offset?, limit? } }`; pages through original scenery in one map |
| POST `preview` | `{ content }`; validates and compiles an unsaved private draft without allocating a database revision |
| POST `save`                                | `{ content }`; saves the closed document below and returns its revision                                    |
| POST `publish`                             | `{ ref: { projectId, id, revision } }`; validates dependencies and returns the immutable publication       |
| POST `list`                                | `{ projectId, offset?, limit? }`; returns latest revision summaries without definitions/runtime blobs      |
| POST `images`                              | Raw PNG body, `Content-Type: image/png`, `X-CSRF-Token` header; returns `{ id, width, height, mediaType }` |
| GET `revisions/:project/:id/:revision`     | Full draft or published revision                                                                           |
| GET `published/:project/:id/:revision`     | Full published revision only                                                                               |
| GET `runtime/:project/:id/:revision`       | Compiled runtime envelope (`kind`, `identity`, `dependencies` and the kind-specific output)                |
| GET `regions/:project/:id/:revision/:hash` | Canonical JSON for a published modified/new map region                                                     |
| GET `images/:hash`                         | Exact owner-scoped uploaded PNG bytes                                                                      |
| GET `world/status` | Current release generation, selection, connected/retained player count and activation state |
| POST `world/activate` | `{ release: { projectId, refs: [{ id, revision }], expectedGeneration, operationId } }`; developer-only activation |

Search covers maps, mobs, quests, items, UI bundles and sound groups in the catalog. NPC/scenery resolution uses map-local IDs; there is no global searchable scenery/NPC index. `assets/scene` pages through scenery in a selected original map. NPC choices come from its life templates. Studio uses the original ID and source map when composing decorations.

Example JSON body for `POST save` (replace build and CSRF values):

```json
{
  "csrfToken": "SESSION_CSRF_TOKEN",
  "content": {
    "projectId": "forest",
    "id": "mossback",
    "kind": "mob",
    "name": "Mossback",
    "baseAssetBuildId": "CURRENT_64_CHARACTER_BUILD_ID",
    "expectedRevision": 0,
    "operationId": "24a70745-2c56-4a86-90d2-85b466858bf3",
    "definition": {
      "base": { "source": "original", "kind": "mob", "id": "100101" },
      "stats": { "maxHP": 120, "exp": 15 }
    }
  }
}
```

After publishing that mob, a map spawn or quest kill objective can reference `{ "source": "custom", "kind": "mob", "id": "mossback", "revision": 1 }`. It receives a separate runtime identity, so defeating ordinary Blue Snails does not award Mossback quest progress.

Validation failures return a `code`, message and optional document path. Important responses are 400 `INVALID_CONTENT`/`INVALID_MESSAGE`, 401 session failures, 403 authorization failures, 404 missing content/assets/builds, 409 `CONTENT_CONFLICT`, and 429 `CONTENT_LIMIT`. Failed publication leaves the saved draft available for correction.

## Bounds and checks

Authoring JSON is limited to 512 KiB, depth 32 and 65,536 nodes. PNGs are at most 4 MiB and 2048×2048 pixels. Each uploaded animation set is limited to 1024 frames and 16,777,216 referenced frame pixels. Accounts have limits of 4096 content identities and 1024 uploads; each identity has at most 10,000 revisions. Search/list pages contain at most 100 results. The HTTP handler admits four concurrent requests. These are initial engineering limits, not an abuse-resistant public hosting quota system; aggregate byte quotas and archival/retention administration remain future work.

```sh
bun run test:content
bun run check:content
bun run check:studio
```

The first command runs schema/compilation/API tests using existing generated fixtures; native PostgreSQL tests are skipped unless `OPENMS_TEST_DATABASE_URL` is supplied. The second reads `OPENMS_TEST_DATABASE_URL` or the scoped server `DATABASE_URL`, creates disposable databases, invokes the explicit migration runner twice (the second run skips applied scripts) and checks persistence, immutable revisions, concurrent saves, owner isolation, mixed original/uploaded resources, extraction snapshots and world-release protections. The configured database is used only to create/drop those disposable databases. Its tables are never migrated by this check. The test account needs database-creation permission. The third command runs the focused native Studio/shared-world scenario described in the [Studio guide](studio.md). None of these commands extracts assets or runs the full smoke suite.
