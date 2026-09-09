# Validation results

## Current original-behavior correction acceptance

The [fidelity report](ingame-validation/fidelity/report.json) records the September 9, 2026 correction wave, including staged source identities, controlled fixtures, native input, observed state transitions and retained screenshots. The final source is `61f1725c854188bf689100f6ca4078df8f6fdabfb6a2e73db0b45aa0ab6d1878`; extracted assets are `bcb95e4daac55b53de1722ff2a9d6fef64ff273782f9362bd41b6c6dda3aa7ec`.

Final source gates: `bun run format`, `bun run lint` and `bun test` passed; **128 tests, 0 failures, 751 assertions across 21 files**. `bun run extract` regenerated the catalog, including accurate learned-skill capability reporting.

| Surface | Executed acceptance |
| --- | --- |
| Collision and debug geometry | Original tower geometry admitted both recovered ±200 knockback impulses without integer-coordinate wall escape; actors returned to foothold 153. An actual tower mob hit supplied +200/−200 velocity while airborne with contact group 2 and space group 0. [Visible physical bounds, paths and hit](ingame-validation/fidelity/tower-debug.png). |
| Damage, expression, recovery and name | Real contact produced Violet incoming digits at a fixed world anchor, with the recovered rise/fade and removal. Hit expression remained through 1470 ms and reset at 1500 ms. Controlled native recovery produced HP 20→33 and Blue 13; MP 0→3 still occurred during movement. The original plain Arial-12 name layout remained attached to the rendered avatar. [Hit](ingame-validation/fidelity/hit-initial.png), [fade](ingame-validation/fidelity/hit-fading.png), [recovery/name](ingame-validation/fidelity/recovery.png). |
| Revival and audio | Native Escape did not dismiss the original Notice0 dialog. Native confirmation routed map 100010000 to authored return map 100000000, restored HP 0→50 and left MP 33 unchanged. Enabled original audio resumed on trusted input. [Original revival dialog](ingame-validation/fidelity/revival.png). |
| Native UI | Skill pickup survived release; next-down placement worked in KeyConfig and quick slots, including displaced-binding carry and restoration. Chat exercised focus, local speech, history recall, resizing, channel cycling and explicit server-only rejection. Cody was picked at 312 world units: cursor 4 on hover, 12 on press, then the native dialog. GameMenu and ShortCut retained recovered bottom-right logical anchors. [NPC](ingame-validation/fidelity/npc-dialog.png), [ShortCut](ingame-validation/fidelity/shortcut.png). |
| Persistent character development | Native edits to identity/job/level/vitals/stats/meso/fame/SP survived reload. HP 101/maxHP 100 failed without partial publication. Native learned-skill addition/removal and expiration/master metadata persisted. Schema 3 keeps ten SP pools and explicit learned records. |
| Learned skills | Native allocation consumed SP 10→9→8 and survived reload; native Power Strike consumed MP 100→96. Slash Blast paid HP 8/MP 6 and hit two real mobs. Iron Body paid MP 8, supplied PDD 2, reduced the same contact from 6 to 5 and expired at exactly 75 seconds. [Learned ranks](ingame-validation/fidelity/skills-learned.png), [two-target Slash Blast](ingame-validation/fidelity/slash-blast.png), [authored Iron Body cast pose](ingame-validation/fidelity/iron-body.png). |
| Display density | Live 1×/1.25×/2× transitions and a resized 2× viewport produced matching CSS/backing dimensions while preserving GameMenu `(666,423)`. Two actual regressions were corrected: unreliable emulated media-query notifications and paused world-name raster density. Paused DPR 2 now retains name resolution 2 without advancing physics. [1×](ingame-validation/fidelity/ui-1x.png), [1.25×](ingame-validation/fidelity/ui-125x.png), [2×](ingame-validation/fidelity/ui-2x.png), [resized 2×](ingame-validation/fidelity/ui-resized-2x.png). |

Final native ArrowRight play moved X 112→357.75 over 120 measured rAF intervals: mean 16.666 ms, p95 16.7 ms, maximum 16.8 ms; no player fault or runtime error. This is a short measured interval on the current host, not a hardware-wide performance guarantee.

**Coverage boundary:** all 534 original skills across 71 books are retained and classified; that does **not** make all controllers usable. Current supported classes are ten passive consumers, four self-stat buffs and two sword attacks. [Skills](skills.md) names unsupported controllers, authored resource absence, local buff precedence and unrecovered server formulas. [UI](ingame-ui.md), [combat](offline-combat.md), [profile](offline-profile.md) and [agent interface](agent-interface.md) separate recovered behavior from local policy. No original Windows gameplay capture or Nexon source was available; the authorized Cosmic reference is server code, not original client source.

## Initial renderer extraction and validation

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
