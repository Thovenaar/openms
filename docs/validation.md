# Validation results

## Actual commands and environment

- `bun run extract`: original Henesys `Map.wz:Map/Map1/100000000.img`; 1,112 entities, 270 textures, 20 checksum-checked IMG resources, 26,162,516 decoded RGBA bytes. Last extraction: 527 ms; process RSS 203,669,504 bytes. See [extraction.json](extraction.json).
- `bun run scan`: all **12,822 IMG payloads** in original Map/Character/UI archives checksum-checked and parsed; **zero failures**. Counted 434,565 canvas records. First actual canvas per format/scale/envelope decoded and hashed; this is not a claim that every canvas was inflated. See [archive-scan.json](archive-scan.json).
- `bun test`: **9 pass, 0 fail, 29 assertions**. Synthetic boundary fixtures plus an observed original encrypted filename; not original-client screenshot tests.
- `bun run validate --duration 15`: **pass**, 135 recorded checks/observations, 60 canvas captures, **59 independent pixel-oracle comparisons, maximum observed channel error 0**. No page/network errors or unexercised checks in this run. See [validation/report.json](validation/report.json).
- Chrome `152.0.7977.77`, WebGL2, ANGLE Metal / Apple M3, 1280×900 browser viewport, device scale 1. Browser canvas is responsive inside the controls layout. Actual visible browser surface was also inspected through Chromium automation.

## Observed performance

15,023.6 ms live interval; 901 actual rAF intervals. No screenshot/oracle work during measurement.

| Measurement | Observed |
|---|---:|
| Frame interval mean | 16.666 ms (~60 FPS) |
| Frame interval p95 / p99 / max | 16.8 / 16.8 / 16.8 ms |
| Frame intervals above 20 ms | 0 |
| Draw CPU mean / p95 / max | 0.544 / 2.10 / 2.50 ms |
| Browser Long Tasks ≥50 ms | 0 |
| Unthrottled atomic asset reload | 262.3 ms |
| Reload rAF interval maximum | 16.8 ms |
| Active RGBA texture estimate | 26.16 MB (24.95 MiB) |
| Chrome used JS heap before / after live interval | 58.37 / 36.94 MB |
| Chrome used JS heap after reload | 39.90 MB |

Draw CPU is the renderer's most recent bounded 240-sample window, not GPU time or complete browser CPU. Texture memory is a dimension-based estimate, not measured GPU allocation; ImageBitmaps, old/new scene overlap, render targets, and driver overhead add memory. Heap is Chrome `performance.memory`, not whole-browser RSS or proof of leak freedom. Loading ran with existing browser cache state; no cold-network performance claim. The independent oracle's duplicate bitmaps were closed before measurement.

This run met the requested 60 FPS target on this host. Higher-refresh behavior is proven only by deterministic 60/144 Hz elapsed-time partition tests; no physical 144 Hz display measurement. No general hardware or scene-wide performance guarantee.

## Correctness coverage

Captured internal state and actual pixels for seven avatar actions; exact delay boundaries, multi-cycle jumps, static poses, original integer alpha fades, visibility, positions, camera movement, world-only pixel translations, overlap layering, and restoration. The first animated map entity also exercises the explicit alpha-tween case. Other animated map instances remain part of the real scene but are not individually boundary-tested; the report names selected subjects.

Held a manifest request to verify that the complete previous frame remains visible during loading. Then replaced the manifest with a controlled variant referencing different **actual decoded** avatar frames, verified new pixels/state, and restored the original references without stale pixels. The variant is a validation input, not a claimed original map or asset format.

Original-archive coverage: 434,177 format1/scale0 canvases, 188 format2/scale0, two format513/scale4, and 198 format513/scale0. All observed canvas envelopes in this sweep were plain zlib; encrypted-chunk behavior is supported by Ghidra evidence and synthetic boundary tests, not an original encrypted-canvas example. DXT3 mapping is original-Ghidra-backed and synthetic-block-tested; no DXT3 original example was found in these archives.

## Observed failures fixed

- Strict finalized-stream zlib inflation rejected a real character canvas. Traced original ZLZ flush semantics; use sync-flushed segments with exact output-size enforcement, not swallowed inflate errors.
- Real map resources contained nested `Shape2D#Convex2D`. Traced and implemented its compact count and nested object framing; no guessed skip.
- Full metadata sweep encountered `Sound_DX8` in `MapHelper.img`. Ran additional original-DLL Ghidra analysis and implemented its actual envelope, preserving format/audio bytes without claiming playback. Sweep now has zero failures.
- Corrected initial coarse map depth ordering to original tile/object/back formulas, including the negative `zM` multiplier.
- Corrected constant-start alpha to recovered signed-integer endpoint interpolation; implemented background repetition and camera-displacement behavior.
- Validator initially rejected valid static character actions with absent delays. Fixed its contract to exercise these poses with an elapsed hold instead of manufacturing an animation delay.

No render/loading bottleneck remained in the measured interval: persistent sprites, bounded metrics, cooperative decode/upload, and atomic swaps kept measured frame intervals within one 60 Hz display period. No gameplay expansion followed the benchmark.

## Reference limitation

**No original-client gameplay captures or original source were supplied, and the Windows executable was not run.** All pixel comparisons are against an independent compositor of decoded original assets, not original-client pixels. Full original avatar assembly, absolute camera attachment, camera-follow behavior and other limits remain explicitly listed in [README.md](README.md) and [client-evidence.md](client-evidence.md).
