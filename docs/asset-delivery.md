# Deterministic original-asset delivery

`bun run extract` packages the original WZ inputs into schema v2. A smaller explicit selection is:

```sh
bun run extract --maps 100000000,100000001,230000000
```

`--map 100000000` selects a single map. `--assets /path/to/original/files` overrides `MAPLE_ASSETS`. The offline integration bounds packaged selections/portal closure at 1024 unique nine-digit map IDs. IDs are sorted before conversion, so argument order cannot change the build. No third-party client assets or implementation are used.

## Incremental extraction and preflight

```sh
bun run preflight --report /tmp/maple-preflight.json
bun run preflight --maps 100000000,100000001 --assets /path/to/original/files --server-reference /path/to/Cosmic --report /tmp/maple-selected-preflight.json
bun run extract
bun run extract --maps 100000000,100000001 --cache-dir /path/outside/public-output
bun run extract:full                     # explicit forced conversion, same default selection
```

Preflight accepts `--assets`, `--map`/`--maps`, `--server-reference` and `--report`. It traverses the selected world dependency closure without publishing generated release resources. Its schema-v1 JSON report records `status`, `elapsedMs`, selection IDs/seeds/blocked routes, source provenance, dependencies, failures, normalizations and coverage. Findings retain their original-source ownership; pass means this selected closure is admissible, not that full inventory, Cash Shop, all-skill UI or catalog publication passed. A failing command exits nonzero.

Extraction always performs that preflight before conversion and retains its report at `<cache-dir>/preflight.json`, or the explicit `--preflight-report <path>`. Extraction accepts `--assets`, `--map`/`--maps`, `--cache-dir`, `--preflight-report` and `--full`; use `MAPLE_SERVER_REFERENCE` for its authorized server-reference checkout. The smoke loop directs this same report into its generation evidence instead of running preflight twice. The default cache is `client/.cache/extraction`, overridden by `--cache-dir` or `MAPLE_EXTRACTION_CACHE`. Cache records must remain **outside** `client/public/generated`; they are converter state, not downloadable game resources. `extract:full` means forced cache misses, not all original maps, and remains an explicit release gate rather than a per-edit loop step.

Reusable units cover shared domains and individual maps. Recipe identities hash the version, named recipe and sorted source-file hashes, following bounded static local imports from explicit recipe roots. The extraction entry point is hashed for map orchestration without treating every imported sibling as a map recipe. Prerequisite values, required source sets, original IMG bytes and archive inventories are dependencies; actual original bytes are hashed even on hits. Changed recipes, source identities or prerequisites rebuild the unit instead of trusting timestamps.

A hit also requires matching publication bindings for shared texture, atlas, region and tiled-canvas tables. A unit that previously reused an atlas cannot restore stale coordinates when an earlier unit changes that binding. The converter recursively verifies the complete immutable output descriptor closure, including JSON children, exact lengths and SHA-256; resolved paths must remain inside generated output. Missing/corrupt output or a changed closure forces reconstruction. Verified descriptors may be reused within that extraction process, but **file existence alone is never a cache-hit criterion**. Content-addressed records retain results, sources, output closure and publication deltas without caching parser trees or decoded pixel buffers.

Immutable outputs precede atomic catalog publication. Preflight, conversion or catalog-size failure preserves the prior catalog; caches and orphaned immutable outputs are not an alternative publication pointer. The [iteration procedure](validation-method.md#persistent-smoke-loop) separates this verified incremental work from explicit full extraction, full-release/offline acceptance and broad world validation. [Current results](validation.md) record what actually ran, not inferred speedups.

## Original selection evidence

Read-only extraction of `Map.wz:Map/Map1/100000000.img` found Henesys, `info.mapMark=Henesys`, `info.swim=0`. `Map/Map1/100000001.img` contains portal `out02` targeting `100000000`, providing an original connected nearby map. `Map/Map2/230000000.img` contains `info.mapMark=AquaRoad`, `info.swim=1`, and `info.bgm=Bgm11/Aquarium`: this is the original water/swim example, not recolored Henesys. All three retain original portal and physics metadata. Global physics comes from **`Map.wz:Physics.img`**, through `readPhysicsData(map, physics)`.

Default extraction keeps the original eight acceptance seeds and adds explicit inspection roots. `catalog.routes.seeds` records the selected roots and `scope` distinguishes directed closure from an explicit selected-content release. New profiles start in Mushroom Town (`000010000`); saved profiles retain their recorded location. An explicit map-limited release that omits Mushroom Town uses its first selected map. The default participates in the content-derived catalog build identity.

| Included inspection roots             | Source-backed coverage                                                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `000010000`                           | Current beginner chain rooted at Mushroom Town; authorized server `BeginnerCreator.java` selects numeric10000.                                                                               |
| `000000000`, `000000001`, `000000003` | Real historical training scenes, not a replacement current tutorial policy or every archival island variant.                                                                                 |
| `101000100`, `101000102`              | **The Forest of Patience**, separately entered Steps1–2 and3–5.                                                                                                                              |
| `105040310`, `105040312`, `105040314` | **The Deep Forest of Patience**, separately entered Steps1–2,3–4 and5–7.                                                                                                                     |
| `103000900`, `103000903`, `103000906` | Shumi's B1, B2 and B3 construction-site chains. These correspond to distinct quests2055 **Shumi's Lost Coin**,2056 **Shumi's Lost Bundle of Money**, and2057 **Shumi's Lost Sack of Money**. |

Original availability is not directed reachability: original `Map.wz:Map/Map0/*.img`, `Map/Map1/10100010*.img`, `Map/Map1/10504031*.img`, and `Map/Map1/10300090*.img` supply scenes; `String.wz:Map.img` supplies their names. “Forest of Endurance” is not an original name or catalog alias. Catalog/manifest IDs remain nine-digit strings, whereas original map-name keys use numeric strings (`000010000` → `10000`); name consumers normalize through `Number(id)`.

Strict authored normal portals and dependencies of supported on-map NPC programs supply descendants. Closure is not reversed across one-way boundaries and does not use partially discovered dependencies of blocked scripts. Historical island variants with missing named destinations remain outside that closure unless explicitly selected. Course roots are deliberate inspection coverage, not invented town portals or permission to execute scripts. The observed current catalog contains **728 packaged scenes**. That count measures inclusion, not implemented quest/portal admission or all course mechanics; unsupported portal diagnostics and blocked NPC source diagnostics remain authoritative. See [current validation](validation.md) for the identified release and executed scope.

Authorized Cosmic server-reference scripts explain entry and reward policy but are not original Nexon source: NPC1032003/1061006 enter the two forest families; NPC1052007 handles construction-site tickets/event branches, while1052008–1052010 handle depot rewards. The unrelated booth portal `subway_in2` targets ordinary subway103000101, not a Shumi course. Packaging does not implement blocked ticket/event APIs, quest admission/completion, fares, reward randomness/gender/capacity checks or item grants. Nonzero original `fieldLimit` restrictions and exact jump-course hazard contact/movement/knockback/reset rules remain explicit incomplete-consumer boundaries, not guarantees supplied by renderable geometry.

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
- `incremental`: cache hit/miss and per-unit timing/reason evidence, logical reused RGBA bytes and verified output resource/byte counts. Timings describe the actual run, not a cache-speed guarantee.
- `policy`: `{atlasLimit, padding, regionSize, maxMaps}`.
- `counts`: unique textures, unique atlases, retained source-image count (including verified reused inputs), map-region count.
- `bytes`: `originalRGBA`/`newlyDecodedRGBA` count this run's decoding, `roundTripCompared` counts new pixel comparisons and `logicalReusedRGBA` records reused units separately. Encoded atlas PNG, decoded atlas RGBA (including padding), region JSON, map JSON and catalog JSON describe published content; reuse is not another pixel decode.
- `inputs`: keyed original `Archive.wz:IMG/path`, with original directory `path,name,type,size,checksum,offset`, SHA-256 of original IMG bytes, and exact original byte length.
- `formats` describes publication formats; `newlyDecodedFormats` distinguishes work decoded in this invocation. `images`, `durationMs` and explicit `limitations` remain diagnostic.
- `pixelRoundTrip`: `{passed:true, method}` distinguishes newly emitted atlas verification from reuse. New atlases independently parse PNG chunks, inflate IDAT scanlines and compare every subrect row against decoded original bytes, including transparent RGB; zero-filter scanlines and decoded dimensions are checked. Reused units instead verify immutable transitive output hashes against successful conversion records, not a fabricated fresh pixel comparison.
- `tiledCanvases`: keyed original full-canvas pixel identity, retaining original dimensions/source/format/scale and each tile's identity/offset/dimensions. Tile identities use the same dimensions-plus-RGBA hash convention. Tile parts also carry `sourceCanvas` and `sourceRect`. Before new atlas creation, the converter independently reconstructs every full oversized canvas from its tiles and compares every byte, including transparent RGB. `bytes.tileReconstructionCompared` sums retained per-canvas proof, which may come from verified cache records; it is separate from this run's PNG round-trip comparisons.

The original seed selection contains eight maps: `100000000`, `100000001`, `103040000`, `108000500`, `120000000`, `200090500`, `211040000`, and `230000000`. Offline integration expands the default through data-supported nonscript portal routes; explicit `--maps` remains a selected release. The actual downloadable map inventory always comes from the final catalog. Browser code never downloads a WZ archive.

## Historical converter-only fidelity boundaries

Original camera fallback is not recovered: absent VR fields retain an explicit foothold-derived inspection rectangle. NPC/mob artwork is packaged as authored metadata previews, not live spawn/AI. Selected Effect.wz sequences are separately demand-loaded previews; unresolved global/automatic map effect behavior is not synthesized. Active unsupported physics remains visible in each manifest's inventory; packaging a swim map is not proof of swim-motion fidelity. Browser residency, cancellation, uploads and native audio belong to the runtime, not this offline converter.

These are the pre-offline converter discovery boundaries, retained as historical evidence rather than current gameplay claims. Current camera, life, combat, quest, and portal behavior belongs to the corresponding domain documents; complete resource installation does not itself establish those semantics.

## Verified offline release installation

This delivery protocol is **local browser policy**, not recovered original-game behavior. No executable address or WZ field defines CacheStorage, service-worker lifetime, browser quota, release activation, or readiness. The original delivery investigation is retained in `agent://offline-gameplay-discovery-6`; its410-file/eight-map measurement is historical. Publication still inventories the complete extracted catalog, including its portal closure or explicit `--maps` selection. Required installation is now scoped to the shell/catalog and current map; publication coverage is not a startup download requirement.

`client/tools/dev.js` builds all browser bundles, then calls `prepareRelease(root)` from `client/tools/release-manifest.js` **before listening**. The builder reads the exact catalog bytes, iteratively walks every inline object for `{url,sha256,bytes}` descriptors, verifies each referenced file, opens every referenced JSON and repeats. Descriptor-bearing objects are not traversal leaves: nested gameplay metadata and new descriptors are visited as well. URL conflicts, missing files, mismatched hashes/lengths, and traversal exhaustion fail publication. Stale files elsewhere in `generated/` do not count toward readiness.

The complete shell is the document, stylesheet, main bundle, atlas decoder worker, audio capture worklet, delivery worker and its shared manifest module, web manifest, and local SVG icon. Source maps and the browser-validation oracle are not runtime dependencies. Mutable shell and catalog bytes are snapshotted under `/generated/releases/blobs/<sha256>.bin`; immutable generated resources retain their existing URLs. The resource table maps canonical runtime URLs to these immutable download sources. A deterministic schema-v1 release digest includes the whole table, exact catalog identity, packaged-map labels, and named unavailable portal destinations. The immutable `/generated/releases/<releaseId>.json` is published before atomically replacing `/generated/release.json`. A download selects an immutable release ID, never combines two mutable catalogs, and never consults a fixed map/category list.

### Native initialization and lifecycle

Main imports:

```js
import { initializeOfflineDelivery } from "./offline-delivery.js";
const delivery = await initializeOfflineDelivery(
  document.querySelector("#offline-controls"),
  prepareInitialMap, // Resolve the durable character's map, or bootstrap a new one.
);
await delivery.ready; // Verified shell/catalog and initial-map closure; renderer follows.
```

Initialization returns the delivery owner after service-worker registration. Main awaits `delivery.ready`: the owner verifies shell/catalog bytes, invokes the saved-map resolver, then verifies that map's transitive dependency closure before creating the renderer. A new profile uses the default map; existing profiles do not download it merely to discover their saved destination. The viewport reports scoped progress and retry errors. Online startup selects the latest release and reloads changed source when necessary. Manifest discovery allows120 seconds for transport and reading its bounded body, not merely receiving response headers. Interrupted transport, including body-read failure or timeout, permits only intact verified installed content; HTTP, hash and JSON failures never masquerade as offline success. `snapshot()`, `refresh()`, `prepareMap(mapId,signal)`, `download()`, `cancel()`, `activate()` and `destroy()` are the integration operations.

Every field preparation calls `prepareMap(mapId,signal)` before loading/publishing its replacement. The worker traverses only the requested map and required shared descriptors, verifies cached bytes and downloads missing resources into the pinned release. Neighbor-map descriptors do not recursively become required startup maps. A map-ready marker is distinct from complete-release readiness. Cancellation/stale callers cannot publish a replacement; an unavailable offline destination leaves the current field and saved location intact.

The explicit **Download** action still stages the entire selected release, streams bounded resources and checks encoded length/SHA-256. It independently traverses the complete cached catalog closure before writing the completion marker and staged-ready pointer. **Use installed release and reload** re-verifies the full release before atomic activation. This optional action is not invoked by ordinary startup or map travel.

`maple-offline-meta-v1` stores active/staged/partial/client pointers. Each `maple-offline-release-v1-<releaseId>-<instance>` cache owns an immutable manifest and canonical verified responses, plus separate map/full-release markers. These caches are outside bounded runtime asset-cache eviction. A verified shell with an admitted current map can be active and launch-ready while `complete:false`; this must not be described as a full installation. The network integration stops its separate progressive persistent cache after service-worker control.

A navigation checks the current release. Changed source stages/verifies its shell first, pins the new tab to that cache and finishes only the selected map's startup gate. Other tabs retain their immutable bindings across worker termination. Cached responses are length/hash checked before serving. A missing listed resource may be fetched from its exact pinned descriptor and cached only after verification; corrupt cached content, unavailable required bytes and unlisted generated content return named errors rather than incompatible source. Release-index checks remain network-only.

### Cancellation, interruption, quota, and coverage boundaries

- Full-release network/quota/hash failure leaves the previous active and staged-ready releases untouched. Partial metadata permits verified reuse on retry. Scoped map preparation likewise cannot turn a partial dependency closure into map-ready or complete-release readiness. Online startup selects the latest published release without recursively installing its other maps.
- Explicit full-release **Cancel** aborts the active fetch and removes only its incomplete target. Once the complete-pointer commit has begun, cancellation reports that there is no cancellable operation. Activation is serialized against download. Garbage collection protects active, staged, partial and live-client-bound releases; it never blindly clears installed caches during worker activation.
- Installed responses admit eight concurrent verification owners, retaining admission through response verification/error handling. Further requests enter a bounded256-entry FIFO instead of receiving a synthetic503 merely because eight readers are active. Status admits one scan. GC excludes admitted readers/status/publishers for its complete snapshot/delete interval; the response queue resumes afterward. Queue exhaustion remains explicit. Client bindings absent from `matchAll()` are checked with `clients.get()` before deletion so reserved navigation clients retain their pin.
- Explicit downloads request browser storage persistence from the user action and report the result. Scope preparation preflights its remaining encoded bytes plus a provisional10% and1MiB metadata reserve, not the complete release's size. Updates can retain old and new bytes; matching hash **and** length are required for reuse, and browser deduplication is not assumed. Quota/storage/persistence/update-check failures remain visible. Encoded-byte fit is necessary, not a promise about browser overhead or origin eviction.
- Engineering ceilings are1024 packaged maps,65,536 release resources,32MiB per ordinary resource, a separate64MiB catalog ceiling,16MiB per release manifest,8GiB total encoded content and64million visited metadata nodes. Catalog size is not permission to raise the ordinary-resource or manifest bounds. Work is iterative with descriptor URL deduplication; exhaustion is explicit. Progress and full verification are bounded and throttled for the native UI; a stopped worker is a timeout/error, never readiness.
- The content details name packaged map IDs/labels, authored portal destinations outside the release, individual missing/corrupt installed resources, and uncached requests. An explicitly selected release is complete only for its actual catalog closure, not the whole original game. Authored script dependencies and unsupported gameplay rules remain separate domain evidence; a complete download does not manufacture their missing server behavior.
- The web manifest/icon provide local launch metadata, not a promise of an OS-level PWA-install affordance. Root-scope localhost/HTTPS hosting and service-worker/CacheStorage support are required. Startup discovers a changed delivery worker and explicitly activates it while preserving every tab's content binding. Previously running old workers must first discover the update; an origin cannot execute new logic inside code the browser has not fetched.

### Executed scoped and full installation

The current observed full release contains **728 maps,49,232 resources and4,539,139,539 verified encoded bytes**. Its server-stopped cold reload and paused native-inspector destination rendering are indexed in [current validation](validation.md). These are descriptor and executed-delivery results, not wire-transfer timing, decoded residency or authorization of every packaged quest/portal.

The earlier [scoped replay](native-ui-validation/reported-r2/report.json) records a198-resource Henesys startup without installing the other355 maps; that run's regenerated closure was **45,678,089 encoded bytes (43.6MiB)**. Its optional full release contained356 maps,36,781 resources and1,154,903,755 bytes (1,101.4MiB). These historical figures are verified descriptor bytes, not measured wire transfer or decoded residency.

In that earlier scoped run, an uncached offline transition to100000001 was refused while100000000 remained live. Online travel showed a destination gate and admitted its121-resource closure. After clearing only delivery caches/registration, startup selected the saved100000001 and cached no other map. With the origin process actually stopped, that partial release still launched the saved map with `launchReady:true`, `complete:false` and no map error. Expected failed update requests and interrupted requests remain in the report; an earlier emulation-only attempt did not establish offline transport.

Historical full-release evidence: `71146c859aeae9a15148d5e91a4ec11947ffcc221bbd378441bcaea132018c94` contained **356 maps,9,709 resources and416,128,097 verified file bytes (396.9MiB)**. [Native installation](offline-validation/main/final-release-install.json) and [activation](offline-validation/main/final-release-active.json) recorded complete readiness, exact pinning and no installer/worker error or uncached content on that build.

In the historical full-release run, Main stopped the origin server and restarted isolated Chrome with its retained profile. [Cold-launch resource evidence](offline-validation/main/final-server-stopped-restart.json) records installed shell/catalog/world responses through the service worker with zero network transfer; runtime/physics faults and uncached lists remain clear. The intentionally network-only release-update check fails and displays `Update check unavailable: Failed to fetch`, without invalidating installed readiness. [Native offline portal/jump/save/reload](offline-validation/main/final-offline-portal-reload.json) confirms `navigator.onLine=false`, exact installed pinning and full saved-player equality after reload.

[Independent delivery scenarios](offline-validation/delivery/evidence.json) cover installation and failure boundaries. Main's [quota/retry/cancel replay](offline-validation/main/delivery-failures-after.json) confirms one visible quota error, cleared retry/cancel error state and preservation of the active release. [Normal update replay](offline-validation/main/delivery-update-after.json) confirms that a stable URL with a legitimately changed hash is not reported as damaged: prior-cache reuse requires matching descriptor hash **and** byte length. The retained pre-activation waiting-worker warning is historical, not the final worker's result.

### Bounded HTTP content encoding

The loopback server precomputes beneficial gzip representations for release text resources of at least64 KiB, retaining at most16 MiB total. Selection requires the current canonical file size/mtime to match and an accepted nonzero gzip quality. Responses vary by `Accept-Encoding`, report actual wire length and retain original MIME/cache policy. Browser HTTP decoding occurs before descriptor length/hash verification; immutable file identity is unchanged.

The historical [native HTTP smoke](offline-validation/main/http-encoding.json) compares identity, gzip, disabled gzip and nonzero quality: that catalog decodes to the same11,337,089 bytes and SHA-256, while gzip transfers1,979,464 bytes. [Measured gameplay/performance](offline-gameplay.md#measured-loading-stalls-and-memory) separates scoped network shaping, verified file-byte counts and physical transport bytes.
