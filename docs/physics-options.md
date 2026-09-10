# Original physics-option inventory

## Scope and reproducible evidence

This is an inventory of the supplied original v83 WZ metadata and address-identified consumers in `Maplestory_UNPACKED.exe`, not a claim of complete physics equivalence. No original C/C++ source or original gameplay/reference recordings were supplied or found in the input directory. No third-party client implementation was used. Numeric names alone are not treated as proof of semantics.

- Global physics resource: **`Map.wz:Physics.img`**, requested by the executable as `Map/Physics.img` at `00a43512`, in constructor `00a43433`.
- [Machine-readable inventory](physics-options.json): normalized original paths, full distinct values with occurrence counts, numeric ranges, eight exact sample paths per pattern, loader defaults/precedence where recovered, addresses and status. Numeric **path segments** become `#`; field names such as `floatDrag1` and `floatDrag2` remain distinct. Samples are bounded; counts and distinct values are not truncated. Numeric strings remain strings.
- [All-map extraction probe](ghidra-physics-options/map-probe.json): every concrete map and info-only map passed through the production `readPhysicsData` helper; exact exceptional map paths, area rectangles, foothold flags and portal impacts retained.
- `bun client/tools/physics-inventory.js [original-directory] [output.json]` reproduces the metadata inventory. `bun client/tools/physics-map-probe.js [original-directory] [output.json]` reproduces extraction coverage. These are read-only original-data experiments, not build/test-suite commands.
- The inventory traverses every IMG in all 16 supplied PKG1 archives: Map, Skill, Character, Morph, Item, Mob, TamingMob, Npc, Reactor, Etc, UI, Effect, Sound, String, Quest and Base. It selects all non-art/actor map sections, all `info`/`level`/`common` metadata, movement-name candidates anywhere, and all Morph/TamingMob metadata. Canvas/audio payloads are parsed but not pixel/audio-decoded. `List.wz` has a different archive-mode-list format, not a PKG1 property tree, and is explicitly not classified as a physics-property archive. A candidate appearing in artwork/UI is not automatically a gameplay setting.
- Bounds: 100,000 directory entries per archive, 2,000,000 nodes per IMG, 100,000 option patterns, 100,000 distinct values per pattern. Exhaustion appears as an explicit per-IMG failure; no successful partial scan is silently claimed. The retained run has no parse failures.

`status: supported` in this report means **the original metadata loading/extraction contract is recovered**, not that every simulator branch consuming it is implemented. `unknown` explicitly includes partially recovered consumers, modifier precedence not yet established, and broad candidate matches. No option is labeled `unused` merely because its name has no known consumer. `binaryOnlyOptions` records foothold `drag`: its loader is real, but no supplied foothold defines it. Absence is not dead-code proof. The browser's supported/blocked runtime behavior is documented in [physics-evidence.md](physics-evidence.md).

### Geometry coverage


The expanded retained run parsed **16,821 / 16,821 IMG**, visited **12,500,732 nodes** and **9,457,204 scalar/vector/link values**, and selected **2,647,318 value occurrences** across **6,240 path patterns**, plus the binary-only `drag` entry. There were zero per-IMG failures.

| Archive | Parsed IMG | Nodes visited | Selected value occurrences |
|---|---:|---:|---:|
| Map | 5,602 | 7,916,016 | 2,216,013 |
| Skill | 76 | 124,484 | 64,130 |
| Character | 7,201 | 3,432,840 | 227,943 |
| Morph | 42 | 11,553 | 9,221 |
| Item | 155 | 147,961 | 33,850 |
| Mob | 1,568 | 329,100 | 86,384 |
| TamingMob | 7 | 49 | 35 |
| Npc | 1,620 | 76,352 | 6,941 |
| Reactor | 419 | 26,871 | 553 |
| Etc | 22 | 110,107 | 157 |
| UI | 19 | 33,037 | 1,083 |
| Effect | 17 | 27,092 | 921 |
| Sound | 44 | 10,745 | 15 |
| String | 20 | 97,771 | 4 |
| Quest | 6 | 156,338 | 60 |
| Base | 3 | 416 | 8 |

The production helper successfully extracted **5,261 / 5,261** map IMG, retaining **315,064 footholds, 9,557 ladders/ropes, 18,666 portals and 67 areas**, with zero failures. Only 2,995 maps contain the usual geometry/art branches; 2,266 are info-only. Do not turn an info-only/link map into a playable empty world.

The same full-map probe exercised retention of **1,521 object instances** with force/flow/drop candidates under `map.$objectPhysics`; their original runtime semantics remain explicitly unresolved.

The probe exposed real named area IDs (`o`, `next`, `DS`) in `109020001`, `910033000`, `910033100`, `910033200`, and `209080000`. The extractor preserves those names rather than imposing integer IDs on all areas. Numeric area IDs remain numeric. Foothold, ladder and portal IDs remain validated integers.

The physical field rectangle is distinct from the camera rectangle. Foothold extrema supply `minX+30`, `maxX−30`, `minY−300`, `maxY+10`; `VRLimit` optionally restricts nonzero VR edges with original `+20`, `−20`, `+65`, and `0` offsets. Initial position clamps all four edges, while subsequent ground/air movement clips X and the air top only. See [`physics-refinements.md`](physics-refinements.md) and its original instruction/decompiler exports.

## Global options: complete 19-field IMG

All 19 values below occur exactly once. Constructor `00a43433` loads them in this order into contiguous eight-byte slots. [`global-loader.txt`](ghidra-physics-options/global-loader.txt) retains each string, callsite and store. `00440d21` attempts COM `VT_R8` conversion; EMPTY, ERROR or failed conversion returns the supplied default. All these calls supply zero. [`global-loader-instructions.txt`](ghidra-physics-options/global-loader-instructions.txt) explicitly shows `FLDZ` and stack storage for the first call, and [`global-conversion.txt`](ghidra-physics-options/global-conversion.txt) retains the conversion routine. The extractor preserves the actual WZ scalars rather than substituting these defaults.

| Original key | WZ value | Physics slot offset |
|---|---:|---:|
| walkForce | 140000 | 0x00 |
| walkSpeed | 125 | 0x08 |
| walkDrag | 80000 | 0x10 |
| slipForce | 60000 | 0x18 |
| slipSpeed | 120 | 0x20 |
| floatDrag1 | 100000 | 0x28 |
| floatDrag2 | 10000 | 0x30 |
| floatCoefficient | 0.01 | 0x38 |
| swimForce | 120000 | 0x40 |
| swimSpeed | 140 | 0x48 |
| flyForce | 120000 | 0x50 |
| flySpeed | 200 | 0x58 |
| gravityAcc | 2000 | 0x60 |
| fallSpeed | 670 | 0x68 |
| jumpSpeed | 555 | 0x70 |
| maxFriction | 2 | 0x78 |
| minFriction | 0.05 | 0x80 |
| swimSpeedDec | 0.9 | 0x88 |
| flyJumpDec | 0.3499999940395355 | 0x90 |

Do not round the original single-precision WZ values to prettier decimals before packaging. Units, secure character attributes, ground/air integration and action-dependent consumers belong to the motion evidence, not to an inference from these names.

## Map, foothold, ladder, water and portal options

All scalar/nested info fields are enumerated in JSON, including administrative candidates such as `fieldLimit`, `fieldType`, `moveLimit`, `allMoveCheck`, `VRLimit`, `lvForceMove`, `forcedReturn`, `timeLimit`, and unrelated fields that must not be silently mistaken for physics. Camera `VRLeft/Right/Top/Bottom`, map links, portal targets and original unknown values are preserved.

| Scope / option | Observed data | Recovered consumer/default/precedence |
|---|---|---|
| `info/fs` | 68 occurrences, all `0.20000000298023224` | `0052b2b5`, string ID `0x661`, double default 1; secure CField attribute at `+0x1d0`/integrity `+0x1e0`. `00a45b8c` places its getter result into both map force/drag attributes. Getter `00a45cd6` uses 1 for zero; see motion evidence. |
| `info/swim` | 0 or 1 | `00529ef2`, default 0, nonzero becomes CField `+0x158`. |
| `info/fly` | 0 or 1 | `00529ef2`, default 0, nonzero becomes CField `+0x15c`. Wide string at `00af451c`: DWORDs `006c0066 00000079` spell `fly`. |
| swim versus fly | Both are independent flags in data | `00a45b8c` gives swim mode 1 precedence over fly mode 2; retained instructions settle the branch hidden by decompiler parameter loss. |
| foothold `x1,y1,x2,y2,prev,next` | Every concrete map; full ranges in JSON | `00a43e7b`, integer conversion defaults 0. Extractor requires the actual geometry instead of inventing missing coordinates. |
| foothold `force` | 855 occurrences; negative and positive values, range -300..220 | `00a43e7b`, ID `0xb9c`, integer default 0. Runtime force composition is separately documented. |
| foothold `drag` | No supplied occurrences | `00a43e7b`, ID `0xb9b`, integer default 0. A real binary option absent in supplied geometry, not a proven unused feature. |
| foothold `forbidFallDown` | 1,012 occurrences, value 1 | `00a43e7b`, ID `0x1141`, integer default 0 then nonzero boolean. |
| ladder `l`, `uf` | 9,557 occurrences each; 0 or 1 | `00a43e7b`, calls `00a44ece` / `00a44f31`, zero defaults, nonzero booleans at ladder `+4` / `+8`. |
| ladder `x,y1,y2,page` | `page` range 0..7 | Same loader; page call `00a450ab`, zero default, ladder `+24`. Raw names retained in properties. |
| `swimArea` | Five original maps, named or numeric rectangle IDs | `0052b2b5` requests literal `swimArea`, enumerates children and loads rectangles. Activation timing and overlap with global water mode remain unresolved here. |
| portal `horizontalImpact` | 1,057 occurrences, -200..300 | `0071165a`, ID `0x13ed`, integer field at portal `+0x38`; activation/impulse semantics unresolved. |
| portal `verticalImpact` | 134 occurrences, 600..2000 | Same loader, ID `0x1444`, integer field at portal `+0x34`; activation/impulse semantics unresolved. |
| object `force`, `flow`, `forbidFallDown` | Present under numbered map layers; `force` often numeric strings | Retained as candidates. Some duplicate foothold flags; do not apply both without proving original consumers. `flow` also appears in object rendering loader `0063ad16`, so a name match alone is insufficient. |

Address-bearing material: [metadata-loaders](ghidra-physics-options/metadata-loaders.txt), [map attributes](ghidra-physics-options/map-attributes.txt), [mode instructions](ghidra-physics-options/map-mode-instructions.txt), [portal loader](ghidra-physics-options/portal-loader.txt), [portal references](ghidra-physics-options/portal-refs.txt). String-ID consumers were located by scanning 2,240,735 analyzed instructions with the retained `physicsOptionRefs.java` script. An immediate-value match is a candidate; decompilation and property lookup context are required to promote it to a consumer.

### Active exceptional maps, not hypothetical settings

- `230000000` has global `swim=1`; default Henesys `100000000` and connected `100000001` have no active unusual flags captured by the probe.
- Local swim rectangles: `120000000/nt` = (-606,207)..(5318,302); `108010700/sea` and `140020300/sea` = (1920,124)..(3601,274); `120000301/pw00` = (-400,-45)..(401,375); `970020000/0` = (-360,184)..(1260,336). These are preserved, not silently turned into whole-map water.
- `108000500` contains foothold forces ±180; `103040000` includes -100/-120 slope forces. The JSON probe retains exact footholds.
- `109090300` has type-13 portals with vertical impacts 1500/1700 and horizontal impact 10. `980041000` has several jump portals. These are not ordinary map-travel portals.
- Unrecognized original root sections include `snowMan`, `user`, `battleField`, `noSkill`, `coconut`, `weather`, `shipObj`, `snowBall`, `mobMassacre`, `monsterCarnival`, `BuffZone`, `healer`, and `pulley`. They are preserved with unsupported reasons. A generic movement simulation must not claim their minigame/script semantics.

## Equipment, skill, morph and mount modifiers

The report records every selected original field rather than only likely movement keys. This includes skill `x`, `y`, `prop`, `time`, effect bounds and action-link candidates; their meanings vary with skill and are not globally assigned a movement interpretation.

- **Equipment:** `005cac3d` loads `incSpeed`, `incJump`, `incSwim` (IDs `0x7f2..0x7f4`) with integer default 0; secure storage integrity slots `+0x118`, `+0x120`, `+0x128`. The same loader reads `fs` with double default 1 and `swim` with integer default 100. Seven Shoes IMG have `fs=10`. Equipment ranges are retained by slot/path in JSON; unusual data includes cap `incJump=50`, cap `incSpeed=30`, and weapon `incSpeed` up to 20. This establishes template values, **not** stacking order with equipped instances, scrolls, set effects, pets or temporary stats.
- **Skills:** `0075f464` loads level `speed` and `jump` into secure fields at `+0x78` and `+0x84`; [skill instructions](ghidra-physics-options/skill-defaults.txt) retain the exact calls. Across player skill levels, `speed` has 229 occurrences, range -30..40; `jump` has 122 occurrences, range 1..20. Ordinary player secondary Speed/Jump now have a recovered consumer below. This is not a name-derived rule for dash, teleport, rush, knockback, mounts, or job-specific skills.
- **Morph:** parent `006883cf` loads literal `Morph`; template loader `0068889f` has **speed default 100, clamp 80..140**, **jump default 100, cap 123**, `fs` double default 1, `swim` integer default 100. Original speed values include 70 and 150, so the clamps materially change supplied values. 35 morphs have `fs=10`; speed/jump occur in 36; swim occurs in 35. Before attribute loading, the loader inspects top-level `jump` and `fly` action presence and has a rejection branch when both are absent. Further state/application branches are not fully explained. See [morph loader](ghidra-physics-options/morph-loader.txt), [origin](ghidra-physics-options/morph-origin.txt) and [instructions](ghidra-physics-options/morph-instructions.txt).
- **TamingMob:** parent `007af814` loads literal `TamingMob`, not `Morph`. Template `007afc40` has **speed default 100, clamp 80..190**; jump default 100/cap 123, fs default 1, swim default 100. The different speed upper clamp must not be conflated with Morph. All seven tiny original TamingMob IMG were scanned. [Modifier origins](ghidra-physics-options/modifier-origins.txt) retain the namespace and `006823f0` lower-clamp helper.
- **Mob/Npc/Reactor/Etc:** broad metadata/candidate inventory is retained to expose potential sources, not to claim player movement uses their identically named fields. `006dce02` is retained as a candidate modifier loader with its separately exported parent; it must not be mislabeled as Morph simply because it reads `speed`.

### Ordinary player skill movement consumer

The unique `skill-movement-*` exports in `ghidra-physics-options/` retain fresh Ghidra 12 read-only/no-analysis recovery. The [producer](ghidra-physics-options/skill-movement-producer.txt), [normal-player instructions](ghidra-physics-options/skill-movement-normal-instructions.txt), [other consumer instructions](ghidra-physics-options/skill-movement-instructions.txt), [swimming instructions](ghidra-physics-options/skill-movement-swim-instructions.txt), and [base/refresh wrappers](ghidra-physics-options/skill-movement-attributes.txt) establish:

- `004fe802` initializes mass 100 and ordinary ability multipliers 1. `009b195f` refreshes the actor ability reference through its owner each 30ms update; `009cbeb8` wraps it with fall-speed bookkeeping, not a second Speed/Jump scaling pass.
- `008c457c` returns base secondary Speed plus its effective temporary component (negative temporary Speed overrides the competing positive source; otherwise the larger temporary component wins). `008c45e8` adds base Jump to the larger temporary Jump component. Full equipment/server-stat production is still separate from offline skill composition.
- **Normal player**, `0094d8f1..0094d9be`: Speed is lower-clamped to 80 and upper-clamped to a secure cap, default **140** when the override is zero; Jump is clamped **80..123**. Both multiply the binary double `00af14f0 = 0.01`. These happen to overlap some Morph limits but are independently recovered player instructions, not borrowed Morph policy.
- Speed is written to ability `+0x6c`, copied to `+0x60` (swim speed), then `+0x24` (walk speed); Jump is written to `+0x48`. Ground force `+0x18` remains 1; Haste raises the speed limit, not acceleration or friction. `009b2187` consumes walk speed for foothold limits, including slopes/conveyors. Existing jump paths consume walk/jump values for ground and ladder-detach impulses.
- `009b3176` consumes ability `+0x60` for swimming speed, while swim force remains its independent `+0x54` multiplier. Ordinary-air steering at `009b2cfb` uses the **original global** `walkSpeed / walkForce` ratio, not secondary Speed. Fly uses independent `+0x78/+0x84`, and `009cc627` ladder travel is vertical input times 3 pixels/update, without Haste scaling.

`client/src/physics/skill-movement.js:updateSkillMovement(sim, derived)` consumes cached additive skill `speed`/`jump`, using base 100 and the ordinary default speed cap. It reconstructs effective walk, jump and swim speeds from preserved original globals on every call; passing `null` restores the actor immediately without accumulation. Integration must invoke it before simulation advance using the same cached derived stats that clear on expiry, death and profile replacement. The SkillSystem owns recast/expiry/overlap; this consumer neither invents WZ magnitudes nor mutates map/environment options. Secure cap-override skills, equipment, morph and mounted composition are not claimed by this narrow interface.

Scoped in-memory smoke exercised the actual settings, hook and dynamics functions: Speed+40 reaches 175px/s flat ground and 196px/s swimming; Jump+20 supplies a 666px/s launch scalar; ordinary-air steering was unchanged. Recast did not compound; null restored 125/555/140; extreme additions hit the independently recovered player clamps; map fs=0.2 remained unchanged. An initial exact-equality assertion on 175 exposed normal binary floating-point representation and was rerun with a 1e-9 comparison; no production change was needed. No project suite, build, formatter or browser playtest was run by this worker.

Native acceptance scenarios for integration: Nimble speed+10/+20 affects ground/swim limits but not climbing/air steering; Haste speed+40/jump+20 raises ground and swim speed and jump height; recast refreshes duration without increasing magnitude; expiry/death/profile change restore unbuffed values; swimming ground jumps retain their existing water multiplier; fly and natural steep-slope slip remain independent. Original runtime/reference recordings remain unavailable.

## Extraction interface and preservation policy

`client/tools/physics-data.js` exports `readPhysicsData(map, physics)` and accepts parsed WzNode roots. It returns schema version 1 with globals, map info, every foothold, ladder, portal and area. It does not resolve cross-IMG map links, compose skills/equipment, or simulate movement.

- All original globals/info/geometry property names and scalar types survive. Nested Property/Vector metadata is JSON-safe; UOL or other uninterpreted types retain their type/value and an unsupported reason rather than being followed speculatively.
- Foothold and ladder records retain complete raw `properties`, including geometry and unknown fields. Convenience ladder flags use the original zero defaults; raw omission remains visible in `properties`.
- Portal schema has no `properties` slot, so all original portal properties also survive under `map.$portalProperties`, keyed by original portal ID. This includes scripts, impact values, range/delay/one-shot flags and unknown options.
- Unknown non-art root sections survive under `map.$unrecognized`. Object instances with the discovered force/flow/drop candidates retain full metadata under `map.$objectPhysics`, keyed by `layer/obj/id`. Both carry unsupported reasons. These `$` names are browser interchange containers, not claimed original WZ fields.
- Artwork pixels, ordinary map artwork/actor branches, seat, clock, minimap and tooltip data are handled by their own packager and are not duplicated into physics metadata.
- Malformed geometry and traversal bounds fail explicitly. Named areas are preserved because real original data requires them. No missing source data is replaced with a visually plausible body, mass or motion constant.

## Remaining gaps and provenance

This work exhausts the selected metadata paths in the explicitly listed archives, **not every executable branch**. Unsupported/unexplained behavior includes local swim-area boundary/update timing, complete portal type/script/impulse activation, generic `fieldLimit` bits and map/minigame controllers, object-versus-foothold duplicate option precedence, equipment/skill/morph/mount/temporary-stat composition, server-authoritative movement corrections and packet serialization. Full motion and hitbox fidelity additionally requires the separate evidence and runtime acceptance, and original gameplay recordings remain unavailable. Unknown options stay unknown rather than being labeled unused.

Original SHA-256 provenance (measured from supplied files):

| File | SHA-256 |
|---|---|
| Maplestory_UNPACKED.exe | `1198fa57ca5a7c489bae43ec13c69681d9cabe0f96762f3dc0357facf2e7d4df` |
| Map.wz | `a0657907c42962d5b8a38e007defbcb9ba4f8a61bc32884e9f8c2bc1cb0ebebe` |
| Skill.wz | `c68f7f4667c1493a7c7f2437f28d83192f84f2dc4b010cf2d9d69ad45bbad0f1` |
| Character.wz | `9e873074213bdb660c27cee11c4052233c408f6864249d459931321f0c05ddc5` |
| Morph.wz | `9bf57995efcd331f23e8fd0ff818e00ec159ab1995f8d9bca7ef856e301f6782` |
| TamingMob.wz | `d23604f70c25cabd83e5c30a2ed9390ba1078c0966fd7d76a4adfc03cb2cae0d` |

Ghidra evidence was exported only from the isolated `/tmp/maple-physics-options` copy of the corrected analyzed executable, with `-noanalysis`, Ghidra 12.0.4 and OpenJDK 21/native arm64 decompiler. The retained C text is decompiler output with its warnings, not supplied source. Builds, formatters, linters and test suites were intentionally not run by this worker; Main owns integrated validation.
