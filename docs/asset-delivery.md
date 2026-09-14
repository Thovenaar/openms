# Asset extraction and online delivery

The repository converts supplied original WZ inputs into deterministic, content-addressed browser resources. The browser never downloads a WZ archive. Gameplay and durable state remain server-owned regardless of which definitions are packaged beside artwork.

## Incremental extraction and preflight

From the repository root:

```sh
bun tools/openms.js extract --assets ../Maplestory-Client
```

Useful explicit selectors are `--map ID`, `--maps ID,ID`, `--full`, `--gameplay-definitions-root DIR`, `--sql-root DIR`, `--cache-dir DIR` and `--preflight-report FILE`. CLI flags and repository-relative defaults determine inputs; one-shot tools do not read path overrides from environment variables.

Extraction writes immutable atlases, map/region manifests and visual bundles before atomically publishing `client/public/generated/catalog.json`. A failed preflight, conversion or closure check preserves the prior catalog. Content hashes include original inputs, converter recipes and local gameplay definitions required by the selected output.

The extraction cache records reusable unit results and their transitive recipe/input identities. Unchanged units are reused across sessions. `--full` forces conversion but retains the same validation and atomic publication rules. Do not delete the cache or rerun extraction for a browser-only source edit.

## Generated catalog

The schema-2 catalog provides:

- the asset build identity and bounded map descriptor inventory;
- shared UI, avatar, audio, item, quest, NPC and gameplay metadata;
- SHA-256 and byte length for every fetched immutable resource;
- names and availability data used by the online server and browser.

Map manifests contain physics, actors and region descriptors. Regions and visual bundles refer to immutable atlases rather than embedding image bytes. Descriptor traversal is iterative and bounded by [resource validation](../client/src/assets/resource-validation.js).

Packaging a record establishes data availability, not gameplay support. The server must still admit the action, script, quest, portal or reward. [Feature coverage](server/offline-parity.md) records those boundaries.

## Original selection evidence

Original map IDs, portal metadata and dependency closures are retained in the generated catalog and [extraction report](extraction.json). Earlier seed-selection and full-release counts are historical measurements; they do not define the current online catalog.

## Profiling a slow extraction

When extraction performance is explicitly in scope, retain preflight, input scan, conversion, output-closure verification and publication timings separately. Compare runs with the same explicit inputs and cache state; do not count nested stages twice or infer a speedup from unrelated source changes.

## Online build and serving

The browser build consumes the existing catalog:

```sh
bun run client:build
```

It verifies catalog and server-rule identities, compiles the guarded entry at `client/src/browser/online/main.js`, and writes bundles under `client/dist/online/`. The build does not perform extraction or publish an offline release.

During development, `bun run client:dev` serves the checked-in online `index.html`, styles, compiled bundles and `/generated/` resources. It proxies same-origin `/api/` HTTP and WebSocket requests to the authoritative server. Static immutable resources receive long-lived caching headers; the shell and catalog are revalidated.

The online client uses no service worker, CacheStorage release installer, browser-local character save or disconnected gameplay fallback. Network loss leaves the last complete visual state available for recovery UI, while the server remains the only gameplay authority.

## Runtime streaming

The catalog and destination map are verified before a field becomes interactive. Visible and always-resident regions load on demand through bounded network and atlas gates. Field replacement retains the previous complete scene until the destination resources and matching server transition are ready; cancellation or failure cannot publish a partial scene.

Fullscreen loading is restricted to map preparation that actually starts an uncached asset download. Cached map entry and same-map character changes never admit it. Once needed, it lasts through that map's preparation, including decode/upload; cancellation releases its owner. Other network/decode work uses a 20px circular indicator near the bottom-right, above the native HUD, with no pointer interception. Fully resident assets start no activity token. Startup uses the same small indicator. The ordinary between-map brightness fade remains a separate presentation effect.

The original mushroom loading decoration is optional presentation over real asynchronous work. It cannot grant readiness, hide a failed request or invent progress. [Streaming](streaming.md) owns residency and teardown, while [scene contracts](scene-contract.md) own manifest semantics.

## Evidence and historical material

[Extraction results](extraction.json), [archive scan](archive-scan.json), [asset evidence](asset-evidence.md) and [original-resource audit](original-resource-audit.md) retain current input and output evidence. Earlier offline installation, CacheStorage and stopped-origin measurements remain under the documentation archive and `docs/offline-validation/`; they describe retired builds and are not current runtime support.
