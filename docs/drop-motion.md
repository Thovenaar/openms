# Original drop motion and atomic local mesos

## Evidence and authority

Recovered from `Maplestory_UNPACKED.exe`, SHA-256 `1198fa57ca5a7c489bae43ec13c69681d9cabe0f96762f3dc0357facf2e7d4df`, using Ghidra 12.0.4, project `/tmp/maple-ingame-portals`, `-readOnly -noanalysis`. This investigation executed the existing bounded `clientFieldRefs.java` tool to follow the pickup queue from `004360c3` through the animation displayer's `+0xa8` list, `004375b1 -> 0044528f -> 004416db`. That resolved the previous manual-search bottleneck and recovered the pickup equation rather than borrowing another client implementation. Address-directed exports used `clientFocus.java`, `clientInstructions.java`, `clientBytes.java`, and `motionImmediates.java`. Exports are retained under [ghidra-drop-motion](ghidra-drop-motion/). Earlier drop exports under `ghidra-client-corrections` remain useful instruction evidence; their provisional 600ms/48px/300ms presentation conclusions are superseded here.

No original C/C++ source or Windows runtime was available. Cosmic is an authorized **server reference**, not original Nexon source. It supplies the offline fanout and amount rules; executable/WZ evidence supplies client presentation.

## Recovered equations

Let `q=30ms`, `r(v)=trunc(v + 0.5)` for nonnegative `v`, otherwise `trunc(v - 0.499999999)`. The negative scalar is the actual double at `00af3720`, not JavaScript's asymmetric `Math.round`. Packet positions are integer feet coordinates. The rendered vector subtracts half the canvas height from source and destination Y (`00505f0d..00505f5a`); the canvas is centered around that vector with negative half width/height (`00506054..00506090`). `drop-motion.js` retains packet coordinates; `client/src/online/scene-drops.js` applies that canvas centering for live server drops.

### Launch, fanout and landing

- Native drop states at `00504bff` are waiting `0`, flight `1`, fall `2`, hover `3`, delayed removal `4`. `00505117` and `00504e9c` advance flight/fall by **30ms**. Local `step(deltaMs)` accumulates bounded input quanta into that cadence without dropping remainder time.
- Waiting becomes visible on the first positive clock difference (`0050542d`); `DropItem` is triggered there, **not at landing**. Sound is globally throttled by strictly `>300ms` (`0050563e..00505687`). The local field owner retains this throttle across its drop slots.
- Ordinary launch uses `V=400px/s`; native ownership type 3 uses `V=720px/s`. Gravity term is `400*t²`, with `t` in seconds (`00af3740=400`, `00af3738=720`). Normal flight therefore rises 100px, rather than the old provisional 48px.
- `005064ff..0050658f` computes duration `D`: scale `s=1` ordinary or `1.8` type3, apex constant `a=100` or `180`. If source `Ys <= Yg`, `D=trunc(1000*s)`. Otherwise `D=trunc(min(30*(trunc(sqrt(2.5*(Yg+a-Ys)))+1)+500*s,1000*s))`. `00a622fc` is the original `FSQRT`. Local placement never chooses a foothold more than 85px above the source; standalone motion rejects an unreachable apex rather than inventing a curve.
- At flight age `u` in milliseconds: `h1=min(1,u/500)`; `h2=0` for `u<=500`, otherwise `min(1,(u-500)/(D-500))`. `X=r(Xs+(Xg-Xs)*(h1+h2)/2)`. `Y=r(Ys - V*u/1000 + 400*(u/1000)^2)` (`00505117..00505226`). Horizontal movement is two-stage, not a single arbitrary-duration lerp.
- On the first 30ms sample reaching `D`, a lower destination (`Ys<Yg`) enters fall with age zero and X at destination. Fall is `Y=r(Ys + V*u/1000)` until reaching the foothold, then snaps to destination (`00504ea3..00504f0c`). Otherwise flight snaps directly to destination (`00505229..0050535a`). Hover resets the rotation.
- Ordinary **items** set the vector's 300ms rotation cycle through `00506142..00506182`; mesos instead animate their canvases through `00506e62`. The renderer rotates around the actual canvas center, not an assumed 32px cell. Item rotation continues during fall and stops at settlement.
- [Fresh Shape2D recovery](original-resource-audit.md#item-rotation-client-call-through-shape2d) follows that virtual call to the DLL's periodic angle evaluator. Drawing includes elapsed visual time between fixed updates: offline uses its remainder, and online advances the published flight plan locally. Reading only the network sample angle caused 108-degree jumps; the former online 90ms cap also froze spin during delivery gaps. Predicted settlement stops rotation, and field pause stops its visual clock.
- Native packets provide distinct source and landing coordinates; client code does **not** derive server fanout. Cosmic `MapleMap.java:768` begins its normal drop index at **1**, and lines 670–673 apply 25px alternating offsets: `0,+25,-25,+50,-50,...`. The previous local zero-based application duplicated the first position; it is corrected. Local support selection projects those X coordinates onto authored footholds and falls back to the first supported drop point when a lateral point has no floor. Cosmic's more elaborate map-edge/binary-search placement is not claimed as reproduced.

### Untradeable discard

Eligible untradeable/quest-item discard first presents the original warning: `This item can't be taken back once \r\nthrown away. Will you still drop it?`. Cancel preserves the instance. Confirmation revalidates ownership/quantity and commits the debit before publishing the disappearing drop; this is not a recoverable floor pickup.

Native spawn mode3 is separate from explosive ownership type3. It uses the ordinary launch and rotation while fading from the first positive30ms sample: `max(0,trunc(255*(1000-(age-30))/1000))/255` (`00505559..005055d8`). Landing or the original3000ms lifetime cap retires it; it does not wait on the floor before beginning an invented fade. The [native replay](native-ui-validation/reported-r2/report.json) captures Favorite Doll4000517 warning/cancel, accepted removal, launch and alpha124/255 at age540ms.

### Idle and pickup

- Idle increments phase by the double `0.09424769999999999` (`00af3730`) every 30ms and uses `trunc(Yg+3*sin(phase))` (`00504d98..00504e44`), with no arbitrary bounce height.
- Pickup source is the stored **landing vector**, not the current hover offset (`005066de..005066e3`, `00506ba0`). Pickup follows the live player's current coordinates. For a player, native `004519aa` finds the maximum first-canvas height of the avatar layers and the target is `Yplayer-trunc(height/2)` (`004416db`); the integration supplies `pickupHeight()` from the current authored avatar composition. Invalid/unavailable height refuses the intent explicitly. Pet/mob collection targets are not part of this local-player subsystem.
- With pickup age `u<700`, `X=trunc(((700-u)*Xs+u*Xt)/700)` and `Y=trunc(((700-u)*Ys+u*Yt)/700)-40+trunc((u-350)^2*160/490000)` (`0044191f..00441970`; full function retained in `drop-native-pickup-equation.txt`). This is a **700ms** trajectory with a **40px quadratic arc**, not the old 300ms sine curve.
- Alpha is `255` through `u=420`; afterwards `255+trunc((420-u)*192/280)`, normalized by 255. At `u>=700`, native removes the animation instead of fading all the way to zero (`004417dd..0044181a`). Local 30ms samples remove at the first sample at/after 700ms.
- `PickUpItem` is emitted only after successful local durable credit. Native removal handler `00506590` emits it for the matching local owner; browser persistence latency necessarily delays the presentation until the value is safe.

### Mesos artwork and depth

`00506bfe` selects `<50`, `<100`, `<1000`, then bag. Original WZ paths are `Item.wz:Special/0900.img/09000000..09000003/iconRaw/0..3`. `00506e62` overrides generic missing-WZ-delay behavior: variants 0/1 have four **80ms** frames; variant 2 has four **200ms** frames; bag has **4000,120,120,120ms**. Evidence: `drop-native-helpers.txt` frame insertions at lines 205/252/299/346, 417/464/511/558, 629/676/723/781. Extraction owns these immutable frame delays; renderer consumes them.

The rendering owner's recovered `00505f82` world depth is `29999 + (foothold.layer*3000 - foothold.group)*10`. Drops enter the scene's shared world ordering instead of the former arbitrary million-depth overlay. Foothold metadata is validated at construction. Renderer owns decoded imagery only and never mutates the profile or awards loot.

## Online presentation through delayed updates

[DropPresentationMotion](../client/src/online/drop-presentation-motion.js) uses the server-published source, landing point, duration, speed and phase. It advances the same recovered equations through waiting, launch, fall and hover, with at most four phase transitions per sample. Work does not grow with network delay. Two reusable 30ms states interpolate position and centered artwork at render cadence; item spin advances continuously. Mesos retain their authored canvas animation without rotation.

The visual age is monotonic: delayed state cannot rewind flight or hover. New positional differences blend over 180ms. A drop first seen while the authority is still in its `waiting`/`launching` phase replays the authored arc from its published origin, because the whole source/landing plan is already known and the acknowledged entity frame can arrive hundreds of milliseconds into the launch at 500 ms RTT; a drop first seen already airborne or grounded (a late join) anchors to the authority's own age instead. Once a drop has started, a newer snapshot can never rewind it. This dedicated path replaces generic foothold-clamped motion, which incorrectly pulled airborne drops below the landing floor. Because the whole trajectory is already known, flight, landing, hover and disappearing-item fade continue through gaps longer than the remote actor's 600ms forecast. Pause/inactive presentation stops the field visual clock.

The client starts from a received drop and never creates inventory value or predicts pickup ownership. Server removal still retires the entity. A confirmed pickup uses the original 700ms arc and follows the receiving player's live, smoothed position. No extraction is needed for these presentation changes; restart client and server to match runtime identities.

[Scoped validation](validation.md#remote-players-and-drops-under-latency) covers original-equation comparisons, delayed copies, disappearing drops, and a native two-player flight/hover check at 500ms RTT with a 1.2-second traffic pause. It does not establish speculative pickup admission or Windows visual parity.

## Atomic mesos and pickup ownership

`DropSystem.dropMesos(amount,simulation)` returns an awaited `{ok,code,reason,...}` result. The original numeric dialog (`0081dac6..0081dadd`) caps the maximum at `min(balance,50000)` and passes 10 as the initial/minimum input. Cosmic `MesoDropHandler.java:53` independently enforces `meso>9 && meso<50001`. Authority requires an integer **10..50000**, a live player, sufficient current balance, a finite supported placement, and a free slot.

1. Validate the request and placement before touching the profile.
2. Reserve one **hidden**, non-pickable slot. Mob batch capacity counts reservations; another transaction receives a busy result.
3. `store.commitProfile` revalidates and debits a draft atomically. Until completion, balance and visible world count are unchanged.
4. Only after success initialize/publish the local meso drop. Failure releases the reservation without a debit or a value-bearing visual. The reservation and pending barrier clear in `finally`.

Pickup similarly preflights capacity, quest/unique/stack constraints and meso overflow; marks exactly one drop pending; commits once; then publishes collection animation. Repeated pickup cannot select pending/collecting loot. A rejected write restores grounded state and value, and pending time does not consume its remaining lifetime.

**Lifecycle contract:** map replacement/disposal must await `drops.waitForIdle()` before `destroy()`. Direct destruction while a transaction is pending throws `field-busy`; it cannot erase a reserved debit target or reuse a credit slot. A committed result is never “cancelled” by erasing its world entity before publication. Once idle, ordinary map departure intentionally discards transient field drops, as declared offline ownership policy; that is distinct from transaction cancellation. On reload, field drops still do not persist. Persistent ground-item escrow across app termination is not implemented and is not claimed.

Remaining offline policies: field capacity 256, 180s transient lifetime, local-only ownership, fixed pickup rectangle 40x60, inventory category capacity 96, ordinary non-type3 server drops, base equipment rather than randomized stats. Type3 motion equations are recovered, but no new server ownership mode is fabricated.

## Executed scoped proof and integration scenarios

A throwaway Bun scenario exercised the actual `DropSystem` and `ProfileStore.memory`, without a project test suite/build/extraction. Observed: fanout `[0,25,-25,50,-50]`; at flight age 510ms the +25px drop was `(13,-100)`; normal/high/type3 durations `[1000,710,1800]`; moving player X to 70 during pickup produced X=36 at 360ms. It exercised atomic debit/credit, hidden reservation, duplicate pickup/debit, pending destroy refusal, injected quota errors for pickup/debit, amount bounds, unsupported ground, capacity256 with unchanged refusal balance, and destroyed-field refusal. All assertions passed. This proves the memory-store transaction path and injected error handling, **not** a real browser IndexedDB failure or Windows-client visual comparison.

The integrated [item report](ingame-validation/expanded/items/evidence.json) now retains native two-item25px fanout/rotation, moving Z pickup, invalid9/50001/decimal/empty amount rejection, Cancel/Enter/Escape routing, repeated-Enter one-debit behavior, meso100000→99990→100000 and earned item/meso persistence after reload. Exact launch/pickup traces and captures are linked there. The pending-transaction lifecycle, amount/capacity edges and rejected writes have production-module regression/smoke coverage; this pass does not claim native coverage of every meso variant, foreground/drop overlap, quota failure or portal attempt during a pending transaction. Earlier native storage-failure evidence remains in the interaction report.
