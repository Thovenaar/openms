# Validation results

## Current expanded-fidelity acceptance

The [expanded index](ingame-validation/expanded/report.json) joins three independent native-browser playtests, exact staged source identities, retained failures and corrected replays. Gameplay actions used real mouse/keyboard input; validated temporary profiles are labeled setup, not earned progression. Recording/replay is a separately labeled scenario, not a substitute for native play.

Final source: `713aad43393ae26e4cc57e1a35a412bb3b0930d5cf19368ace8b3b3b893d9fde`; assets: `f30d7d8f367fe8a432c43733817fb440d9d0b1d36b9025c4fa0ccdd0539ff0a4`. Strict lint and **147 tests,0 failures,876 assertions across23 files** pass. Full extraction packages356 maps. Earlier native traces retain their own source IDs; the windows sweep explicitly records mixed-build scope rather than claiming all observations came from the final bundle.

| Surface | Executed acceptance |
| --- | --- |
| Conditional hits | Native Red Snail32/hit1; Hector798 below threshold versus800/130 recoil; existing attack1 survives recoil. Stance damages while preserving position/contact, then expires and admits ordinary±270/−270 impulse. Magic Guard consumes MP and applies HP shortfall. [Gameplay report](ingame-validation/expanded/gameplay/report.json). |
| Timed skills/actions | Recovery six4HP heals/cost/cooldown; Nimble125→137.5→125; two corrected F1–F7 rounds, early guard refusal and independent expiry; Insert seat23/movement release; Space opens Maya. Six-command24-tick recording/replay has exact observation equality. |
| Tooltips/dialog/loot | Inventory/equipment/skill/key/quick-slot hover and Tab focus; live learned rank1→2 descriptions. Native amount9/50001/10.5/empty refused; focused Cancel Enter/Escape work; repeated Enter debits once. Native100000→99990→100000 drop/pickup persists. Earned Omok Piece : Pig4030011×1 plus15 mesos survives reload. [Item report](ingame-validation/expanded/items/evidence.json). |
| Motion/stacking | Native item rotation and25px fanout, moving-target Z pickup;390px four-corner tooltip clamp and cursor above tooltip. Player body/name disappear behind the higher original treehouse during walk/jump without an airborne depth change. |
| Native windows/ground | WorldMap art/marker/spot/link/parent/current navigation, broken authored parent refusal, native window bindings, all seven chat modes and explicit social-service refusals. Maya floor38, Kyrin floor150 with authored2px overhang, Aqua9250023 intentional float. [Windows report](ingame-validation/expanded/windows/report.json). |
| External tools | Actual XP/95/Y2K selection at desktop/390px leaves native game artwork/fonts unchanged and has no horizontal overflow. Staged presets apply atomically; SQL, origin, skill and world-map audit CLIs were executed. |
| Independent world oracle | Final-source [world report](ingame-validation/expanded/world-final/report.json):394 checks,0 failures,0 errors; five artwork-backbuffer comparisons on Henesys, Maya,211040000 and230030100. This compares decoded original assets, not original Windows screenshots. |
| Complete installed release |18420 resources,790363469 verified bytes,356 maps; release `80196659dff5c14da871e6f128c35871ac38b0fa47d1b0c35d2bbd732d990fe5`. With origin stopped, reload, native movement112→195.075 and WorldMap opening worked; active pin stayed exact, readiness true and uncached lists empty. [Proof](ingame-validation/expanded/offline-final.json), [capture](ingame-validation/expanded/offline-final.png). OS navigator remained online; the expected failed update check is not a failed installed release. |

**Failures found and replayed:** skill tips called `.find` on schema4's ID-keyed skill dictionary; corrected lookup now passes hover/focus/binding/live-rank replay. Expression guard timestamps leaked into a different temporary-profile clock; same-store-only inheritance now passes two new-scene rounds. The world validator initially captured Chrome's DOM focus outline as artwork; it now captures the actual WebGL backbuffer, retaining native focus indication and the unchanged pixel tolerance. Presentation gating now includes independently rooted effects and actor-owned labels, with native LevelUp/name/HUD hide/restore.

**Measured performance:** Chrome152, Apple M3/Metal/WebGL2,1280×900/DPR1;5,002.7ms and299 rAF intervals, mean16.666ms,p95≈16.7ms,max≈16.8ms, no intervals above20ms and no long tasks. Sampled JS heap107,765,737 bytes; CPU decoded and GPU-estimated artwork each44,157,448 bytes;27 atlases, longest upload batch≈4.4ms. Cold readiness34.365s uses the validator's scoped network emulation, not unrestricted startup. This is a short host-specific measurement, not universal60-FPS or peak-process memory proof.

**Remaining boundaries:**35 of534 catalogued skills have implemented controllers;499 remain explicitly classified by missing consumers. Cosmic's24 SQL schemas/73 tables and13 companion files yield30557 published reference rows;55 tables have no supplied seeds, and1915 inventoried scripts are not executed. Shops/crafting/cards/cash descriptors are reference inputs, not enabled mechanics. Remote social/commerce, inventory-chair/item-script/macro controllers and other documented unsupported behavior do not return fabricated success. Uncollected drops are transient. Native stationary-NPC-name opaque occlusion remains uncaptured; retained Hector attack pose is proved, its pending damage is not. No original Windows-runtime parity is claimed.

## Earlier interaction-correction acceptance {#current-interaction-correction-acceptance}

The [interaction report](ingame-validation/interaction-corrections/report.json) records native Chromium mouse, keyboard and form workflows on an isolated local origin. Scripts observed gameplay state; explicit request/IndexedDB fault injection exercised failure paths, and a Web Audio observer counted real source starts. No game-authority API substituted for native play.

Final implementation source: `6478b29df40219025ed7fc1d3566c405ee01ef9559dbd324da1ef0d22efe774f`; extracted assets: `a2803d8b95eb1ebc7d64c22de07c8134f7179629c86d79d349af71168fff3a1e`. `bun run format`, `bun run lint`, `bun run test` and `bun run extract` passed: **140 tests, 0 failures, 822 assertions across 22 files**. The full356-map extraction retained157 mob templates,1,643 drop item IDs and4,305 supported Cosmic rows, with no unavailable drop rows.

| Requested surface | Executed native acceptance |
| --- | --- |
| Minimap | M cycled compact260×153, expanded477×173 and title-only260×20 in Henesys. Movement changed74 raster pixels; drag, close/reopen, controls and original title/markers worked. [Expanded](ingame-validation/interaction-corrections/minimap-expanded-title.png). |
| Transitions | Named Henesys↔Maya entry, black-boundary commit,600-ms reveal with admitted movement, revival and all four same-map Teleport frames without global fade. A503 request failure reversed partial darkness; superseding at opacity0.224 left no stale fade or pending loads. [Arrival](ingame-validation/interaction-corrections/maya-field-arrival.png). |
| Drops/pickup | Native Blue Snail kills produced Green Apple2010009 and9 mesos. A quota failure preserved both drops and the profile; meso-capacity refusal did not poison storage state. Retry animated pickup with one sound, credited once and survived reload. [Ground loot](ingame-validation/interaction-corrections/native-mob-drop.png), [inventory](ingame-validation/interaction-corrections/native-pickup-inventory.png). |
| NPCs | Cody's scrolling quest list retained its portrait/footer; Maya's level55 requirement stayed blocked. Nella's original next/back/decline/accept pages charged1000 mesos once and persisted quest2029 state1. [Maya](ingame-validation/interaction-corrections/npc-maya-requirements.png), [original yes page](ingame-validation/interaction-corrections/npc-original-yes-page.png). |
| Chat | Minimized editor/channel had no client rectangles; local submit/history, readable channel list and native13px resize quanta worked. [Expanded chat](ingame-validation/interaction-corrections/chat-expanded.png). |
| Cursor/stacking | Original cursor remained above chat list, tooltip and popups; GameMenu artwork covered underlying Stat text as one window. [Cursor detail](ingame-validation/interaction-corrections/chat-cursor-detail.png), [popup overlap](ingame-validation/interaction-corrections/game-menu-over-stat.png). |
| HUD | Original LV. artwork rendered at levels1/30; the recovered Stat AP position displayed saved AP5. [Stat/AP](ingame-validation/interaction-corrections/character-stat-ap.png). |
| Skills | Prerequisite unlock, ordinary mastery0 learning, max/expiry/SP-zero disabling, mastery-gated Brandish allocation and live job/book refresh passed. Native D-bound Power Strike paid original rank1 MP cost4. [Mastery/SP](ingame-validation/interaction-corrections/skill-mastery-sp-exhaustion.png), [binding](ingame-validation/interaction-corrections/skill-key-binding.png). |
| Sounds | Admitted release and focused Space produced one original click; off-target release produced none. Carry used DragStart/DragEnd; successful pickup produced one real source start. No synthetic playback was introduced by the observer. |
| Hits/geometry | Contact produced both ±200 horizontal/−200 vertical impulses1500ms apart. Complete tint phases were60 simulated ms. Standing/prone rectangles were44×65/46×31; a Red Snail's HP40→8 hit entered `hit1`. [Mob hit](ingame-validation/interaction-corrections/native-mob-hit1.png), [prone receiver](ingame-validation/interaction-corrections/native-crouch-hitbox.png). |
| Character editor | Typed edits and AP persisted; job/skill/SP projections refreshed coherently. HP301/maxHP300 plus an unrelated name change failed atomically. Zero HP opened original revival rather than silently restoring vitals. |
| Keybinding workflow | Click-carry, live attack preview, duplicate rejection, original default/clear notices, nested draft isolation, dirty-close Save/Discard, failed-save preservation and reload passed. Final-source replay proved Space cancels a focused Cancel footer while Enter applies default OK; outer discard restores both key/quick-slot baselines. [Live preview](ingame-validation/interaction-corrections/key-live-preview.png), [nested draft](ingame-validation/interaction-corrections/quickslot-isolated-draft.png). |
| Connected defects | Native play found and fixed quick-key Space/Enter routing, dark-on-dark NPC name text and reverse-Tab skipping disclosure summaries. Native summary focus/Space expansion passed after correction. |

Viewport captures cover [800×700/DPR1](ingame-validation/interaction-corrections/viewport-800x700-dpr1.png), [1280×900/DPR1.25](ingame-validation/interaction-corrections/viewport-1280x900-dpr1.25.png) and [1920×1200/DPR2](ingame-validation/interaction-corrections/viewport-1920x1200-dpr2.png). Actual window bounds stayed inside the field, and cursor backing bitmaps followed density.

Chrome150.0.7871.24, ANGLE Metal/Apple M3: native movement and attack at1920×1200/DPR2 yielded **300 rAF intervals over5,000ms,60 FPS, p95/max16.8ms, zero intervals above33.4ms**,1,095 resident sprites and zero pending loads. This short measured interval is not a hardware-wide guarantee or a repeat of the earlier independent world-pixel oracle.

**Evidence boundary:** original executable/WZ inputs establish recovered constants and artwork; authorized Cosmic code is a SERVER reference, not Nexon source. Drop launch/pickup curves, local authority, asynchronous recovery, browser font/compositor behavior and unknown initial placements remain explicit policies. No original Windows execution, native camera-vector dynamics, exact BGM crossfade, server scripts or unsupported skill controllers are claimed. See [UI](ingame-ui.md), [combat](offline-combat.md), [skills](skills.md) and [portals](ingame-portals.md).

## Earlier original-behavior correction acceptance

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
