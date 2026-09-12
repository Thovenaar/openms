# Original client and rendering evidence

## Scope and provenance

This is an investigation of the supplied original `Maplestory_UNPACKED.exe`, `Gr2D_DX8.dll`, and the renderer's supplied `Shape2D.dll` dependency. **Decompiled C is evidence reconstructed from machine code, not recovered original source.** No third-party client, WZ implementation, or reconstructed game source was consulted. No Windows executable was run.

Ghidra 12.0.4 headless actually imported/analyzed the binaries with `x86:LE:32:default:windows`; Java 21.0.10 satisfies its Java 21 minimum. Separate projects were `/tmp/maple-client-exe3`, `/tmp/maple-client-render3`, and `/tmp/maple-client-shape`. Initial attempts stalled in the bundled Rosetta decompiler. Analysis succeeded after the main investigator built Ghidra's own native ARM64 decompiler. Logs and address-bearing output are under `ghidra-client/`; reusable Ghidra Java scripts are `tools/client*.java`.

The unpacked executable SHA-256 is `1198fa57ca5a7c489bae43ec13c69681d9cabe0f96762f3dc0357facf2e7d4df`; Gr2D SHA-256 is `ab1c942229af33da04d913ed1157ab322bff0812f7368bcf745d64b98698d34d`. Full metadata is `ghidra-client/input-metadata.json`.

**Verified game version: 83.** Client functions `0x009876f7` and `0x009f9893` pass `0x53` to diagnostic `ver(%d)`/`ver.%d` strings. Resource initialization `0x009f7159` also passes `0x53` during mounting. PE VERSIONINFO is merely `1.0.0.1`, not the patch version.

**Reference availability:** The supplied tree contained no original gameplay screenshot, video, runtime capture, or original source tree. HShield splash/update JPGs are not gameplay references. Static analysis and a newly written renderer cannot establish original visual parity without an original-client reference capture.

## Reading the evidence

- `Maplestory_UNPACKED.exe.txt`: initial string xrefs, resource initialization and version diagnostics.
- `decoded-strings.txt`: 5,658 original string-pool entries, original encoded addresses, IDs, and selected PUSH-immediate consumers. `ID_XREF` is a candidate numeric-ID use, not a typed symbol reference; the function decompilation establishes actual use.
- `string-functions-fixed/`: recovered string pool algorithm; `repair-inspection.txt` and `repair-applied.txt` explain the analysis correction.
- `map-functions/<address>.c.txt`, `avatar-functions/`, `avatar-anchors/`: bounded client consumers.
- `render-functions/<address>.c.txt`, `vector-functions/`: original DLL routines with caller/data references.
- `frame-alpha.txt`, `map-depth-disassembly.txt`, `vector-vtable.txt`: focused evidence.

Ghidra initially misclassified allocator `0x00403065` as non-returning and failed to model the shared exception prologue `0x00a60b98`. The allocator contains a real return, and the prologue instructions exactly match Ghidra's `EH_prolog` injection. `clientRepair.java` clears that incorrect no-return metadata, restores call flow, applies the injection, and repairs selected function bodies; it does not patch executable bytes. Pre-repair exports are retained as such. Other imperfect calling-convention/type recovery remains visible as stack temporaries, pointer-scaled integers, and unreachable-block warnings; use arithmetic plus instruction output, not inferred C types, as authoritative.

## Resource mounting and paths

Verified at client `0x009f7159`: create `ResMan`, `NameSpace`, `NameSpace#FileSystem`, and package objects through PCOM; mount `Base.wz`, then iterate 15 domain names and form `%s.wz`. Gr2D `0x50401ca2` imports PCOM functions including `PcCreateObject`, `PcSerializeObject`, `PcSerializeString`, and `PcRootNameSpace`. `0x50402ced` loads `D3D8.DLL`, invokes `Direct3DCreate8(0xdc)`, and creates three `Shape2D#Vector2D` objects.

Recovered original strings and consumers:

| Resource        | Original string / semantics                                                                                                          | Evidence                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| map             | `Map/Map/Map%d/%09d.img`                                                                                                             | ID 2498, encoded address `0x00b259c4`; consumers `0x0052950e`, `0x005cf792` |
| tile            | `Map/Tile/`, `tS`, `u`, `no`, `zM`                                                                                                   | IDs 1489–1493; `0x0063a100`, `0x0063a5c4`                                   |
| object          | `Map/Obj/%s.img/%s/%s/%s`, `oS`, `l0`, `l1`, `l2`                                                                                    | IDs 1495–1499; `0x0063ad16`                                                 |
| background      | `Map/Back/`, `bS`, `no`, `ani`                                                                                                       | IDs 1507–1513; `0x0063cd4e`                                                 |
| body/head       | `Character/%08d.img`                                                                                                                 | ID 2327                                                                     |
| equipment       | `Character/{Face,Hair,Cap,Accessory,Coat,Longcoat,Pants,Shoes,Glove,Shield,Cape,Ring,PetEquip,Weapon,TamingMob,Sub,Dragon}/%08d.img` | IDs 2328–2344; `0x005c94a1`                                                 |
| avatar ordering | `smap.img`, `zmap.img`                                                                                                               | IDs 948, 949; startup `0x004010bd`, `0x00401086`                            |
| frame placement | `origin`, `map`, `brow`, `navel`                                                                                                     | IDs 959, 950, 1074, 1075; `0x00407a36`, startup globals and `0x004016a5`    |

The string-pool recovery itself is independently reproducible: `0x0079e993` reads table `0x00bdc9d4`, takes the first signed byte as a rotation amount and the following NUL-terminated bytes as payload. `0x0079ebf3` rotates the key bitstream; `0x0079e7e8` repeats it by index modulo key length; `0x0079ecde` XORs each payload byte, preserving the key byte if XOR would produce NUL. Key and length are at `0x00b001ec`/`0x00b001fc`, count at `0x00b00200`. This is the client's string-obfuscation algorithm, **not** the WZ archive encryption algorithm.

## Map draw ordering

Let `B = -0x40000000`; increasing depth is the intended layer ordering. The browser subtracts `B` from every root world depth. Renderer ties are **not world Y sorting**: `50403a4b` compares the first distinct overlay ancestors' signed depth, then their renderer serial (`virtual +0x0c(1)`). `5040399b` assigns the serial on insertion; `50409efd` assigns a new serial on depth mutation. Nested overlays stay with their ancestor group. Fresh read-only exports are `ghidra-client/depth-renderer*.txt`; `depth-renderer-ties.txt` resolves the accessors. The browser uses authored extraction order as the static initial serial (native initial map creation order remains unproved), and monotonic serials for dynamic insertion/depth changes. Stream reload preserves the authored static tie seed instead of making network completion order visible.

| Entity                       | Original depth expression                                                                                       | Evidence                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| tile                         | `B + 19990 + layer*30000 - tile.zM*10 + tileCanvas.z`                                                           | `0x0063a5c4`, expression `iVar5 - 0x3fffb1ea + (param_1*3000-iVar4)*10`                                |
| object                       | `B + 2000 + layer*30000 + obj.z`                                                                                | `0x0063c212`; assembly `0x0063c27b IMUL ... 0x7530`, `0x0063c289 LEA ... +0xc00007d0`                  |
| back (`front=0`)             | `B - 128000 + index*1000`                                                                                       | `0x0063cd4e`                                                                                           |
| front (`front!=0`)           | `B + 272000 + index*1000`                                                                                       | `0x0063cd4e`                                                                                           |
| ordinary mob                 | `B + 29991 + (layer*3000-group)*10`                                                                             | `00664e35`, `depth-actors.txt`, `depth-actor-instructions.txt`                                         |
| NPC                          | `B + 29995 + (layer*3000-group)*10`                                                                             | `006d267d`                                                                                             |
| local player                 | `B + 29992 + (activeController?5:0) + (layer*3000-group)*10`                                                    | `0092fd16`; local active controller selects `29997`                                                    |
| drop                         | `B + 29999 + (layer*3000-group)*10`                                                                             | `00505900`, instruction `00505f82`                                                                     |
| combat number, miss, LevelUp | `B + 398500` (`0xc00614a4`)                                                                                     | `0043849c`, `0043dee8`, `0093780b`; `depth-label-instructions.txt` and `depth-effect-instructions.txt` |
| ordinary name/function       | relative overlay `z=2`, **parented to the actor's layer**, separately attached to its unflipped position vector | `005f1775`, `005f17bb`, `005f1805`; NPC passes artwork `+0xe4` in `006d5e6c`                           |

Do not mistake vector `+0x18` for a foothold pointer: `009b12a8` writes its first activation argument there; the foothold is `+0x110`. Jumping does not remove the active local user's five-depth increment. Last contact layer/group survive ordinary flight; an initially uncontacted vector uses layer7/group0. Mob `00664e35` also contains controller-mode3 (`B+270100`) and explicit Zakum/Horntail/Pink Bean template overrides. These special controller/boss depth paths are retained as evidence, **not generalized ordinary-mob behavior**; their complete runtime controllers remain unavailable.

The scene's `setEntityDepth` now maintains both the entity and actual flattened display ordering without rebuilding display objects or sorting every frame. `addWorldContainer/removeWorldContainer` retain independent native root layers through region refresh; only diagnostic geometry/hit targets use the always-front inspection overlay. Every damage/miss event has its own pooled root layer, so a later hit correctly sorts after an equal-depth LevelUp effect rather than being trapped inside a permanent number-group container. LevelUp follows the actor's original unflipped position vector (`004ad42b`); other explicit effect previews use the same world-effect plane as a documented preview policy, not a recovered automatic MapEff depth. Player/NPC/mob labels belong to actor groups, counter-mirror their position vector, and no longer pierce higher map/front artwork. Avatar RGB modulation affects artwork sprites rather than incorrectly tinting those independent name layers.

`docs/tools/clientDepthRefs.java` was built and executed against the original executable to inventory all instructions with operands in `0xc0007500..0xc0007600`; `depth-operands.txt` led directly to ordinary mob and drop consumers. It bounds instruction visits at ten million and does not patch original bytes.

Do not sort tile placement `zM` as if it were an ordinary ascending object `z`: it enters with a negative multiplier. Do not discard the tile canvas's `z`.

## Camera and backgrounds

### Camera bounds — verified

`0x00641ef1` establishes an original 800×600 center-based viewport:

- horizontal center bounds: `VRLeft + 400`, `VRRight - 400`;
- vertical center bounds: `VRTop + 300`, `VRBottom - 300`;
- if either upper bound is less than or equal to its lower bound, replace both with their signed-integer midpoint.

Missing VR properties have fallbacks derived from field geometry: left geometry minus 20, top minus 60, right plus 20, bottom plus 100, followed by the viewport-half adjustment. The geometry-global interpretation is inferred from its use, not a recovered original symbol. Camera acceleration/follow smoothing and all transitions were not fully reconstructed.

### Parallax — verified displacement contract

Client `0x0063cd4e` first attaches the background vector to the renderer's camera-origin vector (slot `+0x64`), sets local `x,y`, then calls vector slot `+0x98` with source=camera, denominators `100,100`, numerators `rx,ry` for ordinary types 0–3.

Shape2D vtable `0x5140c0fc + 0x98` points to `0x5140847d`. It snapshots source X/Y, stores ratios, and installs the evaluator `0x514085b3`:

```
localX += trunc((sourceX_now - sourceX_at_attachment) * rx / 100)
localY += trunc((sourceY_now - sourceY_at_attachment) * ry / 100)
```

The parent camera origin contributes another full camera displacement. Total movement is therefore `1 + rx/100` and `1 + ry/100`, with the additional ratio term truncated toward zero. `rx=-100` cancels horizontal camera movement; `rx=0` behaves as ordinary world placement. The exact absolute origin at original-client startup was not traced; preserve the attachment baseline rather than silently asserting an absolute screenshot alignment.

### Repeat and auto-scroll — verified

`0x0063e2c5` uses bit 0 for X repetition and bit 1 for Y repetition. `0x0063cd4e` maps:

| type | repeat | auto movement |
| ---- | ------ | ------------- |
| 0    | none   | none          |
| 1    | X      | none          |
| 2    | Y      | none          |
| 3    | X,Y    | none          |
| 4    | X      | X             |
| 5    | Y      | Y             |
| 6    | X,Y    | X             |
| 7    | X,Y    | Y             |

Explicit `cx,cy` control period. With zero period and ordinary non-special backgrounds, the fallback is the canvas dimension plus `1 - (1 << canvasScale)`; this equals the canvas dimension for scale zero. A separate resize/special branch uses field-geometry width/height. The exact tiling seam/boundary convention for nonzero canvas scale was not visually validated.

Auto-X types 4/6 clear the origin parent, then attach camera ratios `(0, ry+100)`; total camera movement is zero in X and `1+ry/100` in Y. Auto-Y types 5/7 use `(rx+100,0)`. The scrolling axis's `rx` or `ry` is a speed, not also a parallax ratio. The client sets an initial offset of minus 100 for positive speed, then schedules movement to the base coordinate after `trunc(20000/abs(speed))` milliseconds. Thus positive speed moves in the positive coordinate direction; the nominal rate is `speed/200` pixels per millisecond, with original integer-duration quantization. Zero-speed handling and unusual out-of-range properties should not be extrapolated from this branch without further tracing.

### Same-map teleport delivery boundary

Retained `vector-functions/51408d23.c.txt` commits DOUBLE camera history and signed renderer time only when requested; `51408e33` supplies its distance/time residual. A same-map target discontinuity is not evidence for resetting that history. The browser keeps these evaluators unchanged. `origin-layer-probe.json` independently records Henesys `Map.wz:Back/grassySoil.img/back/0`:256×256, origin(128,128), type3, rx/ry/cx/cy0; client `0063e2c5` supplies both-axis repetition. Its prepared sprite pool is viewport-bounded and the packaged background is always resident.

The browser-specific failure boundary was relocation publication before intermediate/destination spatial regions were ready: a6178-pixel `hp01 -> hp01_1` target change can outrun200-ms demand. Staging and pinning the swept camera viewport before publication repairs that delivery boundary while preserving the original smooth filter, integer repetition, and zero same-map fade. This does not establish that always-background eviction caused the reported fully blank frame. The settled `same-map-teleport` scenario passed with real Up in serial and isolated-context parallel runs; [consecutive-frame observations](native-ui-validation/reported-fixes/native-report.json) and [reviewed intermediate artwork](native-ui-validation/reported-fixes/teleport-frame-60.png) establish retained artwork and smooth, unfaded browser travel. They are not an original Windows reference capture.

## Frames, alpha, placement, and pixels

<a id="timed-frame-alpha--verified"></a>

### Timed frame alpha — verified

Client `0x0043f768` reads frame `delay` with default **120 ms**, `a0` with default **-1**, `a1` with default **-1**, and passes them to the layer's canvas insertion helper. Gr2D `0x5040abef` stores delay at frame-record `+0x0c`, a0 at `+0x10`, and a1 at `+0x14`. `0x5040b9e7` accumulates `frameDelay * animationScale / 1000` into end timestamps; initial a0 is applied immediately when nonnegative and a1 is scheduled for the frame end when nonnegative. `-1` means omit that assignment, not forcibly reset to 255.

The expanded extraction encountered original `Reactor.wz:2302002.img/0/hit/3` with explicit delay0. This is not malformed: `5040abef` stores the supplied integer unchanged; `5040b9e7` adds zero to the accumulated timestamp; [`5040da7c`](ghidra-client/render-functions/5040da7c.c.txt#L28) consumes events whose end timestamp equals the current time. The extractor preserves that zero rather than inventing a minimum duration. Browser frame selection uses a bounded upper-bound search, including at action entry, and applies a terminal zero-duration alpha endpoint immediately. Negative delay remains rejected in this layer path. Wholly zero-duration looping clips have no positive period; the browser's finite last-frame hold is a stated policy, not a claim about original looping behavior. The retained animation regression exercises leading, intermediate and terminal zero boundaries, one-shot completion, looping and seeking.

The vector call is slot `+0x90`: Shape2D `0x5140828f` → `0x51407fe1` → `0x5140806d` → evaluator `0x5140809f`. Its transition is integer-linear:

```
a = aStart + trunc((aEnd-aStart)*(now-start)/(end-start))
```

Before/start time it leaves the starting value; at/after end it commits the full delta. The asset investigator additionally preserves this chain's assembly in `ghidra-assets/Shape2D.dll/interpolation.txt`. A frame containing `a0=0,a1=255` is not a constant-transparent frame. Layer alpha and texture alpha both matter.

### Placement and avatar limits

The client consumes each action frame's `delay`, canvases' `origin`, and named `map` anchors rather than treating character parts as images centered on a common bounding box. `0x004016a5` enumerates the canvas `map` property into per-part anchor data. `0x00407a36` explicitly loads `origin`, `map`, and `brow` for face-related alignment. Original action strings include `walk1`, `walk2`, `stand1`, `stand2`, `jump`, `ladder`, and `rope`; their existence is verified by the decoded pool, but this does not prove every equipment item contains every action.

Gr2D `0x5040b26c` adjusts a layer's geometry when its canvas changes, preserving placement relative to old/new canvas origins; `0x5040d98b` implements integral affine placement and optional horizontal reflection `x = 2*pivot - x`. This is evidence against bounding-box centering. The complete avatar anchor graph resolution, action remapping, equipment hiding via smap, zmap tie behavior, weapon-specific transitions, and original actor/foothold z relationship were not completely reconstructed in this scoped pass. Any independently written anchor-graph assembler must label its untraced rules as inference rather than claim exact original composition parity.

Subsequent address-directed work recovered the standard fixed-loadout anchor forest, disconnected components, centroid merge and death composition in [avatar-actions.md](avatar-actions.md); arbitrary equipment arbitration remains qualified. The browser now projects each complete world composition and camera vector to signed integer pixels before GPU submission. This is an explicit interpolation/viewport policy consistent with integral placement, not a claim that original camera smoothing was recovered. Per-vertex GPU rounding was rejected because half-pixel ties distorted individual parts. The final [world oracle](offline-validation/performance/summary.json) has zero pixels outside its unchanged tolerance across seven captures, including moving mobs.

### NPC ground alignment and reusable origin inspection

`bun tools/openms.js audit origins SOURCE MAP_ID[,MAP_ID...] OUTPUT.json` reads the original WZ archives through the production parser/decoder, with bounded maps, placements, footholds and frames. It reports every stand-frame origin, canvas extent and bottommost nontransparent pixel relative to that origin; exact authored `x/y/cy/fh`, finite foothold geometry and placement-to-ground gap; and background origin, front/depth, camera ratios, repeat periods and original source paths. It writes evidence JSON, not replacement assets, and never recenters artwork using its opaque bounds.

An actual run over `100000000,100000001,103000000,108000500,230000000` produced `ghidra-client/origin-layer-probe.json`: **69 NPC placements and51 backgrounds**. Sixty-seven placements were more than one pixel above their authored foothold when drawn literally at map-editor `y`. Representative anchors:

| Map/entity                | authored anchor | authored `cy` / finite ground | first stand opaque bottom relative to origin |
| ------------------------- | --------------- | ----------------------------- | -------------------------------------------- |
| `100000000/1012000`       | `(149,267)`     | `274 / 274`                   | `0`                                          |
| `100000001/1012101` Maya  | `(-17,36)`      | `38 / 38`                     | `0`; origin `(23,77)`                        |
| `103000000/2042002`       | `(-1390,303)`   | `308 / 307.6771653543307`     | `0`                                          |
| `108000500/1072008` Kyrin | `(-227,137)`    | `150 / 150`                   | `2`                                          |
| `230000000/9250023`       | `(-362,85)`     | `100 / 100`                   | `-42`, deliberately floating artwork         |

Native `006d089a` reads packet position, direction and foothold, creates its NPC vector, then initializes through `009c1d70 -> 009b12a8 -> 009b1553`. The latter resolves contact distance from the foothold tangent and clamps to `[0,length]`; the usual finite floor has `x=clamp(authoredX,x1,x2)` and `y=y1+(x-x1)*(y2-y1)/(x2-x1)`. The offline extractor now resolves that authored floor before integer world placement; it retains raw map `y/cy`, never substitutes an arbitrary pixel offset, and leaves wall/missing-contact cases authored. This is initialization on the supplied authored contact, not a claim to reconstruct network NPC activation or movement. The camera attachment baseline for backgrounds, special canvas scaling and deliberate canvas-origin floating remain separate questions: no compensating background shift was invented.

Native/browser overlap scenarios for integration: Henesys1012000 and Maya should touch their original floors; Kyrin retains the original two-pixel canvas overhang; Aqua9250023 retains its authored floating stand art. Walk/jump behind higher objects/fronts with the player and its name together; move ordinary mobs across connected foothold groups; settle/pick up a drop against tile edges; cross equal-depth dynamic entities and refresh regions without art reordering. Numerical production-scene smoke exercised dynamic equal-depth insertion/mutation (`npc,mob,front` then `mob,npc,front`), root damage numbers above ordinary fronts, and extracted smile expression expiry to default. This worker ran no project extraction/build/lint/tests and makes no new integrated visual-parity claim; Main owns browser acceptance.

Expression rendering now accepts the packaged original families rather than only `default/hit`. Timed face parts retain `expressionStart`, `expressionEnd`, `expressionLoopMs` and root `expressionDuration`; the manifest boundary validates the shared native family table and complete integer intervals. `EntityAnimation` compiles per-family periods/durations once and advances a separate expression clock even while the body frame is held/completed. Main owns the original face extraction, cash-item ownership and activation/cooldown. A second actual-Pixi numerical smoke kept body frame0 fixed and exercised a120/120-ms face cycle: frame0 at0/119ms, frame1 at120ms, frame0 again at240ms, then default exactly at the supplied500-ms expiry. This is frame-clock proof, not native cash-emotion UI acceptance.

A production-scene ownership smoke registered numberA, LevelUp, then reused numberA at equal z398500: draw order was`LevelUp,numberA`, remained identical after region refresh, and removing numberA retained LevelUp. Scene teardown detached rather than destroyed the externally owned effect container. Native-browser alpha overlap and the new pooled-number rendering still require Main's integrated playtest.

A direct original`Character.wz:Face/00020000.img` metadata-to-production-animation probe also compiled `vomit` duration5000/period240 and `oops` duration1640/period150. It used actual original frame delays/root duration with ordinary Texture.WHITE stand-ins solely to exercise timing compilation; it did not claim face pixel rendering or run release extraction.

### Texture formats and blend state — verified

- `0x50404869` maps WZ canvas format `1026` (`0x402`) to Direct3D FOURCC **`0x33545844` = DXT3**. `0x50404cbb` exposes the reverse mapping. This is original-module evidence, not a guessed association with DXT5.
- The same function handles formats 1, 2, 513 with device-capability-dependent conversion targets. Archive-format decoding is documented separately by the asset investigator.
- `0x50408c31` sets Direct3D8 alpha blending enabled, depth buffering disabled, alpha test disabled, and texture/address states.
- `0x5040da7c` selects default `SRCALPHA / INVSRCALPHA`, mode 1 `SRCALPHA / ONE`, and mode 2 `INVDESTCOLOR / ZERO`.
- That draw routine selects point filtering when source/destination extents agree and the transform branch permits it; otherwise it uses linear filtering, unless a layer explicitly specifies a filter. The exact transform-condition meaning remains partially inferred. A universal linear-filter setting does not reproduce all original sprite states.

## Verification and limits

Actual Ghidra analysis logs report import/analysis/save success. The native renderer corpus export produced 644 functions; the bounded map and avatar exports produced 38 and 16 functions respectively. The original string-pool recovery produced 5,658 meaningful strings and 120 selected categories. Address-directed disassembly confirms the object z formula independently of Ghidra's pointer-scaled C presentation. No game build, linter, project-wide tests, or Windows runtime were executed for this investigation.

These observations establish concrete data/render contracts for an independently written implementation. They do not establish gameplay completeness, original network behavior, pixel-perfect parity, or an executable-to-original-source recovery.
