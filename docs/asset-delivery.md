# Asset extraction and online delivery

The repository converts supplied original WZ inputs into deterministic, content-addressed browser resources. The browser never downloads a WZ archive. Gameplay and durable state remain server-owned regardless of which definitions are packaged beside artwork.

## Incremental extraction and preflight

From the repository root:

```sh
bun tools/openms.js extract --assets ../Maplestory-Client
```

Useful explicit selectors are `--map ID`, `--maps ID,ID`, `--full`, `--gameplay-definitions-root DIR`, `--sql-root DIR`, `--cache-dir DIR` and `--preflight-report FILE`. CLI flags and repository-relative defaults determine inputs; one-shot tools do not read path overrides from environment variables.

Extraction writes immutable atlases, map/region manifests and visual bundles before atomically publishing `client/public/generated/catalog.json`. A failed preflight, conversion or closure check preserves the prior catalog. Content hashes include original inputs, converter recipes and local gameplay definitions required by the selected output.

Every generated `/generated/**/*.json` resource of at least 64 KiB is published together with a deterministic `<hash>.json.gz` sibling, written before the catalog that names the raw file. The catalog still describes the raw resource's SHA-256 and byte length; the sibling is a delivery form, not a second descriptor. JSON is the dominant cost in the corpus and compresses to a small fraction of its encoded size, so the sibling is what lets a quota-limited browser cache retain most of the world instead of a small part of it. Already-compressed PNG and MP3 outputs never receive one, and smaller JSON gains too little to justify a second file. Both forms are content-addressed and reused when identical, so extraction stays incremental.

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

Field preparation keeps the original mushroom in a Windows 95 window with a progress bar, file/byte counters, destination name and current asset category. Fullscreen loading is restricted to map preparation that actually starts an uncached asset download. Cached map entry and same-map character changes never admit it. Once needed, it lasts through that map's preparation, including decode/upload; cancellation releases its owner. The counters describe discovered dependencies, not an invented total for the whole world. Other network/decode work uses a compact Windows 95 activity symbol in the project bar, directly left of the server ping. Clicking its navy spinner opens a native modal with current files, region queue, cache usage and Pause/Resume; the symbol stops spinning while paused and shows a check when a region completes. Only that symbol intercepts pointer input; the modal owns keyboard focus while open. Reduced-motion preferences stop rotation. The ordinary between-map brightness fade remains separate.

Login startup is the one other fullscreen phase. Until the login page's own artwork is ready, a browser-owned Windows 95 download page covers the shell instead of exposing account controls without art. Its bar and counters report only work the pipeline declared: catalog and manifest descriptor byte lengths, plus the live encoded length of the fetch in progress, so no percentage is invented for undiscovered resources. Entering the world releases that page back to the mushroom card; returning to the login surface uses the small indicator, never the startup page.

Saved files are checked locally against expected hashes. Startup says “Checking saved game files…” for this work and “Downloading game files…” only while a transfer is active; its accessibility labels use the same distinction. `delivery.preparedBytes` counts completed preparation, including cache hits, and replaces the misleading `delivery.downloadedBytes` field. `streaming.downloadBytes` counts bytes actually read by network downloads. The root catalog is also cached and validated against the fresh server configuration hash, and the optional loading decoration uses the same verified cache.

The original mushroom loading decoration is optional presentation over real asynchronous work. It cannot grant readiness, hide a failed request or invent progress. A required login resource failure, or a bootstrap failure before the login page exists, keeps the loading page with an explicit message and no progress until the page is reloaded. [Streaming](streaming.md) owns residency and teardown, while [scene contracts](scene-contract.md) own manifest semantics.

### Bound skill readiness

Field presentation prepares Use artwork, available projectile-ball artwork and Use audio for up to eight bound skills. [LocalSkillWarmup](../client/src/online/local-skill-warmup.js) holds at most 16 shared visual leases; repeated casts borrow these prepared resources, avoiding a fetch/decode at the key press. This working set is separate from regional disk caching and is released with the field. Preparation failures retain a diagnostic and leave ordinary on-demand loading available. This covers bound skill feedback, not every learned skill's hit/summon/area resources.

### Regional background downloads

After the initial login artwork is ready, the client automatically queues **Victoria Island** for persistent caching. Installing a playable field puts its own region first, leaving Victoria queued behind it when the player starts on Maple Island. This does not extend the blocking login pack. `asset-regions.js` groups available catalog maps by original WorldMap membership and parent maps; unlisted interiors inherit their district, with Victoria's 100–109 districts included explicitly. Unclassified maps form individual groups. Private/community assets never enter this shared cache.

Each region follows every packaged map manifest to its complete scenery-region and atlas descriptors, including all declared mob artwork and available mob sound families, plus map minimaps and music. Shared files deduplicate by URL/hash. The retained catalog's Victoria plan contains **268 maps, 6,498 files and 1,475,943,505 bytes**; this is the available extracted region, not a claim that unavailable original maps have been extracted. Planning that closure from local manifests took **3.032 s**, without reading/decoding image payloads or rebuilding extraction.

### Region packs and shared asset containers

A member count is not a transfer count. The online browser build now publishes two aggregation layers under `/generated/packs/`, both derived from the retained generated tree without rerunning extraction:

- One **map pack** per packaged map, carrying its manifest, its scenery regions and its minimap bundle as a self-describing container of individually gzipped members.
- **Shared asset containers** carrying the atlas artwork, map music and mob sounds that many maps reach. Grouping follows original WorldMap ownership (widest reach last), so a region's own artwork stays together while genuinely global mob artwork shares one container instead of being duplicated into every map pack.

Both layers use the same container format: an 8-byte `OPENMSRP` magic, a bounded big-endian header length, a JSON member index, then each member's bytes. JSON members are gzipped; PNG and MP3 travel as identity members because they are already compressed. Every member is content-addressed, so its URL restates its hash and a verified container authenticates its own index. The client fetches one container, verifies the container hash against the compiled index descriptor, verifies every member against its URL-derived hash, and only then writes the existing per-file cache entries. Each member keeps its own stream, so the persistent cache stays exactly as small as ordinary per-file delivery; the container itself is never cached.

`client/tools/region-packs.js` builds both layers during the online build and publishes a catalog-bound index (`generated.regionPackIndex`, compiled in as `OPENMS_REGION_PACK_INDEX`). The index binds to the catalog build id, so a stale pack set is ignored rather than mixed with fresh descriptors. Pack identity is a digest of the map and minimap descriptors, and container identity is a digest of the whole shared-asset set, so an unchanged rebuild reuses every published blob without reading or recompressing it.

The retained catalog measured **735 map packs / 17,119 JSON members / 3,658,861,975 declared bytes -> 235,155,687 container bytes**, plus **99 shared containers / 5,211 unique assets** (including each minimap bundle's own artwork) **/ 442,884,896 declared bytes -> 443,930,240 container bytes**, with a **1,119,903-byte** index (**271 KiB** gzipped). A cold build published every blob in **24.0 s**; an unchanged rebuild reuses packs and containers in **0.3 s**. Because blobs are content-addressed and never overwritten, each rebuild retires the ones its new index does not reference, so the directory holds exactly the 735 packs and 99 containers it publishes.

The effect is on requests, not bytes:

| Warm target | Member files | Before | After |
| --- | ---: | ---: | ---: |
| Victoria Island | 6,498 | ~10,979 requests | **304** (268 packs + 36 shared containers) |
| Maple Island | 346 | ~600 requests | **32** (17 packs + 15 shared containers) |
| Every packaged map | — | ~35,700 requests | **834** (735 packs + 99 containers) |

Driving `RegionDownloadPlan` against the served tree over real HTTP reproduces those counts exactly, with `packed`/`assetContainers` set and zero fallbacks, and the packed Victoria frontier stays the full **6,498** members: a map pack carries its minimap bundle, and the bundle's own artwork still enters the frontier through the shared layer.

The "before" column counts the guaranteed `<url>.gz` probe that every sub-64 KiB JSON member cost before its raw fetch; the "after" column leaves no per-file leftovers for these regions. Bytes are essentially unchanged (Victoria ~233 MiB -> ~236 MiB) because grouping only trades a small amount of partial-container overhead for far fewer round trips.

```sh
bun client/tools/build-online.js
bun test client/test/online-region-pack.test.js client/test/region-downloads.test.js client/test/download-details.test.js
```

The details window distinguishes the two counts: `Saving 1986 / 6498 files (304 downloads)`. A missing, stale or damaged index, a failed container transfer or storage loss all downgrade that region to ordinary per-file delivery without disconnecting gameplay.

Downloads use the existing verified cache and at most two background requests. The shared four-slot gate reserves two slots for foreground work and chooses queued gameplay work first; browser requests also carry low priority for prefetch. No background image decoding or GPU upload occurs. Plans contain at most 16,384 files, yield between two-file batches, and report discovered/verified bytes as their frontier expands. The quota-aware disk ceiling is now **4 GiB / 32,768 files**, still leaving browser quota headroom. Admission is judged on descriptor byte lengths, while compressed siblings mean the resulting disk cost is usually lower than that conservative estimate. A plan that cannot fit with 256 MiB reserved for foreground assets stops with an explicit storage message. Cache loss or a failed request stops that regional plan without disconnecting gameplay. Closing the details window keeps downloading; Pause stops admission after the current small batch.

### Slow downloads and recovery

A complete validated server baseline is retained and acknowledged before its artwork finishes. The [transport presentation queue](../client/src/online/transport-presentation.js) prepares the scene separately, so downloads cannot block heartbeat replies, command receipts or resume-session retention. Input starts after presentation is ready; an old baseline is refreshed first. Same-field artwork refreshes keep the installed movement simulation receiving observations and impulses.

Map preparation has its own [protocol deadline and recovery budget](server/protocol.md#slow-connections-and-presentation-recovery). Individual downloads also retain the [network limits](../client/src/rendering/stream-deadline.js): 30 seconds without progress and 300 seconds total, subject to earlier cancellation by their scene owner. These limits measure different work; a stalled file is not evidence that the WebSocket died.

Failed streamed regions rebuild through a replacement scene. Travel waits for destination preparation before opening its database transaction, then revalidates and commits the fare or other cost. A disconnect cancels the server's preparation wait; a pre-commit failure does not charge the player. See the [transition contract](server/protocol.md#map-transition-state-machine), [recovery steps](development.md#slow-connections) and [repeatable latency scenario](validation-method.md#slow-network-gameplay-check).

## Evidence and historical material

[Extraction results](extraction.json), [archive scan](archive-scan.json), [asset evidence](asset-evidence.md) and [original-resource audit](original-resource-audit.md) retain current input and output evidence. Earlier offline installation, CacheStorage and stopped-origin measurements remain under the documentation archive and `docs/offline-validation/`; they describe retired builds and are not current runtime support.
