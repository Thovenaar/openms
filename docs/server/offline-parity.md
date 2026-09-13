# Online/offline feature parity

Online uses the same authored presentation and recovered gameplay rules as the offline client, with the server owning gameplay decisions and durable changes. An offline save is not an online command. This inventory separates implemented paths from this change's focused verification; it is not an all-content acceptance result.

## Implemented ownership paths

These paths were inspected in September2026. The older server overview's four-skill whitelist and exclusion of storage, cash, guilds and family were stale.

| Capability | Shared presentation/rules | Online owner |
| --- | --- | --- |
| Movement, players, mobs, attacks and skills | Shared motion kernel, `SkillSystem`, combat controllers and original animations | `server/src/world.js`, `field-skills.js`, `combat-controller.js`; recipients consume state and combat events |
| Item use/equipment, pickup/drop, AP/SP, macros and settings | Inventory, skill allocation and profile rules | `action-inventory.js`, `action-character.js`, field drops and transactional action adapters |
| NPC programs and quests | Original UtilDlgEx, `QuestDialogue`, `QuestSystem`, compiled authorized Cosmic callbacks | `interaction-npc*.js`, `interaction-quest*.js`; session-bound conversation steps and transactional rewards |
| Shops, storage, trade and cash catalog commerce | Shared original windows and commerce rules | `interaction-shop.js`, `interaction-storage.js`, `interaction-trade.js`, `interaction-cash.js`; participant/account locking and receipts |
| Friends, party, guild/alliance, family, messenger and chat | Shared social windows; server-fed peer directory | `interaction-social.js`, `social-family.js`, `interaction-chat.js`; relationship and recipient admission |
| Expressions, seats, reactors, pets, monster book and travel | Original world-action, reactor, pet, book and transition presentation | `field-world-actions.js`, `field-reactors.js`, `action-pets.js`, `action-native.js`, `field-transition.js` |
| NPC ambient animation and speech | Original NPC actions/utterances and `NpcWorldPresentation` | **Restored:** `field-npcs.js` chooses and times one field-owned presentation for recipients and late joiners |

[OnlineUI](../../client/src/online/ui.js) connects shared native controls to the `native-*` adapters. [NativeProfileSource](../../client/src/online/native-source.js) is a read-only publication source without save/flush/commit methods. UI drafts may change locally; rewards, inventory, relationships and field outcomes require server receipts. [The online build graph](../../client/tools/online-build-graph.js) rejects browser imports of offline persistence/authority owners. Rendering, audio, menus, camera and movement prediction remain client responsibilities.

Skills are admitted through the shared controller families, learned ranks, equipment/movement requirements, costs and cooldowns; the server's paid skill phase owns resource debits and publishes casts/results. This does not establish that every skill, map or original-server rule is complete. Missing original content/controllers still fail admission. Both modes retain boundaries around reactor script rewards, pet-equipment interaction and spouse relationships; real payments require an external service. Local simulation/GM editing is a development capability, not a normal player's gameplay permission.

## NPC/quest corrections

The original evidence is linked from [NPC interaction](../ingame-life.md#npc-world-target-and-admission), [quest recovery](../ingame-quests.md) and [native dialogue recovery](../ghidra-client-corrections/reported-r4-npc-native.txt). Source inputs are original WZ/executable plus the authorized Cosmic server scripts; Cosmic is an emulator, not Nexon server source.

- The wire carries numeric authored choice IDs; the shared native controls require `{id}` records. The online adapter now converts them at that boundary, including reward choices. It preserves `#L` IDs instead of substituting row indices.
- **End Chat** sends `cancel`, closes the server conversation and removes its reconnect presentation. **Decline** sends `yesno:false`, follows the original No prose and ends with OK. Cancellation must not call `QuestDialogue.reject()` or enter another prose page.
- Active unfinished quests remain in the NPC menu and show their authored stop/in-progress prose. Browsability does not issue a claim grant: only an eligible confirmation populates `lease.offers`, and the transaction checks requirements again. The server rejects forged claims and stale conversation steps.
- Final blocked/declined/accepted pages use OK; authored choice pages retain Next. Shared UI teardown must finish when a server terminal event destroys the panel before its pending command receipt arrives. A user double-click is still blocked while a response is pending; retired views are never refreshed or written after destruction.

### Shared NPC ambient presentation

The original [006d2918 consumer](../ghidra-client-corrections/reported-r4-npc-native.txt) counts30ms updates, schedules a3000–8999ms cooldown and selects authored actions/global speech using the original modulo order. Action durations come from the WZ animation, then return to the template's default action. [Speech consumers](../ghidra-client-corrections/speech-consumers.txt) and [instructions](../ghidra-client-corrections/speech-instructions.txt) establish the5000ms bubble lifetime and field-layer ownership; `006d271f` gives quest markers precedence over ambient bubbles.

Offline retains its local selector. Online previously disabled this path with `ambient:false`; it now uses `ambient:"server"`. `field-npcs.js` owns randomness and field ticks. Each NPC publication carries its existing action/start tick plus nullable `npcSpeech:{actionIndex,lineIndex,startTick}`; `actionIndex:null` means a global line. Indices are bounded and resolve only against that NPC's authored content. NPC speech metadata on other entity kinds is rejected. No speech-control command is exposed to the browser.

The browser renders the selected original line and resumes its age from the observed field tick, without rerolling or restarting on duplicate updates or region rebinding. Late joins receive the same start tick. Per-character quest markers still suppress the bubble because quest eligibility differs between players. A conversation by any active player defers new shared ambient selections; this is an explicit multiplayer policy extending the original local conversation suppression. Field pause also pauses the server selector.

## Focused proof and reproduction

```sh
bun test server/test/npc-dialogue.test.js server/test/npc-ambient.test.js \
  client/test/online-dialogue.test.js client/test/online-npc-ambient.test.js \
  client/test/online-protocol.test.js client/test/speech-bubbles.test.js \
  client/test/login-selection.test.js client/test/login-motion.test.js
```

Result: **21 passed,77 assertions**, with scoped Prettier/ESLint passing. The NPC server tests use actual generated quest1039/Yoona to exercise cancel, decline and unmet kill requirements. Ambient tests compare two recipient publications and a late join, original action expiry, conversation suppression and invalid protocol metadata. Those recipients are test fixtures, not a two-browser gameplay claim.

[runOnlineNpcDialogue](../../client/tools/scenarios/online-npc-dialogue.js) accepts `{browser,url,output,account,password}`. The caller owns a dedicated database/runtime/browser; the scenario owns an isolated browser context. Seed a fresh beginner at map`000050000`, x167 with grounded y335, beside original Robin2003, with quest1036 unstarted. Seed only before connecting a character lease. For Bun SQL, a plain object parameter casts correctly to JSONB; pre-stringifying it stores a JSON string instead of a location object. Do not run this fixture setup against player data.

The scenario signs in, uses actual NPC/dialogue clicks to cancel menus and confirmations, decline, accept and finish Robin's quiz, then reconnects using the native diagnostics control. It observes persisted quest completion and unchanged EXP after reconnect and closes the ordinary authored NPC script. Finally it checks the rendered ambient bubble against the server's selected start tick. Inspection APIs only observe. Both uncaught errors and the bounded game error journal must be empty.

The final [NPC report](../native-ui-validation/online-npc-dialogue/report.json), [rendered NPC speech](../native-ui-validation/online-npc-dialogue/authoritative-npc-speech.png) and [selection spotlight report](../native-ui-validation/selection-spotlight/browser/report.json) share source/catalog identity. [Spotlight recovery](../login-creation-recovery.md#selected-character-spotlight) records the Ghidra coordinates, layer order and WZ timing. No extraction, whole-world smoke run, cash/social gameplay replay or exhaustive skill check was required or claimed for this batch.

A separate attempted combat check exposed four existing failures in `server/test/field-combat.test.js`. Repeating it against the committed pre-change world/view code produced the same four failures; [the retained baseline log](../native-ui-validation/online-npc-dialogue/combat-baseline.log) records that result. The fixtures still use the superseded basic combat adapter/event shape. These failures are outside this patch's passing NPC tests; the full test suite is not reported as passing.

## September13 UI and authority audit

The [NPC/Ability/development recovery](../native-ui-authority-recovery.md) adds original quest headings/order/ScriptInfo labels, beginner Details, bounded preset requests, conjure/pickup, owned-instance reactor offers and buddy queue/error handling and key-order-independent social mirror checks across PostgreSQL reloads. Closing PartyHP now refreshes its native UserList control through the online window-close hook. Shop, storage, trade and conversation already own their server close/cancel commands through each panel's lifecycle; the hook must not send a duplicate economic action.

Run `bun docs/tools/online-feature-audit.js` to regenerate the deterministic [static inventory](online-feature-audit.json). It enumerates **61closed top-level commands,45social subcommands and all normal UI bindings**, comparing the offline interface hooks with online hooks. All declared social commands have a shared server rule and no offline interface hook is missing. Literal command references can occur in guards or dispatchers; an empty browser-reference list can mean a dynamic adapter. Neither result is execution proof. The older `docs/validation/online-parity/inventory.json` predates the current social/commerce adapters and must not be used as the current capability list.

| Original surface / input | Online submission and authority | Audit result / remaining limit |
| --- | --- | --- |
| Item, Equip, gather, stack move, drop/mesos, use, enhancement | `NativeInventory`; inventory/equipment/item/drop commands → `action-inventory`, `action-character`, `field-drops` | Wired with opaque instance IDs and receipts. Pet-equipment child artwork opens, but attaching pet equipment is incomplete in both modes. |
| Stat and attached Details; AP | `OnlineUI.profileHooks`; `stats.allocate` → `action-character` | Beginner Details and its attack-range display repaired; the display uses server-published stats and recovered arithmetic. |
| Skill, SP and point books | `NativeInventory`/`OnlineUI`; `skills.allocate`, cast/release/cancel → character/field skill owners | Shared learned-rank/controller admission. Declared skill books are not proof that every original skill controller exists. |
| SkillMacro | `NativeMacros`; `skill-macros.save`; cast intent on activation | Wired; editing is a client draft until its server save. |
| GameMenu, ShortCut and normal window key bindings | `OnlineUI.activateBinding`, shared `GameUI` | Existing online windows are reachable; shortcuts invoke the same adapters. External original account/channel services are not reconstructed by opening a window. |
| KeyConfig, quick slots | Shared `KeyBindings`; `key-bindings.save` | Server validates all89records and publishes persisted bindings. |
| GameOpt, SysOpt and window positions | `settings.save` → `action-native` | Saved settings are authoritative; volume/mute and dragging have local presentation until save. |
| MiniMap, WorldMap and quest NPC markers | Shared map/native rendering against current server field | Read-only views; map travel uses portal/door/GM admission, never a UI coordinate write. |
| Quest, attached detail, QuestAlarm and readiness notice | `NativeQuests`; accept/claim/abandon/track/notice → interaction quest owners | Session-bound rewards and persisted tracker. Special PQuest/rank/timer/auto-execution controls without recovered handlers remain content blockers. |
| UtilDlgEx NPC talk, choices, numbers/text, cancel | `NativeDialogue`; npc.open/answer → compiled route/session owner | Menu artwork/order/labels repaired; unsupported script dependencies remain explicit rather than executing arbitrary client JS. |
| Shop | `NativeShop`; buy/sell/recharge → `interaction-shop` | NPC/session/range and transaction checks. |
| Trunk/storage | `NativeStorage`; storage.execute/close → `interaction-storage` | Session-owned deposit/withdraw/mesos; follows its own asynchronous close handshake. |
| TradingRoom and invitation/chat | `NativeTrade`; trade.* → `interaction-trade` | Two participants, locks, confirmation, cancellation and transactional exchange; native teardown settles the same authority. |
| CashShop, wardrobe/locker, gifts, wishlist and expansion | `NativeCashShop`; cash.* → `interaction-cash` | Existing catalog/account transactions are wired. Charging real money needs an external payment service. |
| UserList / buddies and blacklist | `NativeSocial`; social identity/read/execute → participant transaction | Repeat/multiple pending requests and JSONB mirror equality repaired; native notice and useful refusal codes added. Acceptance changes both profiles. |
| UserInfo, peer portrait, fame, wish gifts and family links | `NativeSocialPeers`; social.peer/execute and cash.gift | Uses server-selected peer projections; cannot mutate a foreign browser profile. |
| PartySearch, party controls and PartyHP | Shared windows; social.execute → group/family owners | Wired membership/search/HP; close-state refresh repaired. |
| Guild, alliance, ranks, notice and bulletin board | Shared UserList/social windows; social.execute → group/board owners | Wired45-command rule set, with capacity, rank, cohort and founding presence checks. Not exhaustive guild lifecycle acceptance. |
| Family and FamilyTree, reputation and travel privileges | `NativeSocial`/peers; family commands → `social-family` and participant travel | Wired; rules require eligible real participants and server-owned travel. |
| Messenger and map/whisper/buddy/party/guild/alliance chat | `NativeSocialChat`; chat.send and messenger rules → interaction-chat/social | Recipient admission is server-owned. Spouse relationships/chat remain unavailable. |
| MonsterBook and Title/medals | `NativeMonsterBook`/quests; book.cover, medal/quest commands | Wired with earned card/quest validation. Special unsupported quest controls are not bypassed. |
| Revive, portal/door travel, expressions, seats | `NativeWorldActions`/transitions; revive/portal/door/expression/seat commands | Existing server-owned state and recipient events. Unsupported revive consumables/routes remain blocked. |
| Pet activation and field behavior | item.use → `action-pets` and skill utility pet controller | Owned pet activation exists; pet-equipment interaction is a separate gap. |
| Reactors / nearby item offering | reactor.offer → `field-reactors` | Character-panel instance-ID adapter repaired. Original state transition works only when eligible; script rewards remain incomplete. |
| Running, jumping, climbing, attacks and mob/item changes | Sequenced native input and admitted skill/item intents → field simulation | Existing state/delta/event recipient path. This audit does not certify every original animation/controller or cross-channel service. |
| Developer Character tab and field controls | Audited HTTP development endpoint | Presets/scalar/skill edits repaired; conjure added. Player sessions cannot use GM controls. Browser-local checkpoint/reset is not exposed as an online operation. |

This inventory covers the reconstructed native windows, bindings and protocol surface. It does **not** claim complete original v83content or every original client/server feature. Remaining shared/content gaps include pet equipment, reactor script rewards, unsupported quest/skill/item controllers, spouse/marriage and external payment/channel services. Implement those as separate recovered contracts and prove native input → transaction → recipient → reconnect for each domain; adding a capability flag or mapping every icon to a handler is insufficient.
