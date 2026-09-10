# Browser validation method

## Run the current client

Extract original inputs and start the development server before validation:

```sh
bun run extract
bun run dev
# In another terminal:
bun run validate --duration 10 --maps 100000000,100000001,104040001,106010000,230030100,211040000 --output docs/offline-validation/performance
```

The current entry point is `/generated/catalog.json` (package schema 2), not the
historical all-at-once `scene.json`. Restart the development server after source
changes: Bun builds the browser entry points at startup, including the atlas
worker, audio-capture worklet and independent composition oracle.

`client/tools/validate.js` launches a dedicated installed Chrome through
`puppeteer-core`, then closes it in `finally`. Options are `--url`, `--chrome`,
`--duration` (positive seconds, maximum 120, default 15), `--output` (default
`docs/physics-validation`) and `--headed`. It does not manage the server.
Missing inputs, rejected readiness, failed requests and failed invariants produce
an error report and nonzero exit status. Use a distinct output directory to keep
historical evidence; only artifacts named in that run's report belong to it.

Current native acceptance is indexed in [native-ui-validation.md](native-ui-validation.md), with its identified world/performance [summary](native-ui-validation/final/performance/summary.json) and full [report](native-ui-validation/final/performance/report.json). Each captured state retains `sourceBuildId` and asset `buildId`; environment alone is not a build identity. [Offline gameplay](offline-gameplay.md), the earlier [world report](offline-validation/performance/report.json) and [in-game results](ingame-validation/results.md) retain their historical scopes. The world command does not enable audio or certify every UI/portal/quest interaction; independent native scenarios remain required.

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

- Cold-load Henesys with the recorded empty-cache page-target network emulation. Service-worker-originated fetches are not throttled by that CDP target; do not call this a fully shaped connection.
- Click empty canvas near its edge, hold Right, press/release the original default Alt Jump binding, and observe displacement, rising motion, landing and artwork/pose agreement. The initial center can legitimately hit Regular Cab during entry and open a modal; that is not failed keyboard focus.
- Run a screenshot-free live movement interval with bounded frame/long-task probes.
- Select requested browser maps through the real map control, retain the previous scene while loading, exercise movement/jump and capture the commit. `--maps` limits these browser selections; the report records the actual coverage.
- Select each original hitbox preview through the real debug controls. These are
  non-authoritative geometry previews, not combat activation.
- Replay timestamped input at60/120/144/240Hz partitions. Compare selected final-state fields and the minimum Y sampled after **every physics step**, including batched low-refresh steps. This is final-state/per-step-extremum consistency, not full trajectory equality, physical display refresh or original-runtime parity.

Reports include checks, errors, captures, transitions, refresh comparisons,
source/environment details and measured samples. The validator attempts a full-page
failure screenshot when a browser page exists.

## Independent world-artwork oracle

`client/tools/browser-oracle.js` independently fetches the current catalog, map,
resident region manifests and atlas PNGs. Canvas2D composes the captured world
state using original atlas subrects, origins, stable ordering, selected animation
frames, mirrored positions, alpha and background repetition. It does not call the
Pixi animation/rendering implementation.

Dynamic mobs resolve original artwork from authored placements/templates and use their captured live pose/frame and native mutation-order serial. Reports retain entity state so a comparison is reproducible. The browser's whole-pixel world/camera projection precedes GPU submission; rounding individual sprite vertices is not equivalent at half-pixel ties. Pixel captures explicitly use device-pixel ratio1.

For oracle captures only, the inspection API hides screen-space UI and registered
world presentation layers (nameplates, preview geometry and effects). A `finally`
block restores their prior visibility. Actual pixels come from the rendered WebGL
canvas readback, not a DOM element screenshot: Chrome's keyboard-focus outline is
a CSS decoration and is intentionally retained in the UI, not compared to atlas
pixels. Reports label these images `world-artwork-backbuffer`. This isolates the
oracle's actual contract; it is **not** a UI, nameplate or effects parity check.
Full visible UI/life/effect screenshots belong to separate input-driven acceptance below.

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
