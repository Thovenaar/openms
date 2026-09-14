# Validation results and known limits

Read a result together with its **source/catalog identity, fixture, action and limitation**. A passing unit test, an implemented handler and a native browser replay establish different things. [Validation method](validation-method.md) owns the procedure; old run narratives are in the [archive](archive/index.md).

## Current evidence index

| Area                                   | Evidence                                                                                                             | Scope                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Online 100% movement                   | [Movement parity](movement-parity.md#scoped-verification)                                                            | Shared-kernel/server steps, browser prediction and checkpoint continuation.                             |
| Client-owned motion and knockback      | [Movement parity](movement-parity.md#client-owned-motion) · [Browser check](#client-owned-motion-browser-check)      | One native browser hold and the real server/predictor divert tests; not original Windows parity.        |
| Airborne skill continuity and recoil   | [Skill cast repair](#skill-cast-stutter-repair) · [Movement contract](movement-parity.md#skill-snapshot-continuity) | Same-field snapshot continuity, immediate impulses and recovered foothold-tangent mob recoil. |
| Consecutive Flash Jump artwork         | [Replay validation](#consecutive-flash-jump-artwork-14-september-2026) | Five admitted casts, including a rapid direction reversal, with zero rendered-origin offset. |
| Modern combat equations               | [Formula contract](combat-formulas.md) · [Validation](#modern-combat-formulas-14-september-2026) | Shared client/server calculations and explicit mappings for existing v83 content. |
| Drops, presets and chat                | [Two-player report](native-ui-validation/drop-chat-presets/report.json) · [Recovery](original-resource-audit.md)     | Source-identified native recipients/reconnects; no all-content claim.                                  |
| Skill admission (every preset job)     | [Report](ingame-validation/skill-admission.json) · [Tool](../server/tools/check-skill-admission.js)                  | 71 preset jobs / 2,879 skill-job pairs from packaged content; no browser or native-cast proof.          |
| NPC, Ability and development tools     | [Native report](native-ui-validation/ui-authority-repairs/report.json) · [Recovery](native-ui-authority-recovery.md) | Repaired native UI and authority paths on its recorded build.                                          |
| NPC dialogue and shared ambient speech | [Native report](native-ui-validation/online-npc-dialogue/report.json)                                                | Session dialogue, cancel/quest behavior and shared NPC presentation.                                   |
| Login, creation, spotlight and dice    | [Recovery and evidence](login-creation-recovery.md)                                                                  | Original placements and server-issued starting stats.                                                  |
| Selection and travel                   | [Focused report and method](login-selection-travel.md)                                                               | Retained native selection/transition checks.                                                           |
| Original asset inventory               | [Resource audit](original-resource-audit.md)                                                                         | All 16 resource archives inventoried; counts are not runtime completeness.                             |
| Extraction performance                 | [Measured comparison](#extraction-performance) · [Report](extraction-performance.json)                                | Same 735-map all-hit workload, complete output verification and identical catalog bytes.              |
| Online surface declarations            | [Feature inventory](server/offline-parity.md)                                                                        | 72 action kinds, 45 social actions, 69 online hooks; static coverage only.                             |
| Documentation                          | [Maintenance and checks](documentation-guide.md)                                                                     | Source links/routes, current constants, readable navigation and rendered diagrams.                     |

Reports above retain the build they actually measured. A later source edit does not retroactively refresh their results.

## Iteration-loop investigation

The retained [iteration investigation](archive/validation-history.md#iteration-loop-investigation) measured existing primitives on Bun 1.3.14 / Darwin arm64. These are historical observations, not a new performance benchmark or fixed budget.

| Stage                                          | Retained observation | Practical implication                                                     |
| ---------------------------------------------- | -------------------- | ------------------------------------------------------------------------- |
| Scoped formatting / lint                       | 173 / 298 ms         | Fail early before acquiring runtime resources.                            |
| Online protocol tests / import build           | 385 / 112 ms         | Cheap checks can validate one contract and authority imports.             |
| Content/rules/map preparation                  | 190 ms               | Online iteration can reuse extracted content.                             |
| Isolated browser context / login-art readiness | 5 / 353 ms           | Reuse the browser, isolate participants; readiness is not gameplay proof. |
| Warm extraction integrity / receipt reuse      | 53.565 s / 156 ms    | Preserve the successful-extraction receipt. These are different checks.   |
| Retired local-client build startup             | 29.523 s             | Historical measurement; it is not part of the online workflow.            |

The proposed `check online-social` domain command remains **unimplemented**. Use existing scoped checks in the [documented order](validation-method.md#shorten-the-loop). Current source hashing still requires backend/frontend restarts after shared runtime changes; do not weaken identity guards to avoid a restart.

## Client-owned motion browser check

On **2026-09-14**, a real headless Chrome entered the development server (`map` `000050000`, source `c9d4b895…`, rules `373d3460…`, assets `93fd9410…`) with the client-authoritative prediction. A 3 s held right-arrow was sampled from `requestAnimationFrame` across 180 presented frames: the character advanced `kernelX 11 → 380.5`, presented **123.94 px/s** against `walkSpeed` 125, with **stall ratio 0**, jerk ratio 0.194, **0 prediction corrections**, 0 overflow and 0 last-position error. This establishes that ordinary movement is paced by the browser's own kernel with no server correction; it is not a frame-rate claim or original Windows parity. The mid-air skill and mob-knockback trajectories are proven by `client/test/divert-alignment.test.js` (optimistic skill applied once, refused cast rolled back, hit divert merged into the client's own state) and `server/test/hit-divert-replay.test.js` (a real `OnlineWorld` publishes the 270/-270 hit divert and a real `OnlinePrediction` merges it) rather than by this hold.

## Skill cast stutter repair

On **2026-09-14**, the [scoped native check](validation/skill-motion/report.json) completed **three successful rank-20 Flash Jumps** in original Henesys (`100000000`) with disposable account/database state. Source `edad787f…`, rules `15f80b52…`, assets `93fd9410…`; full identities and receipts are in the report. Across **211 frames**, prediction had **0 tick regressions, 0 unready frames, 0 loading/input-blocking frames, and 0 server position-ownership frames**. Frame interval median/p95 were **16.7/16.7 ms**, maximum **16.8 ms**, with no interval over 20 ms. Each cast's 60-ms observation retained horizontal speed **±550 px/s**. This is a short local workload, not an all-skills, WAN-latency or original Windows benchmark.

Readiness took **2.719 s**, the three-cast action window **3.543 s**, and browser-context teardown **21 ms**. [Runtime log](validation/skill-motion/runtime.log) retains server startup and catalog/rules/source checks and the guarded browser compilation stages. Existing generated assets were reused with **no extraction**. Browser acquisition is included in fixture startup rather than separately instrumented; these measurements make no acquisition-speed claim.

The [before report](validation/skill-motion/before.json) and [frames](validation/skill-motion/before-frames.json) captured **3 clock resets, 3 unready frames and 3 loading frames** despite stable 16.7-ms rendering. Its three key attempts included two successful casts and one insufficient-MP refusal: the initial fixture set displayed maximum MP without base MP. The final fixture sets both and explicitly checks three **cast** receipts rather than counting release receipts. This is causal failure evidence, not an equal-workload throughput comparison. Earlier setup attempts also exposed a missing shared report `results` array and missing WZ prerequisite; both harness defects were fixed before the retained baseline. An intermediate fix still reset prediction because assembled profile snapshots omit connection epoch; the final guard uses the authenticated transport epoch.

[Targeted test log](validation/skill-motion/tests.log): **107 tests / 1,453 assertions passed**, covering movement adoption/watchdog disconnection, protocol transport, immediate native cast and echo consumption, repeated/invalid casts, stale refusal after field replacement, player impulses and grounded mob recoil. Scoped formatting/lint and the nonpublishing guarded browser build passed. [Ghidra run log](validation/skill-motion/ghidra.log) and [full decompilation](ghidra-client/knockback-trajectory.txt) retain the original-client investigation. [Movement findings](movement-parity.md#skill-snapshot-continuity) describe the fixes and source boundaries.

## Extraction performance

On **2026-09-14**, the same default 735-map extraction with all 742 units cached fell from **57.11 s to 36.50 s**, a **36.1% reduction**. Both serial runs used Bun 1.3.14 on Darwin arm64 with CPU profiling enabled. This is one measured pair on this machine, not a cold-disk or cross-machine guarantee. [Evidence](extraction-performance.json) retains source hashes, input identity, timings and sampled hotspots; [profiling instructions](asset-delivery.md#profiling-a-slow-extraction) reproduce the workflow.

| Work | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| Complete extraction | 57.11 s | 36.50 s | Final success progress time; includes the rows below. |
| Selected-world preflight | 17.85 s | 7.56 s | Same source/dependency validation and decoded-pixel checks. |
| UI cache unit | 11.30 s | 7.34 s | Source, cache-record and transitive output verification. |
| Map cache units, summed | 22.26 s | 18.58 s | 735 sequential units; excludes surrounding catalog work. |
| Verified resources / bytes | 49,445 / 4,552,029,422 | 49,445 / 4,552,029,422 | Every unique reachable output still receives a length and SHA-256 check. |

The profile identified typed-array checksum iteration and generic per-pixel coordinate expansion as avoidable costs. Indexed signed-checksum arithmetic and direct unscaled RGBA conversion remove that overhead. Output verification also resolves its owned root once and uses native synchronous SHA-256. It still resolves each resource path, parses JSON dependencies and repairs missing/corrupt output through the existing cache path.

The decoder/recipe change required **one rebuild of all 742 units**, recorded separately at **662.22 s**. It independently compared **4,457,477,660 bytes** of atlas pixels, then reproduced the exact previous catalog bytes: build `20f52c09a7bf695a0b1e5b921383757aa48947d6b1be13f1ad53f5515294418e`, catalog SHA-256 `4fbf9bf3c70f13a209ff633f058fbf6a4aec139e962e168daa4dbcceeab4a17e`. The cache was retained and refreshed; this rebuild is excluded from the all-hit speed comparison. Cold conversion remains expensive and has no before/after speed claim here.

All **27 focused tests / 120 assertions** passed, including every 16-bit packed color, transparent RGB, scaled edges, signed checksum overflow, corrupt output/cache repair, nested descriptors, symlink escape refusal and publication binding changes. Scoped Prettier/ESLint checks passed. No gameplay or browser benchmark was needed for this identical-output conversion change.

The optimized warm run still spent **23.34 s** in output-closure verification, including **10.81 s** in reads/path checks and **9.61 s** in JSON decoding/traversal. These nested times are not additive with the total. Explicit extraction remains the integrity/repair operation; unchanged receipt probing is a separate, much cheaper operation. PNG encoding, metadata serialization and hashing remain costs when units actually rebuild.

## Known limits

| Claim not established                                       | Where to look                                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Complete original Windows rendering / native execution      | [Windows reference requests](windows-reference-captures.md)                                     |
| Every original skill, quest, item, reactor or service       | [Feature gaps](server/offline-parity.md#shared-rules-and-missing-coverage)                      |
| Production security, durability and deployment readiness    | [Required protocol proof](server/protocol.md#implementation-order-and-required-proof)           |
| Current full-catalog or world-wide performance             | [Historical reports](archive/index.md); these gates must be explicitly rerun for a new release. |

## Historical results

Earlier account names, schema versions, capture counts and benchmarks have moved to [validation history](archive/validation-history.md), [offline gameplay history](archive/gameplay-history.md) and [native UI history](archive/native-ui-history.md). Use the original report and source identity when investigating a regression; use the current guides for setup and implementation.


## Modern combat formulas (14 September 2026)

The user selected modern combat equations from StrategyWiki for the existing v83 content. [The formula contract and content mappings](combat-formulas.md) supersede earlier native damage calculations; native movement and authored action timing remain in place.

- **137 tests / 866 assertions passed** across sixteen affected client/server suites: formulas, stat display, large-number glyphs, first-cast area/Meso contexts, incoming hits, skill/status lifecycle, authority publication, protocol and motion. [Test output](validation/modern-formulas/tests.log).
- Scoped ESLint (zero warnings), Prettier and documentation links passed. The guarded browser build contains 930 modules. The running client/server identity matches the browser-tested source build `e17db7502eb12b3018eda94d305ab356549cb10d55c99f4f12505ecf4c6d4983` and rules `093a4c7c7504727b2e12b5ce30c9dd3da826bce8b0e499419da79b7028801293`.
- The isolated browser repeated three airborne Flash Jumps with the new combat/stat schema. All three casts committed. Across 210 frames: median 16.7 ms, p95/max 16.8 ms, zero intervals over 20 ms, zero motion regressions, zero unready/loading samples and zero metric overflow. [Report](validation/modern-formulas/report.json), [frames](validation/modern-formulas/frames.json).

This is a scoped regression measurement, not a guarantee across all hardware, maps or simultaneous combat populations. Modern-only content systems remain outside the v83 catalog; missing monster defense-rate fields explicitly mean zero percent, never a reinterpretation of legacy flat defense.

## Consecutive Flash Jump artwork (14 September 2026)

The [initial rapid-cast reproduction](validation/flash-jump-replay/before-report.json) committed two consecutive jumps and measured a 221 px separation between the second effect's rendered and published origins; its third cast was rejected. [Before frame samples](validation/flash-jump-replay/before-frames.json) and [image](validation/flash-jump-replay/before.png) retain that failure. Slower casts did not reproduce the offset. Intermediate rapid checks also exposed the input-order and paused-skill-clock admission cases described in [movement parity](movement-parity.md#skill-snapshot-continuity).

The final [report](validation/flash-jump-replay/report.json) and [frame samples](validation/flash-jump-replay/frames.json) cover five committed casts, including a rapid pair with a direction reversal and one replay while the old effect was still resident. Every visible Flash Jump frame matches the new cast's quantized origin: maximum offset **0 px**. [After image](validation/flash-jump-replay/after.png). Across 278 frames, median/p95 intervals were 16.7 ms, maximum 16.8 ms, with no intervals over 20 ms, loading/unready samples, regressing prediction ticks or authoritative movement resets. This is a local scoped measurement, not a hardware-wide performance claim.

**30 tests / 102 assertions passed** across seven suites covering effect reuse, WZ playback publication, queued-input ordering, airborne-use recovery, skill admission, combat and protocol. [Test output](validation/flash-jump-replay/tests.log). Changed JavaScript passed Prettier and ESLint with zero warnings; the browser used existing extracted assets. The report retains the exact source, rules and catalog identities.
