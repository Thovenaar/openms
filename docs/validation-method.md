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

Current local-gameplay acceptance is indexed in [offline-gameplay.md](offline-gameplay.md), with the executed world/performance [summary](offline-validation/performance/summary.json) and full [report](offline-validation/performance/report.json). The earlier [in-game results](ingame-validation/results.md) remain a historical presentation/audio baseline. The world command does not enable audio or certify every UI/portal/quest interaction; independent native scenarios remain required.

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

Dynamic mobs resolve original artwork from authored placements/templates and use their captured live pose/frame plus authored-placement display tie order. Reports retain entity state so a comparison is reproducible. The browser's whole-pixel world/camera projection precedes GPU submission; rounding individual sprite vertices is not equivalent at half-pixel ties. Pixel captures explicitly use device-pixel ratio1; a CSS-element screenshot at another ratio is not a one-to-one backbuffer comparison.

For these captures only, the inspection API hides screen-space UI and the separate
world presentation overlay (nameplates, preview geometry and effects). A `finally`
block restores their prior visibility. The report explicitly labels these images
`world-artwork-only`. This isolates the oracle's actual contract; it is **not** a UI,
nameplate or effects parity check. Full visible UI/life/effect screenshots belong
to separate input-driven acceptance below.

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

Use workflowz workers with separate browser instances/pages and nonoverlapping
artifact paths. Do not modify source while accepting the final integrated build.
Drive actual keyboard/mouse input; use `window.maple.snapshot()` only to observe.
Do not teleport the player or mutate simulation state to claim portal traversal.

Required slices:

1. Original HUD/window/control presentation: open I/E/S/K windows, operate buttons
   and tabs, inspect tooltips, focus/close behavior, key-config and minimap. Verify
   modal/text focus clears movement and that gameplay resumes without stuck keys.
2. Portals: walk to supported routes, press Up, verify named arrival, return travel,
   held-key guards, hidden-portal states and safe unavailable-target behavior.
3. Life: inspect original NPC/mob artwork, facing, names, frame timing, explicit
   local-preview selection and original geometry. Click an NPC and verify the
   server-unavailable boundary rather than invented dialogue or inventory state.
4. Audio/effects: enable audio through its gesture control, exercise accepted UI,
   jump and portal cues, change map BGM and separate BGM/SE mute/volume, and operate
   explicitly labeled original-effect preview controls. Check cleanup on replacement.
5. Integrated performance/lifecycle: move with UI, life and audio active; open/close
   demand-loaded windows/effects, traverse/reload maps, observe stalls, resident
   bytes, cancellation, stale work and teardown.

Save screenshots and structured observations under `docs/ingame-validation/`.
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
