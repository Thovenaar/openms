# Original-client motion reconstruction

## Provenance and scope

The implementation in `client/src/physics/` was reconstructed from the supplied `Maplestory_UNPACKED.exe` and original WZ archives, not another client implementation. Analysis used the independent `/tmp/maple-physics-motion` Ghidra project, the corrected original analysis database, and address-directed decompilation plus instruction recovery. No original C/C++ or reference gameplay recording was supplied. Consequently the evidence proves particular formulas and branches, **not complete frame-for-frame original-game equivalence**.

The original global `Map.wz:Physics.img` was independently opened with the local WZ decoder. Its 19 values are retained in [wz-globals.json](ghidra-physics-motion/wz-globals.json). The binary loader is `00a43433`: `walkForce` is stored at global physics structure offset `00`, `walkSpeed` at `08`, and the remaining fields occupy successive eight-byte slots. [Global loader](ghidra-physics-motion/globals/00a43433.c.txt) and the inventory owner's [option inventory](physics-options.md) retain the property-name mapping. The physical state uses original feet coordinates, not sprite rectangles.

## Recovered cadence and numeric order

The fixed movement quantum is **30 milliseconds**, not a browser tuning parameter:

1. `009b1928` calls virtual slot `+24`, then passes its result to virtual `+28`.
2. The local-user `+24` method is `009cbeb8`, which calls `009b195f` and returns its result.
3. `009b195f` copies the prior motion state, refreshes map/actor attributes and returns `0x1e`.
4. Local-user `+28` is `009cbefb`; its input consumer calls `009b19d0` with that duration.
5. The secondary update `009b16e8` also explicitly supplies `0x1e`.

See [fixed-cadence.txt](ghidra-physics-motion/fixed-cadence.txt), [fixed-dispatch.txt](ghidra-physics-motion/fixed-dispatch.txt), [player vtable](ghidra-physics-motion/swimming.txt), and [local-user wrapper](ghidra-physics-motion/rounding-control.txt).

`009b19d0` handles pending motion transitions before integrating. Ground and airborne integrators both update velocity first, then position using the **trapezoidal rule**:

```
dt = elapsedMilliseconds * 0.001
pNew = pOld + (vOld + vNew) * dt * 0.5
```

The binary doubles are `00af0e10 = 0.001`, `00af0d48 = 0.5`, `00af0de0 = 1`, and `00af0de8 = 0`; exact words are in [helpers.txt](ghidra-physics-motion/helpers.txt). Ground formula exits are `009b2b69..009b2bc6`; airborne exits are `009b3421..009b34c7`. Evidence: [ground integrator](ghidra-physics-motion/globals/009b23f2.c.txt), [air/float integrator](ghidra-physics-motion/globals/009b2c3c.c.txt), [update order](ghidra-physics-motion/integrator-callers/009b19d0.c.txt).

Coordinates/velocities are held as encoded doubles in the original, decoded by `00539338` and written by `005393b6`. **Do not truncate every integration result.** Original collision candidate coordinates are truncated through `__ftol` at `009b34c8`; the browser does `Math.trunc` for that swept-point predicate. Jump detachment uses `00a634a7(y-1)`: this invokes rounding with control word `00be3d70 = 0x173f`, i.e. downward rounding, implemented as `Math.floor(y-1)`. [Rounding decompilation](ghidra-physics-motion/rounding.txt), [control word](ghidra-physics-motion/rounding-control.txt), [detachment](ghidra-physics-motion/transforms.txt).

JavaScript binary64 replaces original x87 intermediate precision. Recovered contact-time integer truncation and secondary sweeps are implemented; exact register-rounding and integer-rational boundary equivalence remain unverified. [Motion refinements](physics-refinements.md) retain the instruction-level corrections.

## Base avatar and acceleration

`004fe802` constructs the movement-ability object. The secure double at `+0c` is initialized from `00af29e0 = 100`, then the ordinary force/speed/friction/jump modifiers are initialized to one. `+3c` is initialized from `00af32d8 = 0.9`, the steep-slope threshold. [Constructor](ghidra-physics-motion/attribute-writers/004fe802.c.txt), [offset instructions](ghidra-physics-motion/attribute-defaults.txt), [scalar words](ghidra-physics-motion/default-scalars.txt), [mass consumer pointers](ghidra-physics-motion/parameters.txt).

The base avatar has mass 100, walk speed 125 pixels/second, walk force 140000, walk drag 80000, gravity acceleration 2000 pixels/second squared, terminal fall speed 670, and jump speed 555. These are decoded original values, not inferred from visual motion.

`009b2bcb` applies `v += force / mass * dt` only while velocity is below the force-directed speed bound and clamps an overshoot to that bound. It does not instantaneously erase pre-existing overspeed. Braking approaches zero or a selected speed limit without crossing it.

Ground movement in `009b23f2`:

- Base flat acceleration is `walkForce / 100 = 1400`.
- Base flat braking is `walkDrag / 100 = 800`.
- Effective friction is clamped to `[minFriction,maxFriction]` (`0.05..2`); friction below one has the original additional `0.5` multiplier before drag is applied.
- Let `s = tangentY`, `uphill = -sign(s)`. The force includes `1-s*s` when `s<0`, otherwise `1+s*s`. The uphill speed limit is the ordinary walk limit; downhill limit is multiplied by `1+s*s`. Overspeed braking chooses its limit from the velocity direction, while acceleration chooses from the force direction.
- For `abs(s)>0.9`, the original steep-slip branch applies slope-scaled `slipForce`/`slipSpeed`; uphill input halves the natural sliding terms. Neutral input on ordinary slopes brakes to rest.
- Swimming ground movement multiplies force and walk limit by `swimSpeedDec` (`0.9`).

`map.info.fs` is a recovered map force/drag coefficient. `0052b2b5` loads it, default one, into CField secure double `+1d0`; `00a45cd6` maps explicit zero back to one. `00a45b8c` writes that coefficient to both map force and drag attributes. [Map coefficient wiring](ghidra-physics-motion/map-attribute-instructions.txt), [zero normalization](ghidra-physics-motion/flight.txt), [inventory loader](ghidra-physics-options/map-attributes.txt). Nonzero foothold `force`/`drag` use the original hundredths conversion and recovered input-dependent conveyor formulas; see [exact conversion, integer magnitude and precedence](physics-refinements.md#foothold-force-and-drag).

Ordinary airborne motion in `009b2c3c` uses gravity/fall clamps and `floatDrag2`; held horizontal input applies twice this drag as force with limit `walkSpeed / walkForce * floatDrag2`. Thus jumping preserves a running speed already above this small air-control bound; it does not replace it with a guessed 125-pixel/second air cap. Released horizontal input uses `floatCoefficient` while falling below terminal speed. Excess downward speed is reduced toward terminal speed by drag before gravity is applied.

## Footholds, slopes, boundaries and jumping

`005b0b8c` consumes decoded string ID `0x5ce` (`foothold`) and invokes the world-space loader `00a43e7b`. The adjacent original string ID `0x5cf` is `ladderRope`. [Field consumers](ghidra-physics-motion/field.txt). The initial RTTI scan for VecCtrl/Attr/Foothold names found none in initialized analyzed memory; no class name is claimed on that basis.

- `009b1553` projects world position into distance along the foothold, clamps it to `[0,length]`, and projects velocity by the tangent dot product.
- `009b1646` reconstructs world position as `endpoint1 + tangent * distance`, and world velocity as `tangent * scalarSpeed`. The browser precomputes normalized tangents outside the hot loop.
- `009b3fd1` crosses `prev` at negative distance and `next` beyond length. A positive-X connected tangent is walkable. A vertical/backward segment whose vertical direction faces the current edge blocks it; an absent link or descending edge releases into the air. Scalar contact speed is carried across a connected floor, rather than resetting velocity at every foothold ID.
- `009b34c8` is a one-sided **swept point** collision routine. With `cross = (y-y1)*dx - (x-x1)*dy`, it requires old side `<=0`, new side `>=0`, and not both zero, then intersects the finite segments. This is not an axis-aligned sprite/body-box landing test.
- Airborne landing picks the first crossing along the sweep, with recovered endpoint/wedge and two-candidate cross-product arbitration. Contact velocity is interpolated before tangent projection; matching/neutral input halves landing scalar speed, opposing input clears it. Connected endpoints use truncated elapsed milliseconds and coast over remaining time; wall and ground-to-air paths perform bounded secondary sweeps. Ordinary floor candidates are not restricted to one rendering layer; wall/backward candidates use the last contact group.

Evidence: [tangent transforms](ghidra-physics-motion/transforms.txt) and [landing/connected-boundary routines](ghidra-physics-motion/collision.txt).

Original normal jump `009b1d3d` detaches the floor, sets upward velocity from `-jumpSpeed`, and uses the directional `0.8 * walkSpeed` horizontal jump adjustment, capped at the walk limit. `00af0d40 = 0.8`. Buoyant ground jump uses the additional `00afe7f8 = 0.7` multiplier. Ladder jump requires horizontal input; horizontal impulse is `walkSpeed * 1.3`, vertical impulse `-jumpSpeed * 0.5` (or `0.3` in buoyant movement). [Jump routine](ghidra-physics-motion/globals/009b1d3d.c.txt), [jump attribute pointers](ghidra-physics-motion/jump-parameters.txt), [scalar words](ghidra-physics-motion/movement-scalar.txt).

Down+jump respects original `forbidFallDown`, whose loader defaults to zero. `009b1c51` clears horizontal speed and applies `jumpSpeed * -0.35355339`; this exact short decimal is decoded at `00b3e3a0`, not replaced with a higher-precision square-root expression. Original queries first inspect floors through feet+300, then the interval [feet+300,feet+600), rejecting a result within five pixels. The selected candidate gates eligibility: collision ignores the **source foothold**, not every floor except the candidate. The public field is `ignoredFootholdId`. [Original query, setter and rounding evidence](physics-refinements.md#drop-eligibility-is-not-a-selected-landing-target).

## Ladders, ropes, swimming and flying

The original ladder loader in `00a43e7b` defaults `l`, `uf`, and `page` to zero; extraction supplies those recovered defaults. `00a45b03` uses a 10-pixel horizontal capture tolerance. `009cbefb` searches up to 20 pixels above standing feet for upward capture, 10 pixels below for downward capture, and permits airborne upward-key capture while descending. Capturing snaps X to the ladder and clears velocity.

`009cc627` advances by three pixels per 30ms update, independent of walk-speed modifiers. At the top, `uf=0` clamps to the top; otherwise it releases five pixels above. Passing the bottom releases one pixel below. Ladder/rope artwork is selected by original `l`. [Climb and capture predicates](ghidra-physics-motion/climb.txt), [three-pixel scalar](ghidra-physics-motion/climb-scalar.txt).

The global environmental mode is recovered, not inferred from map names:

- `00529ef2`: CField `+158 = swim`, `+15c = fly`.
- `00a45b8c`: mode one for nonzero swim, otherwise mode two for nonzero fly.
- `00704710`: swimming tests mode one; `009cb8c1`: user flight tests mode two.
- `007046ac` additionally tests local `swimArea` occupancy using truncated feet coordinates and `005983f4`.
- The local-water predicate includes occupied neighboring cells at exact rectangle boundaries. The browser retains inclusive integer-coordinate rectangles loaded from the original named `swimArea` entries, with a bounded scan. Global fly/local-water overlap has differing jump/integration precedence and is explicitly blocked.

[Mode predicates](ghidra-physics-motion/modes.txt), [flight predicate](ghidra-physics-motion/flight.txt), [mode flag instructions](ghidra-physics-motion/swim-flag.txt), [local-water predicate](ghidra-physics-motion/swimming.txt), [field-name proof](ghidra-physics-options/fly-field-name.txt).

Buoyant integration `009b2c3c` uses `floatDrag1` for overspeed/released-horizontal braking and `swimForce/swimSpeed` or `flyForce/flySpeed` for horizontal control. Swimming has an original neutral downward acceleration, **not invented stationary hovering**. Up/down vertical targets are `-swimSpeed*0.3` / `swimSpeed*1.5`; velocity approaching from below uses half acceleration. A swimming jump gives `-swimSpeed*5` with base modifiers. Flight neutral downward limit is `fallSpeed*0.015`; downward input targets seven times that limit. Flight jump is `-flyJumpDec*flySpeed*5`, and a directional flight jump doubles current horizontal velocity. Scalar words are retained in [movement-scalar.txt](ghidra-physics-motion/movement-scalar.txt) and [flight-scalars.txt](ghidra-physics-motion/flight-scalars.txt). These modes were exercised on original map data, not only synthetic flags.

## Browser API, bounds and overload

`createSimulation(world,{x,y})`, `advanceSimulation(sim,input,elapsedMs,onStep?)`, `relocateSimulation(sim,{x,y})`, and `snapshotSimulation(sim)` implement the reconstruction contract. Input uses held booleans `left,right,up,down,jump,attack` and one `jumpPressed` edge. The edge is consumed on the next tick; an ineligible edge is rejected rather than buffered until a future landing. Held Space is a separate **provisional offline scheduling policy**: retry eligible ground and horizontally directed ladder/rope requests each tick; detached swim/fly requests are separated by 300 ms. Releasing resets repeat cooldown. Original `009b1d3d` proves branch permissibility and impulses, not this browser cadence. Left/right and up/down cancel when both are held.

State strings are `ground`, `air`, `ladder`, `swim`, `fly`; `crouching` is a separate physical-pose boolean. Physics actions are `stand1`, `walk1`, `jump`, `fly`, `prone`, `ladder`, `rope`. Original `00451ec8` selects action-table index `0x22` (`fly`) for detached buoyant motion and `0x23` (`jump`) for ordinary air; grounded water poses remain ordinary ground actions. Facing is numeric: `-1` left, `+1` right. Held attack is owned by local gameplay, not an unsupported-attack diagnostic. `movementLocked` suppresses controls, crouch, facing changes and jump requests but preserves integration, gravity, friction and preexisting velocity. The lock is an explicit local gameplay policy, not recovered attack-lock timing.

`previousX`, `previousY`, `x`, `y`, `accumulatorMs`, and `effectiveSettings.quantumMs` are public on the reusable simulation and in inspection snapshots. A renderer may interpolate presentation with `min(1,accumulatorMs/30)` between previous/current positions, without mutating physical coordinates. Snapshot allocation is explicitly outside simulation ticks.

The optional `onStep(30)` consumer runs after each successful fixed tick, before the next catch-up tick, including ticks drained with zero newly elapsed time. Main updates local gameplay, selects player artwork and advances that artwork in this hook only; RAF never ages the player again. Reentrant simulation advancement is rejected. A throwing consumer propagates its error; the completed physics quantum is already accounted and the reentry guard is released. Ambient rendering retains a separate presentation clock, not a second player gameplay clock.

`relocateSimulation` preserves simulation object identity, elapsed backlog, diagnostics and gameplay lock. It clamps validated arrival coordinates to existing bounds and clears velocity, foothold/ladder/drop contacts and interpolation history before resampling the environment. Same-map travel therefore cannot invalidate an OfflineField reference or reload live mobs.

Named browser safety policies:

- Maximum 65,536 segments, 4,096 ladders, 4,096 water rectangles, 1,024 map metadata fields/sections; invalid/nonfinite geometry, unresolved IDs, zero-length segments, reversed rectangles and empty non-playable linked maps fail explicitly.
- Original coordinates are constrained to integer magnitudes at most one million during geometry preparation, keeping browser cross products exact in the supported range.
- At most 32 connected-foot transitions per update; exhaustion records `transitionLimit` and a fatal diagnostic.
- At most eight 30ms catch-up steps per `advanceSimulation` call. **All unprocessed elapsed time remains in `accumulatorMs`**; overload, backlog and overload-count are visible. A subsequent call with zero elapsed can drain it. No elapsed cap silently changes movement speed.
- Compensated elapsed-time addition reduces refresh-partition rounding drift. No per-step arrays, objects, closures, sorting, logging or collision-list construction are performed. Segments, IDs, tangents, state and diagnostics are prepared before play.

## Explicit remaining fidelity policies / blockers

The browser core is usable keyboard-driven movement, but not a claim to have reconstructed every original branch:

1. Integer-rational/x87 numerical boundaries and original spatial-index ordering at coincident/equal-query-height contacts remain unverified, despite recovered endpoint and cross-product arbitration.
2. Rare non-floor collision group exceptions, moving footholds/objects and full dynamic map-boundary state remain unresolved. `map.$objectPhysics` is reported when present.
3. Opposing subunit conveyors reach a proven original zero divisor; original exception-mask/server reachability context is unavailable. This path faults explicitly rather than using an invented denominator.
4. Unexplained active map movement flags, field limits and script-driven entry effects remain in `blocked`.
5. Movement modifiers from equipment, temporary stats, skills, mounts, transformations and special forced-motion modes remain outside the base-avatar physics contract. Local gameplay now gates controls using `movementLocked`; that does not claim original skill/action-lock timing. See [physics-options.md](physics-options.md) and [avatar actions](avatar-actions.md).
6. Local-water neighbor-cell and within-tick resampling details remain timing uncertainties. No original gameplay recording is available; executed browser routes and source-derived checks do not establish complete original-runtime equivalence.

## Executed proof

A throwaway Bun scenario exercised the actual public API against original maps. [smoke.json](ghidra-physics-motion/smoke.json) retains the output; no project builds, lint, formatter or test suite ran during concurrent work.

- Henesys `100000000`: spawn `(112,197)` settles on foothold 126 at `(112,274)`; held-right motion crosses to foothold 133 and reaches velocity 125. A jump has velocity -495 after its first 30ms update and subsequently lands/brakes.
- Presenting the same 3,000ms input as 100×30ms, 180×(1000/60)ms, or 432×(1000/144)ms produces **identical physical X/Y/velocity and 100 ticks**: X `447.03142857142853`, Y `274`.
- A single 3,000ms call executes eight ticks, exposes 2,760ms backlog/overload, then zero-elapsed calls drain to 100 ticks without losing time.
- Original ladder 1 captures and climbs at X5370; down-jump at `(3800,124)` lands on lower foothold 101 at Y454.
- Original slope foothold 63 moves along its tangent; the connected wall at foothold 299 stops at X611 with zero velocity; leaving an unconnected edge releases and lands on lower foothold 48.
- Aqua `230000000` executes swimming/jump; original flight map `200090500` executes flight/jump. A bounded original Map2 scan independently found the two active fly maps `200090500` and `200090510`.
- Nautilus `120000000` selects swimming inside its actual local water rectangle `(-606,207)..(5318,302)` despite no global swim flag.

Main completed integrated source checks and native keyboard/presentation acceptance. [All-map refresh validation](offline-validation/refresh-invariance.json) covers356 packaged maps,7,013 regions and573 dynamic renderables at60/120/144/240-Hz elapsed partitions; all pass without faults. [Independent native movement/UI scenarios](offline-validation/ui-movement/results.json) and [final installed offline portal/jump replay](offline-validation/main/final-offline-portal-reload.json) exercise the real surface separately. The final [world/performance pass](offline-validation/performance/summary.json) records403 passing checks. None substitutes for original Windows motion traces.
