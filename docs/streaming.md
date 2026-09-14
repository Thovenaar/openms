# Progressive browser streaming

This is a new browser delivery/runtime design, not a claim about the original client's networking, cache, camera, scheduling, or memory limits. Original image placement, alpha, part ordering, animation delays, and background displacement/repetition remain governed by the recovered rendering evidence. Physics behavior and unsupported original options are documented separately in physics evidence/options.

## Public interchange

Production loads `/generated/catalog.json` schema version 2, then the selected catalog map's content-addressed manifest. There is no `scene.json` compatibility loader. Catalog entries identify manifest URL, exact encoded byte length, SHA-256, and packaged neighbor IDs. Manifests identify actor entities, atlas/subrectangle dictionaries, complete modest physics metadata, and region descriptors. Regions contain schema version 2, matching region ID, and their entities. See `reconstruction-contract.md` for fields and `scene-contract.md` for entity semantics.

Every immutable manifest, region, visual bundle, reference resource, PNG and MP3 is byte-length and SHA-256 checked, including persistent-cache hits. The root catalog is fetched without the HTTP cache and its version/build ID is inspected. A map manifest ID must match its catalog key; region IDs must match descriptors. Dictionary, array, coordinate, animation, atlas rectangle, resource URL and dimension boundaries are validated before constructing resources. This detects stale/corrupt content; hashes do not authenticate an untrusted server.

A corrupt progressive-cache hit fails explicitly and is evicted through the same serialized writer, including byte/entry accounting. Only a subsequent explicit demand fetches replacement bytes; the failing call does not hide corruption with an automatic retry. Installed-release corruption remains a distinct explicit503 path.

Atlas parts use Pixi `Texture` subrectangles of shared `ImageSource`s, preserving straight source pixels through the worker's explicit premultiplied ImageBitmap path, nearest filtering, offsets, part/entity flips, alpha interpolation and stable z ordering. Losslessly tiled large original canvases carry `frame.sourceSize` so background repeat periods remain the original logical width/height when WZ `cx`/`cy` are zero. Background viewport clipping uses the union of tile rectangles, not the first tile. Every tile participates in repetition and alpha.

Each v2 entity requires `order`, its global pre-partition input index. Equal-z entities sort by that value, not region URL, region arrival time or map iteration order. Part z ties retain their original input order within each frame.

## Ownership and demand

- Initial critical load: actor atlas set plus regions intersecting the initial viewport and all `always` regions. Other regions are not awaited.
- Every 200 ms, a timer (not RAF) updates region demand. Visible regions are requested before regions within a half-viewport margin. At most two region loads are outstanding. Leaving that margin cancels pending loads and destroys resident region display objects/subtextures.
- Each region commits its complete entity set only after all required atlases are fetched, decoded and uploaded. `VisualTextures` owns subtextures and per-consumer leases; the shared AtlasStore keys sources by content hash. Regions, map candidates, persistent HUD, demand-loaded windows/minimaps and effect previews participate in the same residency budget.
- The login surface shares that budget only while it is presented. Entering the world destroys the login scenery and releases its portrait leases, and a hidden login prepares no portrait: an admitted dense field such as Lith Harbour (104000000) already retains most of the reservation when the post-entry roster refresh runs. Returning to the login surface releases the retained field before its artwork is loaded, and the next admitted snapshot rebuilds that field. One portrait slot never holds two previews, so a replaced preview releases before its replacement reserves an atlas.
- The old map remains visible while a replacement loads, but its gameplay authority and input are frozen. A generation/AbortSignal check gates atomic swap, and the tick rechecks ownership after portal admission. Failed/superseded candidates cannot replace the retained map. Replacement destroys old references only after the complete candidate is ready.
- Same-map relocation stages regions intersecting the rectangle swept by the current and destination camera viewports before publishing the new player position. Existing demand drains first, staging loads serially, and timer eviction pins the sweep until normal half-viewport demand covers the remaining smooth travel. This is browser delivery policy, not recovered native prefetch. It leaves camera filter history and same-map brightness unchanged; failed staging retains the old player/scene, reports the error, and releases the pin. Existing atlas/entity/sprite ceilings still apply rather than admitting an unbounded teleport cache.
- Switching maps cancels old neighbor metadata demand. At most two catalog neighbors are prefetched, metadata only, into the bounded persistent cache. IDs absent from the catalog are explicitly unavailable, not fetched as invented paths.
- Last-reference release aborts the atlas's underlying work. Active native ImageBitmap decoding cannot be interrupted: its result is closed on return when cancelled. Queued fetch/decode jobs are immediately removed on cancellation. The dedicated worker is terminated on API teardown, rejecting its outstanding promises.
- A failed region remains explicitly failed for that map lifetime rather than entering a retry loop. Reload is the explicit retry operation. A budget failure retains the current map and reports backpressure, rather than silently dropping the byte ceiling or substituting artwork.
- A visual owner's caller signal forwards cancellation only while loading. After success it detaches: cancelling a completed map request cannot destroy a still-displayed HUD or another persistent owner. Consumer display objects die first, then subtextures, then owned leases/source references. Integrated native map travel exposed and verified this lifetime boundary.
- Audio uses the same bounded verified network/cache path, not a separate download cache. Native PCM has its own bounded accounting and serial admission. New BGM selection cancels obsolete pending BGM fetch/decode/validation; the prior playing track stays pinned until successful replacement. Selected effect artwork has one demand owner and uses the shared atlas path.

## Browser engineering ceilings

| Resource              | Policy                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network               | 4 admitted fetches, 256 maximum queued jobs; 32 MiB encoded resource ceiling                                                                                                  |
| PNG decode            | Dedicated `/dist/atlas-worker.js` worker; 2 admitted decodes                                                                                                                  |
| Atlas                 | Maximum 2048 by 2048, no mipmaps; 16 MiB RGBA per atlas                                                                                                                       |
| CPU decoded residency | 192 MiB reserved before fetch/decode, including pending and cancelled-but-not-yet-settled records                                                                             |
| GPU estimate          | 192 MiB, same reservation discipline, including both current and candidate maps                                                                                               |
| Upload batches        | Timer-driven, at most 16 MiB and 4 ms admission budget per batch                                                                                                              |
| Persistent cache      | CacheStorage `maple-content-v2`, 192 MiB, 2048 entries, serialized FIFO eviction                                                                                              |
| Draw surface          | Maximum 2560 by 1440 at resolution 1                                                                                                                                          |
| Display data          | 8192 resident entities and 65536 resident sprites per map; at most 10000 pooled sprites per repeating background, 4096 parts per frame                                        |
| Inspection samples    | Fixed 240-element frame-delta and draw-CPU rings                                                                                                                              |
| Audio PCM             | 160 MiB decoded cache, 64 entries, serial native decode, 32 pending demands, 24 sources                                                                                       |
| UI / effects          | Four ordinary windows plus two reserved modals;1632 raster objects/128 controls per surface; one preview effect; one field speech bubble and64×10 pooled combat-digit sprites |
| Live audio capture    | One capture, at most five seconds of stereo Float32 output; caller owns returned bytes                                                                                        |

A single synchronous GPU driver upload cannot be preempted. `longestUploadBatchMs` exposes that actual duration; 4 ms is a scheduling/admission budget, not a hard real-time guarantee. Decoded ImageBitmaps remain alive with their atlas source for renderer ownership/context restoration and close when the last owner leaves. There is no unbounded zero-reference GPU cache. Compressed fetch buffers and CacheStorage copies are additionally bounded by admitted fetch/decode counts and the per-resource ceiling; `cpuDecodedBytes` specifically measures decoded RGBA reservations, not total JavaScript heap or browser internals. Persistent-cache unavailability is visible in `cacheStatus`; streaming remains network-backed without pretending persistence succeeded. Browser/driver allocations are estimates rather than an exact process-RSS cap.

Background sprite pools are prepared before commit, for the maximum supported drawable surface, never grown during RAF. Simulation/render callbacks mutate preallocated input, simulation state, animation sprites and metric rings. Demand, metadata parsing, entity construction, control readouts and snapshots allocate outside the hot loop.

Henesys `hp01(-377,273) -> hp01_1(5801,454)` exposes the distinction between filter and delivery: the preserved native filter can traverse several regions between 200-ms demand passes. Merely keeping departure regions does not make intermediate/destination artwork ready. All eight Henesys backgrounds are already `always` regions; original `back/0` is a 256×256 both-axis repeat, so spatial eviction of that background is not the demonstrated root cause. The same-map camera-path staging closes the visible-region readiness gap without a fade, camera snap, repeat-pool growth, or generated-artwork change.

## Controls and inspection API

Click/focus the canvas. Arrows move/climb; other actions use the shared active `KeyBindings` map. Recovered defaults are Alt Jump, Control Attack, I/E/S/K windows, Backslash Set Key, Q Quest, [ ShortCut and ] QuickSlot. The old C/H aliases are removed. Down+bound Jump requests dropping; Up requests supported portals before physics. Blur/visibility changes clear input. KeyConfig is nonmodal; dialogue/quick-key popups and focused chat/text input block gameplay. See [UI/input contract](ingame-ui.md).

The sidebar keeps pause/reload/map/input/audio available, with scene/geometry, reference data and runtime diagnostics in advanced sections. Missing original avatar actions are explicitly reported as `actorArtworkUnsupported`, not replaced with fictional art.

Camera follow uses the recovered VR center-limit helper documented in [UI](ingame-ui.md), not the earlier65%-height heuristic. Camera buttons and `setCamera` disable follow; re-enabling it recomputes and renders immediately while paused. Other viewport sizes and interpolated presentation remain browser extensions. Hidden tabs reset the elapsed-time baseline.

`window.maple` is the sole ambient mutable inspection API:

- `ready`: promise for the latest requested critical map load. Resolves after atomic commit; failed/cancelled requests reject. Neighbor/near artwork may continue after readiness.
- `switchMap(id)`, `reload()`: return the new readiness promise. Reload also refetches the catalog. Superseded requests reject with `AbortError`.
- `snapshot()`: allocates JSON-safe build/map/camera/input/simulation/entity/region data, `field` portal/life state, `inGame` UI/audio state, `streaming` ownership metrics, bounded frame/draw samples and explicit errors.
- `pause(boolean)`: pauses or resumes simulation advancement, not input registration or streaming.
- `step(ms)`: requires pause and no pending replacement, accepts finite0–10000ms, advances actual simulation/animation, renders and returns a snapshot. It cannot advance the retained field during loading.
- `setDebug(boolean)`, `setFollow(boolean)`, `setCamera(x,y)`: explicit inspection policies.
- `setAction(id,name)`, `setVisible(id,bool)`, `setLayer(id,z)`, `setPosition(id,x,y)`: resident entity inspection. The player position belongs to simulation and cannot be teleported through `setPosition`. Simulation reasserts its supported player action when advanced. When paused, `step(0)` renders pending inspection changes.
- `captureAudio(seconds)`: observes actual post-gain stereo output, returning bounded PCM bytes and numerical metadata; no synthetic audio proof.
- `setPresentationVisible(boolean)`: inspection-only gate for UI/world overlays during the independent world-artwork oracle. Full in-game acceptance must keep them visible.
- `destroy()`: idempotently aborts map/neighbor/audio/effect demand; destroys persistent UI and field consumers before visual leases; closes voices/PCM/context, atlas/bitmap/worker resources, observers, listeners, timers and Pixi.

Streaming metrics include admitted/queued fetch and decode counts, upload queue/batches and longest duration, cache bytes/entries/status/hits, encoded download bytes, atlas count, decoded CPU reservation bytes, GPU reservation estimate, evictions, backpressure count, and the public limits. Samples are bounded storage, not an unbounded telemetry log.

## Verification boundary

Integrated native-input evidence is retained under [ingame-validation/](ingame-validation/), separately from the earlier [physics pass](physics-validation/results.md). [Validation method](validation-method.md) distinguishes full UI/audio acceptance from the world-artwork oracle. Native scenario workers use isolated Chrome contexts, profiles and service-worker/CacheStorage state inside one owned browser; their timing is excluded from dedicated frame/stall/residency measurements. Original Windows visual/audio parity remains unverified.

Focused integration recipe: `same-map-teleport` seeds a detached profile at original Henesys `hp01`, waits for actual ground contact, activates it through real Up, and samples up to360 consecutive presented canvases. It retains bounded low-resolution PNG checkpoints, checks every frame for world artwork rather than clear/black pixels, requires zero fade and intermediate filtered-camera positions, and records the scene sprite ceiling plus the runner's `nativeActionDelta`. Its sample readback is correctness evidence, not a performance benchmark. `client/test/stream-scene.test.js` isolates staging/eviction and failure-retention transitions. Settled serial and isolated-context parallel runs both passed; [retained native evidence](native-ui-validation/reported-fixes/native-report.json) and [reviewed intermediate artwork](native-ui-validation/reported-fixes/teleport-frame-60.png) establish the browser result, not Windows parity.
