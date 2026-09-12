# Browser validation method

## Run the current client

For an explicit world/physics release gate, extract original inputs and start the development server:

```sh
bun run extract
bun run client:dev:offline
# In another terminal:
bun run validate --duration 10 --maps 100000000,100000001,104040001,106010000,230030100,211040000 --output artifacts/world-current
```

The current entry point is `/generated/catalog.json` (package schema 2), not the
historical all-at-once `scene.json`. Restart the development server after source
changes: Bun builds the browser entry points at startup, including the atlas
worker, audio-capture worklet and independent composition oracle.

`client/tools/validate.js` launches a dedicated installed Chrome through
`puppeteer-core`, then closes it in `finally`. Options are `--url`, `--chrome`,
`--duration` (positive seconds, maximum120, default15), `--maps` (comma-separated packaged IDs), `--output` (default
`docs/physics-validation`) and `--headed`. Default URL is `http://127.0.0.1:3100`. It does not manage the server.
Missing inputs, rejected readiness, failed requests and failed invariants produce
an error report and nonzero exit status. Use a distinct output directory to keep
historical evidence; only artifacts named in that run's report belong to it.

[Current validation](validation.md) is the final evidence index for this iteration, including native, UI, stopped-origin offline, smoke and explicit world-gate results. Consult the report's actual status before calling a gate passed. The earlier identified world/performance [summary](native-ui-validation/final/performance/summary.json) and full [report](native-ui-validation/final/performance/report.json), [offline gameplay](offline-gameplay.md), [world report](offline-validation/performance/report.json) and [in-game results](ingame-validation/results.md) retain historical scopes. Each captured state retains `sourceBuildId` and asset `buildId`; environment alone is not a build identity. The world command does not enable audio or certify every UI/portal/quest interaction; independent native scenarios remain required.

## Native scenarios and replay

Use these for focused iteration against an already running, rebuilt dev server:

```sh
bun run scenario list
bun run scenario --list
bun run scenario all --concurrency 2 --output artifacts/native-current
bun run scenario world-tour-return claw-close-skill --output artifacts/native-selected
bun run scenario window-map-travel --headed --output artifacts/native-window
bun run scenario --rerun artifacts/native-window/window-map-travel/inputs.json --output artifacts/native-rerun
```

The names are `world-tour-return`, `claw-close-skill`, `window-map-travel`, `diagnostic-replay`, `inspection-errors`, `same-map-teleport`, `npc-talk-menu` and `social-invitations`. `list`/`--list` prints schema-v1 descriptors (`name`, `recipe`, `mapIds`, `dependencies`) without launching Chrome. `all` or no names selects every case; named positional arguments select only those cases, rejecting duplicates and unknown names.

The online login and console surface is a separate module, `client/tools/scenarios/online-login-console.js` (`runOnlineLoginConsole({browser, url, output, accounts, password})`), because it needs the online dev server, a developer and a player account, and an existing browser; it opens its own pages and never launches Chromium. It checks the recovered creation choices, the carousel portrait pixels, live login and field PCM, and all six console sections in both authority modes, writing `report.json` plus captures into its output directory.

Options are `--url` (default `http://127.0.0.1:3100`), `--output` (default `artifacts/native-scenarios`), `--chrome` (default installed macOS Chrome path above), `--browserWSEndpoint`, `--headed`, `--rerun`, `--concurrency` (integer1–4, default1) and `--list`. The bounded concurrent runner shares one browser process, **not a game session**: every case owns a fresh BrowserContext, profile, IndexedDB, service worker/CacheStorage and output directory. CDP focus emulation keeps isolated foreground input alive; do not run competing performance measurements concurrently. All workers drain before teardown, and reports retain selection order. Borrowed browsers are disconnected, not closed; owned browsers close in `finally`.

Before gameplay navigation, the runner prepares a canonical profile/account-storage fixture through the production persistence validators and the fetched catalog's item authority. It intercepts a blank same-origin document with no scripts or `window.maple`, requires an empty profile store, and commits the fixture to IndexedDB before loading the actual page. Seeding is setup (`earnedProgress:false`), not an agent mutation, real purchase, earned EXP or gameplay achievement. Current persistence uses [schema8 and v1–v7 migration](offline-profile.md#schema-8).

Saved `inputs.json` is a schema-v1 replay boundary capped at2MiB, with scenario/recipe, original and captured build identities, canonical fixture and parameters. `--rerun` reads that file, validates its scenario, recipe, envelope, profile/account state and size, and replays the saved inputs against the **current** runtime. It preserves `originalIdentities` while writing the new `capturedIdentities`; it does not fetch or silently restore an old build. A conflicting named selection fails.

The served catalog must hash to the exact current workspace `client/public/generated/catalog.json` bytes, not merely share a build label. Descriptor loads are bounded and verify encoded length/SHA-256. Before and after native actions, the runtime source identity must equal the workspace source hash and its asset build must equal the fetched catalog; a source edit during execution also fails the case. Restart a standalone dev server after edits instead of accepting stale source or stale catalog evidence.

Native readiness waits for verified launch readiness, a current map, prepared gameplay, no loading, idle field transition, no pending in-game UI work and no pending profile transaction, surviving the service worker's first-control navigation. A transport warning can precede successful installed-content fallback; a startup delivery error fails early only when the actual retry control becomes visible. Readiness and fixture setup use120-second deadlines; individual native scenario execution uses a300-second deadline. These are bounds, not observed execution timings.

Each case writes `<output>/<name>/inputs.json` and `report.json`. Reports retain identities, fixture provenance/seeding status, dependencies, before/after observations, `nativeActionDelta`, checkpoints with compact state/deltas, observations and structured failures. Evidence is bounded to96 checkpoints and a rolling48 diagnostic events (warnings/errors, page errors, failed requests and HTTP errors; text capped at2000 characters). On failure it attempts `failure.png` plus up to8 recent640×450 JPEG screencast frames; these are failure context, not a complete input recording or automatic visual acceptance. Scenario-authored screenshots remain separate observed artifacts. The aggregate `<output>/report.json` and JSON console summary report pass/fail; any failed case or teardown fails the run and exits nonzero. Use fresh output directories to retain earlier failures.

Failure reports also retain the development error journal as `errorLog.text` with an explicit `truncated` flag, bounded to32,768 UTF-16 code units. This preserves actionable source stacks without another interactive reproduction merely to retrieve text.

### Timing the feedback loop

Aggregate `report.timings` separates `catalogIdentityMs`, `browserAcquireMs`, `scenariosMs` and `teardownMs`. Each case separates fixture preparation/seeding, context creation, navigation, readiness, actions, final readiness/identity/catalog checks and teardown; failed stages also retain elapsed time. Compare identical named cases serially and with `--concurrency 2`, using distinct output directories and the same source/catalog identities. These are wall-clock observations, not inferred savings. Parent and child timings overlap: do not sum `scenariosMs` with each case's elapsed time.

`bun run client:dev:offline` writes plain stdout lines with elapsed seconds and **0/25/50/75/100% completed stages**: browser build, verified release, HTTP encoding, listener readiness. Intermediate integrity counts preserve the last completed-stage percentage. This is a stage count, not a byte-weighted estimate or ETA;100% is emitted only after readiness. The programmatic server identity retains source hashing/compilation, catalog validation, asset integrity, release publication, HTTP encoding and listener timings.

## Persistent smoke loop

```sh
bun run smoke
bun run smoke --once --output artifacts/smoke-current
bun run smoke --scenarios world-tour-return,diagnostic-replay --port 3102
bun run smoke --help
```

`smoke` owns a loopback dev server (default port3101) and one reusable headless Chrome; each native case still gets a new isolated context. Options are `--once`, `--scenarios` (comma-separated names), `--concurrency` (integer1–4, default1), `--port`, `--url`, `--output` (default `artifacts/smoke`), `--chrome`, `--assets`, `--server-reference` and `--help`. `--url`, if supplied, must be exactly the owned `http://127.0.0.1:<port>/` origin/root with no credentials, search or fragment; it is not a way to adopt an unrelated server. Asset/reference defaults and environment overrides match [extraction](asset-delivery.md#incremental-extraction-and-preflight).

The watcher inventories explicit source/tool/shell/package inputs, descriptor dependencies, original `*.wz` inputs and authorized server-reference scripts/SQL. Generated assets, dist, cache, evidence output and node_modules are excluded. A size/mtime/ctime/inode stamp avoids unnecessary hashing, but changes are admitted by SHA-256 content, including additions/removals, not mtime alone. Polling is every1000ms and changes coalesce for200ms. New edits advance a generation; a stale completion is retained as `superseded`, not accepted as the current pass.

Every generation first probes the published catalog against a persistent successful-extraction receipt in `client/.cache/extraction/` (or `MAPLE_EXTRACTION_CACHE`). Its key covers configured original/reference inputs, their content hashes, the lockfile/Bun version, and the existing transitive recipe hashes for the units in the successful extraction report. The catalog digest and report/build identity must also match. This includes shared compiler code imported by extraction, not just `client/tools` edits. Unchanged assets skip **both preflight and conversion**, including across separate smoke sessions; initial source/input scanning still runs.

Without a matching receipt, `smoke` runs **incremental** extraction, including selected-world preflight exactly once. Its `--preflight-report` writes gate evidence directly into the generation; no second preflight subprocess is needed. Only successful extraction can publish a reuse receipt, and a changed algorithm during conversion cannot overwrite that receipt. The dev server still verifies published-resource integrity; a missing/corrupt resource cannot be served merely because extraction was reused. Explicit `bun run extract` remains the full output-closure verification/repair operation. Current orchestration-file hashing is conservative: changing `extract.js` can invalidate map conversion even when a narrower recipe split might be possible.

Declared dependency matches select affected scenarios; shared/extraction/unknown inputs conservatively select all configured cases with a recorded reason. Startup and SIGUSR1 manual rerun select all configured cases. The loop verifies the rebuilt source/asset identities against the native report before accepting a generation.

Evidence lives under `<output>/<timestamp>-<pid>/generation-N/`, retaining `changes.json`, `generation.json`, `result.json`, job logs, native aggregate/per-case reports and preflight reports when run; session status records the current state and evidence location. A persistent failure leaves the session available for another edit or SIGUSR1 rerun rather than erasing the failed evidence. SIGINT/SIGTERM stops owned jobs; final cleanup closes the owned browser and dev server. `--once` completes one generation, tears them down and returns0 only for a nonsuperseded pass without cancellation.

Each subprocess also retains `<job>.timing.json`; generation `result.timings` separates `assetProbeMs`, the recorded `assetReuse` decision, optional asset refresh, server startup and browser acquisition/reuse. `result.identity.timings` holds the server stages, `result.nativeTimings` the runner totals, and session `teardown.json` the final owned-resource shutdown. Use these artifacts to identify the dominant stage before changing workflow.

The loop **never** invokes `extract:full`/`--full`, broad `validate`, full-release download, stopped-origin cold reload, project-wide tests, lint or formatting. Those remain explicit release gates. Incremental extraction itself still performs selected-world preflight and verifies output closure; “fast loop” does not mean file-exists shortcuts or hidden skipped identity guards. Do not infer elapsed-time improvements from this procedure: retained reports in [current validation](validation.md) are the measurement authority.

Movement presentation is measured separately from frame rate. `bun run smoothness` samples the presented local-player pose on every animation frame while a real key is held, gates stalled and jerk frames on authoritative kernel movement within a trailing window, and computes a raw-kernel control from the same trace, so a presentation regression stays distinguishable from terrain blocking or deceleration. It runs against the offline or the online client with the same metric and never steps the simulation itself. Stall and jerk ratios are browser presentation policy, not original-client thresholds.

## Evidence boundaries

These checks validate browser behavior and our versioned interchange. They do
not establish original-client parity. Ghidra output is retained binary evidence,
not supplied C/C++ source. The original client cannot run on this Mac, and no
original gameplay/audio recordings were supplied. Required reference material is
listed in [windows-reference-captures.md](windows-reference-captures.md).

Separate these claims:

- **Recovered:** an original archive field or executable/DLL consumer establishes it.
- **Browser-exercised:** actual input/output exercised the reconstructed surface.
- **Interchange-matched:** independent composition matches packaged artwork/state.
- **Original-reference-matched:** a supplied original runtime capture was compared.
- **Unknown/unsupported:** evidence or server state is missing; no fake behavior fills it.

## Automated world and physics checks

The current command uses real mouse/keyboard input for movement and map selection:

The command first seeds a canonical stopped-page Henesys fixture and retains `fixture.json` plus `report.fixture` provenance. Its HP, maxHP and baseMaxHP are explicitly30,000 to keep hostile-map world rendering/mobility inspection from becoming an unrelated death replay. Ordinary damage and movement remain enabled. This is **noncombat setup**, not the default beginner profile, earned progression, proof of default-character survival or original death parity. Combat/revival require their own native proof.

- Cold-load Henesys with the recorded empty-cache page-target network emulation. Service-worker-originated fetches are not throttled by that CDP target; do not call this a fully shaped connection.
- Click empty canvas near its edge, hold Right, press/release the original default Alt Jump binding, and observe displacement, rising motion, landing and artwork/pose agreement. The initial center can legitimately hit Regular Cab during entry and open a modal; that is not failed keyboard focus.
- Run a screenshot-free live movement interval with bounded frame/long-task probes.
- Open Play, type the exact map ID into the real bounded map search, wait for its single matching option, operate the native select with Home/Enter and click explicit Go. Selection alone must not transition. Retain the previous scene while loading, exercise movement/jump and capture the commit. `--maps` limits these browser selections; `browserMapCoverage` records selected IDs and packaged count. This does not inject an out-of-window option or mutate a runtime destination directly.
- Select each original hitbox preview through the real debug controls. These are
  non-authoritative geometry previews, not combat activation.
- Replay timestamped input at60/120/144/240Hz partitions. Compare selected final-state fields and the minimum Y sampled after **every physics step**, including batched low-refresh steps. This is final-state/per-step-extremum consistency, not full trajectory equality, physical display refresh or original-runtime parity.

Reports include checks, errors, captures, transitions, refresh comparisons,
source/environment details and measured samples. The validator attempts a full-page
failure screenshot when a browser page exists.

The current728-map catalog is packaged scene coverage, not728 implemented quest/portal admissions. Named missing destinations, blocked scripts and unsupported quest/course rules remain domain blockers even if inspection Go renders a scene. Retain those diagnostics rather than converting a world-oracle pass into an arbitrary server-script, ticket/reward, hazard/reset or complete-game claim.

## Independent world-artwork oracle

`client/tools/browser-oracle.js` independently fetches the current catalog, map,
resident region manifests and atlas PNGs. Canvas2D composes the captured world
state using original atlas subrects, origins, stable ordering, selected animation
frames, mirrored positions, alpha and background repetition. It does not call the
Pixi animation/rendering implementation.

Dynamic mobs resolve original artwork from authored placements/templates and use their captured live pose/frame and native mutation-order serial. Reports retain entity state so a comparison is reproducible. The browser's whole-pixel world/camera projection precedes GPU submission; rounding individual sprite vertices is not equivalent at half-pixel ties. Pixel captures explicitly use device-pixel ratio1.

For captures, the validator explicitly pauses the world before taking its snapshot
and backbuffer; live performance and each subsequent map transition explicitly
resume it. This freezes the compared state, rather than racing movement/animation
against independent composition. For oracle captures only, the inspection API
hides screen-space UI and registered world presentation layers (nameplates,
preview geometry and effects). A `finally` block restores their prior visibility.
Actual pixels come from the rendered WebGL canvas readback, not a DOM element
screenshot: Chrome's keyboard-focus outline is a CSS decoration and is
intentionally retained in the UI, not compared to atlas pixels. Reports label
these images `world-artwork-backbuffer`. This is **not** a UI, nameplate, effects,
combat or original-runtime parity check. Full visible UI/life/effect screenshots
belong to separate input-driven acceptance below.

Both actual WebGL PNG and independently composed PNG are decoded into RGBA pixels.
Comparison permits at most four 8-bit levels per channel for raster/alpha rounding;
no pixel outside that tolerance is allowed. This is an interchange-compositing
criterion, not an invented tolerance against an unavailable original recording.
Malformed pixel lengths/dimensions/tolerances fail rather than yielding NaN-based false passes. PNG evidence verifies CRCs, chunk ordering/uniqueness, bounded input/output and exact termination; unsupported transparency/APNG is rejected. The independent compositor bounds fetched bytes, surfaces, artwork and repeat work, and closes already-decoded bitmaps if a later atlas fails. It still shares generated data and captured state, so it cannot independently detect a shared extraction, animation-state or camera error.
The old renderer-only action/asset-swap suite is historical evidence, not a claim
about what the current `validate.js` executes.

A canvas-element screenshot includes DOM content painted over its rectangle.
Browser inspection controls must remain inside the sidebar, not float over the
viewport. The first integrated run caught precisely this contamination; correcting
the layout made the unchanged pixel comparison exact. Never hide unexpected
controls or relax the tolerance merely to turn that failure into a pass.

## Delegated in-game acceptance

Use separate isolated browser contexts and nonoverlapping artifact directories. Each run records both `sourceBuildId` and extracted catalog `buildId`; restart after source edits and preserve earlier failures under their original identities. Do not accept a previous startup bundle as the corrected build.

Drive trusted keyboard/mouse input. `maple.snapshot()` and paginated `maple.agent.observe()` are observations, not mutation shortcuts. Reversible scenarios and canonical stopped-page IndexedDB fixtures may establish prerequisites, but reports must distinguish seeded items/funds/rosters/EXP from actual pickup, purchase, consent or earned progression. Use the outside-game local-peer producer only for the explicitly selected peer; the active character's native feature must still be exercised.

Required independent slices:

1. **Bindings/focus:** all native binding routes, settings and macros; original Save/Discard semantics; shared HUD/carry state; text/IME, blur/visibility and pending modal loading; single-click Exit after human takeover.
2. **Inventory/trade:** UID/slot move/merge/equip/use/drop/pickup/gather; real nine-slot two-profile offers/confirmation; cancellation; exact quantity/meso conservation; capacity refusal followed by a valid new room; durable reload.
3. **NPC/quest:** actual supported authored say/choice/yes-no/number routes, shop buy/sell/recharge and disposal; challenge/claim/equip; journal/helper progress, scrolling and persistence; account unreachable authored text/speaker/artwork variants rather than invent scripts.
4. **Social/identity:** Buddy/Party/Guild/Alliance/Blacklist and Messenger; permissions/consent/search filters; rank/emblem/board/leave/disband; selected-profile UserInfo and its equipment/wishlist/collection attachments.
5. **Family:** real local relative links, costs/reputation, all entitlements, incoming/outgoing summon consent and portal-zero travel, party recipient exclusions, bonding, earned kill/level progress, expiry/day reset and reload. Shortened clocks and seeded budgets remain labeled fixtures.
6. **Cash:** original stage/category/page/search/price controls, complete asynchronous list publication, real purchase/package/gift/receipt/locker transactions, detached avatar motion/try-on/reset, all original backgrounds, editor/modal isolation and measured BGM restoration.
7. **Monster Book:** empty/owned grids, count-tier details/search/pages/cover, actual card pickup and saturated repeat consumption, correct native chat notification, persistence and the actual tooltip-only location boundary.
8. **Gameplay:** contact protection/brace/independent regeneration, recoil admission and retained attack pose, temporary-effect icons/durations/expiry/cancellation, reciprocal same-map teleport/camera history, notice/speech fade and revival.
9. **Viewports/lifecycle:** desktop and compact sizes, actual390px layout, DPR1–4 and explicit higher-density refusal, root CSS zoom separately labeled, attached-window movement/front/close/clamping, minimap alpha/filtering, tooltip wrapping, modal input and cleanup.

For disappearing tooltips, prefer viewport screenshots (`fullPage:false`): a full-page capture can resize the page, legitimately invalidate the layout generation and hide an event-owned tooltip. For native double-click proof, verify the trusted `dblclick` event sequence; a driver's unsupported option is not a product defect. Inspect every cited screenshot rather than equating a successful capture with correct pixels.

Save current screenshots and structured observations under `docs/native-ui-validation/`, retaining older `docs/ingame-validation/` reports as historical evidence.
Original WZ pixels can support asset identity/placement checks; browser screenshots
cannot stand in for original runtime reference screenshots.

## Audio proof

Playback events or source counters are insufficient. Use the runtime's bounded
`captureAudio(seconds)` inspection API after an actual enable gesture. It taps
stereo Float32 PCM after the real BGM/SE gains and before the output destination.
Retain sample rate, frame count, RMS, peak, SHA-256 and the stated representation.
When retaining raw PCM, wrap it losslessly as WAV for independent waveform analysis;
do not lossy-re-encode original MP3 or normalize the capture.

Exercise nonzero BGM output, BGM mute, independent SE output and accepted input-driven
cues. Silence is a valid mute observation but never audible-playback proof. Capture
must fail explicitly when output is not running or the request cannot complete.
A graph capture proves real renderer audio samples, not physical-speaker audibility
or agreement with an unavailable original soundtrack capture.

## Performance reporting

Record observed rAF interval distributions (including p95/p99/max), real renderer
frame/draw CPU samples, and Long Tasks where supported. The 50-ms Long Tasks floor
does not prove shorter stalls are absent. Keep captures/oracle work outside the
steady-state measurement interval. Record network/cache conditions for cold loads,
map transitions and demand-loaded resources separately.

Report shared decoded atlas CPU residency, atlas/GPU byte estimates, persistent
cache bytes and decoded audio PCM bytes separately. GPU estimates are not driver
allocation measurements; Chrome heap is not total browser RSS. Include viewport,
device scale, Chrome version and reported WebGL backend. Record all threshold
misses: a 60-Hz display or an average near 60 FPS does not establish stable 60 FPS.

Performance is **measured, not graded**: sample-capacity checks establish measurement completeness, not smoothness. No original FPS threshold is invented. Full-window rAF/Long Task observations are separate from the runtime's trailing240-slot frame/draw CPU ring; reports retain only samples known to fall inside the measurement window and label that narrower coverage. Late buffered Long Tasks preceding reset are excluded. One probe owns one observer/rAF chain and tears both down.
