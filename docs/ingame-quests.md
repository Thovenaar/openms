# Original quest data and offline quest authority

## Scope and ownership

`client/tools/quest-data.js` extracts the complete supplied Quest archive into `catalog.quests`. `client/src/quest-system.js` interprets supported declarative paths against the shared `ProfileStore`. `client/src/quest-ui.js` mounts native dialogue and journal controls inside the existing original `UIWindow/UtilDlgEx` surface. No third-party client implementation, invented NPC dialogue, missing script body, monster drop table or server implementation is used.

This is **local authority**, not original server parity. Original records determine requirements, dialogue and encoded reward amounts. Synchronous one-shot transitions, browser persistence, local character progression, inventory aggregation, list pagination and accessible DOM text are explicit browser policies. The profile's provisional class selector does not reconstruct original job-advancement scripts and never weakens a quest's literal job requirements.

## Complete original archive inventory

A bounded read of every IMG in the supplied v83 `Quest.wz` parsed 156,338 nodes with zero unknown parser types or parse failures:

| IMG | Quest/root records | Nodes | Bytes | SHA-256 |
| --- | ---: | ---: | ---: | --- |
| Check.img | 2,806 | 55,421 | 684,779 | `0603293c5453cb1bcff410dcbd39883ff9b9a70f878956f613a10067c1a153fc` |
| Act.img | 2,823 | 38,132 | 640,726 | `82ca8469fa757328cbe16811c8963b0aca52d61bf44138a27996a38579128da8` |
| Say.img | 2,800 | 42,293 | 3,164,451 | `8199cf01c4b226142c7f18c0175b267801ebd011037a67c0bf1607effe6296a3` |
| QuestInfo.img | 2,817 | 20,018 | 1,474,669 | `59edc9d73ebe3ff2234f6a5329dd26659da579f1f5cc6feaf38cce871dc4e901` |
| Exclusive.img | 1 medal container | 16 | 173 | `0e42a1f3e737e051bae449eb7a007e1555ec64dabb8697201a1adf10893bb18f` |
| PQuest.img | 10 | 458 | 6,521 | `c99d280728d88777ad7890d5d2f1ac2cf5e9d3db2488489f987b77a1343db6d4` |

The extraction uses the existing WZ parser, not a second decoder. The normal extraction context retains actual IMG identities and checksums in the release manifest. The catalog retains each original node's exact path, type, value and classification under `quests.inventory[image].rows`; property containers, malformed authored keys, missing stages, extra numeric branches and auxiliary records are not flattened away. `quests.fields` counts every normalized field path and its observed classifications. `quests.records` is the union of ordinary Check/Act/Say/QuestInfo IDs, not a hand-selected list. The source inventory contains 2,825 distinct ordinary IDs; 2,780 have all four records and 2,779 have both stages in all stage-bearing images.

The complete discovery inventory identified 40 named Check condition families. There are 319 `startscript` and 362 `endscript` Check occurrences. These are references, not bodies. `Etc/ScriptInfo.img` is menu-label/description metadata, not executable quest logic.

## Retained executable evidence

`docs/tools/questConsumers.java` searches PUSH operands for the original decoded string-pool IDs 3198–3232, then exports containing functions without modifying the original program. Its completed read-only Ghidra run retained 53 scalar reference rows in `docs/ghidra-ingame-quests/refs.txt` and the associated decompilations. `evaluate.c.txt` additionally retains the original active-quest evaluator and callers. The existing decoded pool is `docs/ghidra-client/decoded-strings.txt`.

| Address | Evidence used |
| --- | --- |
| `0071d8df`, pool `00b19cdc` | Original Check image/resource consumer. |
| `0071e1d6` | Decodes condition records, including npc, job lists, level/fame/meso fields, quest state and item/mob pairs. |
| `0071e9a1` / `0071ea08` / `0071ea6f` | `lvmin`, `lvmax`, `pop`; fields stored at record offsets `+0x1c`, `+0x20`, `+0x24`. |
| `0071f7fb` | Literal Check job-list loader; entries are enumerated, not inferred from quest names. |
| `0071faa7` and `0071fcf0` | Missing quest `state` and item `count` decode with zero defaults. |
| `00721d2c` | Active quest evaluation: nonzero endpoint NPC mismatch rejects; item and prerequisite-state checks; authored kill counters. |
| `00721d2c`, retained lines 130–163 | Positive item count requires at least that count, negative count imposes a maximum of its absolute value, zero requires absence. Original client also distinguishes item-instance categories not represented by the aggregate local inventory. |
| `00721d2c`, retained lines 166–191 | Prerequisite state 0 is neither active nor completed, 1 active, 2 completed. |
| `00721d2c`, retained lines 195–238 | Completion reads encoded three-digit kill counters and compares them with authored required counts. Local storage uses bounded numeric counters instead of recreating a server string format. |
| `007166b6`, `00716926` | Act item presentation/filtering; job mask tests `1 << ((job / 100) & 31)`, with family 9 exemption; gender default 2 means unrestricted. Local gender is absent, so gender-restricted reward rules are unavailable. |
| `0071808a` | Original completion reward/selection presentation, item/meso/EXP/fame display and selected-item result. |
| `00716fe1`, `007171ba` | Loads dialogue from `Quest/Say.img`, quest ID and stage. |
| `00717963`, `007179e9` | Numeric dialogue sequence with `stop/<page>/<selected-choice>` branch lookup. |
| `00717ddd`–`00717e2a` | Nonempty selected stop text is displayed and terminates the conversation; absent/empty selected stop text advances. Thus a naive `answer - 1` evaluator is not used. `answer` metadata remains in the inventory/projection. |
| `00717b36` | `flip` activates an additional native text/speaker presentation path. That path remains unsupported; it is not guessed from the field name. |
| pool `00b19c34`, `00b19c0c`, `00b19be8` | Original UtilDlgEx quest accept/give-up/list resource identities. Positioning and text metrics are not established by these string references. |

Original packet delivery, authorization, rollback/error behavior, reward generation, repeat policy and time control are not recovered from presentation consumers. The browser transaction policy below is explicitly local.

## Field classification and implemented projections

Every classification is recorded per source node, with an exact source-path reason for unsupported nodes. A quest with an unsupported mandatory condition/action/control or dialogue branch is not admitted. Missing Check/Act stages and missing numeric Say dialogue pages are explicit blockers. Original Act-embedded strings are retained but never substituted for missing Say pages: quest 1029, for example, contains Korean Act text alongside distinct English Say text.

### Check

Implemented:

- `npc`: required endpoint identity when nonzero; rechecked for every transaction.
- `lvmin`, `lvmax`: inclusive local level gates; zero means no bound.
- `job`: membership in the exact authored list; no implicit inclusion of beginners and no class-family expansion.
- `pop`, `endmeso`: minimum local fame/meso gates.
- `item/<index>/{id,count}`: aggregate local stock with the original positive/negative/zero comparison described above; equipped possession counts for conditions, but quest actions do not silently remove equipped objects.
- `quest/<index>/{id,state}`: exact not-started/active/completed prerequisite state.
- `mob/<index>/{id,count}`: accepted local kills while the quest is active, saturating at the largest requirement for that quest/template. Duplicate requirement rows cannot double-credit a kill.

Explicitly unavailable Check families:

- Time/schedule: `start`, `end`, `interval`, `dayByDay`, `dayOfWeek` and weekday children.
- Scripts/control: `startscript`, `endscript`, `normalAutoStart`, `userInteract`.
- Character/world state not in this profile: `level` (distinct from `lvmin/lvmax`), `worldmin`, `worldmax`, `skill`, `pet`, `mbcard`, `mbmin`, `pettamenessmin`, `tamingmoblevelmin`, `petRecallLimit`, `petAutoSpeakingLimit`.
- Field/equipment/info conditions requiring additional semantics: `fieldEnter`, `equipAllNeed`, `equipSelectNeed`, `infoNumber`, `infoex` including `value/cond`, `info`.
- Buff/special conditions: `buff`, `exceptbuff`, `morph`, `partyQuest_S`, `questComplete`.
- Additional nested numeric quest/mob branches and any unrecognized shape/value.

### Act

Implemented local deterministic transactions:

- `exp`, `money`, `pop`: original integer quantities; EXP uses the shared `awardExperience` policy, never a quest-specific level-up formula.
- `item/<index>/{id,count}`: positive grants, negative debits, zero no change. All debits are validated against pre-transaction inventory; receiving the same item in the transaction cannot fund its debit.
- `item/job`: original integer family-mask filtering. Unrestricted `gender=2` is supported; restricted gender needs absent profile data and blocks the rule.
- Absent/zero `prop`: deterministic item entry. `prop=-1`: an explicit player-selected original reward; selection is mandatory and validated. Positive weighted `prop` values remain unavailable, not replaced by a convenient deterministic prize.
- `quest/<index>/{id,state}`: encoded state assignments, subject to the local monotonic one-shot constraint. An action attempting to reset a completed/active quest or contradict the current transaction is rejected atomically.
- `npc`, `lvmin`, `lvmax`, `job` list: additional local gates, never job-advancement assignments.
- `nextQuest`: retained, displayed as the original next quest, and available through its original endpoint/prerequisites. It does not silently accept a quest or invent travel.

Unavailable actions: item `var`, restricted `gender`, positive weighted `prop`, `period`, `dateExpire`, `name`; skill/rank/master-level actions, pet actions, field/map travel actions, time/control fields, `buffItemID`, `npcAct`, `info`, `message` and unrecognized fields. Embedded numeric/yes/no/ask/stop dialogue is retained as non-operative Act metadata; original Say is the displayed source.

### Say and QuestInfo

Supported Say is ordered numeric pages, authored `yes`/`no` pages, ordinary `stop/npc|item|mob|quest|default` pages, and numeric choice-response branches. Choice IDs are the literal `#L<id>#` values, not option array positions. Missing closing `#l` before another option or the end of text is rendered without inventing another choice. Every displayed answer is one of the encoded choices. A wrong authored stop response terminates without state/reward mutation. A correct path advances to the next numeric page. `ask` is retained, and NPC speaker overrides use the corresponding original String name.

Optional `lost`/`lost/yes` recovery branches are individually classified unavailable and are not offered. They do not prohibit an otherwise supported normal accept/complete path. The runtime does not fake lost-item recovery grants. Nonzero `flip`, malformed authored dialogue keys, nested stop/stop branches, override job/quest/info state, choice-bearing yes/no paths, or choices without a corresponding original result container block affected ordinary dialogue rules.

QuestInfo numeric 0/1/2 journal text and `name`, `area`, `parent`, `order`, `summary`, `demandSummary`, `rewardSummary`, `type`, `sortkey`, `showLayerTag` are retained as presentation. `autoStart`, `autoPreComplete`, `autoComplete`, `autoAccept`, `oneShot`, timers/play-time, selected mob/skill, medal selection and the nested `8833/4963` record remain classified mandatory-control blockers. Exclusive medal and PQuest result/rank trees are fully retained and explicitly unavailable as ordinary quest authority.

## Shared state and transaction ordering

`new QuestSystem(catalog.quests, store, hooks)` exposes `forNpc(npcId)`, `begin(questId,npcId)`, `complete(questId,npcId)`, `onKill(templateId)`, `openDialogue(questId,npcId)`, `knownJobs()` and `snapshot()`. `knownJobs()` is the bounded union of original Check job lists used by the clearly labeled local class selector.

The shared profile is the only durable state owner. No quest singleton, storage key or second persistence database is introduced. Missing quest records have state 0. Acceptance moves 0→1 and initializes kill counters; completion moves 1→2. State 2 never grants another completion reward. Optional completedAt uses epoch milliseconds.

For a transition:

1. Re-read the current profile and validate state, the original endpoint, all supported Check gates and Act gates.
2. Require the completed dialogue session for a choice-bearing path; its quest, stage and NPC must match the transaction.
3. Validate selected original item rewards and every required debit against current stock.
4. Build a transaction draft with new inventory/quest maps, meso/fame and the shared progression result. Existing profile collections are not mutated during this phase.
5. Validate the complete draft using the shared profile validator, including its inventory capacity and safe integer bounds.
6. Synchronously replace durable fields on the same profile root, then call `markDirty()` once. Only then notify UI/effect hooks. There is no await between admission and commit.

Original `QuestClear` and `LevelUp` effects are emitted after a successful corresponding local event. Acceptance has no invented effect. Save I/O remains the profile owner's revision-checked full-snapshot transaction; UI surfaces failures rather than claiming unsaved state durable. Reset replaces nested profile collections, so all state reads use the current profile rather than captured quest/inventory aliases.

## Native surface and interaction authority

Main wires:

- `hooks.onNpcDialogue = (panel,npc) => mountNpcDialogue(panel,npc,quests)`.
- `hooks.onQuestJournal = panel => mountQuestJournal(panel,quests)`.
- confirmed field kills to `quests.onKill(templateId)`.
- quest `onChange` to `GameUI.refreshProfile()`.

The life owner's native record carries **`canInteract(): boolean`**, not a second admission alias. Quest UI rechecks that exact live closure before opening a conversation, advancing/answering, or committing acceptance/completion. A missing closure, stale field/membership, hidden/unresident/destroyed NPC, absent rendered artwork, dead player or blocking transition cannot authorize the transaction. Normal agent interaction and primary-left world release share this gate; inspector selection never authorizes gameplay. Recovered `00531b8d` cursor and `0094fa8e` left-button release both use NPC pool picker `006d92d3`; `006d3fde` translates dc without facing, with per-edge defaults `[-22,-65,22,0]` from `006dd584`–`006dd6f0`. The former guessed 120×100 proximity policy is removed; original server distance acceptance is not claimed. See [NPC world target and admission](ingame-life.md#npc-world-target-and-admission) for the optional unrendered quest-indicator boundary and retained original evidence.

Integration supplies `LifeSystem.hooks.isBlocked(id)` for map/profile transitions, carried UI state and unrelated modals. It permits the currently open same-NPC dialogue's own continuation check. New cursor/world/normal-agent admission instead calls the same hook **without an ID**, rejecting every modal, including the current conversation. The main UI also prevents new world pointer/cursor activity behind modals. A rejected world action never falls back to metadata inspection.

UtilDlgEx keeps the original t/c/s chrome and authored BtPrev/BtNext/BtQYes/BtQNo/BtOK/Close controls. Native content uses the UI owner's 480×132 scrolling rectangle; each local list page contains at most 24 entries and all entries remain reachable. Footer controls are cached per panel, reused across remounts, and hidden/released by cleanup. Content uses two delegated listeners per mount; refresh does not accumulate listeners or controls. The journal is read-only: selecting an entry does not accept or complete it remotely.

Text is constructed through `textContent`, never innerHTML or evaluation. Original name tokens resolve via original String NPC/Mob/Map/item categories; player-name and progress/count tokens use the shared local profile. Color/bold and line-break presentation are a documented local rendering policy. Item-image tokens use the original item name as accessible textual presentation, not fabricated artwork. Unsupported resource/skill/other markup stays visible as original literal bytes; it is never treated as executable control. Missing strings remain missing rather than invented NPC speech. Font metrics, portraits and original dynamic dialogue sizing are not claimed recovered.

## Concrete generic paths and content boundaries

### Camila 28268

`[Hunt] The Pigs Are Ruining the Produce!` has:

- Start NPC 1012108, exactly 65 authored advanced-job IDs; **job 0 is absent**. There is no lvmin/lvmax field.
- Completion NPC 1012108 and Pig 1210100 ×30.
- Empty acceptance action; completion EXP 600.
- Complete ordinary accept/refuse/progress/finish dialogue and journal text.

No quest-ID branch exists in the interpreter. This path uses the same NPC, literal-job, kill and EXP operations as other admitted records. The beginner bootstrap must not bypass its job list; the explicitly provisional local class selector is separate from quest interpretation.

Camila is at Henesys 100000000, authored life/6 x5036/y−127/fh68. Henesys east00 reaches map100010000 west00, The Hill East of Henesys, which contains 13 original Pig placements. The field owner's explicit local respawn policy makes 30 accepted kills possible; placement metadata alone does not establish original spawn authority. There is no invented Pig loot.

### Other generic records

- 1009, `Rain's Maple Quiz 1`: NPC12101, job0, authored I/K/S/E choices, EXP2 and nextQuest1010. The correct option is ID0, whose stop text is absent; the three wrong original responses are preserved. Its Info has no automation gate. Following quiz records use the same interpreter, not dedicated script code.
- 1036, `Robin the Walking Encyclopedia`: NPC2003, job0, lvmax10, three authored choice questions, EXP40. No automation gate is authored in Info. The original malformed choice closing markup is preserved, not normalized into different choices.
- 2088, `The Reason Behind the Mushroom Studies`: Bruce1012111, lvmin10; 40 Orange Mushroom Caps4000001 and 10 Mushroom Spores4000011, consumed for EXP300 plus25 Red Potions2000000. The generic transaction supports this exactly when the items exist. No original monster-drop authority is supplied, so item acquisition is an explicit dependency, not a fabricated loot rate.
- 2062, `Mrs. Ming Ming's First Worry`: NPC1012106, lvmin20; original Pig's Ribbon/Slime Bubble/Bubbling's Huge Bubble requirements and debits, EXP3000. Differing quantities in the authored progress dialogue are preserved, not corrected by rewriting NPC speech.

`record.dependencies` retains referenced NPC, monster, item, quest, map and missing-script identities. The release's selected map set is indexed for actual NPC/mob placements, with a bound of512 maps. Missing packaged NPC/mob/map dependencies are exposed. Item dependencies state the absence of invented drops. Neither script-free status nor a fully decoded archive is a claim that a particular profile can currently finish every quest. Exact source rules, current character prerequisites, unavailable controls and actual packaged content are distinct surfaces.

## Verification ownership

Original-data probing and the two read-only Ghidra exports above were run during implementation and are retained evidence. A scoped throwaway native Bun invocation exercised the completed quest modules without running a build, formatter, linter or project test suite. It extracted all 2,825 ordinary records and all 156,338 nodes; **961 records** had supported ordinary declarative paths in this interpreter revision. This count excludes profile eligibility and packaged-content feasibility.

The native invocation observed: beginner job0 rejection for Camila; wrong-NPC rejection; successful generic acceptance; completion rejected at0 and29 Pig kills; completion after30 accepted kills granting the original EXP600; duplicate completion rejected with only one persistence-mark call for the successful completion. Bruce2088 rejected missing items, then consumed40 Caps and10 Spores and left exactly25 Red Potions after the original reward. Rain1009's wrong authored choice left state1 with rejected dialogue; the correct choice path completed forEXP2 and returned nextQuest1010. These were isolated in-memory profile scenarios using real extracted WZ records, not fabricated quest fixtures or a browser/server parity claim.

Main completed release extraction and integrated native acceptance. [Independent combat/quest evidence](offline-validation/combat-quests/evidence.json) records the real NPC/class controls, 30 native Pig kills, completion and one EXP600 reward, then durable reload. Main's native [journal replay](offline-validation/main/journal-after.json) and [detail replay](offline-validation/main/journal-detail-after.json) reopen completed 28268 on the first journal page, show 30/30 and EXP600, and leave duplicate completion disabled. These prove that supported local path, not every record's content feasibility or original server parity. The earlier persistent-Eval cross-module Object-realm issue was isolated by the native Bun module-graph invocation; profile validation was not weakened.
