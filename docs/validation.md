# Validation results and known limits

Read a result together with its **source/catalog identity, fixture, action and limitation**. A passing unit test, an implemented handler and a native browser replay establish different things. [Validation method](validation-method.md) owns the procedure; old run narratives are in the [archive](archive/index.md).

## Current evidence index

| Area                                   | Evidence                                                                                                             | Scope                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Online 100% movement                   | [Movement parity](movement-parity.md#scoped-verification)                                                            | 33 focused tests / 795 assertions; actual server step, offline trajectory and checkpoint continuation. |
| Drops, presets and chat                | [Two-player report](native-ui-validation/drop-chat-presets/report.json) · [Recovery](original-resource-audit.md)     | Source-identified native recipients/reconnects; no all-content claim.                                  |
| NPC, Ability and development tools     | [Native report](native-ui-validation/ui-authority-repairs/report.json) · [Recovery](native-ui-authority-recovery.md) | Repaired native UI and authority paths on its recorded build.                                          |
| NPC dialogue and shared ambient speech | [Native report](native-ui-validation/online-npc-dialogue/report.json)                                                | Session dialogue, cancel/quest behavior and shared NPC presentation.                                   |
| Login, creation, spotlight and dice    | [Recovery and evidence](login-creation-recovery.md)                                                                  | Original placements and server-issued starting stats.                                                  |
| Selection and travel                   | [Focused report and method](login-selection-travel.md)                                                               | Retained native selection/transition checks.                                                           |
| Original asset inventory               | [Resource audit](original-resource-audit.md)                                                                         | All 16 resource archives inventoried; counts are not runtime completeness.                             |
| Online surface declarations            | [Feature inventory](server/offline-parity.md)                                                                        | 61 action kinds, 45 social actions, shared hooks; static coverage only.                                |
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
| Earlier offline server startup                 | 29.523 s             | Offline integrity/compression is not the online inner loop.               |

The proposed `check online-social` domain command remains **unimplemented**. Use existing scoped checks in the [documented order](validation-method.md#shorten-the-loop). Current source hashing still requires backend/frontend restarts after shared runtime changes; do not weaken identity guards to avoid a restart.

## Known limits

| Claim not established                                       | Where to look                                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Complete original Windows rendering / native execution      | [Windows reference requests](windows-reference-captures.md)                                     |
| Every original skill, quest, item, reactor or service       | [Feature gaps](server/offline-parity.md#shared-rules-and-missing-coverage)                      |
| Production security, durability and deployment readiness    | [Required protocol proof](server/protocol.md#implementation-order-and-required-proof)           |
| Current full-release installation or world-wide performance | [Historical reports](archive/index.md); these gates must be explicitly rerun for a new release. |

## Historical results

Earlier account names, schema versions, capture counts and benchmarks have moved to [validation history](archive/validation-history.md), [offline gameplay history](archive/gameplay-history.md) and [native UI history](archive/native-ui-history.md). Use the original report and source identity when investigating a regression; use the current guides for setup and implementation.
