# In-game life: original metadata and local offline gameplay

Original metadata extraction and inspection use only the supplied `Maplestory-Client` WZ archives and executable. The new [offline combat authority](offline-combat.md) now implements local mob movement, combat, HP/MP, death/recovery, respawn and progression with explicit provisional rules; it is not original server reconstruction. Original evidence and historical preview verification below are retained. No original runtime recording, Windows runtime, server, drop tables or missing scripts are fabricated.

## Delivered modules and integration

- `client/tools/life-data.js`: `await extractLife(context, map, mapId)` returns `{entities, life}`. Append entities to the existing map entity collection and retain `life` as `manifest.life`.
- `client/src/life-system.js`: `new LifeSystem(scene, hooks)`, `refresh()`, `update(ms)`, `snapshot()`, `destroy()`.
- `client/src/life-geometry.js`: owned, preallocated current/swept mob-body and separate NPC-interaction geometry.
- `client/src/life-controls.js`: bounded, clearly labeled DOM preview controls; no shared HTML/CSS modifications.

`scene` supplies the shared scene contract plus persistent `scene.overlays`. Main advances mob gameplay/artwork only in the fixed tick before `LifeSystem.update(ms)`, which observes mobs without changing their action, phase or visibility. `life.refresh()` follows membership changes. LifeSystem owns overlays/listeners, not textures. NPC artwork remains region-owned; mob artwork is separately demand-leased through `OfflineMobRenderer`, so region unloads cannot reset live mob state. Destroy LifeSystem before scene/entity/texture ownership.

Additional public preview methods:

- `select(id)` selects a stable authored `life:<index>` placement.
- `setPreviewAction(id, action)` selects original NPC inspection artwork only; gameplay-owned mob actions cannot be overridden by the inspector.
- `interact(id)` is inspection only and never opens a quest transaction. Native NPC world-pointer interaction uses current placement/proximity/death admission and emits the local dialogue hook; mob clicks inspect metadata.
- `showGeometry` and `revealHidden` are controlled by the corresponding labeled preview checkboxes. The latter explicitly overrides authored `hide=1` for inspection only.

Gameplay NPC records expose `{id,templateId,name,functionName,authority,kind,authored,info,interactionGeometryKnown,mode,canInteract,admissionPolicy}`. Authority is `offline-local-policy`; mode is `npc-local-interaction`. `canInteract():boolean` rechecks a live, visible, resident, nonhidden NPC and alive player within local 120-pixel horizontal/100-pixel vertical reach. This is not a claim about original dc admission. Quest/UI confirmation must recheck the prebound callback after movement/map changes. Inspector selections never invoke this hook. Original sounds are not dispatched merely for metadata selection; callbacks retain explicit error handling.

## Metadata schema and resource identities

`life` is JSON-compatible:

- `schemaVersion: 1`, `mode: "metadata-preview"`, `activationKnown: false`, `mapId`.
- `placements`: stable `id`, template key, kind, exact authored scalar/vector fields and exact WZ path. Missing `f`, `hide`, `mobTime`, `limitedname` remain missing. `x/y` are authored positions; `fh/cy/rx0/rx1` are retained without claiming live controller state.
- `templates`: keyed by `npc:<seven-digit original id>` or `mob:<seven-digit original id>`. Each retains original id, exact String.wz `name` and optional `func`, selected template info, `artworkHash`, action metadata, and lossless nonpixel source trees.
- Source-tree rows retain type, path, raw scalar/vector values, UOL text, and original canvas dimensions. They do not embed parent pointers or encoded pixels. `context.image` additionally records input hashes in the shared extraction provenance.
- Per-action metadata retains authored properties and every frame's original key, raw delay type/value (`null` denotes absent), normalized milliseconds, origin, width/height, and explicit `lt/rb` body rectangle or `null`.
- Templates additionally retain `defaultAction`, `artworkStatus` and original mob combat restrictions/type-0 action inputs. Missing stand uses an existing original fly/other action, not invented artwork; templates with no action canvases remain metadata-only. Missing optional foothold/range fields are preserved and their unsupported movement family is classified.
- Packaged `life.renderables[template]` supplies original per-template frames, atlas dependencies and presentation-only bounds; mobs are excluded from static region ownership.
- No new Entity/Frame/Part extension is required. All artwork actions use the existing contracts. `context.part` supplies lossless content-addressed artwork and original origin offsets. The life cache is scoped to the extraction context and keyed by original kind/id; identical pixel hashes share the existing atlas identity across templates and placements. `artworkHash` hashes the compiled action/part content, not an invented live actor id.

Limits are engineering bounds, not original constants: 4,096 placements per map, 8,192 templates per extraction context (expanded for the bounded portal closure), 128 action branches, 1,024 authored frames per action, 32,768 metadata nodes per source IMG, depth 64, 32 mob link hops. Malformed/cyclic input throws rather than truncating; missing unsupported action families remain classified. The original eight-map acceptance set contains no IMG links; UOL aliases resolve through the existing parser.

NPC image `info/link` redirects artwork once, while source NPC info and original-id String.wz lookup are retained (`006dce02`). Mob links form an iterative chain with cycle detection (`0067cf06`). Chained NPC artwork-cache semantics outside the acceptance set are not claimed as proved; source rows retain the exact link data.

## Recovered original consumers

Fresh evidence is under `docs/ghidra-ingame-life/`, generated read-only from the isolated `/tmp/maple-ingame-life.gpr` project using installed `analyzeHeadless` and `docs/tools/clientFocus.java` / `clientInstructions.java`.

| Original address        | Recovered behavior and boundary                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00639b3d`              | Existing map preloader enumerates `life`, reads type/id, and loads NPC/mob templates. It does not establish live actors.                                                                                                                                                                                                                                                                                      |
| `00858603`              | Fresh decompilation enumerates map `life`; compares type to decoded string `0x573 = n`, skips nonzero `hide` (`0xc17`), and collects `x/y` (`0x3d1/0x3d2`) in a presentation collection. This is additional NPC map-presentation evidence, not spawn authorization. The surrounding minimap-related properties support a minimap interpretation; exact class naming remains an inference.                     |
| `008ebfde`              | **Not a Map life consumer.** The shared string id `life` appears in item/pet-duration formatting alongside `permanent`, water-of-life expiry, and `0x2a4 = DAYS OF MAGIC : %d`. Treating this xref as a spawn consumer would be incorrect.                                                                                                                                                                    |
| `0067cd28` → `0067cf06` | Mob template cache/load; resolves Mob IMG links and loads String/Mob names and template metadata, including `hideName`. No AI is derived from this loader.                                                                                                                                                                                                                                                    |
| `006dcb16` → `006dce02` | NPC original-id strings, optional function, hideName, authored interaction metadata, and linked artwork.                                                                                                                                                                                                                                                                                                      |
| `006d9993`, `006d9549`  | Pool/network-facing paths read ids, load templates, construct actors via `006d041e`, and initialize via `006d089a`. This reinforces that map metadata is not a replacement for live pool state.                                                                                                                                                                                                               |
| `006d2e07`              | Reads two packet bytes; updates the NPC action state and dispatches additional resource/speech data only under template/state conditions. Resource branch names alone do not reproduce this protocol.                                                                                                                                                                                                         |
| `006d263e`, `006d232a`  | Current action/motion low bit supplies facing; the Gr2D flip setter receives `bit == 0`. Mapping authored placement `f` into this live actor field is still unproved. Preview policy maps authored `f=0` to mirrored artwork and `f=1` to unmirrored; absent `f` retains artwork.                                                                                                                             |
| `0040db31`              | NPC action frame cache loads authored Canvas delay and optional zigzag. **NPC absent delay is 180 ms**, not the generic extractor's 120 ms. Disassembly `default-instructions.txt` shows `PUSH 0xb4` at `0040de3a`, `delay` id `0x15f8`, conversion call `00414d40` at `0040de89`, and stored result at `0040de8e`. No acceptance action has zigzag; special branches are selectable only as manual previews. |
| `006d5c9a` | Original NPC nameplate consumer suppresses name/function when `hideName` at `+0x18` is nonzero. Current NPC labels use original name/role without the old preview suffix; local mob labels say `[offline local gameplay]`. Typography/outline/spacing remain browser policies, not original font parity. The retained early screenshot's `[metadata preview]` suffix is historical. |
| `006d267d`              | NPC layer depth is `(layer * 3000 - group) * 10 - 0x3fff8ad5`; translated to the existing renderer baseline this is `29995 + (layer * 3000 - group) * 10`. Preview resolves the authored foothold plane. Applying that plane to mobs and missing-fh fallback `29995` are preview policies, not recovered mob depth.                                                                                           |
| `00664559`, `00663fe2`  | Mob body selects cached facing rectangle, translates at current position, and optionally unions that **same current rectangle** at previous position. The swept rectangle is not a union with the preceding animation frame's body. `00663fe2` reads the actor direction low bit, with a template override.                                                                                                   |
| `0066936e`              | Mob action/canvas helper consumes original delay/body metadata. Fixed-30-ms mob/NPC actor updates remain documented in the earlier research; the life preview does not alter simulation cadence.                                                                                                                                                                                                              |

Retained decoded string identities are corroborated by `docs/ghidra-client/decoded-strings.txt`. Geometry research remains in `docs/hitboxes.md` and `docs/ghidra-physics-hitboxes/`; current local incoming/outgoing combat is documented separately in [offline-combat.md](offline-combat.md), preserving the recovered/unrecovered authority distinction.

## Timing, visibility and geometry policies

Strict integer/string numeric delay conversion happens once during extraction. For example, Rina's `blink` aliases resolve the repeated string sequence `"150", "100", "1200"`. Maya's single stand frame has no authored delay and uses the newly recovered NPC 180-ms default. Explicit zero delay remains unsupported. Missing mob delay remains unsupported until its actual loader default is proved. An unsupported action retains all authored frame metadata but exposes only an untimed first-frame artwork preview, compatible with shared frame validation. **No acceptance action has unsupported timing.**

NPCs initially preview existing stand/fly/other original artwork; authoring flags do not authorize original spawn activation. Mob current action comes only from the fixed-tick offline field. Authored hidden/limited/inactive mobs remain inactive; reveal controls do not override gameplay visibility. NPC `hideName` still suppresses names. No event dates or missing scripts are invented.

Geometry namespaces remain separate:

- Mob body uses explicit per-frame `lt/rb`, mirrored about original anchor and translated into world pixels.
- Swept mob body uses the same current-frame rectangle at previous/current simulation positions. The inspector observes this fixed-tick sweep, never an elapsed-render-frame approximation or a stale pre-unload position.
- NPC `dcLeft/dcTop/dcRight/dcBottom` remain separate original interaction rectangles, never physical bodies or damage geometry. Missing/partial fields stay unsupported. Native dialogue uses separately labeled local reach admission, and inspector selection remains nondamaging and cannot initiate quests.
- Authored `fh` and optional `cy/rx0/rx1` are displayed when present. The gameplay mob owner separately projects onto the exact original finite segment and follows its contiguous links under documented local patrol rules.
- `playerFootInsideBody` reports only point-in-body inspection of the existing avatar foot position. It is not avatar receiver collision, contact damage, or a hit decision.

`update` mutates prebuilt graphics transforms, text positions and rectangle slots. No arrays, objects, strings, closures or Graphics command lists are created in the hot loop. Pointer callbacks are prebound at construction; region membership/listener wiring occurs only in `refresh`. Preview action and elapsed phase survive region unload/rebind, explicitly a browser policy. All overlays, labels, handlers and DOM controls are owned and destroyed by LifeSystem; no texture ownership path is duplicated.

## Coverage and exercised proof

`docs/ghidra-ingame-life/extraction-probe.json` is an actual original-input extraction/decode run, not estimated inventory:

| Map       | NPC placements | Mob placements |
| --------- | -------------: | -------------: |
| 100000000 |             30 |              0 |
| 100000001 |              1 |              0 |
| 103040000 |              7 |              0 |
| 108000500 |              1 |             15 |
| 120000000 |             15 |              0 |
| 200090500 |              0 |              0 |
| 211040000 |              0 |             34 |
| 230000000 |              9 |              0 |
| **Total** |         **63** |         **49** |

All **112 placements, 53 NPC templates and 3 mob templates** decoded successfully through the original parser and lossless Canvas decoder. The probe found **529 distinct pixel hashes**, **22,354,884 bytes of unique decoded RGBA**, no template links in this acceptance set, and no unsupported action timing. This number is extraction payload size, **not live resident GPU memory**. Full action metadata includes special branches without activating them automatically.

An isolated native-browser smoke used the installed Pixi ES module (no build), the actual LifeSystem/EntityAnimation modules, and exact decoded Maya/Hector/White Fang artwork. It did not use a mock renderer. Exercised:

1. Maya displayed at original authored anchor with `Maya` and explicit preview label; a real pointer click produced one server-unavailable NPC interaction record with template `1012101`, without inventing dc geometry.
2. Actual map selector input replaced Maya with all 34 authored 211040000 mob previews; the old owner left exactly one preview DOM panel after replacement.
3. Actual action selector input chose Hector `move`; the geometry checkbox displayed per-frame bodies, selected sweep, and authored foothold/contact/range overlays. The retained image is `docs/ghidra-ingame-life/native-browser-preview.png`.
4. A separate inspection experiment translated Hector 20 pixels without adding movement logic. Current body was `[-341,-100]..[-239,-45]`; sweep was `[-361,-100]..[-239,-45]`, preserving the same-frame union rule.
5. A membership-removal/rebind experiment reported resident false and inactive geometry while absent, then restored `move` and the same displayed frame. No world texture loader was added to the production life owner.

The isolated probe bypassed production streaming to exercise this domain independently. Integrated native evidence now lives in [life/report.json](ingame-validation/life/report.json), with twenty screenshots and exact action records. It covers Maya/Kyrin identity, Hector/Octo action/body previews, hidden/name suppression, natural region residency, control focus and map-owner replacement. Native NPC close buttons exposed the shared UI pointer-reparenting bug; [fixed-ui-npc-close.json](ingame-validation/fixed-ui-npc-close.json) confirms Main's correction using both actual close controls. Dense static-preview names can overlap; no live-spawn/AI/font/depth parity is claimed. Far-right Octo traversal and nonzero live actor sweeps were not exercised.

## Required Windows/reference captures and server boundary

Expand original-runtime capture requests with:

- Maya and Thompson: anchored artwork, native font, name/function layout, animation frame timestamps, NPC click and keyboard interaction behavior.
- Kyrin on 108000500 against ordinary `f=0` NPCs: correlate authored facing with spawn/controller packet direction and Gr2D flip.
- Hidden Bush/Maple TV/Ice Piece: distinguish map `hide`, template `hideName`, click geometry and event activation. Capture `limitedname` availability with event/server context.
- Rina blink/smile/hair: verify UOL animation cadence, special-action selection protocol, absence/zero delay behavior and any action-loop handling.
- Hector/White Fang: compare frame-dependent body rectangles and direction; capture actual actor depth, contact/invulnerability handling and previous-position sweep boundaries without inferring combat from rectangles.
- OctoPirate: capture special `mobType=4`, `mobTime=-1` placements and live controller packets; do not generalize generic ground AI from this template.
- Record spawn/despawn ids, controller assignment and action packets if server-authoritative reconstruction is later authorized. The supplied offline assets cannot establish these states.

No original visual parity, live-spawn fidelity, original damage formula or server-compatible interaction protocol is claimed. Local offline behavior is deliberately distinguished from those unresolved original semantics.
