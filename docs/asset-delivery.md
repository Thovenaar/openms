# Deterministic original-asset delivery

`bun run extract` packages the original WZ inputs into schema v2. A smaller explicit selection is:

```sh
bun run extract --maps 100000000,100000001,230000000
```

`--map 100000000` selects a single map. `--assets /path/to/original/files` overrides `MAPLE_ASSETS`. The offline integration bounds packaged selections/portal closure at 512 unique nine-digit map IDs. IDs are sorted before conversion, so argument order cannot change the build. No third-party client assets or implementation are used.

## Original selection evidence

Read-only extraction of `Map.wz:Map/Map1/100000000.img` found Henesys, `info.mapMark=Henesys`, `info.swim=0`. `Map/Map1/100000001.img` contains portal `out02` targeting `100000000`, providing an original connected nearby map. `Map/Map2/230000000.img` contains `info.mapMark=AquaRoad`, `info.swim=1`, and `info.bgm=Bgm11/Aquarium`: this is the original water/swim example, not recolored Henesys. All three retain original portal and physics metadata. Global physics comes from **`Map.wz:Physics.img`**, through `readPhysicsData(map, physics)`.

## Publication and ownership

`/generated/catalog.json` is the mutable gameplay-data entry point; an installed client receives its pinned exact copy. The extractor supplies its deterministic build ID. The delivery release separately hashes the exact complete catalog bytes and all reachable dependencies, including inline gameplay metadata added after the original `{maps,hitboxes,ui,audiovisual}` index. Each map descriptor records its immutable URL, SHA-256, exact encoded byte length, and neighbors that are actually packaged. Original unbundled portal targets remain in map physics; they are not advertised as fetchable neighbors.

Maps, regions, atlases, visual bundles, reference JSON and audio are stored under their shared `maps/`, `regions/`, `atlases/`, `bundles/`, `references/` and `audio/` directories, with SHA-256 filenames derived from complete encoded bytes. Every immutable resource is completely written before the catalog is atomically renamed. Failed conversion leaves the prior catalog intact. Old unreachable resources may remain cache-addressed; consumers follow the catalog rather than enumerate the directory. Concurrent extractor processes targeting the same output directory are unsupported.

`publishFile` uses a uniquely owned staging directory, complete write, atomic rename and finally cleanup for resources, catalog and release pointers. Concurrent per-file publication cannot rename another writer's temporary file; failure retains the prior complete destination. This is per-file atomicity, not a multiprocess transaction spanning catalog, diagnostic report and build outputs.

Map manifests contain complete modest collision metadata, actors, texture subrects, atlas descriptors, and independently fetchable region descriptors. Region JSON contains only its owned entities. All original canvas origins, straight alpha (including transparent RGB), animation delays/alpha endpoints, object/tile depth, avatar anchors/equipment depth, flip flags, and camera-relative background metadata retain the existing scene semantics. Texture IDs remain SHA-256 over `width + "x" + height + ":"` followed by decoded original RGBA, not PNG encoding identity.

UI windows/minimaps and selected effect sequences use independent schema-v1 visual bundles through the same `packageVisualBundle` atlas packer. Portals and NPC/mob artwork are ordinary spatial map entities; `portalPresentation` and `life` retain their metadata separately. UI/effect canvas identity is shared with world artwork by the existing original-RGBA hash. Sound publishing copies exact original MP3 payloads without transcoding, with original envelopes and map BGM/effect bindings in `catalog.audiovisual`. A resource descriptor proves bytes, not gameplay activation or server permission.

## Browser engineering limits

- Spatial cells are 1024 × 1024 world pixels. Each non-background entity belongs to its origin cell. Descriptor bounds are the union of all animation frames, including overhang, so demand intersection never clips boundary artwork.
- Every background is conservatively always-loaded because its parallax/repetition may expose it outside its nominal rectangle. Other entities wider or taller than one cell also have individually owned always regions. Actors live in the map manifest.
- Atlas dimensions are at most **2048 × 2048**, a conservative texture/upload policy, not an original-game constant. One zero-filled transparent pixel surrounds each subrect; interiors therefore cannot exceed 2046 in either dimension. Oversized canvases are losslessly partitioned into bounded tiles, never resized. Frame parts expand with original-relative offsets; horizontally flipped parts use `part.x + originalWidth - tile.x - tile.width`. Single-canvas frames retain `sourceSize:{width,height}` for original background repeat periods. Shelf packing trims unused bottom/right canvas area. At most 128 tiles per original canvas and 128 total expanded parts per frame are allowed, matching runtime limits; exhaustion fails before catalog publication.
- Within each deterministic actor/region batch, pixel IDs sort lexically before shelf placement. Previously packaged identical pixels reuse their atlas across regions/maps. This deliberately trades some shared-atlas overfetch for deduplication; atlases never exceed 16 MiB decoded RGBA. Actor resources are packed first. Per-map entity count is bounded at 100,000; WZ traversal has separate parser limits.
- PNG remains lossless RGBA8, without palette conversion, quantization, premultiplication, or color-space transforms. Runtime should sample exact integer subrects with smoothing disabled; zero padding does not reconstruct filtered edge bleed.

## Conversion report schema (v2)

`docs/extraction.json` is written after successful publication. Timing is diagnostic, not part of the build hash.

- `schemaVersion: 2`, `buildId`, `inputDirectory`.
- `maps`: ordered `{id, entities, regions, textures, physics}` counts and original map settings.
- `policy`: `{atlasLimit, padding, regionSize, maxMaps}`.
- `counts`: unique textures, unique atlases, parsed input images, map-region count.
- `bytes`: original decoded RGBA, independently round-tripped RGBA, unique encoded atlas PNG, decoded atlas RGBA (including padding), unique region JSON, encoded map JSON, catalog JSON.
- `inputs`: keyed original `Archive.wz:IMG/path`, with original directory `path,name,type,size,checksum,offset`, SHA-256 of original IMG bytes, and exact original byte length.
- `formats`, `images`, `durationMs`, and explicit `limitations`.
- `pixelRoundTrip`: `{passed:true, method}` exists only after every emitted atlas passes verification. The verifier independently parses PNG chunks, inflates IDAT scanlines, then compares every atlas subrect row against the decoded original bytes. This detects channel changes, incorrect placement, and transparent-RGB loss; it is an executable conversion invariant, not a source-text test. All zero-filter scanlines and decoded dimensions are validated.
- `tiledCanvases`: keyed original full-canvas pixel identity, retaining original dimensions/source/format/scale and each tile's identity/offset/dimensions. Tile identities use the same dimensions-plus-RGBA hash convention. Tile parts also carry `sourceCanvas` and `sourceRect`. Before atlas creation, the converter independently reconstructs every full oversized canvas from its tiles and compares every byte, including transparent RGB; `bytes.tileReconstructionCompared` records this additional proof separately from PNG round-trip comparisons.

The original seed selection contains eight maps: `100000000`, `100000001`, `103040000`, `108000500`, `120000000`, `200090500`, `211040000`, and `230000000`. Offline integration expands the default through data-supported nonscript portal routes; explicit `--maps` remains a selected release. The actual downloadable map inventory always comes from the final catalog. Browser code never downloads a WZ archive.

## Historical converter-only fidelity boundaries

Original camera fallback is not recovered: absent VR fields retain an explicit foothold-derived inspection rectangle. NPC/mob artwork is packaged as authored metadata previews, not live spawn/AI. Selected Effect.wz sequences are separately demand-loaded previews; unresolved global/automatic map effect behavior is not synthesized. Active unsupported physics remains visible in each manifest's inventory; packaging a swim map is not proof of swim-motion fidelity. Browser residency, cancellation, uploads and native audio belong to the runtime, not this offline converter.

These are the pre-offline converter discovery boundaries, retained as historical evidence rather than current gameplay claims. Current camera, life, combat, quest, and portal behavior belongs to the corresponding domain documents; complete resource installation does not itself establish those semantics.

## Verified offline release installation

This delivery protocol is **local browser policy**, not recovered original-game behavior. No executable address or WZ field defines CacheStorage, service-worker lifetime, browser quota, release activation, or readiness. The original delivery investigation is retained in `agent://offline-gameplay-discovery-6`; its 410-file/eight-map measurement is historical, not an installation table. Current delivery always traverses the final catalog produced by extraction, including the expanded portal closure or an explicitly selected `--maps` release.

`client/tools/dev.js` builds all browser bundles, then calls `prepareRelease(root)` from `client/tools/release-manifest.js` **before listening**. The builder reads the exact catalog bytes, iteratively walks every inline object for `{url,sha256,bytes}` descriptors, verifies each referenced file, opens every referenced JSON and repeats. Descriptor-bearing objects are not traversal leaves: nested gameplay metadata and new descriptors are visited as well. URL conflicts, missing files, mismatched hashes/lengths, and traversal exhaustion fail publication. Stale files elsewhere in `generated/` do not count toward readiness.

The complete shell is the document, stylesheet, main bundle, atlas decoder worker, audio capture worklet, delivery worker and its shared manifest module, web manifest, and local SVG icon. Source maps and the browser-validation oracle are not runtime dependencies. Mutable shell and catalog bytes are snapshotted under `/generated/releases/blobs/<sha256>.bin`; immutable generated resources retain their existing URLs. The resource table maps canonical runtime URLs to these immutable download sources. A deterministic schema-v1 release digest includes the whole table, exact catalog identity, packaged-map labels, and named unavailable portal destinations. The immutable `/generated/releases/<releaseId>.json` is published before atomically replacing `/generated/release.json`. A download selects an immutable release ID, never combines two mutable catalogs, and never consults a fixed map/category list.

### Native initialization and lifecycle

Main imports:

```js
import { initializeOfflineDelivery } from "./offline-delivery.js";
const delivery = await initializeOfflineDelivery(document.querySelector("aside"));
```

Initialization awaits only service-worker registration, then returns the owner while `delivery.ready` performs the initial full integrity/status/update scan with handled, visible errors. It does not delay game initialization for a large installed catalog. Existing registrations are reused without requiring an online registration fetch at cold start. `snapshot()`, `refresh()`, `download()`, `cancel()`, `activate()`, and `destroy()` are the integration API. The native fieldset provides the same actions without an inspection-console command. No delivery action sends gameplay or save state to a backend.

**Download** stages the entire selected release, serially streams bounded resources, checks exact encoded length and SHA-256, and stores responses with correct MIME types. It then independently traverses the cached catalog's actual transitive JSON closure and refuses missing, mismatched, or unreachable generated entries. Only afterward is the completion marker written, followed by the staged-ready pointer. **Use installed release and reload** re-verifies every resource, atomically writes the single active pointer, and reloads. A ready download is distinguished from an active launch; unverified demand caching is never advertised as complete.

`maple-offline-meta-v1` stores small active/staged/partial/client pointers. Each `maple-offline-release-v1-<releaseId>-<instance>` cache owns one immutable manifest and all canonical shell/catalog/resource responses. These caches are never part of the bounded runtime asset-cache eviction policy. The network integration skips its progressive persistent cache after service-worker control; before full installation, controlled requests remain verified online fetches, not durable-ready content. No service-worker cache silently replaces the active release on a network update.

A navigation pins its resulting browser client ID to the active complete release. Fixed shell URLs and the catalog then come from that client's release; existing open tabs retain their prior release until they navigate. These bindings persist across worker termination. Installed responses are length/hash checked before serving, including document and module bytes. Missing or corrupt pinned content returns an explicit named 503, rather than HTML for an asset or a newer incompatible shell. Release-index checks use a separate network-only route and cannot change gameplay's pinned catalog.

### Cancellation, interruption, quota, and coverage boundaries

- Network/quota/hash failure leaves the previous active and staged-ready releases untouched. Partial cache metadata persists so a later **Resume** checks stored bytes and downloads only the missing/damaged resources. Worker termination or page closure cannot publish partial readiness. An interrupted older release remains the resume target until explicitly cancelled, even if a newer release is now published.
- Explicit **Cancel** aborts the active fetch and removes only its incomplete target. Once the complete-pointer commit has begun, cancellation reports that there is no cancellable operation. Activation is serialized against download. Garbage collection protects active, staged, partial, and live-client-bound releases; it never blindly clears installed caches during worker activation.
- Installed responses admit at most eight concurrent verification owners before pointer/manifest reads, and retain admission through response verification/error handling. Status admits one scan. GC excludes admitted readers/status/publishers for its complete snapshot/delete interval; new conflicting work fails explicitly rather than queueing without a bound. Client bindings absent from `matchAll()` are checked with `clients.get()` before deletion so reserved navigation clients retain their release pin. Cancellation also owns its partial-manifest read.
- Downloads request browser storage persistence from the user action and display whether it was granted. The quota preflight requires the remaining staged encoded bytes plus a provisional 10% and 1 MiB metadata reserve. The old release remains resident during updates; shared hashes are verified before copying, and browser deduplication is not assumed. `QuotaExceededError`, missing storage APIs, denied persistence, and failed update checks remain visible. Encoded-byte fit is necessary, not a promise about browser overhead or origin eviction.
- Engineering ceilings are 512 packaged maps, 65,536 release resources, 32 MiB per resource, 16 MiB per release manifest, 8 GiB total encoded content, and 20 million visited metadata objects. Work is iterative with descriptor URL deduplication; exhaustion is explicit. Progress and full verification are bounded and throttled for the native UI; a stopped worker is a timeout/error, never readiness.
- The content details name packaged map IDs/labels, authored portal destinations outside the release, individual missing/corrupt installed resources, and uncached requests. An explicitly selected release is complete only for its actual catalog closure, not the whole original game. Authored script dependencies and unsupported gameplay rules remain separate domain evidence; a complete download does not manufacture their missing server behavior.
- The web manifest and icon provide local launch metadata; this is not a promise that a browser offers its OS-level PWA-install affordance. Root-scope localhost/HTTPS hosting and service-worker/CacheStorage support are required. The worker does not force `skipWaiting` across live tabs; waiting worker updates are named in the panel.

### Executed installation and offline launch

The final release `71146c859aeae9a15148d5e91a4ec11947ffcc221bbd378441bcaea132018c94` contains **356 maps, 9,709 resources and 416,128,097 verified file bytes (396.9 MiB)**. [Native installation](offline-validation/main/final-release-install.json) and [activation](offline-validation/main/final-release-active.json) record complete readiness, exact client pinning, no installer/worker error and no uncached content.

Main stopped the origin server and restarted isolated Chrome with its retained profile. [Cold-launch resource evidence](offline-validation/main/final-server-stopped-restart.json) records installed shell/catalog/world responses through the service worker with zero network transfer; runtime/physics faults and uncached lists remain clear. The intentionally network-only release-update check fails and displays `Update check unavailable: Failed to fetch`, without invalidating installed readiness. [Native offline portal/jump/save/reload](offline-validation/main/final-offline-portal-reload.json) confirms `navigator.onLine=false`, exact installed pinning and full saved-player equality after reload.

[Independent delivery scenarios](offline-validation/delivery/evidence.json) cover installation and failure boundaries. Main's [quota/retry/cancel replay](offline-validation/main/delivery-failures-after.json) confirms one visible quota error, cleared retry/cancel error state and preservation of the active release. [Normal update replay](offline-validation/main/delivery-update-after.json) confirms that a stable URL with a legitimately changed hash is not reported as damaged: prior-cache reuse requires matching descriptor hash **and** byte length. The retained pre-activation waiting-worker warning is historical, not the final worker's result.

### Bounded HTTP content encoding

The loopback server precomputes beneficial gzip representations for release text resources of at least64 KiB, retaining at most16 MiB total. Selection requires the current canonical file size/mtime to match and an accepted nonzero gzip quality. Responses vary by `Accept-Encoding`, report actual wire length and retain original MIME/cache policy. Browser HTTP decoding occurs before descriptor length/hash verification; immutable file identity is unchanged.

[Native HTTP smoke](offline-validation/main/http-encoding.json) compares identity, gzip, disabled gzip and nonzero quality: the catalog decodes to the same11,337,089 bytes and SHA-256, while gzip transfers1,979,464 bytes. [Measured gameplay/performance](offline-gameplay.md#measured-loading-stalls-and-memory) separates scoped network shaping, verified file-byte counts and physical transport bytes.
