# Original resource audit and drop/chat/preset recovery

September 13, 2026. This pass reopened the original WZ archives and executable/DLL instructions, independently of the packaged browser catalog. It fixes item rotation between server updates, character preset replacement, chat channel colors and field-wide chat delivery. The inventory below identifies original inputs and remaining implementation work; counting an asset does not establish that its consumer is implemented.

## Inputs and fresh inventory

The supplied `/Users/k/Development/tensorfish/Maplestory-Client` directory contains original WZ archives and `Maplestory_UNPACKED.exe`/DLLs, not C/C++ source. All 16 scanned resource archives plus the executable and `Shape2D.dll` were SHA-256 checked against [the original manifest](input-manifest.json). [This pass's provenance](ghidra-drop-chat/provenance.json) retains those hashes. The authorized sibling `MapleStory-Server` checkout is Cosmic emulator code/scripts, not Nexon server source. No third-party client implementation was used.

The extended [existing archive scanner](../client/tools/scan.js) produced [original-resource-inventory.json](original-resource-inventory.json): **16,821 IMG payloads parsed, 544,718 canvases counted, zero failures**. It took 17.23 seconds with 466,894,848 bytes peak sampled RSS. This is an inventory measurement, not an extraction/build performance comparison. No extraction or asset conversion was rerun.

| Original archive | IMG resources | Canvas nodes | Distinct named properties |
| --- | ---: | ---: | ---: |
| Base | 3 | 0 | 151 |
| Character | 7,201 | 391,184 | 562 |
| Effect | 17 | 5,114 | 419 |
| Etc | 22 | 10 | 334 |
| Item | 155 | 16,843 | 499 |
| Map | 5,602 | 32,542 | 1,429 |
| Mob | 1,568 | 50,787 | 187 |
| Morph | 42 | 1,824 | 56 |
| Npc | 1,620 | 15,453 | 468 |
| Quest | 6 | 0 | 133 |
| Reactor | 419 | 4,384 | 28 |
| Skill | 76 | 15,738 | 193 |
| Sound | 44 | 0 | 405 |
| String | 20 | 0 | 744 |
| TamingMob | 7 | 0 | 6 |
| UI | 19 | 10,839 | 1,229 |

`imagesInventory` records every IMG path, byte size and original checksum. `properties` records each nonnumeric name, occurrence count, node-type counts and the first three exact paths. Numeric item IDs, frame numbers and child indices contribute to `nodeTypes` and canvas counts rather than becoming property names. Names are not normalized: Reactor's original `dealy`, `dleay` and `rpeat` remain distinct from `delay`/`repeat`. Identical names in different domains do not imply identical semantics.

Every IMG payload was checksum checked before parsing. Canvas counts describe metadata; only the first sample of each format/scale/compression combination was inflated and pixel decoded, as in the existing scanner. Format counts were 544,240 `1/0`, 278 `2/0`, 198 `513/0`, and two `513/4`. `List.wz` is the separately documented file-list format, not a PKG1 resource archive, and is outside this IMG scan. UOL/link properties are counted at their authored location; this scan does not recursively expand them or claim that every linked pixel renders correctly.

Reproduce from the repository root:

```sh
bun client/tools/scan.js --properties \
  --archives Base,Character,Effect,Etc,Item,Map,Mob,Morph,Npc,Quest,Reactor,Skill,Sound,String,TamingMob,UI \
  --output docs/original-resource-inventory.json
```

For a smaller investigation, use e.g. `--archives Item,UI` and a separate `--output` path. The scanner bounds each traversal by IMG bytes, rejects child cycles and caps named properties at 65,536 per archive. It releases each archive and does not retain parsed trees between images. Use its exact example paths to locate a property before following the executable consumer.

## Item rotation: client call through Shape2D

The previous 300 ms cycle constant was correct; displaying only the server's 90 ms samples made the icon jump **108 degrees** at a time. The original graphics vector evaluates its own clock between field updates.

Fresh [client instructions](ghidra-drop-chat/client-drop-rotation.txt) show `00506142..00506182` invoking vector vtable offset `+0xa0` with zero angle and `VT_I4(3)` containing `300`. In `Shape2D.dll`, vtable `5140c0fc + 0xa0` resolves to [51408a50](ghidra-drop-chat/shape-rotation.txt); [51408b08](ghidra-drop-chat/shape-angle.txt) evaluates the periodic zero-angle mode:

```text
degrees = 360 * ((time - start) % period) / period
period = 300 ms
```

[Scalar bytes](ghidra-drop-chat/shape-scalars.txt) establish `5140d8c0 = 360`, `5140d8c8 = 0`, `5140d8b8 = pi`, and `5140d8e0 = 180`. Positive rotation is clockwise in the downward-Y client/browser coordinates. The original item canvas is centered around its actual width/height, not an assumed 32 px cell. Rotation continues through the fall phase and stops on landing. Mesos use their authored/timed canvas animation instead. The flight, fall, pickup and rounding equations remain in [drop motion](drop-motion.md).

`dropRotation()` supplies one shared visual equation. Online drawing advances the observed drop age by at most one 90 ms publication interval and freezes extrapolation when the server field is paused. Position, landing state, ownership and pickup rewards remain server decisions. This bounded visual extrapolation does not conceal missing state indefinitely.

For future Ghidra work, start disassembly at a real function entry, such as `00505900`, before asking `clientInstructions.java` for `00505f0d:005061b2`. An empty listing in an unanalysed scratch project is not evidence that code is absent. The existing `clientLoginLayout.java` accepts an output path and a comma-separated address list, with at most 24 functions and a 30-second decompiler timeout per function. Run against an owned scratch project with `-readOnly`; use `clientInstructions.java`/`clientBytes.java` to resolve decompiler ambiguities. Constructor `008d01b2` timed out during this pass, so its chat font evidence below is instruction-level evidence. No original Windows runtime screenshot comparison was performed.

## Character presets and development authority

Repeated native Corsair 522 → Hero 112 replacement reproduced a real post-commit failure: `Committed character delivery failed: null is not an object (evaluating 'spec.kind')`. `SkillAttack.prepareExternal()` stores summon attacks with `spec:null` because summons own their own geometry. Avatar/weapon replacement was interpreting those records as player weapon attacks. `prepareActor()` now preserves external records and rebuilds only player attack geometry/timing. A regression checks both kinds together; the original prepared map remains untouched until replacement.

Character → Presets now includes **Apply staged preset** beside the preview. Stage remains a draft, Apply uses the existing audited HTTP development transaction, and Discard cancels. A utility preset whose values already match (for example restoring full HP/MP) reports that fact locally instead of submitting an invalid empty patch. The server still rejects forged/empty edits, invalid jobs and contradictory staged job overrides.

Field GM controls no longer reject a request merely because an ordinary player is on the same map. Pause, step, spawn and physics remain restricted to a developer role on a development server, and currently busy/retiring participants block shared controls. Ordinary players gain no development permission. The inspection transport recovers an uncertain outcome using the same operation ID instead of issuing another mutation. Existing account setup and `admin`/`player` roles are unchanged.

| Inspection capability | Online ownership and limits |
| --- | --- |
| Job/utility presets, stats, level, AP/SP, skills, key bindings | Validated profile/preset transaction; loadout replacement and recipient publication. All 71 packaged job presets passed detached server transaction checks. |
| Item conjure and existing item/quest/social controls | Existing server commands, IDs, catalog rules and receipts. Normal gameplay controls retain their normal ownership/requirements. |
| Map travel | Existing server transition handshake and field admission. |
| Pause, step, monster spawn, physics | Shared server field controls for GM; field content/bounds and pause requirements still apply. |
| Camera, overlays, error records, login animation inspection | Client presentation/diagnostics. They do not change another player's state. |
| Reconnect/resync | Existing server session and publication recovery. |
| Browser-local checkpoint/reset and live placement editor | Removed with the local client. Server-owned world state and persistence remain the only supported authority. |

The two-player run also exposed a logout publication bug: skills are destroyed before the asynchronous checkpoint and lease release remove the avatar from its field. `actorCombatFields()` now omits the destroyed combat runtime during that interval, so another player's field publication cannot suspend the server simulation by dereferencing `actor.skills.resources`.

## Expanded chat colors and map history

Fresh [font construction instructions](ghidra-drop-chat/chat-fonts.txt) at `008d01b2` populate the message font array. The existing [log consumer](ghidra-client-corrections/reported-r3-chat-layer-properties.txt), `008dc32f`, selects `base + 0xbe0 + type*4`. Original Cosmic `PacketCreator.multiChat` uses mode 0/1/2/3 for buddy/party/guild/alliance; native `008df155` routing provides the client channel connection. These channels are not eight arbitrary CSS colors.

| Channel | Original RGB | Native message font type |
| --- | --- | ---: |
| Same-map / All | `#ffffff` | 0 |
| Whisper | `#00ff00` | 1 |
| Party | `#ff99cc` | 2 |
| Buddy and buddy group | `#ff9900` | 3 |
| Guild | `#e1acfe` | 4 |
| Alliance | `#a6ff7f` | 5 |
| Spouse | `#ff28a7` | 6 |

The spouse palette is recovered presentation; an unsupported marriage relationship is still refused. Font pushes for whisper, party, buddy, guild, alliance and spouse occur at `008d0455`, `008d0dd0`, `008d0d2e`, `008d0fb0`, `008d1052`, and `008d10f4` respectively.

The chat log retains `channelIndex` in its bounded records and checkpoints. Both map and social messages use the same server-event adapter and message-ID deduplication, including the sender's authoritative echo. An outgoing success no longer adds a separate “Message delivered by the server” status row. Refusals still appear. Receiving one's own whisper does not replace the selected reply recipient with oneself.

Map recipients now come from the entire actual field instance, not just the sender's visible entity set. A distant player on the same map therefore receives the message; another map/instance does not. Private channels retain reciprocal membership, mute, blacklist, receive-option and session checks. Group mirror comparison now ignores PostgreSQL JSONB object-key ordering while preserving actual member/rank/list differences.

Expanded history contains messages received during the current client session, including messages from both local and remote map participants. It does not fetch messages sent before login or provide a durable server chat archive. The original client also owns its received log; durable retrospective history would need a separately specified retention/delivery contract. Existing compact-history visibility policy is unchanged.

## Coverage: assets, properties and consumers

Use [the full property inventory](original-resource-inventory.json) for names/paths and [the feature/authority matrix](server/offline-parity.md) for implemented online commands. The current packaged catalog contains **735 maps, 7,531 items, 534 skills and 71 player skill books**. Its classification declares 485 skills supported across controller families and 49 unavailable: 33 disabled, two summons without a controller and 14 requiring unavailable server behavior. These are catalog declarations, not 485 successful gameplay replays.

| Original property/asset family | Existing consumer and fidelity boundary |
| --- | --- |
| Character `origin`, `map` anchors (`neck`, `navel`, hands), `z`, `islot/vslot`, authored actions and delays | Avatar composition/animation and equipment rules; preserve anchor-space and layer order. Seeing the icon does not prove every weapon/action combination. |
| UI backgrounds, button states, borders, digits, ComboBox, tooltips; `origin`, `z`, delays | Native UI panel/artwork owners plus executable placement. All 19 UI IMG resources are inventoried, including Login, StatusBar, UIWindow, Basic, GuildBBS, ChatBalloon, CashShop, ITC and MapleTV. External marketplace/TV/account services are not implemented by extracting their artwork. |
| Item `icon/iconRaw`, stats, requirements, consumption, pet evolution/interaction metadata | Item/inventory/commerce rules, drop renderer, pet controllers. Pet equipment and some special item behavior remain gaps. Missing data is not replaced with a fabricated icon/name. |
| Map physics constants, footholds, portals, backgrounds/tiles/objects, `life`, minimap and scripts | Shared motion, scene extraction, field simulation and transition owners. Map IMG counts include non-map resources; 5,602 IMG does not mean 5,602 packaged playable maps. |
| Mob authored attacks, `lt/rb`, delays, `attackAfter`, elemental/status properties, skills and revives | Shared combat and server mob controller. Unimplemented attack/disease/controller combinations remain content refusals. |
| NPC `script`, `speak/say`, actions, `dcLeft/Right/Top/Bottom`, links and flags | NPC target/dialogue/ambient owners and compiled authorized server scripts. Optional MapleTV/service dependencies remain separate capabilities. |
| Quest check/action/info, job/item/mob/skill requirements, start/end scripts, time/auto flags | Quest conditions/rewards and server conversations. Special party-quest/rank/timer/auto-execution handlers without recovered authority remain blockers. |
| Reactor event type/state, rectangles, timeout, touch and active skill properties | Shared state machine plus server offer admission. Script rewards remain incomplete. Preserve the original property's spelling before proving whether a consumer recognizes it. |
| Skill rank costs, damage/count/rectangle, action, effect, summon, cooldown/status properties | Shared skill controllers with authoritative debits/results. Disabled/unavailable skills are not made functional by a GM learning them. |
| Sound, Effect, Morph, String, Base layer maps and Etc metadata | Existing audio/effect/form/text/catalog owners; not every original special mode or service is implemented. Zero canvases does not mean an archive is unused. |

Seven requested item records remain unavailable in the current extraction coverage: 4031, 1032107, 1140003 and 20120021 have no matching original item/character source; 1052217, 1142151 and 1392000 have Character artwork but no original String.wz item-name record. The audit preserves these distinctions.

For each remaining gap, follow this sequence: locate the original property and linked resources; recover its executable consumer and original arithmetic/placement; inspect the authorized server script/rule where authority is required; implement the shared presentation and a closed server intent; then prove native input → transaction → recipient update → reconnect. Property occurrence counts and static command wiring alone must never be reported as full client parity.

## Scoped validation

Focused tests cover native drop angles and interpolation, summon/weapon replacement, all packaged job preset drafts, channel colors/history/echo deduplication, whole-map recipients, private-channel admission and JSONB membership ordering, development permissions, and logout projection. [The native scenario](../client/tools/scenarios/online-drop-chat.js) uses isolated Developer/Player browser contexts against an owned disposable database on map 50000. It applies Hero/Corsair repeatedly through the UI, checks peer equipment, unchanged restore, colored map/whisper/buddy history, a conjured item, GM pause/step/resume/spawn, and reconnects both clients. It observes state only through the existing read-only inspection APIs.

Fixture setup must happen before character leases: development accounts `admin`/`player`, characters named `Developer`/`Player`, both at original Robin's map `000050000`, grounded at x167/y335, with normal valid beginner profiles. The scenario establishes mutual buddies if absent and tolerates an already expanded persisted chat setting. Its caller owns the database, runtime and browser; it closes only the two contexts it creates. This run used ports 3210/3110 and a disposable database, then removed that database and stopped only its owned launchers. Do not overwrite live profile JSON to reset fixtures: item instances also have materialized database ownership.

```sh
bun test client/test/drop-rotation.test.js client/test/online-chat.test.js \
  client/test/skill-actor-replacement.test.js client/test/development-character-presets.test.js \
  client/test/online-development.test.js client/test/drop-system.test.js \
  server/test/chat-delivery.test.js server/test/development-preset.test.js \
  server/test/development-http.test.js server/test/development-items.test.js \
  server/test/retired-combat-view.test.js
```

Result: **38 tests passed, 315 assertions**, with [the test log](native-ui-validation/drop-chat-presets/tests.log) and [scoped Prettier/ESLint check](native-ui-validation/drop-chat-presets/static.log) retained. The audit-loss message in the HTTP test is an intentional injected failure. [The native report](native-ui-validation/drop-chat-presets/report.json), [chat capture](native-ui-validation/drop-chat-presets/chat-history.png), [item flight capture](native-ui-validation/drop-chat-presets/drop-flight.png) and [server log](native-ui-validation/drop-chat-presets/server.log) retain matching runtime/content identity. Only documentation and scanner formatting changed after that browser run. The server log also records both final character retirements without a simulation suspension.

One earlier rapid-input run received `SERVER_BUSY` when chat overlapped another character operation. Global command serialization is unchanged; the retained native scenario types at 25 ms per character and requires successful delivery, rather than treating a refused message as received history. This batch does not claim to eliminate all busy-operation refusals. Original Windows pixel/glyph parity, every original asset/controller, persistent historical chat retrieval and a full release smoke run are also not claimed.
