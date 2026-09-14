# Character gameplay corrections

## Feedback and resident appearance updates

Expected server refusals, including `SERVER_BUSY` and `REQUIREMENTS_NOT_MET`, remain visible as gameplay feedback. They do not enter the error journal or trigger the unexpected-error alert. Persistence adapters retain a typed refusal so callers can abort their action without misclassifying it as an exception. Unexpected exceptions still reach the journal.

Full snapshots also publish inventory, level and skill changes. A snapshot for the resident field updates its existing owners without starting the field-loading overlay, including cached equip/unequip and removal of a cursed equipped item. New-field entry retains its preparation screen.

## Earned points

`awardExperience` grants five AP per earned level, with the Cosmic Cygnus bonuses from `Character.levelUp` (lines 6308–6321). It no longer assigns STR, DEX, INT and LUK automatically. The existing local EXP threshold and base HP/MP growth remain unchanged; these are not claimed as original Nexon progression tables.

Non-beginner jobs receive three SP per earned level, following `Character.levelUpGainSp` (6257–6280). Beginners retain the executable-backed entitlement `min(level − 1, 6)` minus learned beginner ranks. The online Skill window now uses that entitlement instead of looking at ordinary SP.

The requested restriction on banking SP is enforced in both allocation and display: ordinary advancement stages use separate positions in the existing ten-element `remainingSp` array: first job 0, second 1, third 2, fourth 3. Evan retains positions 0–9 for its ten books. Only the selected skill's book can spend its own balance, so first-job points cannot purchase second-job skills. Existing legacy pooled SP remains in position 0; its historical earning stage cannot be recovered reliably. No existing balances or allocated stats are rewritten. Advancement-stage separation is the requested application policy, not a claim that the original executable maintained four ordinary wire pools.

## Incoming monster hits

The supplied archive was read directly: `Mob.wz:0100100.img/info` gives Snail level 1, PADamage 12 and accuracy 20. These agree with the reusable extracted catalog. The existing `0079286e` physical evasion formula, its 4.5 divisor, integer half-level penalty, and ordinary/thief caps agree with the retained [decompilation](ghidra-client-features/trading/physical-incoming-evasion.txt) and [constant bytes](ghidra-client-features/trading/physical-incoming-evasion-constants.txt).

Fresh [Ghidra instructions](ghidra-client/gameplay-corrections/incoming-instructions.txt) confirm a second reason for MISS: `0095848f` compares the physical result with zero and `00958492 SETLE` marks all nonpositive damage as missed. The later minimum-one branch at `00958fed` only applies when that miss flag is clear. Defense can therefore cause repeated MISS against weak monsters even when evasion probability is low. The reported level-5 beginner's derived EVA 7 against Snail accuracy 20 implies about 7.78% evasion; its PDD 12 can separately reduce every Snail physical damage roll below one. The formula is preserved rather than replacing native defense misses with guaranteed one-damage hits.

## Dark scroll destruction

Direct `Item.wz:Consume/0204.img/02043005/info` observations give 30% success and `cursed: 50`. Curse probability applies after failure, matching the supplied Cosmic `ItemInformationProvider.scrollEquipWithId` (1063–1135). An ordinary failed dark scroll can leave the item intact; a curse removes it. White Scroll preserves a failed upgrade slot but does not protect against curse destruction.

The existing `applyEnhancement` removes the selected UID from its actual container, including worn equipment, and recalculates worn-item vitals. Same-template copies are preserved. Server item rows and their economic ledger follow the committed draft. Pure regression cases cover both containers and White Scroll; native validation below checks the transaction and reconnect boundary.

## Focused checks

- `client/test/level-points.test.js`: multilevel awards, job-stage isolation, beginner entitlement, Cygnus boundaries and the level cap.
- `client/test/online-feedback.test.js`: visible refusals, unexpected-exception routing and online beginner point display.
- Existing skill allocation/growth, advancement, enhancement, physical damage, transport and kill-credit checks cover the affected shared contracts.
- `bun server/tools/check-character-corrections.js --output /tmp/openms-character-corrections`: disposable database/accounts and two isolated browsers; native quest completion, skill allocation, equip/unequip, invalid equipment admission, worn/bag dark scrolling, recipient appearance and reconnect. Original scroll RNG is retained and bounded; exhausting the bound is a failed check, never a manufactured curse. No extraction rebuild is required.

The browser report records source, rules and catalog identities. These checks establish application behavior and source agreement, not original Windows runtime parity.

The retained [native report](validation/character-corrections/report.json) passes with zero loading-overlay activations and no browser exceptions. It includes the rejected equipment requirement, earned and spent second-job SP, two curse deletions, the witness's equipped-weapon removal, and reconnect persistence. Both participants and the reconnected character verified the same served source and asset identity. The focused regression run passed 77 tests; changed JavaScript formatting/lint, the guarded browser build and documentation links also passed.
