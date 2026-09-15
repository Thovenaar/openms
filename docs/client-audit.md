# Retired offline client audit

> [!NOTE]
> The offline client, installer and validator covered by this report have been removed. This page preserves evidence for the retired build; use the [online validation procedure](validation-method.md) for current work.

This historical correction pass combined original-binary/WZ investigation, source-level domain audits, independent native browser scenarios, fault-boundary probes and an integrated replay. **410 integrated checks passed; 66 regression tests passed (414 assertions).** Full extraction succeeded for the **356-map** packaged closure.

This is not a claim that the original game has been reproduced completely. Supplied authority consists of original PE/DLL/WZ bytes and address-bearing Ghidra reconstruction. No original C/C++ source, PDBs, Windows gameplay recording or executable Windows reference environment was supplied. Decompiled C is evidence, not original source. See [inputs](inputs.md) and the [Windows reference request](windows-reference-captures.md).

## Callable and subsystem coverage

The [machine-readable inventory](client-audit/functions.json) enumerates **1,748 callable nodes in 97 files**, with final source SHA-256 identities and line ranges. It includes function declarations, expressions, arrows, class methods and callbacks in production browser code, public workers, Bun tools and the VitePress JavaScript configuration. Data-only files remain in the inventory. Dependencies, generated bundles, tests, retained decompilation and Java research scripts are outside that count.

The [complete review and correction ledger](client-audit/source-reviews.json) preserves domain audits, original-evidence recoveries, initial findings and corrective dispositions. Initial reports describe their own source snapshots; the inventory anchors the final source. Enumeration and source review are **not branch-execution coverage**, one-to-one original-function recovery, or a claim that every unsupported path is playable.

| Audited group | Files | Callable nodes | Connected interactions |
| --- | ---: | ---: | --- |
| Asset decoding and publication | 15 | 147 | WZ bounds/crypto/properties/pixels → frames → atlases/regions → catalog/release publication |
| Domain extraction and metadata inventories | 15 | 200 | Avatar, UI/items, portals, life, combat, audio, reactors, quests and geometry → preserved inventories/admission |
| Movement and geometry | 9 | 94 | Input intent → fixed ticks → contacts/ladders/bounds/environment → body geometry |
| Field orchestration, quests, portals and inspection | 16 | 414 | Candidate loading/commit, camera, animation, resident entities, travel, local transactions and inspection |
| HUD, windows, input and interaction | 17 | 391 | Physical keys/drafts, focus/capture, cursor, drag/resize, owned items, layout and accessible hit planes |
| Combat, audio and speech presentation | 8 | 162 | Accepted outcomes → hit/death state, mob labels, digits, spatial sounds and field-owned speech |
| Streaming, delivery and durable ownership | 10 | 235 | Fetch/decode/upload leases, cancellation, CacheStorage, release pins/GC and IndexedDB terminal outcomes |
| Validation evidence | 5 | 100 | Independent compositor/PNG boundaries, browser probes, CPU samples and refresh-partition comparison |
| Documentation routing | 2 | 5 | Checked repository evidence links, site routes and navigation |
| **Total** | **97** | **1,748** | |

## Priority correction checklist

- [x] **Stationary ladder/rope animation.** Rendered frames hold while attached without climbing intent; native stop/resume, closed endpoint, jump detachment and genuine hit detachment exercised. [Motion recovery](ghidra-client-corrections/motion-recovery.json).
- [x] **Walking against a wall.** Action selection follows held walking intent, not displacement alone. Native zero-velocity `walk1`, release to `stand1`, reversal and Down were exercised.
- [x] **Blink cadence versus protection.** Original signed hit protection lasts 1,500 ms. The recovered 30-ms update counter produces two gray/two normal updates: **60 ms gray / 60 ms normal**. Native timing and deterministic phase samples agree. The separate 5,000-ms alert/name consumers are not protection duration. The reported visual impression of faster blinking is not dismissed, but no unsupported slowdown was invented; Windows recording remains needed to compare that impression with the recovered branch.
- [x] **Cursor ownership/hotspots.** World interaction uses actual resident hit testing and NPC reach, not bounding-box proximity alone. Empty/disabled, actionable, drag and resize states were exercised. A native failure on the window title strip was fixed and replayed: hover5 → primary press12 → release5. Original hotspot pixels matched the captured cursor; no duplicate CSS cursor. [UI provenance](ghidra-client-corrections/ui-interaction-provenance.json).
- [x] **Essential controls versus inspection.** Pause, reload, map/input guidance, Key bindings and audio remain visible. Scene/geometry, offline data and runtime diagnostics are collapsed sections. Native layouts at390/768/899/900/901 pixels exercised the stacked/sidebar boundary without horizontal overflow.
- [x] **Supported bindings and Set Key toggle.** Original type4 IDs are Equip0, Item1, Stat2, Skill3, Quest8, SetKey9, ShortCut14 and QuickSlot15. Defaults are E/I/S/K/Q/Backslash/[/]. Former C/H aliases are removed; MiniMap is a direct UI operation. Native default/remapped keys, Set Key draft/quick-slot toggling, discard confirmation, save/reload, cancel and nested quick-slot rollback passed. Right Alt and Right Control work.
- [x] **HUD artwork and hit planes.** Recovered window-client origin is y22. The base stays at y529; control rows are at screen y537/565, not the former y515 row. Quick-slot hit plane is `(647,449)` and artwork begins `(647,453)`. Native clicks and pixel differences verify these distinctions. [Origin](ghidra-client-corrections/ui-hud-window-origin.txt), [coordinates](ghidra-client-corrections/ui-hud-quickslot-coordinates.txt).
- [x] **Offline chat and speech.** All-channel submission creates one head-anchored, wrapped, five-second local bubble, not a fabricated received-message log. Native typing/trusted paste cap at70; eight-entry history, channel transitions, rapid/repeated-message gates, resize/capture and cooldown recovery passed. A stale flood notice after accepted speech was fixed and replayed. [Speech provenance](ghidra-client-corrections/speech-provenance.json).
- [x] **Current-viewport window dragging.** Native drags reach all directions across a1600×900 canvas rather than the old centered800-pixel plane. Resizing back reclamps the window and leaves Close reachable. Nonuniform transformed pointer coordinates were exercised separately.
- [x] **Attacked-mob names and exceptions.** Gameplay owns one local-hit name timer, not a second generic life label. Native name expiry around five seconds and original `HPgaugeHide` Mushmom suppression passed. No `hideName=true` record exists in the356-map closure, so that branch has source evidence but no native corpus scenario. [Combat recovery](ghidra-client-corrections/combat-summary.json).
- [x] **Damage digits and combat audio.** Original digit artwork rises30 pixels over1,000 ms, opaque for400 ms then fading for600 ms. Blue/normal has no fabricated `Miss` requirement. Accepted sword, mob damage/death and Tombstone cues have native PCM evidence. Contact damage does not invent a sample or inherit a mob's pending attack-impact sound. Explicit accepted-attack provenance now selects `CharDam1/2`; a retained regression covers contact → authored impact → contact reuse.

Detailed contracts: [UI/input](ingame-ui.md), [life](ingame-life.md), [offline combat](offline-combat.md), [audio/effects](ingame-audiovisual.md), and [scene API](scene-contract.md).

## Connected findings and final dispositions

| Finding | Final disposition and exercised boundary |
| --- | --- |
| Portal admission starts loading inside an already-entered player update | Recheck loading after `beforePhysics`; retained authority stops before catch-up ticks. Public Step rejects while loading and its control is disabled. Delayed native demand held coordinates/ticks stable; old scene stayed visible. |
| Follow enabled while paused did not reposition the camera | Follow recomputes and renders immediately. Native paused manual-camera displacement followed by activation restores the expected camera without stepping. |
| Reactor offering used512 entries while profiles admit4,096; notified before debit and twice | Shared profile limit; state/debit complete before one notification. Regressions cover the admitted large inventory and atomic observer result. |
| Failed icon replacement hid the previous complete layer | Keep the last complete raster/hit plane until successful replacement; failed candidate is destroyed and signatures permit explicit refresh. Retained regression fails before and passes after the fix. |
| Valid equipment/counts exceeded UI capacities | Icon admission covers the shared128-equipment boundary. A96-stack page can allocate1,632 sprites for icons plus16-digit safe-integer counts. Actual DOM/Pixi capacity smoke reproduces both former limits and accepts the current bounds. This fixture proves capacity, not original large-count layout parity. |
| Installed-resource/status requests had no aggregate admission | At most eight admitted responses and one status scan, plus serialized installer ownership; excess work fails explicitly. No unbounded queue or invented retry. |
| Release GC could race navigation pin publication | GC and admitted response/status ownership exclude each other; reserved navigation clients are retained through `clients.get`, not erased merely because `matchAll` omits them. |
| Corrupt runtime cache entries permanently poisoned demand | Failed cached integrity evicts through the existing writer and still rejects that demand. A subsequent explicit demand can fetch valid bytes; no hidden retry. |
| IndexedDB timeout could reject an already committed write | Terminal `complete`/`abort` events determine durable outcome. A timeout whose abort sees an already-finished transaction awaits its terminal event rather than leaving the caller on an obsolete revision. |
| Concurrent extractors shared temporary filenames | Unique writer-owned staging plus complete write/atomic rename for resources, catalog and release publication. Prior published bytes survive failed replacements; staging is cleaned. Full multi-process extraction is not newly promised. |
| Direct Canvas frames lost authored alpha endpoints | Same original negative-sentinel/initial255 interpretation as numeric frames.98,462 packaged frame comparisons against original WZ metadata passed, including82 authored-alpha cases. |
| PKG1 high-size DWORD and malformed extraction options | Reject nonzero high DWORD as the original reader does; preserve valid low-word archives. Missing/option-shaped argument values fail before extraction. |
| Malformed PCM worklet requests could leave stale capture completion | Invalid/overlapping input clears stale capture state; focused worklet regressions cover the error transition. Normal capture still records post-gain PCM. |
| Metadata shape/identity/evidence promotion gaps | Reject scalar Say branches without discarding their text; reject normalized portal collisions and malformed ladder flags; do not promote unknown/nested Physics.img rows to recovered globals; retain authored zero flags. |
| Inventory/probe failures could look complete or successful | All three actual CLI entrypoints retain exact failure paths and partial artifacts, mark `complete:false`, and exit nonzero. Incomplete scans do not manufacture absence-based evidence. |
| Validator could accept corrupt evidence or overstate performance | PNG CRC/order/transparency and RGBA/tolerance boundaries hardened; compositor work/bitmap ownership bounded; repeated probes own one observer/rAF chain; old long tasks filtered; actual trailing CPU-ring samples retained. Correctness and performance verdicts remain separate. |

[Loading/follow native proof](client-audit/runtime/loading-follow.json), [final native UI replays](client-audit/runtime/final-ui-replays.json), [icon capacity proof](client-audit/runtime/icon-capacity.json), and [executed publication/delivery/metadata probes](client-audit/runtime/boundary-proofs.json) distinguish real-browser evidence from controlled boundary fixtures. Cache/pin/IndexedDB race probes exercise the production modules with controlled API boundaries; they do not establish the frequency of a browser task-source interleaving.

### Findings deliberately not converted into new features

- Proven but unexercised scalar tag6 remains an explicit unsupported decode path; no speculative BigInt/number conversion was added.
- Shared read-only crypto key capacity is an intentional bounded cache. All production callers read only requested bytes; defensive copies would add work without a demonstrated mutating caller.
- Invalid/no-route portal metadata remains preserved and denied. The release's unavailable-map list inventories legal map IDs, not every sentinel or malformed route; extraction is not permission to authorize scripts.
- Already parsed empty foothold containers are bounded by the parser's child/depth/byte-work limits; redundant downstream traversal guards were not added.
- Selected original combat sound aliases that do not resolve remain explicit `{available:false, source, alias, reason}` records. Available records contain their exact descriptor. No path guessing, synthetic audio or swallowing of publication errors.
- Tar container hashes were never a stable-output contract; original IMG byte hashes remain the identities. `activateByTouch`, script rewards, skill callers, server channels and server-authorized outcomes are not fabricated from retained metadata alone.

## Native scenarios and evidence

Three isolated Chrome workers performed independent domain scenarios. Main replayed the reported cursor/chat defects and ran the final integrated/mixed scenarios. Native input means real Chromium keyboard/mouse actions; inspection pause/step/camera/map setup, isolated profile fixtures, explicit lifecycle/composition dispatch and one-pixel capacity fixtures are labeled separately.

| Domain | Evidence | Observed result |
| --- | --- | --- |
| UI/cursor/HUD/bindings | [25 scenario records](client-audit/ui/results.json), [captures](client-audit/ui/) | Default/remapped actions, draft persistence/rollback, nested dialogs, cancellation, original cursor hotspot, exact HUD/quick-slot geometry and responsive dragging. One strip-cursor failure fixed and replayed. |
| Chat/speech | [summary](client-audit/chat/summary.json), [records](client-audit/chat/results.json), [skin pixels](client-audit/chat/skin-pixels.json), [captures](client-audit/chat/) |70-character input/paste, history/gates/channels, world anchoring, wrapping, resize and lifetime.1,777/1,777 sampled opaque pixels across all10 original skin parts match; transparent/glyph-covered pixels excluded. |
| Motion/combat/audio | [records](client-audit/combat/results.json), [original records](client-audit/combat/original-records.json), [PNG/WAV captures](client-audit/combat/) | Ladder/rope/wall transitions,60-ms tint phases/1,500-ms protection, names/digits and post-gain audio. Native Attack-only RMS0.0162182; Attack+Damage0.0313143; Attack+Die0.0167401; ready fatal Tombstone0.0208204. Contact-only correctly silent. |
| Integrated client | [410-check report](client-audit/validation/report.json), [captures](client-audit/validation/) | Eight browser maps, nine independent atlas-region compositor checks, native movement/jump, geometry previews and356 final-state/per-step-extremum refresh comparisons. No failed checks or unhandled browser exceptions. |
| Mixed gameplay | [measurement](client-audit/runtime/mixed-gameplay.json), [capture](client-audit/runtime/mixed-gameplay.png) |15 native alternating walks/Control edges, five Alt commands, three Equip open/close cycles and three local speech submissions with audio running; all15 sampled Control phases were attacks and five mob deaths were observed. |
| Installed release, origin server stopped | [installation/replay/fault record](client-audit/runtime/offline-final.json), [staged release](client-audit/runtime/offline-staged.png), [networkless gameplay](client-audit/runtime/offline-server-stopped.png), [explicit missing-file state](client-audit/runtime/offline-explicit-missing.png) | Native complete installation and activation of 11,748 resources / 420,806,387 bytes / 356 maps. HTTP-cache-disabled reload, unvisited-map demand, native movement/Equip/speech and cached attack audio succeed with 3101 stopped. Deliberate installed-descriptor removal returns 503, retains the current scene/pin and makes verification report not ready. |

Native OS IME was unavailable. Dispatched composition events do not substitute for it. Plain automated paste shortcuts emitted no paste event in the headless chat run; the separately recorded native browser editor paste command emitted a trusted event and enforced70. Authorized/zero combat outcomes have no genuine setup path here; their deterministic source regressions are not presented as native gameplay. Early incomplete stepping and pre-audio-ready silent captures remain identified in the raw records rather than being rewritten as passes.

The final installed-release replay used a fresh `audit-offline.localhost:3101` origin, not the user's existing storage. Stopping the origin server also removed network access for service-worker requests; this was not page-target-only offline emulation. Reload selected 100000000 and public map setup loaded previously unvisited 100010000. With BGM muted, a native Control attack produced 48,000 stereo frames at 48 kHz, RMS 0.0229361. No unhandled page error or missing gameplay resource occurred before explicit fault injection. The update check correctly reported `Update check unavailable: Failed to fetch`; `navigator.onLine` was not forced false. Removing the unvisited 100000001 descriptor was controlled CacheStorage fault setup, not a claim of spontaneous eviction. Its named installed-resource 503 and failed transition preserved 100010000 and the same release pin; native verification identified the missing file. The isolated profile owner was destroyed and that origin's storage cleared afterward.

![Original wrapped speech over native gameplay](client-audit/chat/04-wrapped.png)

![Original damage digits and single attacked-mob name](client-audit/combat/mob-hit-name-damage.png)

![Replayed original drag cursor](client-audit/ui/window-drag-cursor-replay.png)

## Performance and resources

**Measured, not graded.** No original-runtime recording or approved browser smoothness threshold exists. Sampling capacity is a completeness check, not a performance acceptance criterion. Both runs used1280×900/DPR1, headless Chrome152 and ANGLE Metal on Apple M3. They are observed browser runs, not physical60/120/144/240-Hz display tests.

| Measurement |15.006-s held-walk run |27.324-s mixed gameplay run |
| --- | ---: | ---: |
| rAF interval samples |899 |1,633 |
| Median / p95 / p99 interval |16.7 /16.8 /16.8 ms |16.7 /16.8 /16.8 ms |
| Maximum interval |16.8 ms |100.1 ms |
| Intervals above20 ms |0 |1 |
| Recorded long tasks |0 |1 at103 ms |
| Frame CPU p95, trailing240 samples |2.5 ms |1.6 ms |
| Draw CPU p95, trailing240 samples |1.2 ms |0.8 ms |
| Used JS heap at sample |31,701,939 bytes |102,602,662 bytes |
| Resident atlas count |16 |39 |
| Decoded CPU / estimated GPU atlas bytes |45,718,844 each |72,171,680 each |
| End fetch/decode/upload queues |All empty |All empty |

The mixed run includes one visible-timing outlier; it is not a blanket stutter-free claim, and its cause was not attributed by the retained long-task probe. Its audio cache held67,433,520 bytes across three decoded resources, with no pending audio work. Audio/atlas accounting and JS heap are different measurements, not values to combine into an asserted physical-memory total. Atlas evictions reached30; no backpressure was reported.

The integrated cold-ready measurement was25.441 s under page-target150-ms/187,500-byte-per-second emulation with a fresh profile/cache. Service-worker-originated fetches are **not** covered by that emulation, so this is not a whole-origin3G throughput claim. CPU distributions cover only the trailing240-slot runtime ring inside each window; the full-window rAF distribution is retained separately.

## Verification and remaining authority boundaries

The retained reports record the exact retired extraction, formatting, test, browser-validator and documentation-build invocations. Those offline entry points are no longer runnable. Current checks use `bun client/tools/build-online.js`, focused online scenarios and the [online validation procedure](validation-method.md).

The isolated acceptance server used3101 and did not replace the user's3100 server. Throwaway corruption/publication/capacity probes were used for boundary proof rather than left as production features. The two final retained regressions specifically defend failed icon retention and contact-versus-authored audio provenance; the latter's first fixture mistake was corrected before observing the actual pre-fix wrong sound.

The implementation/evidence milestone is `cc2a4f5`. The built documentation [native browser report](client-audit/site/browser.json) covers all32 configured routes, search to this performance section, mobile cross-route/menu/backdrop interactions and all three evidence figures. [Desktop](client-audit/site/desktop.png), [search](client-audit/site/search.png) and [mobile](client-audit/site/mobile.png) captures retain the actual surface. The VitePress build passes with a minified-chunk-over500-kB advisory; no warning threshold was raised or suppressed.

Still unavailable: original Windows timing/font/mixer parity, uncommon unexercised decoder forms, complete original source/symbols, server damage/progression/AI, scripted portals/reactors/quests, arbitrary skills/loadouts, multiplayer/received chat and backend/account flow. The independent compositor proves packaged-data/captured-state interchange, not independent extraction, animation/camera truth or original Windows screenshots. These are explicit evidence boundaries, not hidden fallbacks or newly claimed playable systems.
