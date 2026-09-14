# Validation results and known limits

Read a result together with its **source/catalog identity, fixture, action and limitation**. A passing unit test, an implemented handler and a native browser replay establish different things. [Validation method](validation-method.md) owns the procedure; old run narratives are in the [archive](archive/index.md).

## Current evidence index

| Area                                   | Evidence                                                                                                             | Scope                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Online 100% movement                   | [Movement parity](movement-parity.md#scoped-verification)                                                            | Shared-kernel/server steps, browser prediction and checkpoint continuation.                             |
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
