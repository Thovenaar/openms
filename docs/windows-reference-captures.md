# Original Windows reference captures

## Missing input

The supplied `/Users/k/Development/tensorfish/Maplestory-Client` tree contains original executables, DLLs and WZ archives, but no original C/C++ source, game recordings or input traces. Ghidra output is decompiler evidence, not supplied original source. The original client cannot run on this Mac; browser screenshots cannot establish original-game parity.

Please provide original source with provenance if available, and original-client Windows recordings/input traces for the comparisons below. Use the supplied v83 input identities in [input-manifest.json](input-manifest.json), not a community implementation. Do not provide account credentials. A different executable/WZ version must be identified, not treated as the same reference.

## Capture metadata

For each run, include executable/WZ hashes or exact version; map ID; character job/level, equipment and movement-affecting stats/buffs; resolution/display refresh; recording frame rate and whether frames were dropped; starting position/foothold if obtainable; and the timestamped key-down/key-up sequence. Mark how timestamps and positions were obtained. Video without trustworthy timestamps can support visible transition checks but not precise integration timing.

Prefer lossless or high-quality 60 FPS or faster footage with the entire character and nearby foothold geometry visible. Keep the camera stationary where possible; otherwise include landmarks so world displacement can be separated from camera movement. Include several seconds before and after input. Repeat runs from the same state; do not trim out failed or unusual transitions.

## Required scenarios

| Scenario             | Input and setup                                                                          | Compare                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Flat movement        | Start at rest; hold right, release; repeat left and immediate reversal                   | Acceleration, terminal speed, distance, braking distance/time           |
| Jump                 | Rest and running jumps; short tap versus held key; repeated jump presses                 | Takeoff, apex height/time, airtime, horizontal travel, landing position |
| Slopes               | Walk/brake/reverse uphill and downhill on identified segments                            | Tangential speed, drag, height, exact connection crossing               |
| Edges and walls      | Walk and jump into segment endpoints, vertical connections, gaps; continue holding against a blocked wall | Attachment/detachment, wall clamp, walking action while stationary and release/reversal frame |
| Landing              | Fall through multiple candidate platforms; approach endpoints from both sides            | Chosen foothold, equality boundary, snap and remaining-step motion      |
| Drop-through         | Down+jump from eligible and ineligible platforms; hold/release rapidly                   | Eligibility, ignored foothold(s), exclusion duration and next landing   |
| Ladder and rope      | Enter from ground/air, climb, release, reverse, hold at closed ends, jump away and receive a genuine hit | Attachment/velocity, stationary frame freeze/resume, end behavior and jump/hit detachment |
| Swimming             | Original swim map, idle sink, horizontal/vertical movement, jump pulses                  | Drag, gravity/fall caps, swim speed reduction and transition timing     |
| Movement modifiers   | Identified original low-friction/slippery/conveyor/force maps and stat/buff combinations | Effective precedence, acceleration, clamps, grounded/air differences    |
| Body/damage bounds   | Standing, walking, jumping, prone, ladder/rope, facing both ways                         | State-dependent contact/damage boundaries, independently of artwork     |
| Attacks              | Exact weapon/skill/action, facing, frame and target position                             | Area activation/deactivation, reach, target inclusion/exclusion         |
| Refresh independence | Same timed inputs at two original display rates if supported                             | Distances, apex, landing, and transitions in simulation time            |

The machine-readable option inventory and recovered-code notes refine which original map IDs, modifiers and attack families need captures. An unexplained option is not validated merely because an ordinary flat-map run passes.

## In-game UI, portals, life and audiovisual references

The metadata inventory and retained consumers in `ingame-inventory/` and
`ghidra-ingame-{ui,portals,life,audiovisual}/` do not replace these captures.
Record original executable/WZ identities, server context and exact inputs.
Keep original audio in the recording and provide a separate lossless WAV track
when possible; do not normalize loudness, denoise, resample, or time-stretch it.
Include sample rate, channels, original BGM/SE settings, mute state, output device,
capture method, and any known audio/video clock offset.

| Priority | Original scenario                                                         | Required observations                                                                                                                  |
| -------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | 800×600 in-game HUD, idle then HP/MP/EXP changes                          | Gauge endpoints/fill/clipping, numerical glyphs, text metrics, flash timing, opacity, bottom anchoring                                 |
| P0       | Inventory, equipment, stat and skill windows opened by mouse and keyboard | Initial positions, tabs, slot geometry, original hotkeys, focus, key-repeat handling, overlapping windows, close/restore               |
| P0       | Button hover, press, drag outside/release, keyboard focus                 | Exact normal/hover/pressed/disabled/focused art and sound onset; no compressed-image comparison                                        |
| P0       | Positive/zero ordinary hit, repeated contact, lethal hit and recovery      | Gray/normal phase lengths, persistent counter phase, actual protection expiry and distinction from five-second alert/name timing |
| P0       | Set Key, ShortCut and QuickSlot defaults, remaps and active draft toggles  | Physical Backslash/[/] and type4 IDs9/14/15, dirty-editor confirmation, popup rollback, both modifier sides and current-viewport drag geometry |
| P0       | Ordinary chat, wrapped text, paste, IME, repeated messages and resize      | Original font measurement, ten-part bubble assembly, head/arrow anchor, exact display/fade deadline, history/flood gates and composition behavior |
| P0       | Mob hit/name/digits with boss/name flags and isolated attack/contact audio | Local attacker name lifetime, hideName/HPgaugeHide distinctions, numeral overlap/rise/fade, contact during attack windup, CharDam and death cue onset |
| P0       | Walk to `100000000/in02`, press Up, enter `100000001/out02`, return       | Activation rectangle/grounded predicate, request/permission delay, arrival feet, fade, animation, sound and held-key bounce prevention |
| P0       | Hidden reciprocal portals in 100000000 and 120000000                      | Start/Continue/Exit timing on approach/departure, visibility boundaries, cooldown and same-map repositioning                           |
| P0       | Maya, Thompson, Rina and Kyrin                                            | Feet/origin, facing, name/function font/color/z, expressive-action transitions, interaction range and dialog geometry                  |
| P0       | Hector/White Fang in 211040000 and OctoPirate in 108000500                | Live spawn/controller context, authored versus live positions, stand/move/hit/death transitions, facing, body bounds and sound timing  |
| P0       | Enable/mute/change BGM and SE volume, then change maps                    | Original volume curve, loop boundary/gap, same-track continuity, stop/fade/overlap and channel mixing                                  |
| P0       | Aquarium map entry and Bubbling effect                                    | Screen/world anchoring, positions, repeat counts, alpha, timing, depth and replacement cleanup                                         |
| P1       | NPC dialogue with choices, text entry and continuation                    | Server-provided text/choices, portrait placement, clipping, focus/capture and exact continuation packets if legitimately available     |
| P1       | Key configuration, quick slots, menus, minimap and tooltips               | Default scan codes, remap/drag restrictions, persistence, stacking, hit rectangles, tooltip delay/clipping                             |
| P1       | Original jump, portal, level-up and quest-clear sound/effects             | Accepted event time, visual onset/frame delays/alpha, sound onset and completion; server rejection behavior                            |
| P1       | Scripted/sentinel portals, limitedname/hide/mobTime life records          | Actual activation/gating and server decisions; never infer them from archive names or editor placements                                |
| P2       | Alternate resolutions and display rates                                   | UI anchoring/scaling, minimum viewport, focus behavior, text sampling and timing independent of display cadence                        |

Capture a quiet baseline and isolated short effects before mixed BGM/SE runs.
For every alignment report both visual and audio uncertainty. A browser live PCM
capture proves output of its actual audio graph, not original waveform parity or
physical-speaker audibility. Original-reference audio timing and perceptual parity
remain blocked until the original tracks are supplied.

## Reporting comparisons

Store recordings/traces and their provenance under `docs/` or link to an explicitly supplied reference location. For each comparison record input alignment uncertainty, world-to-screen conversion, original and reconstructed measurements, absolute error, and pass criteria justified by capture resolution. Do not invent a universal pixel/time tolerance before knowing the reference precision.

Distinguish **code-derived**, **browser-exercised**, **original-reference-matched**, **different**, and **blocked/unknown**. Until reference material is supplied, external movement-distance, stopping-distance, jump-height, airtime, landing and transition-timing parity remain blocked even when deterministic browser tests pass.
