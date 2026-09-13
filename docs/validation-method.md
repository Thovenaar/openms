# Browser validation method

## Validation scope

Validation is proportional to the change. Use the smallest check that covers the changed contract, then stop; do not turn a setup or documentation task into an end-to-end acceptance run.

- **Documentation/comments only:** review the edited instructions and links. No runtime, browser, extraction, build or test-suite run.
- **Compose/environment/setup configuration:** use the relevant parser/configuration check; for Compose, `podman compose -f infra/compose.yaml config`. Do not start databases or application servers, migrate data, or exercise login/gameplay/persistence by default. A focused startup check is appropriate when startup behavior itself is the requested change, not merely because a quick start is being documented.
- **Application logic:** run the affected existing test or a narrow reproduction. Do not traverse unrelated application flows.
- **UI behavior/appearance:** check the changed interaction or surface only; do not expand into a full login/gameplay acceptance checklist.
- **Asset/extraction logic:** check the affected decoder or recipe. Reuse existing generated assets for unrelated edits.

Comprehensive smoke/end-to-end runs, `scenario all`, full extraction, world-oracle/full-offline acceptance and serial-versus-concurrent benchmarks require an explicitly requested validation/release/performance scope. The procedures below describe those available tools; they are not a per-edit checklist. The persistent smoke loop is optional, not a default completion gate.

Documentation/configuration-only work needs no new tests, screenshots, timing reports or `validation.md` entry. Report the narrow check performed and any relevant limitation briefly. If a check fails, investigate that failure without expanding into unrelated checks.

### Shorten the loop

- Prove one end-to-end vertical slice first: native input → transaction → recipient update → reconnect.
- Work in smaller, file-disjoint batches with fixed interfaces, and run cheap validation immediately after each batch stabilizes.
- Extend the existing validation tooling with a single domain-scoped command covering changed-file checks, import/contract validation, and a real authority smoke scenario.
- Reuse the extraction receipt, servers, and isolated browser contexts, rebuilding assets only when their recipe changes. Rebuild source bundles and restart source-pinned servers when their identities change; do not accept stale-runtime evidence or share mutable game sessions.

The biggest opportunity is earlier executable feedback and less speculative integration—not more agents. Start with the smallest executable slice, fix its observed failure, and expand only after it works through reconnect. Keep the domain command inside the existing tooling and the validation scope above; it must not silently invoke full extraction or comprehensive acceptance.

#### Immediate online iteration sequence

1. **Fix one contract and name the batch files.** Keep the native intent, admitted request/receipt, recipient publication and reconnect-restored state explicit. For a social slice, a real friend invitation and acceptance must reach the other authenticated player and survive reconnect; a handler existing or a sender-only success is insufficient. Finish that slice before wiring unrelated windows/domains. Delegate only independent, file-disjoint work with those interfaces already fixed.
2. **Get executable feedback before acquiring runtime resources.** Run Prettier `--check` and ESLint `--max-warnings 0` on the explicit changed JavaScript files, then the affected existing contract tests. Check imports with a nonpublishing Bun build (`write:false`), reusing `onlineBuildGraph` from `client/tools/online-build-graph.js`; this resolves transitive imports and refuses the forbidden offline-authority modules. A build does not prove receipt semantics or gameplay. Stop at the first failing stage; do not proceed into extraction or browser work. Apply any needed formatting once, before compiling the served bundle.
3. **Admit one matching runtime generation.** Compare workspace/served source, rules and catalog identities before login. Reuse the already-running online authority and proxy when they match. If stale, rebuild/restart only the owners required by the matrix below, once after the batch stabilizes. Use existing generated assets; never route an online-only change through offline release integrity/compression.
4. **Run only the domain's native authority scenario.** Borrow the retained browser and use a separate isolated context/account per participant. Reuse each participant's context within the scenario, including reconnect; never share mutable sessions across unrelated cases. Drive real native input and observe receipts, both recipients and recovered state, rather than mutating the inspection API. Load scenario modules in a fresh Bun process so retained imports cannot replay obsolete tooling.
5. **Keep one bounded report, then stop.** Record selected files/case, identities, receipt/revision evidence, recipient/reconnect observations, failure stage and separate check/identity/acquisition/readiness/action/teardown timings. Capture an image only for appearance or failure context. No unrelated login-layout tour, `scenario all`, broad test suite or concurrency benchmark.

#### Domain command to implement first

The proposed entry is `bun tools/openms.js check online-social --files <batch files> --url <existing online origin> --browserWSEndpoint <retained browser>`. **This command does not exist yet.** It is the next tooling change, not an instruction that can currently be run.

Extend the existing `tools/openms.js` dispatcher, scenario descriptors and `client/tools/scenarios/` ownership rather than creating another validation framework:

- A closed domain descriptor selects the affected files/dependencies, existing contract tests, import entrypoints and exactly one real authority scenario. Reject an unknown domain or missing scope; do not silently select every case. Follow the existing descriptor/recipe conventions.
- Execute changed-file checks → nonpublishing import/contract checks → identity/reuse admission → native input/transaction/recipient/reconnect. A check failure must exit nonzero before touching servers, extracting assets or opening a game session.
- Reuse `native-evidence.js` timings and failure reporting. Distinguish any explicitly requested checks-only result from an authority-scenario pass; do not report completion from compilation alone.
- Runtime and browser resources have explicit ownership. Borrowed servers/browser processes stay alive; only owned contexts/fixtures are retired. Keep receipt validation and immutable-content integrity guards; no file-exists shortcut.

Until that command exists, use the same ordered, scoped checks directly. The [measured findings](validation.md#iteration-loop-investigation) show these primitives are already cheap; consolidating them and fixing their order is the first opportunity, not a large orchestration rewrite.

#### Current invalidation and reuse constraints

| Change | Required work under the current identities |
| --- | --- |
| Docs/comments with no executable change | Review instructions/links; no extraction, server restart or browser run. |
| Scenario/validation tool JavaScript only | Fresh scenario process; currently rebuild/restart the frontend because `sourceIdentity()` includes all `client/tools/**/*.js`. No backend restart solely for that tool edit. |
| Browser runtime JavaScript, including presentation | Rebuild/restart both frontend and backend: `rulesIdentity()` currently hashes all `client/src/**/*.js`. Reuse extracted assets unless a transitive extraction recipe also changed. |
| Server/shared authority implementation | Restart the backend and rebuild/restart the frontend pinned to its rules hash. Recheck extraction recipes if the edit also affects conversion. |
| Browser CSS/shell | Rebuild/restart the frontend; no backend restart for a CSS/shell-only edit and no asset conversion. |
| Original/reference inputs or transitive extraction recipe | Use the existing receipt decision and incremental extraction only when invalidated; record its preflight once. Missing/corrupt publication still requires verification/repair. |

Those broad source hashes are **current constraints, not the desired design**. Separating scenario identity from runtime identity, and deriving authority identity from its complete resolved dependency closure plus explicit SQL/content/configuration inputs, can avoid unnecessary restarts. Do not simply drop directories from hashing: imported client kernels and dynamic/file-read dependencies must remain covered. Implement the fail-fast domain check first; retain current stale-build refusals until the narrower identities are proved.

## Run the current client

For an explicit world/physics release gate, extract original inputs and start the development server:

```sh
bun tools/openms.js extract
bun run client:dev:offline
# In another terminal:
bun tools/openms.js validate --duration 10 --maps 100000000,100000001,104040001,106010000,230030100,211040000 --output artifacts/world-current
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

Use affected named cases for focused browser iteration against an already running, rebuilt dev server. The `all` example is for an explicitly requested full native run:

```sh
bun tools/openms.js scenario list
bun tools/openms.js scenario --list
bun tools/openms.js scenario all --concurrency 2 --output artifacts/native-current
bun tools/openms.js scenario world-tour-return claw-close-skill --output artifacts/native-selected
bun tools/openms.js scenario window-map-travel --headed --output artifacts/native-window
bun tools/openms.js scenario --rerun artifacts/native-window/window-map-travel/inputs.json --output artifacts/native-rerun
```

The names are `world-tour-return`, `claw-close-skill`, `window-map-travel`, `diagnostic-replay`, `inspection-errors`, `same-map-teleport`, `npc-talk-menu` and `social-invitations`. `list`/`--list` prints schema-v1 descriptors (`name`, `recipe`, `mapIds`, `dependencies`) without launching Chrome. `all` or no names selects every case; named positional arguments select only those cases, rejecting duplicates and unknown names.

The online login and console surface is a separate module, `client/tools/scenarios/online-login-console.js`. For native login-only changes, use `runNativeLoginPresentation({browser, url, output, account, password, register})` with a disposable account and an existing browser. It opens an isolated BrowserContext, optionally registers the account, signs out and back in with valid credentials, checks the recovered name/appearance phases and live avatar raster, creates four characters, visits both three-slot roster pages, cancels deletion, replays the camera and exercises controls at800×600. It deletes only its named fixture characters and preserves pre-existing characters; credentials are not written to the report. It records source/catalog identity, phase timings, observations and captures, then closes its context without closing the borrowed browser. This does not enter a field or establish original-Windows pixel parity.

The broader `runOnlineLoginConsole({browser, url, output, accounts, password})` also needs developer/player accounts and covers login/field PCM and all five console sections in both authority modes. An explicitly requested full online acceptance run must additionally cover original mushroom loading during startup/field preparation, prepared native windows, World default and persisted-section migration, same-field travel, death-dialog revival and explicit logout/relogin. Retained historical six-section/carousel runs are not evidence for the current native layout.

For login layout and shared-map actions, use `runOnlineSharedMap({browser, url, output, password})` from `client/tools/scenarios/online-shared-map.js` against an isolated development database and the actual development launchers. Omit `password` to exercise the default `admin/password` and `player/password` accounts. It creates two Explorer characters, captures the name/appearance/selection panes, seeds explicitly labeled GM combat stats/funds and one monster, and drives native movement, attack, currency drop/pickup and reconnect in two isolated contexts. Both public event streams and the visible state are retained. It logs out both fixtures and closes its contexts; the caller owns server/browser/database cleanup. Do not run against personal accounts: the fixture deliberately changes its admin character. [Evidence and scope](login-shared-map.md).

For the selection/inspection-travel regression, use `runOnlineSelectionTravel({browser, url, output, account, password})` from `client/tools/scenarios/online-selection-travel.js` with a dedicated developer account containing exactly four characters. The scenario checks selected animation and recovered feet/info anchors, captures the roster at1280×800 and800×600, rejects one destination manifest to exercise rollback, drives the inspector's Go button to map100010000, moves with native input and reconnects. It waits through the original travel admission interval and for native UI readiness. It borrows the browser, owns an isolated context and logs out its fixture; it does not create accounts or alter other sessions. Connect a retained Puppeteer browser with `defaultViewport:null` so merely borrowing it cannot resize another live page. [Retained evidence and limitations](login-selection-travel.md).

Finish edits and scoped formatting before starting the online build. The current conservative server rules identity includes `client/src/**/*.js` as well as shared rules, so a client-source change requires restarting **both backend and online frontend** before browser verification; a stale backend is correctly refused as `CONTENT_MISMATCH`. Browser-only edits still do not require asset extraction. Run an updated scenario module in a fresh Bun process when borrowing a retained browser, so a cached module import cannot silently replay older validation code.

Options are `--url` (default `http://127.0.0.1:3100`), `--output` (default `artifacts/native-scenarios`), `--chrome` (default installed macOS Chrome path above), `--browserWSEndpoint`, `--headed`, `--rerun`, `--concurrency` (integer1–4, default1) and `--list`. The bounded concurrent runner shares one browser process, **not a game session**: every case owns a fresh BrowserContext, profile, IndexedDB, service worker/CacheStorage and output directory. CDP focus emulation keeps isolated foreground input alive; do not run competing performance measurements concurrently. All workers drain before teardown, and reports retain selection order. Borrowed browsers are disconnected, not closed; owned browsers close in `finally`.

Before gameplay navigation, the runner prepares a canonical profile/account-storage fixture through the production persistence validators and the fetched catalog's item authority. It intercepts a blank same-origin document with no scripts or `window.maple`, requires an empty profile store, and commits the fixture to IndexedDB before loading the actual page. Seeding is setup (`earnedProgress:false`), not an agent mutation, real purchase, earned EXP or gameplay achievement. Current persistence uses [schema8 and v1–v7 migration](offline-profile.md#schema-8).

Saved `inputs.json` is a schema-v1 replay boundary capped at2MiB, with scenario/recipe, original and captured build identities, canonical fixture and parameters. `--rerun` reads that file, validates its scenario, recipe, envelope, profile/account state and size, and replays the saved inputs against the **current** runtime. It preserves `originalIdentities` while writing the new `capturedIdentities`; it does not fetch or silently restore an old build. A conflicting named selection fails.

The served catalog must hash to the exact current workspace `client/public/generated/catalog.json` bytes, not merely share a build label. Descriptor loads are bounded and verify encoded length/SHA-256. Before and after native actions, the runtime source identity must equal the workspace source hash and its asset build must equal the fetched catalog; a source edit during execution also fails the case. Restart a standalone dev server after edits instead of accepting stale source or stale catalog evidence.

Native readiness waits for verified launch readiness, a current map, prepared gameplay, no loading, idle field transition, no pending in-game UI work and no pending profile transaction, surviving the service worker's first-control navigation. A transport warning can precede successful installed-content fallback; a startup delivery error fails early only when the actual retry control becomes visible. Readiness and fixture setup use120-second deadlines; individual native scenario execution uses a300-second deadline. These are bounds, not observed execution timings.

Each case writes `<output>/<name>/inputs.json` and `report.json`. Reports retain identities, fixture provenance/seeding status, dependencies, before/after observations, `nativeActionDelta`, checkpoints with compact state/deltas, observations and structured failures. Evidence is bounded to96 checkpoints and a rolling48 diagnostic events (warnings/errors, page errors, failed requests and HTTP errors; text capped at2000 characters). On failure it attempts `failure.png` plus up to8 recent640×450 JPEG screencast frames; these are failure context, not a complete input recording or automatic visual acceptance. Scenario-authored screenshots remain separate observed artifacts. The aggregate `<output>/report.json` and JSON console summary report pass/fail; any failed case or teardown fails the run and exits nonzero. Use fresh output directories to retain earlier failures.

Failure reports also retain the development error journal as `errorLog.text` with an explicit `truncated` flag, bounded to32,768 UTF-16 code units. This preserves actionable source stacks without another interactive reproduction merely to retrieve text.

### Timing the feedback loop

Aggregate `report.timings` separates `catalogIdentityMs`, `browserAcquireMs`, `scenariosMs` and `teardownMs`. Each case separates fixture preparation/seeding, context creation, navigation, readiness, actions, final readiness/identity/catalog checks and teardown; failed stages also retain elapsed time. When explicitly evaluating concurrency, compare identical named cases serially and with `--concurrency 2`, using distinct output directories and the same source/catalog identities; routine edits do not need this comparison. These are wall-clock observations, not inferred savings. Parent and child timings overlap: do not sum `scenariosMs` with each case's elapsed time.

`bun run client:dev:offline` writes plain stdout lines with elapsed seconds and **0/25/50/75/100% completed stages**: browser build, verified release, HTTP encoding, listener readiness. Intermediate integrity counts preserve the last completed-stage percentage. This is a stage count, not a byte-weighted estimate or ETA;100% is emitted only after readiness. The programmatic server identity retains source hashing/compilation, catalog validation, asset integrity, release publication, HTTP encoding and listener timings.

## Persistent smoke loop

Opt-in browser iteration tool. Do not launch it for documentation, Compose or unrelated server configuration changes.

```sh
bun tools/openms.js smoke
bun tools/openms.js smoke --once --output artifacts/smoke-current
bun tools/openms.js smoke --scenarios world-tour-return,diagnostic-replay --port 3102
bun tools/openms.js smoke --help
```

`smoke` owns a loopback dev server (default port3101) and one reusable headless Chrome; each native case still gets a new isolated context. Options are `--once`, `--scenarios` (comma-separated names), `--concurrency` (integer1–4, default1), `--port`, `--url`, `--output` (default `artifacts/smoke`), `--chrome`, `--assets`, `--server-reference` and `--help`. `--url`, if supplied, must be exactly the owned `http://127.0.0.1:<port>/` origin/root with no credentials, search or fragment; it is not a way to adopt an unrelated server. Asset/reference defaults and environment overrides match [extraction](asset-delivery.md#incremental-extraction-and-preflight).

The watcher inventories explicit source/tool/shell/package inputs, descriptor dependencies, original `*.wz` inputs and authorized server-reference scripts/SQL. Generated assets, dist, cache, evidence output and node_modules are excluded. A size/mtime/ctime/inode stamp avoids unnecessary hashing, but changes are admitted by SHA-256 content, including additions/removals, not mtime alone. Polling is every1000ms and changes coalesce for200ms. New edits advance a generation; a stale completion is retained as `superseded`, not accepted as the current pass.

Every generation first probes the published catalog against a persistent successful-extraction receipt in `client/.cache/extraction/` (or `MAPLE_EXTRACTION_CACHE`). Its key covers configured original/reference inputs, their content hashes, the lockfile/Bun version, and the existing transitive recipe hashes for the units in the successful extraction report. The catalog digest and report/build identity must also match. This includes shared compiler code imported by extraction, not just `client/tools` edits. Unchanged assets skip **both preflight and conversion**, including across separate smoke sessions; initial source/input scanning still runs.

Without a matching receipt, `smoke` runs **incremental** extraction, including selected-world preflight exactly once. Its `--preflight-report` writes gate evidence directly into the generation; no second preflight subprocess is needed. Only successful extraction can publish a reuse receipt, and a changed algorithm during conversion cannot overwrite that receipt. The dev server still verifies published-resource integrity; a missing/corrupt resource cannot be served merely because extraction was reused. Explicit `bun tools/openms.js extract` remains the full output-closure verification/repair operation. Current orchestration-file hashing is conservative: changing `extract.js` can invalidate map conversion even when a narrower recipe split might be possible.

Declared dependency matches select affected scenarios; shared/extraction/unknown inputs conservatively select all configured cases with a recorded reason. Startup and SIGUSR1 manual rerun select all configured cases. The loop verifies the rebuilt source/asset identities against the native report before accepting a generation.

Evidence lives under `<output>/<timestamp>-<pid>/generation-N/`, retaining `changes.json`, `generation.json`, `result.json`, job logs, native aggregate/per-case reports and preflight reports when run; session status records the current state and evidence location. A persistent failure leaves the session available for another edit or SIGUSR1 rerun rather than erasing the failed evidence. SIGINT/SIGTERM stops owned jobs; final cleanup closes the owned browser and dev server. `--once` completes one generation, tears them down and returns0 only for a nonsuperseded pass without cancellation.

Each subprocess also retains `<job>.timing.json`; generation `result.timings` separates `assetProbeMs`, the recorded `assetReuse` decision, optional asset refresh, server startup and browser acquisition/reuse. `result.identity.timings` holds the server stages, `result.nativeTimings` the runner totals, and session `teardown.json` the final owned-resource shutdown. Use these artifacts to identify the dominant stage before changing workflow.

The loop **never** invokes `extract --full`, broad `validate`, full-release download, stopped-origin cold reload, project-wide tests, lint or formatting. Those remain explicit release gates. Incremental extraction itself still performs selected-world preflight and verifies output closure; “fast loop” does not mean file-exists shortcuts or hidden skipped identity guards. Do not infer elapsed-time improvements from this procedure: retained reports in [current validation](validation.md) are the measurement authority.

Movement presentation is measured separately from frame rate. `bun tools/openms.js smoothness` samples the presented local-player pose on every animation frame while a real key is held, gates stalled and jerk frames on authoritative kernel movement within a trailing window, and computes a raw-kernel control from the same trace, so a presentation regression stays distinguishable from terrain blocking or deceleration. It runs against the offline or the online client with the same metric and never steps the simulation itself. Stall and jerk ratios are browser presentation policy, not original-client thresholds.

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

Independent slices for an explicitly requested full in-game acceptance run:

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
