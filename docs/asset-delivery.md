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
bun client/tools/build-online.js
```

It verifies catalog and server-rule identities, compiles the guarded entry at `client/src/browser/online/main.js`, and writes bundles under `client/dist/online/`. The build does not perform extraction or publish an offline release.

`bun run client:prod` builds and serves the resulting `client/dist/online/site/` without the development sidebar, alongside the generated asset mount and API proxy. Serving uses the published site files, so a separate development build does not replace the running production bundle.

During development, `bun run client:dev` serves the checked-in online `index.html`, styles, compiled bundles and `/generated/` resources. It proxies same-origin `/api/` HTTP and WebSocket requests to the authoritative server. Static immutable resources receive long-lived caching headers; the shell and catalog are revalidated.

The online client uses no service worker, CacheStorage release installer, browser-local character save or disconnected gameplay fallback. Network loss leaves the last complete visual state available for recovery UI, while the server remains the only gameplay authority.

## Startup pack

`client/tools/startup-pack.js` runs during the existing online browser build. It follows the same bounded common-asset policy as runtime startup, reads and verifies those retained generated files, and publishes `/generated/startup/<sha256>.bin`. Existing extraction remains intact. Deployment must include this generated file as well as the other catalog dependencies; `deployment.json` records its descriptor and index in `generated.startupPack`.

Version 1 is gzip-compressed concatenated member bytes in index order. The index is compiled into the browser as `OPENMS_STARTUP_PACK`: version, pack URL/SHA-256/compressed byte length, total unpacked byte length, and ordered member descriptors. There is no separate index fetch or archive pathname extraction. Members are canonical `/generated/` URLs, each with an exact byte length and SHA-256; duplicate URLs, private paths, oversized declarations and a catalog hash that differs from fresh server configuration fail before transfer. The pack is bounded to 770 members and 128 MiB for each compressed/unpacked body. Member limits remain 32 MiB, or 64 MiB for the catalog.

Before catalog/UI preparation, a browser with a usable cache and enough capacity downloads the pack when more than four indexed members are missing. It checks the compressed hash, bounds decompression, verifies all member hashes before the first write, and serially saves the members through the existing cache owner. The temporary compressed/unpacked buffers are released after preparation; they add no atlas/GPU residency and the archive is not stored as a duplicate cache entry. Cancellation or corruption cannot expose a partially prepared login. A storage failure leaves verified members available and resumes ordinary loading under the existing storage policy.

A retained cache skips the pack and verifies member bytes through normal loaders. Up to four missing members use individual requests. Larger update/eviction gaps may redownload the whole pack; it is not a binary delta protocol. Browsers without usable storage skip the speculative pack. The shell and fresh private API configuration remain separate HTTP requests; “one download” refers to generated startup game files.

## Runtime streaming

The catalog and destination map are verified before a field becomes interactive. Visible and always-resident regions load on demand through bounded network and atlas gates. Field replacement retains the previous complete scene until the destination resources and matching server transition are ready; cancellation or failure cannot publish a partial scene.

Field preparation keeps the original mushroom loading card, and fullscreen loading is restricted to map preparation that actually starts an uncached asset download. Cached map entry and same-map character changes never admit it. Once needed, it lasts through that map's preparation, including decode/upload; cancellation releases its owner. Other network/decode work uses a 20px circular indicator near the bottom-right, above the native HUD, with no pointer interception. Fully resident assets start no activity token. The ordinary between-map brightness fade remains a separate presentation effect.

Login startup is the one other fullscreen phase. Until the login page's own artwork is ready, a browser-owned Windows 95 download page covers the shell instead of exposing account controls without art. Its bar and counters report only work the pipeline declared: catalog and manifest descriptor byte lengths, plus the live encoded length of the fetch in progress, so no percentage is invented for undiscovered resources. Entering the world releases that page back to the mushroom card; returning to the login surface uses the small indicator, never the startup page.

Saved files are checked locally against expected hashes. Startup says “Checking saved game files…” for this work and “Downloading game files…” only while a transfer is active; its accessibility labels use the same distinction. `delivery.preparedBytes` counts completed preparation, including cache hits, and replaces the misleading `delivery.downloadedBytes` field. `streaming.downloadBytes` counts bytes actually read by network downloads. The root catalog is also cached and validated against the fresh server configuration hash, and the optional loading decoration uses the same verified cache.

The original mushroom loading decoration is optional presentation over real asynchronous work. It cannot grant readiness, hide a failed request or invent progress. A required login resource failure, or a bootstrap failure before the login page exists, keeps the loading page with an explicit message and no progress until the page is reloaded. [Streaming](streaming.md) owns residency and teardown, while [scene contracts](scene-contract.md) own manifest semantics.

### Slow downloads and recovery

A complete validated server baseline is retained and acknowledged before its artwork finishes. The [transport presentation queue](../client/src/online/transport-presentation.js) prepares the scene separately, so downloads cannot block heartbeat replies, command receipts or resume-session retention. Input starts after presentation is ready; an old baseline is refreshed first. Same-field artwork refreshes keep the installed movement simulation receiving observations and impulses.

Map preparation has its own [protocol deadline and recovery budget](server/protocol.md#slow-connections-and-presentation-recovery). Individual downloads also retain the [network limits](../client/src/rendering/stream-deadline.js): 30 seconds without progress and 300 seconds total, subject to earlier cancellation by their scene owner. These limits measure different work; a stalled file is not evidence that the WebSocket died.

Failed streamed regions rebuild through a replacement scene. Travel waits for destination preparation before opening its database transaction, then revalidates and commits the fare or other cost. A disconnect cancels the server's preparation wait; a pre-commit failure does not charge the player. See the [transition contract](server/protocol.md#map-transition-state-machine), [recovery steps](development.md#slow-connections) and [repeatable latency scenario](validation-method.md#slow-network-gameplay-check).

## Evidence and historical material

[Extraction results](extraction.json), [archive scan](archive-scan.json), [asset evidence](asset-evidence.md) and [original-resource audit](original-resource-audit.md) retain current input and output evidence. Earlier offline installation, CacheStorage and stopped-origin measurements remain under the documentation archive and `docs/offline-validation/`; they describe retired builds and are not current runtime support.
