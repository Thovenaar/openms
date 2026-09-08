# Browser validation method

Run after the original asset extractor has produced `client/public/generated/scene.json` and its referenced PNG textures, and the development server is serving port 3100:

```sh
bun run validate
bun run validate --duration 30 --output docs/validation/run-30s
```

The command uses `puppeteer-core` and `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Options are `--url`, `--chrome`, `--duration` (positive seconds, default **12**), `--output` (default `docs/validation`), and `--headed`. It does not start or stop the development server. It launches a dedicated browser and closes that browser in `finally`, including failed invariant checks. Missing scene inputs, failed asset requests, rejected readiness, and invariant failures produce a nonzero exit status and a JSON failure report. Browser startup must itself succeed before browser captures are possible.

## Evidence, not original-client parity

This command validates the browser's interpretation of the newly designed scene interchange. It **does not establish parity with an original MapleStory client**. Original-client screenshots, animation traces, and equivalent original performance measurements are unavailable to this command. The report marks that distinction explicitly and records the manifest's source and evidence fields. No fictional scene or placeholder texture is substituted for missing extracted inputs.

`report.json` contains the observed checks, unexercised cases and reasons, capture paths and renderer state, scene provenance, measurement samples, environment details, and failures. Captures are numbered canvas PNGs; `-oracle.png` files are the independently composed expectations. On failure the validator also attempts `failure-page.png`. The default report filename is overwritten by the next run; use distinct `--output` paths to retain separate runs. Only files listed by the current report belong to that run; older captures in a reused directory are not current evidence.

## Behavior and actual pixels

The validator waits for `window.maple.ready`, pauses animation, resets current actions, and captures the committed baseline. It operates through the public API described in `scene-contract.md`.

Each behavioral capture is decoded into RGBA pixels using PNG scanline filters and zlib, not compared using PNG file length, compressed bytes, or a screenshot's existence. A separate browser Canvas2D compositor loads the original extracted texture PNGs and independently applies the manifest's camera, entity positions, stable entity and part z ordering, frame selection, mirroring, and opacity. It uses the renderer's explicit opaque `#101820` background, nearest sampling, and one physical pixel per CSS pixel. Rendered PNG pixels must match this reference with at most four 8-bit channel levels of alpha-rounding error; **no pixel outside that tolerance is allowed**. This is an interchange-compositing oracle, not an original-client reference.

The exercised paths are:

- Paused `step(0)` must leave pixels exactly unchanged.
- Every character with a multiframe action, the first animated map entity, and the first explicit-alpha-tween map entity have every action/frame boundary checked (duplicate subjects are removed). Other entities are hidden and the subject centered. `setAction` resets frame zero. Exact delay boundaries and multiple-cycle jumps are checked. Static actions retain their pixels over a 10-second step. Before a boundary, frame index remains stable; pixels remain stable unless the frame contains an alpha tween, whose expected intermediate pixels are independently composed. The report explicitly identifies this coverage, not exhaustive per-instance map testing.
- Visibility chooses an entity that actually contributes visible pixels, and requires a state change and a rendered pixel change. A scene with no visible rendered contribution fails.
- Position changes by an integer offset and must change state and pixels, with the oracle checking the expected location.
- Camera changes are checked against the oracle including background parallax/repetition. A second pair of captures hides backgrounds and verifies exact interior world-pixel translation, rather than wrongly treating parallax as a translation error.
- Layer changes move visible candidates to both z extremes until differing overlap pixels are observed, with the oracle checking each result. If the scene has no demonstrable occlusion difference, the pixel-occlusion check is honestly marked `not-exercised`; layer state is still checked. Restoring the scene must restore exact baseline pixels.
- An intercepted scene-manifest request is deliberately held during an atomic reload. Pending loads must remain observable while the previous complete state and exact pixels remain visible. Releasing the request must finish the reload without missing textures. Resetting action time after reload must reproduce the original baseline pixels. This artificial hold is an atomicity test, **not** a loading performance measurement.
- A controlled manifest replacement swaps `stand1` artwork to actual decoded `walk1` artwork and changes scene ID. Atomic reload must match the new oracle, change visible pixels, then restore the original references with exact baseline pixels—detecting stale textures even when texture counts stay unchanged.

These checks do not claim gameplay, collision, networking, WZ parser correctness, or exhaustive original asset semantics. They can reveal a mismatch between the renderer and generated scene, but cannot establish that an unverified ordering or placement rule in the extractor matches the original client.

## Performance measurements

Following behavioral checks, the oracle's duplicate ImageBitmaps are closed, the scene is unpaused, and the real browser runs for the configurable measurement duration. No screenshots or compositing-oracle work occurs inside this interval. The report includes:

- Actual browser `requestAnimationFrame` timestamps converted to raw frame intervals, count, min, mean, median, p95, p99, and maximum. These are observed display callbacks, not a synthetic fixed-step benchmark or an assumption of 60 Hz.
- Renderer-reported recent bounded draw CPU samples and their statistics. The rendered-frame counter delta restricts samples to frames within the live measurement, and also proves that the actual renderer drew rather than merely receiving unrelated browser rAF callbacks. This is CPU time around the renderer's draw work, **not GPU duration or all browser JavaScript**. The report includes total rendered frames and the sample limit: older measured frames can be evicted from that bounded window, so it is not necessarily a complete-duration CPU trace.
- Browser Long Tasks API entries where supported. The API's 50 ms reporting floor is not a target or evidence that shorter stalls do not exist.
- A separate, unthrottled asset reload duration and rAF intervals bracketing that reload. Existing browser and Pixi cache state is retained and disclosed. An extremely fast reload can produce few frame intervals; samples, not invented stall counts, are reported. The deliberate atomicity hold is excluded.
- Renderer-reported estimated texture bytes and an independent `width × height × 4` manifest sum. These are uncompressed RGBA estimates, **not measured GPU allocations**, and omit driver overhead, render targets, and duplicate uploads.
- Chrome `performance.memory` heap values when exposed, before and after the live measurement and after reload. These do not represent whole-browser RSS. Normal garbage collection may retain earlier validation allocations; no forced collection is performed.
- Chrome version, fixed viewport/device scale, WebGL vendor/renderer/version, and unmasked graphics details when the browser exposes them. Headless rendering may use hardware or a software backend; the command does not claim hardware execution without those observations.

There are no invented FPS, CPU, heap, GPU, or loading thresholds. Performance numbers are observations; correctness invariants are pass/fail. The Main integration session performs the actual validation run after extraction and server startup. No successful result or original-reference parity is implied by the existence of this script or document.
