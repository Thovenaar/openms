# Original in-game inventory

## Authority and priority

The supplied `/Users/k/Development/tensorfish/Maplestory-Client` installation defines original presentation/input and asset identity. [Input identities](input-manifest.json), [consumer evidence](client-evidence.md) and the domain pages distinguish original bytes/instructions from browser policy. Authorized Cosmic GMSv83 is used for server semantics and authored server data only, never as an alternative client presentation source. No original C/C++ source, Windows execution, gameplay capture, audio recording or live server session was supplied. Decompiled C is analysis output, not original source.

| Domain              | Delivered local behavior                                                                                                                                                       | Remaining authority boundary                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| In-game interface   | Original HUD, inventory/equipment, AP/SP controls, learned skill books/macros, binding editor, chat/cursors, windows and minimap; supported cash/community/book/quest surfaces | Exact original text/focus/timing parity and unsupported branch semantics; see [UI contract](ingame-ui.md).             |
| Inventory and trade | Schema-5 instance/slot operations, equipment and appearance publication, use/drop/pickup/gather, actual two-character nine-slot trade                                          | Original instance rolls/upgrade systems and a live remote economy are not reconstructed.                               |
| Portals             | Original portal visuals/input/geometry and supported packaged named destinations, including implemented local same-map transitions                                             | Unsupported scripted/automatic/impact authority remains distinct from metadata. See [portals](ingame-portals.md).      |
| NPC/mob and quests  | Original placements/artwork plus admitted local combat/drops, authored NPC scripts/shops and original declarative quests                                                       | Preload metadata alone is not spawn authority; unsupported scripts/conditions and absent content fail closed.          |
| Sound and effects   | Original MP3/artwork publication, native BGM/SE categories, accepted local event cues, timed effects and labeled inspection previews                                           | No original device/mixer/runtime parity or invented automatic emitter follows from packaged assets.                    |
| Delivery            | Demand-driven world regions and independently owned UI/effect/avatar bundles, bounded PCM and native-input evidence                                                            | Browser budgets/camera/scheduling are engineering policy; extracted-pixel comparisons are not original-runtime parity. |

Full domain ledgers and exact limitations: [UI](ingame-ui.md), [portals](ingame-portals.md), [life](ingame-life.md), [audio/effects](ingame-audiovisual.md). Their `ghidra-ingame-*` directories retain address-bearing decompilation and instruction output.

## Owned instances and atomic operations

`inventory-model.js` is the shared instance/slot/stack authority. The instance format introduced in schema5 remains in schema8: `{uid,id,count,slot,owner,flags,expiresAt}` rather than one aggregate entry per template; equipment uses negative authored positions and each inventory category has its own positive-slot capacity. Multiple compatible stacks of the same template are valid. Equipment count is one; rechargeable items can retain an empty stack. Template metadata, flags, expiration, equip requirements and weapon/overall/shield conflicts are checked by semantic owners, not inferred from icon placement. See [profile migration](offline-profile.md#schema-8).

Incoming compatible ordinary items fill existing stacks up to the original `slotMax` before taking another free slot. Compatibility includes template, owner, flags and expiration; equipment and rechargeable stacks do not merge. A merge preserves the destination UID, not one row per pickup. Overflow remains multiple owned stacks rather than an aggregate template counter. The native correction replay collected ten separate Blue Snail Shell drops into one count10 stack.

The Item surface exposes original category tabs, scrolling, item tooltips, use and gather; Item/Equip carry is transient presentation. Moving, splitting/merging, swapping and equipping are terminal inventory intents. A detached transform admits the operation before a durable lock. Equipment appearance preparation must succeed while the old field actor remains owned; after identity/lease checks the transform is repeated in `commitProfile`. Only durable success publishes equipment, recalculated vitals and prepared appearance. Cancel or preparation failure releases prepared resources without changing owned items. Publication preserves field-owned name/presentation attachments rather than destroying them with the retired avatar.

Scroll targeting now resolves an equipment UID from either owned inventory or equipped slots, without converting its container, UID or signed slot. Native Item carry can place a scroll on the actual Equip icon; the learned Legendary Spirit window can also retain a worn target. Ordinary worn-item scrolling requires no Legendary Spirit, while bag-equipment scrolling and entry into the hidden skill's window remain learned-skill gated. This split follows the authorized Cosmic **server-reference** `ScrollHandler.java:67–72`; native window entry/control evidence is retained in [utility enhancement entry](ghidra-client-corrections/utility-enhancement-entry.txt) and [controls](ghidra-client-corrections/utility-enhancement-action.txt). No original Windows-runtime comparison is claimed.

One detached enhancement result owns its RNG rolls, scroll/White Scroll debits, slot counters and upgrade stats. A successful/failing worn item remains in its exact equipped slot; success raises saved instance stats rather than changing shared template data. A curse removes only the selected worn UID, recalculates/clamps equipment-dependent vitals and prepares the replacement appearance through existing field-avatar hooks before durable admission. Failed preparation or stale ownership leaves the complete old holdings intact; only committed destruction publishes the replacement avatar. Original WZ probability/compatibility/slot requirements and existing White Scroll/clean-slate/Chaos/modifier rules are unchanged. The executed native equipped-scroll scenario and focused regressions are indexed in [integrated validation](archive/validation-history.md#exercised-gameplay-and-development-controls).

Owned Item/Equip tooltips resolve the hovered UID in the current profile and display its committed upgrade statistics and remaining slots. They do not overwrite immutable template requirements or stock-preview values. The native regression checks the visible sword tooltip at attack18/six slots after the real100% scroll, rather than accepting durable state while the screen still shows template attack17/seven slots.

Original equipment set effects are prepared with the appearance before equip publication, not emitted as loot or combat rewards. `equipment-effect-model.js` matches actual visible slots against every authored requirement, choosing the first complete cash set before an ordinary set. The [retained Zakum source](ghidra-client-corrections/interface-wave/equipment-effects-wz.json) identifies item1002357 with `Effect.wz:SetEff.img/99`; other Zakum-named helmets do not inherit that effect by name. The independent original sequence follows the avatar's scene/preview clock through movement and climbing and is hidden on death; its immutable leases belong to the prepared avatar. Relationship ItemEff rings and CharacterEff particle definitions are not substitutes for this SetEff contract.

Drop/use/pickup use their corresponding authorities, not inspector grants. Item consumption commits owned quantity and vitals together; pickup can commit inventory, mesos or a consume-on-pickup card with the actual drop claim. Monster Book counts saturate at five; a full repeated card is consumed without creating an inventory stack. Book inspection/search/page selection is read-only, while cover selection is a saved preference. Cash locker/gift instances share UID validation with inventory/equipment, and locker transfers cannot create a duplicate owned instance.

`LocalTrade` owns one actual two-person TradingRoom with nine offer slots per side, local room chat, portraits/UserInfo, quantities, mesos and confirmation locks. Offers reserve intent, not a durable debit. Both confirmations trigger detached application of the complete exchange, followed by locked revalidation and one `ProfileStore.commitCharacters` for both profiles. Quantities and net mesos account for the authorized trade fee. Unmerged whole instances retain their UID; splits can create an identity and compatible incoming stacks retain the receiving stack's UID. No half-completed transfer can publish.

Ordinary capacity/offer failures are rejected before durable admission, then terminal pending/room ownership is released before observers run. A rejected full-inventory exchange must not prevent a later valid room. Native exit/cancel, Escape or loss of field ownership discards unaccepted offers/carry; an accepted durable commit drains rather than rolling back one participant. Reload restores committed holdings and balances, not a pending room. Local simulation controls produce the other character's real actions through the trade/social services; they are not a live multiplayer server.

These are source contracts. The [first-pass inventory/trade report](native-ui-validation/inventory-trade/report.json) retains native scenarios, explicit fixtures, reload observations and the earlier equipment-runtime failure. It does not certify the later fix or final build. [Final acceptance ownership](validation.md) records the consolidated replay status; this page does not invent passes from implementation.

## Historical metadata inventory, not decode or runtime coverage

[`ingame-inventory/index.json`](ingame-inventory/index.json) is the executed metadata traversal. Each archive index records original IMG identities, SHA-256, counts and retained roots. Compressed JSON members retain original paths, scalar types/values, vectors, UOL references, canvas dimensions and sound-envelope metadata. They do not copy encoded artwork/audio payloads.

| Archive   | IMG visited | Nodes visited | Canvas nodes | Sound nodes |
| --------- | ----------: | ------------: | -----------: | ----------: |
| UI        |          19 |        33,037 |       10,839 |           0 |
| Map       |          11 |        45,379 |        1,818 |           1 |
| Mob       |       1,568 |       329,100 |       50,787 |           0 |
| Npc       |       1,620 |        76,352 |       15,453 |           0 |
| Sound     |          44 |        10,745 |            0 |       3,956 |
| Effect    |          17 |        27,092 |        5,114 |          23 |
| String    |          20 |        97,771 |            0 |           0 |
| Etc       |          22 |       110,107 |           10 |           0 |
| Item      |         155 |       147,961 |       16,843 |           0 |
| Skill     |          76 |       124,484 |       15,738 |           0 |
| Character |       7,201 |     3,432,840 |      391,184 |           0 |

This historical Map inventory traversed the eight selected acceptance maps plus MapHelper, Effect and Physics and explicitly omitted **5,591 other Map IMG files**. That is the traversal's scope, not today's packaged-map count. Character traversal visited every selected tree but retained only roots/info metadata (**115,532 retained nodes**), not all animation subtrees. Other listed archives retained every visited metadata node. These counts do not establish successful pixel/audio decode, live spawn availability, supported mechanics or original-reference parity.

The UI inventory contains **110 UIWindow top-level branches**; [the full branch ledger](ingame-ui.md#remaining-resource-ledger) classifies unsupported families instead of treating the packaged subset as all original UI.

## Historical packaged acceptance selection

The original eight-map acceptance selection was `100000000`, `100000001`, `103040000`, `108000500`, `120000000`, `200090500`, `211040000`, and `230000000`. The following numbers describe that earlier selection only:

- Portals: **131 records**, including 18 pv and eight ph visual entities; all 105 nonvisual records remain explicit metadata. The original connected pair is Henesys `in02` ↔ Maya's House `out02`.
- Life: **112 authored placements**, 63 NPC and 49 mob, covering 53 NPC and three mob templates. These are metadata previews, not server spawns.
- Audio: eight map bindings, **seven distinct BGM tracks**, all 31 UI and 27 Game sound nodes; **65 nodes / 61 distinct encoded hashes** including BGM.
- Effects: **14 selected original bundles**. Every activation is a labeled local preview unless independently tied to a recovered accepted event; automatic map emitters are not invented.
- UI: HUD/Basic at startup; supported windows, tooltips, static equipment information and current-map minimap assets on demand. Unpackaged branches remain available in the inventory, not falsely operational.

## Current publication and coverage boundaries

[`extraction.json`](extraction.json) retains shared lossless packaging, original input hashes, byte comparisons and its own catalog build identity. The earlier **356-map** selection is historical, not the current release total. The current iteration's full offline inventory contains **728 maps**; the pinned release/catalog and [validation](validation.md) own its exact identity and acceptance status. Its map list is the authority for packaged content, not proof that every original map, quest or course mechanic is supported.

Current on-demand coverage includes Item/Equip and their original controls/tooltips; NPC portraits/dialogue/shop assets; Quest/QuestAlarm/Title and WorldMap; original cash/catalog/preview resources; Monster Book; and the supported social/trading windows. A decoded or packaged branch is not automatically an operational feature. The [UI branch ledger](ingame-ui.md#remaining-resource-ledger), [NPC/quest contract](ingame-quests.md) and each feature's recorded blockers distinguish original metadata, packaged assets, implemented semantics, profile eligibility and exercised native paths.

Character metadata coverage is broader than guaranteed live animation compatibility. Required appearance dependencies are admitted/prepared before equip publication; missing assets are not replaced with invented styles. Authored script compilation is likewise broader than live route feasibility: absent compatible text/artwork-dialogue dependencies cannot be replaced with a made-up demonstration script. Monster Book drop/location descriptions are catalog information, not ownership or a guarantee that every listed location/drop can be exercised.

Domain extraction probes establish only their own decode coverage, not current resident GPU/PCM usage. Build identity, final acceptance totals and performance are maintained centrally in [validation](validation.md); no original Windows-runtime comparison follows from browser screenshots.

## Reproduction and lookup

```sh
bun client/tools/ingame-inventory.js
bun client/tools/ingame-inventory.js /path/to/original/client /path/to/output
```

The first form uses the supplied installation path and `docs/ingame-inventory`. The inventory does not alter original inputs. Use the per-archive JSON index to locate a root, then read a compressed member:

- `UI.tar.gz:UIWindow.img/Item.json`
- `Map.tar.gz:MapHelper.img/portal.json`
- `Map.tar.gz:Map/Map1/100000000.img/life.json`
- `Sound.tar.gz:Bgm00.img/FloralLife.json`

A missing property remains missing; a familiar branch name does not supply a default or activation rule. Resolve consumers in the original executable before implementing behavior.

## Acceptance and missing references

[Integrated evidence](ingame-validation/) records native-input play, screenshots, runtime lifecycle checks and actual graph audio. [Validation method](validation-method.md) separates full in-game UI acceptance from the world-only extracted-art oracle. Dedicated browser processes prevent sibling tab visibility from pausing scenarios; parallel playtest timing is not used for performance claims.

[Windows reference requests](windows-reference-captures.md) specify version-hashed captures, resolutions, character/server state, input timestamps and synchronized lossless audio needed to close the remaining fidelity boundaries. Until those inputs exist, original-client visual/audio parity and a complete game reconstruction remain unverified.
