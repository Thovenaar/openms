# Original avatar actions and movement evidence

> [!NOTE]
> References to the former local runtime below are historical. The online client reuses the extracted artwork and movement presentation while the server owns live action and motion state.

## Original-source investigation

The extractor reads the supplied Character.wz and Base.wz through the existing local WZ decoder; no third-party client implementation was used. The complete root/frame scalar inventory is retained in [offline-avatar-wz.json](ghidra-client/offline-avatar-wz.json). This run opened all eight equipped images and inspected every body root. It found 157 body action families, including nested ghost banks and advanced skill aliases; these are not all ordinary locomotion or beginner attacks.

`client/tools/avatar-data.js` exports `extractAvatar({image,part}) -> {actions,equipment}`. Equipment strings preserve the `Character.wz:` source prefix. The equipped weapon is **Weapon/01302000.img**: original info has `walk=1`, `stand=1`, `attack=1`, `afterImage=swordOL`, `sfx=swordL`, `incPAD=17`, `attackSpeed=4`. The [complete selected equipment map inventory](ghidra-avatar-actions/selected-equipment-maps.json) records **39 authored weapon frame references across 15 action families**. Each family is nested as `action/frame/weapon` with a Canvas child, not a numeric weapon-type bank. These authored canvases are composed; an existing frame with no canvases or an unclassified nested part family is an error, not silently omitted artwork. Weapon type does not justify borrowing another weapon's artwork. Standard alternate weapon-family poses have no weapon layer when this original weapon has no such family; playable equipped basic attacks use authored `swingO1`/`proneStab`, selected by local combat.

## Complete standard action coverage

The original action table initialized by `004a38e7` has 34 unique names across indices 0 through 39. Repeated table entries alias existing names, not extra WZ roots. Extraction selects all 34:

- `walk1`, `walk2`, `stand1`, `stand2`, `alert`;
- `swingO1/O2/O3/OF`, `swingT1/T2/T3/TF`, `swingP1/P2/PF`;
- `stabO1/O2/OF`, `stabT1/T2/TF`, `shoot1`, `shoot2`, `shootF`;
- `heal`, `proneStab`, `prone`, `fly`, `jump`, `ladder`, `rope`, `dead`, `sit`.

The nine ordinary pose aliases `alert2..6`, `paralyze`, `ladder2`, `rope2`, `prone2` are also selected. Body aliases are resolved for the entire composed pose, including the body itself, not merely copied onto equipment. Missing targets, noninteger frame indices, alias cycles, missing body canvases, invalid origins and invalid/empty named-anchor maps fail extraction. A valid disconnected anchor component is **not** corruption: the recovered original composer retains it at its authored origin, as described below. Relative UOL traversal remains delegated to the existing bounded cycle-checking resolver. Unsupported movement/control/skill mechanics are not granted by artwork availability.

Evidence: [original action table](ghidra-physics-hitboxes/action-names.txt), [original action loader `00406abd`](ghidra-client/avatar-functions/00406abd.c.txt), [state selection `00451ec8`](ghidra-physics-hitboxes/avatar-state/00451ec8.c.txt), and the new retained address-directed [composition dispatch](ghidra-client/offline-avatar-actions.txt) / [equipment frame loader](ghidra-client/offline-avatar-frame-loader.txt).

## Original composition is an anchor forest

The first integrated extraction failed with `Unconnected avatar anchors alert/0: lHand`. Its root cause was the extractor's unevidenced requirement that every canvas must connect to the body's named-anchor graph. Direct inspection of every selected equipment/action map found that `alert/0..2/lHand` has only `handMove`; `heal/0/lHand` aliases `alert/1/lHand`. No other selected canvas supplies that anchor. In particular, the starter sword's alert canvas attaches through `hand`, not `handMove`. Adding a synthetic `handMove`, substituting `hand`, discarding `lHand`, or borrowing another weapon's map would all change the original composition.

The new address-directed original-client investigation establishes the actual rule:

- [`00402442`](ghidra-avatar-actions/sprite-insertion.txt) initializes **every** canvas's top-left to the negation of its authored canvas origin before inserting its named-anchor component. The existing `context.part` already subtracts the origin, so an untranslated component is represented by zero additional displacement, not by invented world coordinates.
- [`0040197d`](ghidra-avatar-actions/component-search-and-culling.txt) looks for another component with common named anchors. `00402442` repeatedly merges matching components and preserves the first component's coordinate system. A component with no match remains in the composition; there is no missing-anchor error or hand-specific fallback.
- [`00401a17`](ghidra-avatar-actions/component-merge.txt) aligns all common anchors using **separately truncated integer centroids**: `trunc(sum(destination)/count) - trunc(sum(source)/count)` for each coordinate. It does not choose an arbitrary first anchor or truncate the mean difference. The [disassembly](ghidra-avatar-actions/component-merge-disassembly.txt) retains all four signed `IDIV` instructions and the anchor/member translations. This matters because the decompiler incorrectly marks its new-anchor-copy block at `00401b0d` unreachable; the instructions explicitly add the merged displacement to new anchors and every source member.
- [`00401c74`](ghidra-avatar-actions/component-search-and-culling.txt) performs slot visibility arbitration, separately from connectivity; [`00401de9`](ghidra-avatar-actions/composition-render.txt) draws every visible canvas from every component. [`00774901`](ghidra-avatar-actions/slot-lookup.txt) and [`00774815`](ghidra-avatar-actions/slot-intersection.txt) recover the two-character `smap`/equipment slot intersection. For this fixed outfit, `handBelowWeapon` maps to `Bd`, the body's own slot; all its body parts share the same original item priority, and no equipped clothing/hair/weapon slot replaces `Bd`. Slot culling is therefore not a reason to drop this hand. Arbitrary loadout/cap conflict arbitration is not added to the fixed-loadout API.

`placeCandidates` now mirrors this bounded component insertion/merge behavior and retains every authored canvas, including the disconnected hand at its original origin. Weapon canvases connect through their own authored `hand` or `navel` maps. The selected map inventory includes all 1,629 action-map canvas references (including all original hair-shade banks inspected) plus the separately selected default face. Extraction still chooses the fixed body's skin-index-zero hair shade; it does not flatten every variant into the avatar.

[Provenance](ghidra-avatar-actions/provenance.txt) records the original executable SHA-256, exact read-only Ghidra commands and retained reports. These are decompiler/disassembly and WZ observations, not original native execution or an extraction-success claim.

## Timing is original, playback mode is explicit

`00406abd` reads `action` (string ID `0x15ee`), `frame` (`0x437`, default zero), `delay` (`0x15f8`, default **150 ms**), `flip` (`0x1037`, default zero), `rotate` (`0x1038`, default zero), and `move` (`0x1608`). Its alias branch converts negative delays to their absolute duration and also accumulates their magnitude in a separate original pre-action total (`00bec630`). Therefore negative delay is **not** reverse playback and is not a guessed damage activation time. The ordinary aliases retain their authored duration magnitude. The extracted default 150-ms duration for otherwise static `prone`, `sit`, `dead` is now address-backed, replacing the previous browser zero-delay singleton policy.

`004a38e7` marks the direct actions `stand1`, `stand2`, `alert` bidirectional; `00406abd` expands N frames to `2*N-2` and appends N-2 down to 1. Thus their authored three-frame poses play `0,1,2,1`, all at their original 500-ms duration, not the previous `0,1,2` loop. Alias actions retain their own explicitly authored sequence rather than inheriting the target's looping flag.

`EntityAnimation.setAction(name, playback='loop')` is idempotent for an unchanged action and mode. `once` completes at the exact total duration, sets `.completed`, and holds the final frame. Zero-duration static entities complete immediately under `once`. Changing name or mode resets time; callers that deliberately replay the same action must first transition/reset its playback mode. `.actionTimeMs` clamps at the once duration; `.elapsedMs` remains elapsed since selection. Exact interior boundaries choose the next authored frame. These are presentation events, not damaging phases.

`animation.seek(ms)` accepts an authoritative elapsed action clock (used by dynamic mob presentation). It updates elapsed time, loop modulo/once clamping, completion, frame and alpha together without exposing direct clock mutation. Seeking earlier than a completed one-shot's end clears completion. It does not introduce an accumulator or advance gameplay.

### Independent original hit face

The fixed `Face/00020000.img` was directly inspected again: `default` contains one26×16 face canvas; `hit` contains exactly frame0 with a face canvas. The extractor now composes that authored hit face against each face-visible body's original anchors. Only face parts are added, tagged `expression:'default'|'hit'`; body/equipment compositions are not duplicated. Existing `frame.parts` atlas closure, descriptor ownership, tiled-part spreading and texture loading retain both variants. Frame validation rejects unknown expression tags, and the independent Canvas2D oracle filters them using the actor snapshot expression.

`EntityAnimation.setExpression(name,durationMs)` changes only the face selector/deadline, not action/frame/elapsed clocks. `advance(ms)` advances its independent deadline even for held climb frames or completed one-shots. Accepted positive hits select hit for1500ms; zero/negative hits do not. At expiry the renderer unconditionally selects default, matching `004534a2..004534bd` in the [retained instruction export](ghidra-client-corrections/fidelity-r2-emotion-carry.txt), not a saved previous emotion. Locomotion/action changes retain the active face deadline.

These face and number changes were inspected against original WZ and the verified original EXE in read-only `/tmp/maple-physics-motion`; no Windows execution is claimed. Main owns final regeneration of generated assets and browser verification. [Recovery/name evidence and limits](offline-combat.md#recovered-natural-recovery) cover the accompanying field changes.

## Native plain player-name attachment

The completion pass resolves the earlier “unknown parent offset / feet+2 policy” qualification for the ordinary undecorated name. It does **not** derive the name from a mob label or an avatar artwork rectangle. Read-only original EXE instructions are retained in [name compositor](ghidra-client-corrections/fidelity-name-compositor.txt), [compact layout/attachment](ghidra-client-corrections/fidelity-name-layout.txt), [accessors](ghidra-client-corrections/fidelity-name-accessors.txt), and [measurement/canvas helpers](ghidra-client-corrections/fidelity-name-measurement.txt).

`00942dcc` supplies the compositor's stack parameters as name string (`EBP+8`), user layer1150 (`+c`), user vector11a4 (`+10`), category1000 (`+14`), selector (`+18`), then four zero optional arguments. `005f0334` initializes label index0; only other categories switch to index1/2. The newly created name layer receives an overlay relationship to1150 through layer virtual`+fc`, but its **coordinate origin** is attached to11a4 through vector virtual`+64` (`005f17d1..1805`). These are separate relationships, not two competing y offsets. The11a4 object's `+8c` coordinate query is also the source for the original user's X/Y foothold probes at `0092fd99..0092fe11`. It is the user position vector, not the current face/body canvas lower edge.

For the undecorated category1000 branch, let `W` be native font text-width measurement (`0042782e`, font virtual`+1c`) and `H` its font-height property (`00485a45`, font virtual`+14`):

- Canvas width is `W+5`; canvas height is `H+4` (`005f12e5..1345`). Optional icon width is zero on this branch.
- The background fill is ARGB`a0000000`. Each of the four corner1×1 pixels is written as ARGB`00ffffff`, **transparent**, not a white border.
- Text is drawn at canvas`(2,0)` (`005f15ef..1603`), not`(2,2)`.
- Canvas origin is `(trunc(width/2),-2)` (`005f1654..1694`), giving world top-left **`(userX-trunc(width/2),userY+2)`**. The later preceding-label height accumulation cannot move this plain name: index0 decrements to−1 and exits at `005f1979..1981`. Guild/medal/category1/2 stacking is separate.

Thus the ordinary name's feet+2 relation is now native-backed, while the prior4px width padding,2px text inset and square background corners were corrected. Font slot0 remains the previously recovered **Arial12, white**. The renderer substitutes browser Arial text width/height measurement and rasterization; exact Windows font metrics/antialiasing are not claimed. Decoration, highlighted-name modes and native occlusion rules remain outside this plain-name component.

`new PlayerName(scene,store)` retains the stable store owner, not a profile root. `step(renderer.resolution)` reads the latest `store.profile.name`, so atomic profile replacement/rename is visible. Main calls it in `FieldSystems.update` **after** `updatePresentation`; it consumes `scene.presentation.x/y` and uses the same integer logical-pixel truncation as `EntityAnimation.setPosition`. It cannot visibly lead the interpolated avatar by following raw physics. Text/background geometry rebuilds only on a changed name or actual renderer resolution; Pixi Text resolution is explicitly set so density changes rerasterize. `destroy()` removes/destroys its container and text/background resources; there are no subscriptions or per-frame arrays/objects/text construction.

Renderer resize also calls the same name update without advancing physics. This rerasterizes the name when density changes during a deliberate pause, rather than waiting for gameplay to resume.

The address-directed Ghidra exports and [provenance](ghidra-client-corrections/fidelity-name-provenance.json) distinguish recovered layout from remaining browser font/overlay policy. The [current browser report](ingame-validation/fidelity/report.json) and [visible recovery capture](ingame-validation/fidelity/recovery.png) exercise the live profile name after native persistent editing, alongside renderer transitions at1×/1.25×/2× density. These are browser-reconstruction checks, not original Windows screenshots.

## Death is not an authored rotation

Direct inspection disproved the assumption that `dead` is an `action/frame` alias. `00002000.img/dead/0` contains an original 28x28 body canvas, `face=1`, a `neck=(1,-28)` anchor, origin `(13,27)`, and no authored rotation, movement offset or delay.

Original `00407757`, branch action `0x26`, clears the equipment array and retains slots 0, 1, 3, 4. For this un-hatted fixed loadout this removes coat, pants, shoes and weapon, while retaining head/hair/face. Original `0041272c` first requests the body's actual `dead` action, then substitutes table index `0x23` (`jump`) for the head and retained equipment. The implementation composes that body with head/hair `jump/0` and the visible default face using original anchors. It does not invent a flattened/rotated corpse, use standing clothes, or silently drop the head.

No new geometric Frame transform is required by any of the 43 standard/ordinary pose families. Existing Frame schema, Pixi composition and independent Canvas2D oracle therefore stay geometrically unchanged. The extractor rejects an unexpected geometric transform in those selected roots instead of silently ignoring it.

## Distinct nonstandard dependencies

The remaining body roots are advanced skill/alternate form sequences, not ordinary avatar actions. The retained full inventory records their exact nodes rather than claiming them extracted. Examples include `somersault` with original 180/270-degree rotations and move offsets; `dragonstrike` with a flipped frame; authored zero-duration skill endpoints; and `ghostwalk` etc. with nested banks `1` and `2`. Their original transformation/order and skill/form action arbitration are outside the standard-avatar API and are not fabricated as playable beginner skills. Presence of those scalars alone does not authorize an attack, classify a damaging frame or establish skill eligibility.

## Fixed clock, input and scene integration

See [physics evidence](physics-evidence.md#browser-api-bounds-and-overload). `advanceSimulation(sim,input,ms,onStep)` owns the sole compensated accumulator and calls `onStep(30)` after every successful tick. Main runs OfflineField, chooses `field.action ?? sim.action`, supplies the explicit one-shot playback mode, updates actor pose, then advances that artwork by exactly 30 ms. RAF presentation excludes the player and entities with `gameplayOwned=true`; draining physics backlog with elapsed zero still advances their fixed clocks.

Held attack is real preallocated input (`X`, left/right Control); DOM repeat does not fabricate edges. Space retains an immediate edge, plus a separately labelled provisional held policy: eligible ground/ladder retries, and a 300-ms detached buoyant repeat cooldown. Physical branch permissibility/impulses remain original `009b1d3d`; the cadence is not claimed original. `sim.movementLocked` suppresses controls/facing/jump while preserving gravity/inertia. `relocateSimulation` preserves object identity and the accumulator while resetting position/contact state.

Dynamic mobs use `scene.addDynamicEntity(animation)` and `scene.removeDynamicEntity(id)`. The owner retains animation/texture lifetime; the scene owns display membership and combines static/dynamic IDs for selection and rendering. Region loads exclude legacy static mob entities before acquiring their textures. `scene.offlineField` receives demand updates and idempotent teardown. Ambient rendering must not advance `gameplayOwned` entities.

## Investigation proof and integration validation

The initial wave executed original WZ inspection and read-only Ghidra decompilation of `0041272c`, `004123d2`, `00412929`, `0041258d`, `004aa9de`, `00453ad1` plus their retained dispatch evidence. The repair wave additionally inspected every selected equipment/action map and recovered the original insertion, component merge, slot intersection and rendering functions retained in [ghidra-avatar-actions](ghidra-avatar-actions/provenance.txt). Neither worker wave ran extraction/build/lint/tests/formatters, per integration ownership. Main owns final extraction and actual browser keyboard/action validation after handoff; the structural inspection output is not presented as runtime validation. The `extractAvatar` API, Frame schema, all 43 selected action names, authored timing and the simulation API remain unchanged.

Main subsequently completed the full 356-map extraction with all 43 selected avatar families, then exercised ordinary/held jumps, swimming/flight, attacks, hit/death/recovery and native map entry. [Independent movement/UI evidence](offline-validation/ui-movement/results.json), [combat/quest evidence](offline-validation/combat-quests/evidence.json) and [recovery replay](offline-validation/main/recovery-reactor-after.json) retain actual-input outcomes. The [refresh-invariance run](offline-validation/refresh-invariance.json) separately checks fixed-step partitioning over all packaged maps; synthetic refresh partitions do not claim physical 144-Hz display execution.
