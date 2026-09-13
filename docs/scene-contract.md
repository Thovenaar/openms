# Browser scene and inspection contract

This is our versioned interchange, **not an original WZ format or original-client API**. Coding rules are in [coding-style.md](coding-style.md); subsystem schemas are in [reconstruction-contract.md](reconstruction-contract.md).

## Bundles

`/generated/catalog.json` is the atomic mutable entry point: schema version 2, content-derived `buildId`, `defaultMap`, immutable map descriptors and packaged neighbor IDs. `hitboxes` retains metadata geometry previews; `ui`, `audiovisual` and `quests` index original UI/minimap, sound/effect and declarative quest dependencies. All participate in release identity. Descriptors contain URL, SHA-256 and exact encoded file length; HTTP gzip may reduce transport bytes without changing the decoded descriptor identity.

`monsters` is a catalog index keyed by original numeric monster ID. Each record is `{id,name,template,mapId}`; for example, Blue Snail100101 resolves `template:"mob:0100101"` from map`001010000`. The descriptor at `maps[mapId]` remains the hash-verified owner of that original life template and its visual dependencies. The index contains only packaged templates, not all original Mob.wz entries, and is not a durable list of spawned actors.

The original Skill visual bundle carries `metadata.books[bookId] = {iconPath,name}`. Its71 records combine unchanged `Skill.wz:<book>.img/info/icon` artwork with `String.wz:Skill.img/<book>/bookName`; book membership and learn/cast admission remain separate skill contracts.

Map manifests contain bounds/camera, original physics, character actors, texture/atlas descriptors and independently fetchable regions. Regions contain ordinary world/portal/NPC artwork. Mob templates remain in `life.renderables`, but gameplay-owned instances are dynamic and do not reset when regions leave demand. `life` keeps authored placements, templates and geometry separate from local live state; `combat` and `reactors` retain their data contracts. Original pixels share lossless content-addressed atlases across maps/UI/effects. Startup verifies the shell/catalog and saved/default map's dependency closure before renderer initialization. Destination-map verification gates field replacement; complete-release installation is optional. Only visible/always/actor and initial HUD dependencies are immediately decoded/uploaded; other runtime residency remains on demand.

Independent visual bundles use `{schemaVersion:1,id,entities,metadata,textures,atlases}`.
They share the existing hash-verified network, lossless atlas packing, worker decode,
upload admission and refcounted atlas store; there is no second resource or image-decoding path.
Sound descriptors retain original encoded MP3 bytes and Sound_DX8 metadata. Native
decoded PCM has separate bounded ownership and byte accounting.

## Entities and frames

Entity fields: `id`, `kind` (`map`, `character`, `ui`, `portal`, `mob`, `npc` or `effect`), `x,y`, depth `z`, stable `order`, `visible`, `flip`, `opacity`, selected `action`, and `actions` mapping names to frame arrays. Map entities use world coordinates; UI bundle entities use their component-local coordinates. `order` is the extraction-array index, preserved across region partitioning and asynchronous arrivals. It preserves stable input order, not proof of original-client equal-depth tie semantics.

A frame has `delay` in milliseconds and `parts`. A part has a texture ID, local `x,y,z`, optional horizontal `flip`, and optional `opacity`. Local positions already include original canvas origin and avatar anchors. Entity depth then source order determine entity draw order; part depth then source order determine local draw order.

Frame delays are nonnegative milliseconds. Original Gr2D stores zero unchanged and consumes equal-time entries at the same update; zero is not a missing-delay fallback. The bounded timeline search skips leading/intermediate zero-duration frames, and one-shots retain their terminal frame. Zero-duration `alphaEnd` applies immediately without division; positive durations retain signed-integer 8-bit interpolation. A wholly zero-duration clip has no positive loop period and holds its final frame as an explicit finite browser policy. See [renderer timing evidence](client-evidence.md#timed-frame-alpha--verified).

The first frame may carry an original action-level `repeat` integer. Negative values `-1` and `-2` select one-shot playback; a nonnegative value identifies the **frame where the repeating suffix starts**, not a repeat count. Extraction preserves this metadata instead of forcing all scenery to loop. Compiled animation timelines retain the suffix offset/duration; advance and seek share the same bounded projection. A consumer may explicitly request loop/once playback. Later frames cannot redefine `repeat`, and a nonnegative index must exist in that action. The login logo's authored `repeat=-1` therefore fades in and stays opaque; authored glow sequences retain both their fade-in and fade-out.

Oversized source canvases are split losslessly into parts with exact local offsets and flip compensation. Optional frame `sourceSize:{width,height}` preserves the logical original canvas dimensions so tiling does not change background repetition periods. Tile provenance retains `sourceCanvas` and `sourceRect`; conversion independently reconstructs the original RGBA buffer.

Optional entity `background:{type,rx,ry,cx,cy}` retains original background fields. Types 0–7 and camera-relative/automatic displacement are documented in [client-evidence.md](client-evidence.md). Zero repeat periods use the logical frame size, not atlas or tile dimensions. Initial background attachment and camera-follow behavior remain explicitly distinguished from original fidelity.

`catalog.ui.bundles.LoginScene` is an independent visual bundle extracted from `UI.wz:MapLogin.img` and its original `Map.wz:Back/login.img` / `Obj/login.img` dependencies through the same scenery extraction path as fields. `LoginScene` owns its bounded entities, original background placement and animation clock; `LoginBackdrop` supplies the native stage camera and UI panels. It does not load a gameplay map, create an actor or grant field authority. Login geometry and native interpolation evidence are recorded in [client-evidence.md](client-evidence.md#native-login-scene-and-stage-geometry).

## Runtime ownership

Simulation owns the character's position, movement state and action selection; keyboard input drives it independently of display cadence. `server/` remains reserved. The browser performs no WZ parsing. PNG decode runs in a dedicated worker; GPU upload admission and caches are bounded browser policies.

Current complete map state stays owned while a candidate loads. Only a ready candidate commits; failed/superseded candidates release resources without replacing the current map. Ordinary native-style field travel additionally waits for the outgoing600ms black boundary before atomic commit, then reveals the destination over600ms. Input/simulation resume at commit, not at the end of reveal. Same-map teleport retains the scene/BGM and uses the original four80ms Teleport frames without global fade. The black browser overlay approximates native global RGB brightness; developer direct map selection/reload remains immediate. Failed travel restores the last-good scene and reverses darkness, without success cues. [Transition evidence](ghidra-client-corrections/transition-contract.json) distinguishes recovered timing from asynchronous browser ownership. Regions commit after their atlas dependencies are ready, and shared resources remain while referenced.

Offline portal traversal validates the packaged target and exact named destination before replacement. Missing or ambiguous names and unavailable maps fail without redirecting. Family travel instead selects authored portal0 by ID, never by its possibly repeated name. Both arrivals use original `(portal.x, portal.y - 10)` feet offset and recovered physics attachment. Up input is dispatched before ladder/physics handling; portal graphics update after animation. Duplicate/stale requests are guarded. Successful local traversal is not original server authorization. Scripted/conditioned portals remain unsupported where their activation cannot be established.

Screen-space UI/audio survive map replacement. HUD artwork/gauges remain Pixi-rendered; non-HUD top-level windows use atlas-borrowing `UIRasterPlane` Canvas2D artwork in the same DOM stacking context as their text/controls. Cursor/carry own a separate topmost DOM plane. Sprite trees still own geometry/animation but are not duplicate-rendered; windows release consumers before atlas leases. [UI ownership](ingame-ui.md#implemented-modules-and-integration) is authoritative for this browser compositor policy.

Field portal/life/gameplay/reactor/drop, skill, player-name, speech and combat-number owners belong to the candidate scene. Ordinary commits transfer the same character's skill timers before destroying the previous owner; temporary stores remain isolated. World overlays survive region refresh, not field replacement. Displays die before their leases, and failed/cancelled candidates cannot attach late resources. UI focus and ordinary canvas blur clear held gameplay input.

`KeyBindings` survives field replacement with screen UI/profile ownership. Physical codes use one shared active map for HUD, carries, macros and native windows. KeyConfig is nonmodal; its Save changes? notice, isolated quick-key popup, UtilDlgEx, native transaction prompts and ordinary revival own modal admission. The outer binding draft previews live; nested OK only updates it, and parent Save/affirmative dirty-close is the durable boundary. Text focus captures input; pending modal loading also blocks gameplay before artwork appears. Schema5 persists committed bindings, AP/SP, learned records, instance inventory and the additional [local profile domains](offline-profile.md). Drafts, cursor/carry, chat history, preview poses and transient throttle timestamps are not saved.

Candidate initialization and subsequent updates use the same actor-pose synchronization: position, original left-authored facing, action and contact-dependent depth are correct before the first draw, even when the scene is paused. A paused reload does not wait for a simulation tick to correct the avatar.

All retained gameplay authority freezes while replacement is loading, including a portal request begun inside `beforePhysics`. The loop rechecks loading/current-scene ownership before advancing. The old scene stays owned beneath any transition darkness, not keyboard-playable. `step(ms)` rejects while loading; incoming reveal itself does not keep destination gameplay locked. Enabling camera follow recomputes and renders immediately even when paused.

The animation driver samples `performance.now()` at callback entry, consistently with pause/focus clock resets. It must not subtract a newer reset from rAF's earlier frame-start timestamp: that produced a negative elapsed value and stopped cached-map transitions. Negative public simulation input still fails; the fix does not clamp or conceal an invalid delta. The executed lifecycle reproduction and corrected pixel comparison are in [physics-validation/lifecycle-smoke.json](physics-validation/lifecycle-smoke.json).

## Inspection API

`window.maple` is for observation and deterministic checks, not a substitute for input-driven gameplay acceptance:

- `ready`: latest map-load promise; `reload()` refreshes the catalog; `switchMap(id)` loads a packaged map.
- `snapshot()`: version/build, current map, packaged map IDs, pause/debug/follow/loading/error state, presentation-layer visibility, camera, held input, physics snapshot, resident entities/regions, field portal/life observations, UI/audio observations, bounded streaming/resource counters and frame/draw metrics. `actorArtworkUnsupported` names an action without reconstructed artwork.
- `pause(boolean)` and `step(ms)`: deterministic stepping requires pause and no pending field replacement, accepts finite0–10000ms and retains the simulation's explicit catch-up bound.
- `setDebug(boolean)` toggles physics geometry/labels/settings; `setFollow(boolean)` toggles the browser camera policy and immediately restores following while paused.
- `setCamera(x,y)` enters manual inspection; `setAction(id,action)`, `setVisible(id,bool)` and `setLayer(id,z)` inspect entities. Simulation resumes ownership of the character's action and contact-dependent depth on its next update; pause for persistent manual inspection.
- `setPosition(id,x,y)` moves non-player entities only; player teleportation is rejected because movement belongs to simulation.
- `setPresentationVisible(boolean)`: explicitly isolate world artwork by hiding UI and the separate world presentation overlay. Used only for scoped interchange-oracle captures, not to claim UI/effect parity.
- `captureAudio(seconds)`: capture up to five seconds of live stereo Float32 PCM after the actual BGM/SE gains; rejects disabled output/invalid or overlapping requests. The result includes bounded raw PCM and RMS/peak/hash metadata. Snapshots retain metadata only.
- `destroy()` cancels loading/scheduling and releases owned scenes, textures, workers, listeners and overlay state.

## Human controls and evidence

Click empty map space to focus gameplay. Arrows move/climb; Alt Jump and Control Attack are recovered defaults. Down+bound Jump requests eligible drop-through; Up requests supported portal traversal. I/E/S/K open Item/Equip/Stat/Skill; M cycles the demand-loaded MiniMap; Backslash opens Set Key, Q Quest, [ ShortCut and ] quick slots. Z picks up; Space talks to an admitted visible nearby NPC; supported Sit, consumables, expressions and learned skill/macro routes use their normal owners. Enter opens chat without granting remote delivery. UserInfo opens through native character double-click semantics; selected local peers remain distinct from the active character. Social, Family, Book, Cash and transaction windows are local operational domains, not server placeholders. The [complete binding ledger](offline-binding-actions.md) distinguishes every route and unavailable original dependency.

Receiver geometry remains distinct from the foothold contact point. Geometry previews do not establish damaging phases: the separate [offline combat authority](offline-combat.md) explicitly supplies local impact timing and equations. Whole world compositions/camera vectors use signed integer projection before GPU submission; simulation remains binary64. External parity requires [original Windows references](windows-reference-captures.md), not browser self-consistency.
