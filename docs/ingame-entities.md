# Offline reactors and remaining entity families

## Evidence, not server reconstruction

Implementation sources are only the supplied WZ archives and unpacked original executable. No third-party client, server scripts, original runtime recording, or server authority was available. Rendering and hit eligibility are address-backed where described below; applying WZ `state`, item conditions, `timeOut`, quest requirements and placement `reactorTime` offline is an explicit provisional local policy. **A script name never grants an item, meso, experience, quest completion, monster spawn or map transition.**

The inventory was executed over every IMG and every typed descendant in these previously omitted archives, without copying encoded canvas bytes into documentation. Complete rows and exhaustive normalized path/type family counts are retained, including UOL text, scalar/vector values, canvas dimensions/formats and encoded byte counts:

| Archive | Images | Nodes | Canvases | UOLs | Complete metadata |
| --- | ---: | ---: | ---: | ---: | --- |
| Reactor.wz | 419 | 26,871 | 4,384 | 1,461 | [Reactor.json](ingame-inventory/Reactor.json) |
| Morph.wz | 42 | 11,553 | 1,824 | 64 | [Morph.json](ingame-inventory/Morph.json) |
| TamingMob.wz | 7 | 49 | 0 | 0 | [TamingMob.json](ingame-inventory/TamingMob.json) |

Original archive hashes remain in [input-manifest.json](input-manifest.json): Reactor `be1573dc3461298906a35aaa8736c4097f0ab81055cfada640de72fa6774ad94`, Morph `9bf57995efcd331f23e8fd0ff818e00ec159ab1995f8d9bca7ef856e301f6782`, TamingMob `d23604f70c25cabd83e5c30a2ed9390ba1078c0966fd7d76a4adfc03cb2cae0d`.

## Exhaustive Reactor families

Root children across all 419 templates are numeric states, `info`, `action` and `quest`. All info fields are `activateByTouch`, `backTile`, `info`, `link`, `name`, `removeInFieldSet`; no additional info family was omitted. There are 110 authored links and 325 action-script strings.

Numeric state descendants include numeric canvases/UOLs; `hit` canvas sequences/UOLs; `event`; `repeat`; and the exact unusual authored `rpeat` and state-level `timeout`. Canvas descendants include `origin`, `delay`, `z`, alpha `a0/a1`, `head`, `lt/rb`; original misspellings `dealy`/`dleay` remain raw and are **not silently corrected to delay**. Two nested numeric UOL descendants and one numeric Property are also retained. The JSON family tables distinguish all these paths and types.

Every event family has been inventoried: numeric event children carry `type`, `state`, positional scalar children `0/1/2`, optional `lt/rb`, `message`, `activeSkillID` numeric children, and optional event-specific `hit` frames. The state event root contains `timeOut` and, separately, four lower-case `timeout` occurrences. Runtime reads `timeOut` only; the misspelled/case-distinct fields are not guessed synonyms.

| Authored event type | Occurrences | Current boundary |
| --- | ---: | --- |
| 0 | 579 | Direction-independent melee hit event |
| 1 | 104 | Facing-right hit eligibility, original direction/contact ranking |
| 2 | 106 | Facing-left hit eligibility, original direction/contact ranking |
| 5 | 15 | Exact activeSkillID membership and player point in authored event rectangle; no fabricated skill availability |
| 6 | 9 | Original event trigger consumer unavailable; metadata retained |
| 7 | 9 | Original event trigger consumer unavailable; metadata retained |
| 100 | 205 | Local native inventory offering against authored item/count/rectangle; optional scalar2 must be the supported value1 |
| 101 | 161 | Local transition after positive authored event/timeOut |

The ordinary closure from the eight original selected maps contains **356 maps**, **57 maps with reactor placements**, and **26 reactor templates / 101 resolved states**. Its event families are exactly 0,2,100,101. [reactor-closure.json](ghidra-ingame-portals/reactor-closure.json) retains every selected template's state/event projection. All 26 original templates are present. The eight seeds have zero placements; the direct28 neighborhood adds `211050000` (template2119006 linked to2119004), `230010400` and `230020000` (template2302000). Implementing only the zero-reactor seeds would miss real reachable content.

## Recovered original consumers

Fresh read-only Ghidra output is retained under `ghidra-ingame-portals/`:

- [entities-motion.txt](ghidra-ingame-portals/entities-motion.txt): `00739a92` loads reactor info/link and numeric state/repeat/event families; `0073a649` resolves `Reactor/%07d.img`; `0073a865` follows the artwork link; `0073ac7b` chooses `%d/hit` and `event/%d/hit`; `00989add` formats `Sound/Reactor.img/%s/%s`.
- [reactor-triggers.txt](ghidra-ingame-portals/reactor-triggers.txt): `0073a16c` loads original event type, rectangle and activeSkillID records. It does not prove server `state` authority. `00736091` ranks hit events using facing bit0 and foothold-contact bit1: direction-specific grounded hits rank0, generic grounded rank1, direction-specific airborne rank1, generic airborne rank2, nonmatching direction negative.
- [reactor-hit.txt](ghidra-ingame-portals/reactor-hit.txt): `007356c7` selects eligible state events0..4, then derives the hit rectangle from the **current reactor rendering layer's canvas corners** through `00440c54`/`00439dcb`. Reactor canvas bounds are therefore a real distinct receiver family, not a substituted player/mob body rectangle. Browser current `frameGeometry` uses those actual sprite corners. The final nearest-overlap selection in this local implementation is provisional; the original final selector is `0095719b`.
- `00735ab7` tests event5's exact activeSkillID and Win32 point-in-rectangle after offsetting authored lt/rb by placement, without applying sprite flip to event coordinates. Its 800-ms skill packet/animation schedule is not claimed implemented by the generic local basic attack path.
- [reactor-events.txt](ghidra-ingame-portals/reactor-events.txt): `007348a0` switches between idle state artwork and one-shot hit artwork, then uses the common `0043ea3e` frame loader. Thus missing frame delay is the same original 120ms consumed by `0043f768`; explicit numeric-string milliseconds are normalized. Repeat is authored state metadata, not an unconditional animation loop.
- Expanded extraction also reaches explicit zero-delay reactor frames. Their original Gr2D insertion/timestamp/queue consumers preserve equal-time events, now supported by the common renderer without adding a guessed frame duration; see [client evidence](client-evidence.md#timed-frame-alpha--verified).
- [reactor-layers.txt](ghidra-ingame-portals/reactor-layers.txt): exact normal depth at `00734d30` is `B + 29990 + 10*(plane*3000-group)` and backTile depth at `00734fb5` is `B + 2000 + plane*30000`, where the existing renderer removes common `B=-0x40000000`. The original asks `00a45677` for the placement foothold. Offline extraction selects the nearest segment at/below the placement; the no-segment plane0 fallback is explicitly local, not recovered collision behavior.

`ReactorSystem` runs state hit one-shots without looping, changes to the exact authored target state, processes positive timeOut/type101 transitions, and locally respawns terminal states after placement reactorTime seconds. Type100 uses the actual inventory stack and authored required count. The `quest` field is locally interpreted as requiring the quest to be active. None of those local authority choices is described as an original server rule. Reactors whose root action is a script still animate supported state transitions but report `local-transition-script-reward-unavailable` instead of granting invented rewards.

## Extraction and lifetime contract

`await extractReactors(context,map,mapId)` in [reactor-data.js](../client/tools/reactor-data.js) returns `{entities,reactors}`. Main appends entities with final map order and preserves `manifest.reactors`. Reactor metadata schema1 includes complete placement rows, original and resolved linked-template rows, all projected states/events/statuses, flags, script/quest references, and selected sound descriptors. Every supported state/hit artwork family uses the existing Frame/Part/atlas/region path. Original Sound/Reactor Hit nodes reuse audiovisual `publishSound` envelope validation and content-addressed publication; no second sound codec is introduced. Absent original sounds are absent dependencies, not synthesized audio.

`new ReactorSystem(scene,store,hooks)` is synchronous because scene regions own all visual resources. Its API is:

- `step(ms)` once per executed fixed physics tick; no independent accumulator.
- `refresh()` after region residency changes and before draw, including initial preparation. It detects new EntityAnimation identities, marks them `gameplayOwned`, restores current action progress and retains no evicted texture/container leases.
- `strike(rect,facing,skillId=0)` once per actual committed local combat impact. Rect uses the existing equipment attack rectangle. It never manufactures unavailable skill actions.
- `offer(itemId)` from the native inventory **Offer nearby** button. Runtime checks current simulation feet and real inventory ownership, accepts only supported nearby event100 conditions, debits exactly the authored count only for an accepted transition and marks the profile dirty. Returns `{accepted,reason,consumed?}`. No independent caller-supplied item count/position is trusted.
- `snapshot()` reports resident/state/event/script boundaries; `destroy()` drops state references without destroying region-owned resources.

Hooks are synchronous nonthrowing `onChange()` and `onSound(descriptor)` notification boundaries. Main owns actual AudioSystems playback. State survives region eviction/reload but deliberately resets on field entry; this is a local session policy, not a claimed original server persistence lifetime. No generic spawn/summon manager is necessary for authored reactors, and no second all-map visual preload is added.

Engineering bounds: 4096 placements/map, 512 cached templates/extraction context, 256 states/template, 256 events/state, 1024 frames/action, 32768 typed metadata nodes/template image, 32 link hops, 65536 footholds/map. Runtime loops iterate those prevalidated finite records without per-tick arrays, sorting, texture allocation or new containers. All actions stay region-demand-bound; only semantic state survives eviction.

## Exhaustive Morph and TamingMob schemas

Morph has 42 images and exactly these action roots (not a claim every image has every action): alert, alert2, alert3, alert4, alert5, backspin, demolition, doublefire, doubleupper, dragonstrike, eburster, edrain, eorb, fist, fly, jump, ladder, ladder2, prone, proneStab, recovery, rope, rope2, screw, shockwave, shoot1, shootF, sit, snatch, somersault, stabO1, stabO2, stand, stormbreak, straight, swingT1, swingT3, timeleap, walk, wave, windshot, windspear. Info fields are exactly fs, hide, jump, morphEffect, noCancelDamage, speed, superman, swim. Action canvases carry delay, origin, head, lt/rb, occasional z and UOLs; complete path/type counts are in Morph.json.

TamingMob has seven four-digit images0001..0007, no graphics or indirections, and only info/{speed,jump,fs,swim,fatigue}. Their speed values are 150,170,180,80,190,120,140 respectively; jump is120 except0004=100; fs10 throughout; swim100 except0004=80; fatigue5 for0001/0004 and3 otherwise. Therefore this tiny archive is movement metadata, **not mount artwork**. Artwork belongs to `Character/TamingMob/%08d.img` (original consumer `005c94a1`, references `005c98b2`/`005c98dc`).

Neither morph nor mount is an independent map-region entity. A genuine implementation must compose the owning actor/form using original action/anchor consumers and activation sources. The selected route/reactor closure does not introduce a mandatory morph/mount activation; these archives are inventoried rather than falsely advertised as playable form/mount support.

Projectile, summon and drop instance behavior is not proven by these inventories. Projectile-like effect artwork does not establish a projectile action, collision, travel timing or hit policy. No absent projectile family is labeled supported. Local combat/drop policies belong to the combat domain, and reactor scripts do not invent extra spawn/drop tables.

## Verification boundary

Complete original archive/schema and route-closure investigations and fresh address-directed Ghidra exports ran during the implementation wave. Main subsequently completed extraction, source checks and integration. [Independent native portal/reactor evidence](offline-validation/portals-reactors/evidence.json) and [Main's accepted 2302002 state0→state1 hit](offline-validation/main/recovery-reactor-after.json) retain runtime observations, including the repaired zero-duration endpoint. Full-release closure and [server-stopped launch](offline-validation/main/final-server-stopped-restart.json) cover packaged dependency delivery. These local outcomes do not claim unavailable script behavior or original Windows visual parity.
