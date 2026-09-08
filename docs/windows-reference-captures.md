# Original Windows reference captures

## Missing input

The supplied `/Users/k/Development/tensorfish/Maplestory-Client` tree contains original executables, DLLs and WZ archives, but no original C/C++ source, game recordings or input traces. Ghidra output is decompiler evidence, not supplied original source. The original client cannot run on this Mac; browser screenshots cannot establish original-game parity.

Please provide original source with provenance if available, and original-client Windows recordings/input traces for the comparisons below. Use the supplied v83 input identities in [input-manifest.json](input-manifest.json), not a community implementation. Do not provide account credentials. A different executable/WZ version must be identified, not treated as the same reference.

## Capture metadata

For each run, include executable/WZ hashes or exact version; map ID; character job/level, equipment and movement-affecting stats/buffs; resolution/display refresh; recording frame rate and whether frames were dropped; starting position/foothold if obtainable; and the timestamped key-down/key-up sequence. Mark how timestamps and positions were obtained. Video without trustworthy timestamps can support visible transition checks but not precise integration timing.

Prefer lossless or high-quality 60 FPS or faster footage with the entire character and nearby foothold geometry visible. Keep the camera stationary where possible; otherwise include landmarks so world displacement can be separated from camera movement. Include several seconds before and after input. Repeat runs from the same state; do not trim out failed or unusual transitions.

## Required scenarios

| Scenario | Input and setup | Compare |
|---|---|---|
| Flat movement | Start at rest; hold right, release; repeat left and immediate reversal | Acceleration, terminal speed, distance, braking distance/time |
| Jump | Rest and running jumps; short tap versus held key; repeated jump presses | Takeoff, apex height/time, airtime, horizontal travel, landing position |
| Slopes | Walk/brake/reverse uphill and downhill on identified segments | Tangential speed, drag, height, exact connection crossing |
| Edges and walls | Walk and jump into segment endpoints, vertical connections, gaps | Attachment/detachment choice and timing; wall clamping |
| Landing | Fall through multiple candidate platforms; approach endpoints from both sides | Chosen foothold, equality boundary, snap and remaining-step motion |
| Drop-through | Down+jump from eligible and ineligible platforms; hold/release rapidly | Eligibility, ignored foothold(s), exclusion duration and next landing |
| Ladder and rope | Enter from ground/air, climb, release, reverse, exit at both ends, jump away | Attachment range, velocity reset, top/bottom behavior, jump vector |
| Swimming | Original swim map, idle sink, horizontal/vertical movement, jump pulses | Drag, gravity/fall caps, swim speed reduction and transition timing |
| Movement modifiers | Identified original low-friction/slippery/conveyor/force maps and stat/buff combinations | Effective precedence, acceleration, clamps, grounded/air differences |
| Body/damage bounds | Standing, walking, jumping, prone, ladder/rope, facing both ways | State-dependent contact/damage boundaries, independently of artwork |
| Attacks | Exact weapon/skill/action, facing, frame and target position | Area activation/deactivation, reach, target inclusion/exclusion |
| Refresh independence | Same timed inputs at two original display rates if supported | Distances, apex, landing, and transitions in simulation time |

The machine-readable option inventory and recovered-code notes refine which original map IDs, modifiers and attack families need captures. An unexplained option is not validated merely because an ordinary flat-map run passes.

## Reporting comparisons

Store recordings/traces and their provenance under `docs/` or link to an explicitly supplied reference location. For each comparison record input alignment uncertainty, world-to-screen conversion, original and reconstructed measurements, absolute error, and pass criteria justified by capture resolution. Do not invent a universal pixel/time tolerance before knowing the reference precision.

Distinguish **code-derived**, **browser-exercised**, **original-reference-matched**, **different**, and **blocked/unknown**. Until reference material is supplied, external movement-distance, stopping-distance, jump-height, airtime, landing and transition-timing parity remain blocked even when deterministic browser tests pass.
