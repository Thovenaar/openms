# Original motion refinements

This supersedes the conveyor, drag, drop-target and lowest-ID/transported-distance approximation statements in the initial [motion evidence](physics-evidence.md). It does not assert complete original-client equivalence. Only the supplied original `Maplestory_UNPACKED.exe` and packaged original WZ maps were used. Address-directed Ghidra runs opened `/tmp/maple-physics-motion.gpr` with `-readOnly -noanalysis`; no original executable/project mutations were retained.

## Foothold force and drag

[Loader instructions](ghidra-physics-refinements/loader.txt), together with the original [property loader](ghidra-physics-options/metadata-loaders.txt), prove:

- Constructor `00a45200` initializes foothold attribute `+0c=1`, `+18=1`, `+24=0`.
- Nonzero WZ `drag` writes `+18`; nonzero `force` writes `+24` at `00a44707..49`. Both are multiplied by `00af14f0` (binary64 words `3f847ae1:47ae147b`, **0.01**). Explicit zero preserves the constructor value: drag zero means one, force zero means zero.
- Ground `009b2497..24ee` uses ordinary actor force/friction modifiers only when foothold drag is one and force is zero; otherwise the corresponding actor factors are one. The implemented base avatar already has these modifiers equal to one.
- `009b2744..27db` multiplies foothold drag by map drag before the original friction clamps and below-one half multiplier. Nonzero drag is now consumed rather than blocked.

Let `c = force * 0.01`, `a = abs(trunc(c))`, and `d` be held horizontal direction. `009b2582..2712` gives:

| Input | Force before slope factor | Walk-limit multiplier |
|---|---|---|
| neutral, c nonzero | c × base walk force × map force | a |
| same direction as c | ordinary directional force × 2a | 2a |
| opposite direction to c | ordinary directional force × 0.2/a | 0.2/a |
| c zero | ordinary directional force | 1 |

Swimming scales the ordinary directional force before this branch; neutral conveyor force replaces it and therefore does not inherit that force reduction. The walk limit retains swimming reduction. Slope factors and steep-slip combinations remain in their original order.

This integer magnitude is **not a mistaken decompiler fabs signature**. [Callsite instructions](ghidra-physics-refinements/instructions.txt) show `FLD c; CALL 00a62018; PUSH EAX; CALL 00a61a33; FILD integer; FDIVR [00af1628]`. [Callee instructions](ghidra-physics-refinements/conversion.txt) show `00a62018` sets toward-zero rounding and executes `FISTP qword`, while `00a61a33` reads the integer argument into EAX and conditionally negates it. `00af1628` is exactly 0.2; words are in [helpers](ghidra-physics-refinements/helpers.txt).

For `0 < abs(force) < 100`, opposing input therefore reaches a real zero divisor in this original branch. The browser explicitly faults that unsupported path rather than inventing a denominator or allowing nonfinite coordinates. Missing context is the original runtime x87 exception-mask/exception-handler outcome and whether script/server state prevents entry into this path; ordinary WZ metadata does not establish either. Other directions still follow the recovered formula.

## Contacts and remaining time

[Ground decompilation and callers](ghidra-physics-refinements/helpers.txt), [contact instructions](ghidra-physics-refinements/contact-time.txt), [additional instructions](ghidra-physics-refinements/contact-extra.txt), and the original [collision routine](ghidra-physics-motion/collision.txt) support the implemented cutover:

- Ground endpoint crossing uses the fraction of integrated scalar displacement, interpolates old/new scalar speed at that fraction, and subtracts **truncated integer milliseconds**. Remaining movement coasts with contact speed; it does not run gravity or ground acceleration again. The prior unmodified residual-distance transport was incorrect when velocity changed during the tick.
- `009b3fd1` re-entry at an endpoint follows its neighbor's reverse link when that reverse link points to a different foothold. Walkable alternatives attach at their appropriate endpoint; nonwalkable alternatives stop at the original endpoint.
- Ground-to-air exit records endpoint world position and velocity. The parent integrator invokes one nonrecursive secondary air collision sweep over the already-coasted displacement, equivalent to original `009b19d0`'s `param4=0` call. No gravity or acceleration is added during residual time.
- Airborne contact interpolates pre/post-integration X/Y velocity before tangent projection. Floor landing halves that projected scalar speed when held horizontal direction agrees (zero input also satisfies the original nonnegative product); opposing input zeroes it (`009b34c8`, original lines 326–337).
- First-pass wall handling projects final velocity onto the wall, then advances remaining time using the average of contact tangent velocity and final projected velocity. One secondary sweep follows; a secondary wall contact stops at contact projection rather than producing another residual loop.
- Integer sweep endpoint contacts use the original `009b3f1b` wedge predicate. The two endpoint candidates are retained and equal-time candidate pairs are updated using original cross-product signs, not foothold ID. Projected velocities choose between the two with original ±0.001 thresholds ([negative epsilon words](ghidra-physics-refinements/contact-scalars.txt)). An exact endpoint with no corresponding neighbor is excluded by original `009b3814`/`009b3843`.
- Contact X is truncated, contact Y is reconstructed on the integer sweep, and segment distance uses the original `abs(tangentX)>0.5` axis choice before clamping and reconstructing world contact position.

The browser keeps a bounded maximum of 32 connected transitions as an explicit engineering policy. No contact helper allocates arrays/objects in the tick, and ground/air helpers do not recursively call one another.

### Space-group collision correction

The `200081100` outward-hit failure is an eligibility bug, not an incorrect physical right edge. Original `009b36bc..009b3712` accepts a nonpositive-X-tangent segment when its group equals **either** `CSpace2D+0x40` or actor contact group `VecCtrl+0x134`. The browser previously checked only the actor group, rejecting the field's group-0 walls after a hit detached a nonzero-group platform. [`space-group-instructions.txt`](ghidra-physics-refinements/space-group-instructions.txt) retains both comparisons. The actor-kind-7 exception after both comparisons fail is not the ordinary local-player branch and is not implemented by admitting all walls.

The field group is now recovered, not a provisional `0`: `00a447eb..00a448ad` builds a per-group pair of minimum/maximum authored foothold X. Unpopulated entries begin at `INT_MAX, INT_MIN`; `00a44c7c..00a44ca5` initializes `+0x40` to zero, then selects the first pair with `maxX >= minX`. For a nonempty validated static field, this is exactly the **minimum populated foothold group**, independent of layer and input ordering; a vertical-only group is populated too. [`space-group.txt`](ghidra-physics-refinements/space-group.txt) retains range initialization, endpoint updates, the foothold constructor's `+0x20` group assignment and global references. No sparse array indexed by an unbounded group ID is allocated in the browser.

`geometry.spaceGroup` records that load-time selection; `simulation.spaceGroup` is explicitly initialized, restored on same-field relocation, and included in inspection snapshots. Ground attachment, detachment and ladder capture change or preserve **actor** contact group according to their own native paths, never replace the field group with the actor's. New fields derive their own selection. [`space-lifecycle.txt`](ghidra-physics-refinements/space-lifecycle.txt) also retains `00a43433` publishing the `CSpace2D` singleton, `00a43dc2` clearing it at destruction, and `009b1719`'s actor-contact updates.

The supplied executable's SHA-256 was independently recomputed as `1198fa57ca5a7c489bae43ec13c69681d9cabe0f96762f3dc0357facf2e7d4df`; the first new Ghidra extraction checked `currentProgram.getExecutableSHA256()` against it before reading `/tmp/maple-physics-options`. All new extraction used Ghidra 12.0.4, `-readOnly -noanalysis`; no Windows runtime or third-party client was used. The authorized Cosmic emulator's server map rectangle is not the original client's physical-domain authority.

The ordinary loader policy is resolved. Runtime changes to the active space group through exceptional field/script/object state have not been exhaustively reconstructed; this implementation claims only the recovered static-field selection, not a complete audit of all possible indirect writers. Forced targets, special actor kind 7 and moving-object rules still require their genuine dynamic state.

## Drop eligibility is not a selected landing target

The earlier nearest-strictly-lower-floor and target-only collision policy was wrong. [Original input instructions](ghidra-physics-refinements/drop-instructions.txt), [queries](ghidra-physics-refinements/drop-queries.txt), and [drop setter](ghidra-physics-refinements/drop-selection.txt) prove:

1. A standing foothold is required and its original `forbidFallDown` is checked.
2. Query `00a4549d` selects the greatest floor Y no greater than integer feet Y + **300**, under integer feet X.
3. If absent or equal to the current foothold, query `00a45585` selects the least floor Y at least feet Y + **300** and strictly less than feet Y + **600**.
4. A result strictly between feet Y − **5** and feet Y + **5** is rejected. Query slope interpolation uses signed integer division (truncation toward zero), not floor division.
5. The candidate only gates eligibility. `0094c703` stores the **current/source foothold**, not the queried candidate. `0094e692` transfers it to pending VecCtrl `+174`; `009b1c51` transfers that to ignored-source `+118`. Collision `009b34c8` rejects a selected contact equal to this source after arbitration; it does not restrict all collisions to the queried candidate.

The simulation now exposes `ignoredFootholdId`, with no compatibility alias for the misleading former `dropTargetId`. The obsolete unsupported-drop-selection diagnostic is removed. Grounded drop uses `009b44c3`, exactly like ordinary detachment: `00a634a7(y-1)` is downward rounding, therefore **Math.floor(y-1)** remains correct for negative world Y too. This is distinct from the integer query's slope-division truncation.

The input wrapper also gates actor locks, special input modes, certain portal types and field/actor state outside the base-avatar contract. Their dynamic predicates must not be inferred from foothold geometry alone.

## World bounds and initial attachment

`CSpace2D` computes physical bounds from all foothold endpoint extrema: left `minX+30`, right `maxX−30`, top `minY−300`, bottom `maxY+10`. With `VRLimit`, nonzero view edges further restrict the rectangle: `VRLeft+20`, `VRRight−20`, `VRTop+65`, and `VRBottom`. Zero view-edge values leave the corresponding derived edge alone. Evidence: [`world-bounds-loader.txt`](ghidra-physics-refinements/world-bounds-loader.txt), [`boundary-init.txt`](ghidra-physics-refinements/boundary-init.txt), and [`clipping-instructions.txt`](ghidra-physics-refinements/clipping-instructions.txt).

`009b45c1` clips airborne X and top Y, zeroes the relevant velocity, and returns clipped time. It does not create a bottom floor. `009b47aa` clamps ground travel through the foothold tangent. `009b12a8` clamps initial coordinates to all four edges. Implementation: [`bounds.js`](../client/src/physics/bounds.js); decompilation: [`boundaries.txt`](ghidra-physics-refinements/boundaries.txt).

Portal entry passes `portal.y−10`, zero velocity and no foothold to the original initializer; see [`spawn-instructions.txt`](ghidra-physics-refinements/spawn-instructions.txt). The runtime no longer invents a standing contact when a spawn coincides with a floor. Controlled standing test fixtures explicitly attach their synthetic foothold.

For `Map.wz:Map/Map2/200081100.img`, [retained original geometry](ghidra-physics-refinements/200081100-collision.json) has endpoint extrema `(-410,320,-1920,120)` and therefore physical domain **left −380, right 290, top −2220, bottom 130**. Authored render/VR bounds are `(-445,355,-1920,120)` with no `VRLimit`. Platform 153 has group 2 at Y −278 and spans X −310..220; its linked left wall 33 and right wall 140 are group 0. Outward airborne hits must meet those geometry walls, not travel through the gap to physical X 290 or −380. This correction neither substitutes render bounds nor manufactures support at bottom 130.

The boundary review covers minimum/maximum X and Y across initialization, air, ground and relocation: original `009b12a8` clamps all four initial coordinates; `009b45c1` clamps X and minimum Y during airborne motion, with zeroed affected velocity and truncated consumed milliseconds; `009b47aa` clamps grounded X by projecting onto the current foothold tangent. Neither airborne nor ground clipping treats maximum Y as a floor. These recovered formulas and clipping code remain unchanged.

The debug overlay consumes the actual `simulation.bounds`: orange X/top edges are the physical clip domain, its faded dashed bottom is **initialization only**, blue is authored render bounds, purple is authored VR, and green is authored foothold/wall geometry. Its throttled readout prints all exact edges, raw `VRLimit`/VR properties, actor contact plane/group and field space group. Geometry is built on field/simulation replacement; no per-frame text or geometry rebuilding is added.

`client/test/physics-contacts.test.js` now passes the original tower right/left outward-hit and platform-reattachment cases, actor-group versus unrelated-group admission, nonzero minimum space group/relocation, ground-to-air continuation, cross-group landing, domain limits and sloped-left-edge/inward detachment. Native contact sweeps and rendered positions truncate to integer pixels: subpixel coasting against a wall is not a visible escape and is not “fixed” by inventing a new float clamp. The original ±200/−200 tower traces return to platform153 on both sides without crossing the integer wall X. This is executed reconstruction evidence, not an original Windows trajectory comparison.

## Contact-dependent actor drawing order

`0092fd16` computes ordinary local-user depth as `B + 29997 + (plane*3000−group)*10`, with an additional `5` for the separate dynamic-object branch. `009b4929` updates the contact plane/group from footholds or a ladder's page; entry without a contact uses plane 7/group 0. Evidence: [`actor-depth.txt`](ghidra-physics-refinements/actor-depth.txt), [`depth-factors.txt`](ghidra-physics-refinements/depth-factors.txt), [`drawing-contact-state.txt`](ghidra-physics-refinements/drawing-contact-state.txt), and the disassembly above. The browser removes the shared base `B` and reorders only the actor when that contact-derived key changes. The unimplemented dynamic-object branch is not approximated.

This replaces the constant actor depth that the independent slope, conveyor and ice scenarios exposed as hiding the avatar behind map artwork. Their original failure artifacts remain available rather than being overwritten.

## Executed proof and remaining checklist

No formatter, linter, build or test suite was run by this worker. Direct calls to the actual motion API used the packaged original maps (not another client or fabricated map geometry):

- [Conveyor/drop output](ghidra-physics-refinements/smoke.json): original `108000500` foothold 45 (`force=-180`) produces first-tick scalar speeds −84 with left input, −75.6 neutral and +8.4 with right input. Original slope `103040000` foothold 2 (`force=-100`) executes the corresponding signed slope branches with no fault.
- [Connected endpoint output](ghidra-physics-refinements/endpoint-smoke.json): original Henesys foothold 3→11 starts one pixel before the endpoint at speed100. The changed endpoint interpolation produces speed107.4074074074074 and 2.362962962962963 pixels along foothold11 after one tick.
- Henesys down-jump at `(3800,124)` ignores source foothold32, starts at Y118.0133360565 / VY−136.22213145 after one tick, and lands on foothold101 at Y454; the same final result was rerun after contact arbitration and velocity interpolation changed.
- [Airborne wall output](ghidra-physics-refinements/wall-smoke.json): original wall300 at X611, an airborne start `(600,-90)`, VX500/VY100 and right input reaches `(611,-85)` with VX0/VY160 and no fault after the two-pass wall path.

Unresolved, without claiming unavailable context is recoverable from static metadata:

- Original integer rational cross-products/division and x87 intermediates versus browser binary64 can differ at numerical boundaries and coincident/equal-query-height ordering; original spatial-index insertion order is not reconstructed.
- Exceptional group/object rules still require their full dynamic state. Ordinary field load-time space-group selection is recovered above, but special actor kind, runtime active-group changes, moving-object attachment and forced landing targets are not inferred from static geometry.
- Runtime exception behavior for opposing sub-unit conveyors, as described above.
- Complete equipment/skill/mount/action-lock, portal impulse and script/server entry state are outside this base-avatar reconstruction.
- No original gameplay trajectory recording is available. Main owns integrated static validation and real browser keyboard acceptance; the retained scenarios prove exercised implementation paths, not frame-for-frame original-game equivalence.
