# Online/offline feature coverage

Online reuses the offline client's original-asset presentation and shared rules, with the **server authorizing gameplay and durable changes**. This is an implementation inventory, not proof that every original skill, quest or multiplayer failure mode has been exercised.

The [remaining-work audit](remaining-work.md) compares current controllers and packaged content with the original resources and Cosmic reference. Its implementation progress records party effects, shared kill credit, quest timing, safe field retirement and MTS. Progression scripts and monster/event controllers remain major gaps.

## Implemented ownership paths

The static [feature audit](online-feature-audit.json) was rerun against the current code: **71 gameplay action kinds, 45 social actions, no missing shared native UI hooks or social rule mappings**. Literal references and hooks establish wiring, not complete behavior. Reproduce with `bun docs/tools/online-feature-audit.js`.

| Feature / native surface                                   | Online owner                                             | Boundary or limitation                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Walk, jump, climb and remote players                       | `world.js`, shared motion and checkpoints                | [100% movement now matches offline](../movement-parity.md); original 30 ms step. |
| Attacks, skills, damage and mobs                           | `field-combat.js`, `field-skills.js`, shared controllers | Atomic party effects and shared kill credit; special mob controllers and party Door access remain incomplete. |
| Item/Equip, use, enhancement, drop and pickup              | Inventory/character actions and `field-drops.js`         | Opaque instance IDs, owner checks and transactional debits.                      |
| Stat/Details, AP, SP and SkillMacro                        | Character actions, native stat/skill projections         | Server-published stats; macros are drafts until saved.                           |
| NPC dialogue and choices                                   | `interaction-npc*.js`, conversation leases               | Preserves authored choice IDs; unsupported program calls fail explicitly.        |
| Quest journal, tracker and rewards                         | `interaction-quest*.js`                                  | Rechecks eligibility at commit; special unsupported controllers stay blocked.    |
| Shop and storage                                           | `interaction-shop.js`, `interaction-storage.js`          | NPC/session checks; atomic buy/sell/recharge/deposit/withdraw.                   |
| TradingRoom                                                | `interaction-trade.js`, participants                     | Both owners, locked offers, confirm/cancel and atomic exchange.                  |
| CashShop, locker, gifts and expansion                      | `interaction-cash.js`                                    | Catalog/account authority exists; real payment service is external.              |
| Buddies, blacklist, UserInfo and fame                      | Social interactions and participant transactions         | Identity, reciprocal state and eligible recipient checks.                        |
| MTS | `interaction-market.js`, market custody and original ITC UI | Fixed-price sales, wanted orders, auctions, carts, expiry and transfer inventory; payment handling is deferred. |
| Party, search and PartyHP                                  | Group/social rules and field observations                | Mirrored membership, party effects and shared kill credit; shared Door access remains open.         |
| Guild/alliance, ranks, board and notice                    | Group/board owners                                       | Rank, capacity, cohort and founding-presence rules.                              |
| Family, reputation and travel privileges                   | `social-family.js`, participant travel                   | Eligible real members and server-owned costs/travel.                             |
| Map, whisper, buddy, party, guild/alliance chat; messenger | `interaction-chat.js`, social owners                     | Actual recipient admission; spouse relationships unavailable.                    |
| KeyConfig, quick slots and options                         | Binding/settings actions                                 | Server validates saved records; drafts and presentation remain local.            |
| MiniMap, WorldMap, GameMenu and shortcuts                  | Shared `GameUI` and online native adapters               | Views do not grant travel or external channel/account services.                  |
| MonsterBook, medals and titles                             | Native/book/quest actions                                | Earned records and supported quest rules.                                        |
| Revival, portals, doors, expressions and seats             | Field transitions/world actions                          | Server-selected outcomes; unsupported routes/items refused.                      |
| Pets and mount-related controllers                         | Pet actions and shared skill utilities                   | Activation, hunger, hatching and presentation exist; equipment and other lifecycle actions remain incomplete. |
| Reactors and item offering                                 | `field-reactors.js`                                      | Authored eligible transitions; script rewards incomplete.                        |
| NPC ambient action and speech                              | `field-npcs.js`                                          | One server-selected clock/line, shared by recipients and late joiners.           |
| Development World/Character controls                       | Audited HTTP development endpoint                        | Developer role + development mode; never a normal-player mutation.               |

Paths in this table are under `server/src/` unless noted. [OnlineUI](../../client/src/online/ui.js) and its `native-*` adapters connect the windows to those owners. [NativeProfileSource](../../client/src/online/native-source.js) is read-only. [The build guard](../../client/tools/online-build-graph.js) rejects browser imports of offline authority.

## Shared rules and missing coverage

The retained catalog classifies **485 of 534 skills** as source-capable and **49** as unavailable across 71 numeric books. Classification does not bypass rank, resource or controller admission and is not 485 native gameplay replays. [Skill coverage](../skills.md) and the [fresh original-resource audit](../original-resource-audit.md) retain exact classifications and source inventories.

| Still incomplete / external                             | Consequence                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| Pet equipment, reactor script rewards                   | Artwork or an event does not imply the full interaction/reward exists.  |
| Unsupported quest, skill, item and portal controllers   | Admission fails with an explicit reason; no invented rewards or routes. |
| Spouse/marriage, external payment/channel services      | Opening an original window does not implement those services.           |
| Original-server policies and Windows raster equivalence | Emulator rules and browser fonts remain separately labeled.             |

## NPC/quest corrections

| Interaction        | Current behavior                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| Menu               | Original order, quest state icons and authored labels; no synthetic NPC-name choice.           |
| Choices            | Numeric wire IDs become native `{id}` records, preserving `#L` values rather than row indices. |
| End Chat           | Sends `cancel`, closes the lease and removes reconnect presentation.                           |
| Decline            | Sends `yesno:false`, follows authored No prose, then ends with OK.                             |
| In-progress quests | Remain browsable; stop/progress prose grants no reward eligibility.                            |
| Terminal receipt   | Retired UI is not refreshed after server-driven teardown.                                      |

[Native UI recovery](../native-ui-authority-recovery.md), [quest rules](../ingame-quests.md) and [NPC geometry](../ingame-life.md#npc-world-target-and-admission) own the detailed evidence.

### Shared NPC ambient presentation

Native `006d2918` counts 30 ms updates and schedules authored action/speech choices after 3000–8999 ms; speech lasts 5000 ms, and quest markers take precedence. [Original consumers](../ghidra-client-corrections/reported-r4-npc-native.txt) and [speech instructions](../ghidra-client-corrections/speech-instructions.txt) establish those clocks.

Online publishes action/start tick and bounded `npcSpeech:{actionIndex,lineIndex,startTick}`. `actionIndex:null` means a global line. The client resolves only that NPC's authored line and resumes its observed age without rerolling. Quest markers remain character-specific. A field conversation defers new shared selections and field pause pauses the selector; conversation-wide suppression is an explicit multiplayer policy.

## Chat, presets and development

Map chat reaches the actual field instance, including players outside visual interest range. Expanded history uses recovered channel colors, sender echoes and message-ID deduplication. Private membership, preferences and blacklist admission remain server-owned. History is **received during this session**, not a retrospective server archive.

Character presets prepare a preview, then **Apply** submits an authorized edit. Conjure, scalar/skill changes and supported character features share the development endpoint. Preset replacement safely retires old summon resources; ordinary-player presence does not itself forbid authorized shared-field controls. Local checkpoint/reset is not an online profile upload.

## Focused proof and reproduction

| Scope                                  | Executable evidence                                                        | What it establishes                                                       |
| -------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Movement coefficients and continuation | [Regression source](../../server/test/movement-parity.test.js)             | Real server step agrees with offline trajectory and restored checkpoint.  |
| NPC dialogue and ambient               | [Native report](../native-ui-validation/online-npc-dialogue/report.json)   | Source-identified NPC/quest interactions and shared ambient presentation. |
| NPC, Ability and development repairs   | [Native report](../native-ui-validation/ui-authority-repairs/report.json)  | Focused UI/authority corrections, not every native window.                |
| Drops, presets, map/social chat and GM | [Two-player report](../native-ui-validation/drop-chat-presets/report.json) | Actual sender/recipient behavior and reconnects for that repaired build.  |
| Current declarations                   | [Feature audit](online-feature-audit.json)                                 | Hook/action coverage only; no gameplay acceptance claim.                  |

Choose further checks using [change-scoped validation](../validation-method.md#validation-scope). New multiplayer features need native input → transaction → recipient update → reconnect proof for their own domain.
