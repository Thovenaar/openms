# Original portal reconstruction

## Scope and provenance

This is an offline reconstruction from the supplied `Maplestory-Client` executable and WZ files. There is no original recording, original C/C++ source, Windows runtime, or server. Packaged traversal is **not server authorization**. Neither this implementation nor its smoke evidence establishes visual parity with the original running game.

Implementation: [`portal-data.js`](../client/tools/portal-data.js), [`portal-system.js`](../client/src/portal-system.js). Investigation used only the isolated `/tmp/maple-ingame-portals` Ghidra project and the installed original-binary `analyzeHeadless` runner with `docs/tools/clientFocus.java`. Retained outputs:

- [`consumers.txt`](ghidra-ingame-portals/consumers.txt): all seven assigned functions (`00712d35`, `0071332c`, `00712313`, `0071259d`, `00712827`, `0071165a`, `0053185c`), plus original rectangle selectors and record helpers.
- [`activation.txt`](ghidra-ingame-portals/activation.txt), [`input-timing.txt`](ghidra-ingame-portals/input-timing.txt): Up activation, request admission, same-map handling, frame loading and conversion.
- [`ranges.txt`](ghidra-ingame-portals/ranges.txt), [`collections.txt`](ghidra-ingame-portals/collections.txt), [`frame-default.txt`](ghidra-ingame-portals/frame-default.txt): exact instructions resolving decompiler-damaged arguments, collection ownership, omitted defaults and selected variant.
- [`automatic.txt`](ghidra-ingame-portals/automatic.txt), [`automatic-range.txt`](ghidra-ingame-portals/automatic-range.txt): actual automatic/script/impact consumers; these are evidence, not claims that the browser runs them.
- Lossless original metadata: [`Map.tar.gz`](ingame-inventory/Map.tar.gz), per-map `portal.json` members. MapHelper IMG SHA-256: `ea1cf9eeaf6b35809cfca421337e1d6f49ac1f4b2d6852a59f67063653cdf013`.

The loader's string `0xeba` is **hideTooltip**, not script. WZ `script` is retained raw; the portal request transmits the original portal name rather than interpreting JavaScript or implementing server scripts.

## Recovered graphics and timing

`00712313` reads `Map/MapHelper.img` → `portal` → `game` → `pv` (IDs `0x6b0`, `0x5c1`, `0x6b1`, `0x6af`). The loader installs this looping artwork for types 2, 4 and 7. Its animation call uses mode `0x20`.

`0071259d` selects `ph` (`0x1122`); `00712827` selects `psh` (`0x1123`). `00712d35` uses `ph` for type 10 and `psh` for type 11. The loader places types 10/11 in the manager's `+0xc` collection and stores their `image` variant. Only **empty or absent image** is replaced by string ID `0x3c0`, `default`; an unknown nonempty variant must not fall back silently. The eight supplied type-10 records all use this empty/absent default.

When the selected nearby hidden portal changes, `00712d35` starts the old portal's `portalExit`, clears its current/start layer, and starts the new portal's `portalStart`. Both use mode zero. `0071332c` checks `00443e36()==0` to release a completed Start, install `portalContinue` with mode `0x20`, and release a completed Exit. The runtime mirrors those one-shot/loop transitions for all supplied hidden portals. It does not reverse an in-flight Start animation when departing; it starts Exit.

**Type-11 recovered family:** `0071332c` calls the **ph helper unconditionally** for Continue even though Start/Exit select psh. Extraction now reproduces that exact mixed family; it does not substitute psh Continue. A missing requested ph/psh variant is an explicit original-artwork dependency failure, never a default-variant fallback.

All these graphics call `0043ea3e`; its numeric-frame loop calls `0043f768`. The latter pushes **`0x78` (120 ms)** before converting frame `delay`, string ID `0x15f8`, through `00414d40`. This provides a real original-consumer chain for the portal default; it is **not** inferred from the previous shared extractor's 120-ms policy. Portal extraction explicitly normalizes numeric-string delays, retains explicit nonnegative delays, original origins and alpha endpoints, and rejects negative or nonintegral milliseconds. Equal-time zero frames follow the recovered Gr2D queue semantics documented in [client evidence](client-evidence.md#timed-frame-alpha--verified).

| Original artwork         | Frames | Duration |
| ------------------------ | -----: | -------: |
| pv loop                  |      8 |   960 ms |
| ph/default Start         |      4 |   480 ms |
| ph/default Continue loop |      7 |   840 ms |
| ph/default Exit          |      3 |   360 ms |

Portal depth is original `0xc0041f78`, normalized by the same common `B=-0x40000000` removed from existing map/entity depths: **270200**, between ordinary world layers and front backgrounds. Equal-depth ordering remains the existing stable extraction policy, not proved original tie behavior. Editor portal icons are never substituted for game artwork; the executable's `game/pg` string has no corresponding supplied artwork.

## Actual input, geometry and request semantics

- `0094c856` dispatches virtual key **`0x26` (Up)** to `0094df9b`.
- `0094df9b` calls `00712ab1` with half-width **20**. It searches ordinary non-type-zero records in reverse source order, using the original point-in-rectangle operation on **`[x-20,x+20) × [y-50,y+50)`**. Type 6 is removed from this collection by the loader. The browser uses truncated integer simulation feet, not sprite overlap.
- That caller requires the movement unit's `+0x110` contact pointer. `009b1719` demonstrates that this is the foothold contact and copies its plane/group; the browser requires `simulation.footholdId`. Additional original action/status/server gates are not all reconstructed. The local browser attack action is blocked; absent server-owned statuses are not invented.
- `00950555` uses half-width **100** with `00712c57` on the separate type-10/11 collection. This is **`[x-100,x+100) × [y-50,y+50)`**, not the narrower Up-entry rectangle. It supplies the nearby portal to the hidden-graphics transition routine. Browser presentation reevaluates this selector each active update; the original invokes the callback when either of its two arguments is nonzero. Precise original callback scheduling/attachment on initial stationary entry remains unverified.
- Ordinary cross-map `0053035d` admits a request only while the global pending flag is clear and elapsed time since the previous timestamp exceeds **499 ms**. It sets the flag and timestamp when transmitting. `PortalTravelGate`, owned by persistent `InGameSystems`, now retains both pending-token ownership and the interval across successful scene replacement. `0053185c` timestamps the response, including failure; local success/failure/cancellation settlement likewise starts the next 500-ms interval. A stale token cannot release a newer request. `performance.now()` supplies one monotonic application clock; inactive-tab wall time is explicitly browser policy.
- Same-map non-type-4/5 routes take `00957b74`. **Fresh recovery corrects the earlier 120-ms-delay interpretation:** request stores the destination at `+0x2b20/+0x2b24`, request time at `+0x2b28`, and an initial admission deadline `now+120` at `+0x2b2c`. [`0094e5e5`](ghidra-ingame-portals/entities-motion.txt) moves on the next update when `now >= +0x2b28`, then replaces `+0x2b2c` with **now+600**. The browser therefore does not invent a 120-ms travel pause; the shared gate retains the 600-ms same-map recovery after successful commit. Type 4/5 always take the packet-admission path even when target map equals source.
- Original destination entry `00949513` subtracts **10** from selected portal y. The integration must spawn at the exact named destination `(x,y-10)`, not at source coordinates or a random/default spawn.
- After accepted non-type-4/5 ordinary requests, `0094df9b` resolves string ID `0x15ba`, **Portal**, for the Game sound path. Types 4/5 suppress that sound. `00957b74` resolves `0x884`, **Effect/BasicEff.img/Teleport**, for same-map motion. Main receives these exact sound/effect choices with the travel token and dispatches them only after an accepted atomic offline commit. Moving the original request-time effect/sound to accepted completion is deliberate offline failure safety, not original response latency.

The browser latches an **Up keydown edge** independently of held Up, consuming it once before physics. A keydown+keyup within one render interval is therefore not lost. Focus/map replacement clears held and pending edges; subsequent OS repeat cannot rearm until a fresh physical press. This is browser duplicate/bounce safety, not an assertion of identical Windows repeat scheduling. Holding Up or pressing again while loading cannot create a second request. Rejection retains the old scene; generation/destroy guards prohibit stale completion/error mutation.

## Automatic and server-owned behavior: evidence without invention

The automatic selector is not the Up selector. `00712b61` searches the manager's `+8` collection (types 3, 9, 12, 13) in reverse order, using **half of hRange/vRange**, truncating integer division. Loader instructions prove omitted **hRange=100**, **vRange=100**, and **delay=0**. These fields are not substitutions for the Up-entry or hidden-reveal constants.

`0094dac6` type **3** follows the ordinary destination branch: sentinel refusal, exact same-map name via `00957b74`, otherwise `0053035d`, and Game/Portal sound. Automatic same-map calls bypass the ordinary foothold requirement; type3 is now enabled without an Up edge using the recovered hRange/vRange rectangle. The browser makes at most one failed attempt per continuous overlap, requiring exit/reentry after a dependency failure; cooldown-only refusal remains eligible once time elapses. That failure rearming is explicit browser policy, not recovered packet retry timing.

The type-9 branch passes authored delay to `00485bf7`, gates `onlyOnce` against user `+0x31b4`, and sends a script-packet request. Type12 invokes an impact-skill path; type13 also tests field kind, reactor state and contact. These remain classified `automatic-script-packet-unavailable`, `impact-skill-state-unavailable`, and `impact-field-reactor-state-unavailable`; no guessed impulse or script reward is installed. Nonempty `script` always yields `server-script-unavailable`.

Nonscript named ordinary routes now admit types **1,2,3,4,5,7,8,10,11**; type3 additionally activates automatically. The ordinary consumer uses named routing for nonsentinel type7/8/11 too; only their sentinel branches are script requests. Type0 is spawn-only and type6 remains special-loader metadata. `onlyOnce`, `delay`, impacts and `reactorName` are retained, but their type9/12/13-specific consumers are not incorrectly applied as gates to ordinary type1/2/3 routing. Dead or locally action-blocked actors cannot request travel, while portal graphics continue.

`0053185c` is a response handler, not activation logic: it clears the global pending flag, updates the timestamp, consumes a response code, and selects messages including **“The portal is closed for now.”** This is direct evidence that raw `tm`/`tn` is not permission.

## Coverage: every one of the 131 records

The complete per-record presentation accounting is retained in [`extraction-smoke.json`](ghidra-ingame-portals/extraction-smoke.json). It maps each original portal index to a visual entity or explicit metadata-only entry without creating a second runtime route convention.

| Map       | Records | pv entities | ph entities |
| --------- | ------: | ----------: | ----------: |
| 100000000 |      34 |           7 |           4 |
| 100000001 |       2 |           1 |           0 |
| 103040000 |       4 |           1 |           0 |
| 108000500 |       1 |           0 |           0 |
| 120000000 |      17 |           1 |           4 |
| 200090500 |      48 |           1 |           0 |
| 211040000 |       7 |           3 |           0 |
| 230000000 |      18 |           4 |           0 |
| **Total** | **131** |      **18** |       **8** |

Type totals: 0→23, 1→17, 2→16, 3→9, 6→18, 7→2, 9→38, 10→8. All 105 nonvisual records remain represented. Scripted routes such as `highposition`, `undodraco`, and `market05` remain explicit unsupported requests, not invented map edges.

Available cross-map pair: `100000000/in02` (original index 25, x5136/y453) ↔ `100000001/out02` (index 1, x202/y242). Same-map hidden pairs: `100000000 hp00↔hp00_1`, `hp01↔hp01_1`; `120000000 nt00↔nt01`, `cp00↔cp01`. Type-1 same-map routes include `120000000 pt00→pt01→pt02→pt00` and `200090500 st00→st00`. All other unavailable target maps must be rejected by catalog lookup; sentinel `999999999` is never a map or fallback.

## Integration and bounded ownership

`await extractPortals(context,map,mapId)` returns `{entities,presentation}`. Main appends entities with final global order and stores `manifest.portalPresentation`. Schema1 records retain `portalId`, `entityId`, graphics status and activation classification. Routes and all original descendants remain solely in `manifest.physics.portals` / `manifest.physics.map.$portalProperties`.

`new PortalTravelGate(clock?)` belongs to `InGameSystems`, never a scene. `tryBegin(packetPath)` returns a unique token or null; `complete(token,outcome)` settles only that exact active token; `cancel(token)` explicitly aborts application-owned work. `PortalSystem(scene,{travel,onError,travelGate})` requires that persistent gate. `handleInput(input)` consumes the latched native Up edge before physics; `update(ms,input)` also handles automatic selection and artwork. `.blocksMovement` exposes pending same-map motion. Scene destruction clears artwork references but **does not cancel or release a travel token**: successful Main commit destroys the old scene before its promise resolves. `finishTravel` always settles the token in `finally`, even after old-owner destruction, without stale UI/error callbacks.

`travel(mapId,targetPortalName,options)` receives `{token,signal,sound,effect,sameMapMotion,notBeforeMs}`. `notBeforeMs` is admission time, not a 120-ms delay. Main validates catalog existence, exact destination-name uniqueness and generation/signal ownership, prepares the candidate, preserves the old scene on failure, and commits atomically. It plays Game/Portal iff `options.sound`, and Teleport iff the effect is present, only after commit. Signal cancellation belongs to superseding application work, never automatic source teardown. Hooks are synchronous nonthrowing notification boundaries except the awaited travel promise.

`collectPlayableMaps(context,seeds)` is a bounded synchronous WZ-driven closure export. It shares `portalRouteStatus` with runtime; each admitted target must have exactly one named arrival. It returns `{ids,blocked}` and fails explicitly at 512 maps. Default discovery from the eight seeds reaches **356 maps**, including **57 reactor maps / 26 reactor templates**. The complete retained [route closure](ghidra-ingame-portals/route-closure.json) distinguishes the 28-map direct neighborhood from full reachability. One original route is malformed: `680000004/4 → 104040002/st02` has zero matching destinations and remains blocked. Explicit selected-map releases are not described as complete closure.

Portal art remains in package-v2 demand-loaded regions using existing atlas identities/budgets. The owner detects changed region entity identities and retains no leases. Engineering bounds: 4096 portal records/map, 1024 frames/action, 512 closure maps; no per-tick arrays, display objects, textures, or recursive route preloads. Hidden Start/Exit use the renderer's nonlooping playback and Continue loops. Reactor ownership and exhaustive remaining entity schemas are documented in [ingame-entities.md](ingame-entities.md).

## Executed proof and outstanding acceptance

The domain extraction smoke ran the actual new extractor against original WZ parsed/decoded by existing `WzArchive`, `parseImage`, and `decodeCanvas`, with a small in-memory Frame/Part service adapter. It produced **131 presentation records, 26 entities, 22 unique pixel hashes, 1,277,980 unique decoded RGBA bytes**, and the exact durations above. The adapter does not prove shared atlas packaging or rendered pixels.

The scoped runtime smoke used original map physics and the real fixed-step simulation: entering at source portal index25's `(5136,443)` settled after 60×30 ms at **(5136,454), foothold189**. Up requested exactly **100000001/out02**; held Up and a second edge while pending did not duplicate the request. Injected travel failure retained the same scene and reported an error; a separate request rejected after destruction produced zero stale errors. Real `EntityAnimation` with dimension-only TextureSource objects exercised **Start→Continue→Exit→hidden** at 480/360 ms. Evidence: [`runtime-smoke.json`](ghidra-ingame-portals/runtime-smoke.json). This was a rendererless smoke with synthetic input state, not real keyboard/browser or streamed-commit acceptance.

The fresh investigation executed against all original Reactor/Morph/TamingMob images and the complete supported map graph; retained new decompilation includes `entities-motion.txt`, `reactor-events.txt`, `reactor-triggers.txt`, `reactor-hit.txt`, and `reactor-layers.txt`. These are evidence runs, not post-change browser proof. During the concurrent implementation wave, validation/build/lint/tests/formatting were deliberately deferred to Main. The earlier native evidence below covers the prior implementation only; it is not proof of the new cross-scene gate, type3 activation, type11 mixed family or full356 release.

The final delegated native-input pass is [portals/acceptance.json](ingame-validation/portals/acceptance.json), with screenshots and real post-gain portal PCM. It exercised bidirectional named travel, held/repeat guards, pv looping, ph27 Start/Continue/Exit, hp01 same-map travel, sentinel/missing target refusal, cooldown and latest-selector races. First committed destination was `(5136,443)`, then settled at `(5136,454)`. [lifetime-and-short-tap.json](ingame-validation/lifetime-and-short-tap.json) retains Main's failed-before/passed-after short-tap and shared-HUD-lifetime reproduction. Other hidden pairs, early-Start interruption, scripts/impacts and injected network failures are explicitly not covered by this native pass. It is not original Windows parity or a performance measurement.

## Expanded original Windows capture request

Obtain original runtime video plus frame-step screenshots and input timestamps for: ordinary Up entry at rectangle left/top/right/bottom edges while grounded/airborne/attacking; Windows auto-repeat held across map changes; hidden reveal on stationary field entry and proximity boundaries; Start interrupted by departure/reentry; simultaneous nearby hidden portals; type11 psh variants and actual Continue family; same-map teleport motion and the observed 120-ms deadline; repeated rejected/accepted cross-map requests around 500 ms; type9 onlyOnce reset after exit/reentry/death/field change and authored delay; type12/13 impact timing/sign with reactor/field conditions; hideTooltip behavior; type6 special-data consumers; missing game/pg behavior; accepted/rejected Portal sound timing. Include original pixel captures and loopback audio, not just event logs. Until those inputs exist, do not claim original visual/audio or authoritative gameplay parity.
