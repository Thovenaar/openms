# Browser scene and inspection contract

This is our versioned interchange, **not an original WZ format or original-client API**. Coding rules are in [coding-style.md](coding-style.md); subsystem schemas are in [reconstruction-contract.md](reconstruction-contract.md).

## Bundles

`/generated/catalog.json` is the atomic mutable entry point: schema version 2, content-derived `buildId`, `defaultMap`, immutable map descriptors and packaged neighbor IDs. `hitboxes` retains metadata geometry previews; `ui`, `audiovisual` and `quests` index original UI/minimap, sound/effect and declarative quest dependencies. All participate in release identity. Descriptors contain URL, SHA-256 and exact encoded file length; HTTP gzip may reduce transport bytes without changing the decoded descriptor identity.

Map manifests contain bounds/camera, original physics, character actors, texture/atlas descriptors and independently fetchable regions. Regions contain ordinary world/portal/NPC artwork. Mob templates remain in `life.renderables`, but gameplay-owned instances are dynamic and do not reset when regions leave demand. `life` keeps authored placements, templates and geometry separate from local live state; `combat` and `reactors` retain their data contracts. Original pixels share lossless content-addressed atlases across maps/UI/effects. Only visible/always/actor and initial HUD dependencies are startup-critical; other content loads on demand.

Independent visual bundles use `{schemaVersion:1,id,entities,metadata,textures,atlases}`.
They share the existing hash-verified network, lossless atlas packing, worker decode,
upload admission and refcounted atlas store; they are not a second rendering/decoding path.
Sound descriptors retain original encoded MP3 bytes and Sound_DX8 metadata. Native
decoded PCM has separate bounded ownership and byte accounting.

## Entities and frames

Entity fields: `id`, `kind` (`map`, `character`, `ui`, `portal`, `mob`, `npc` or `effect`), `x,y`, depth `z`, stable `order`, `visible`, `flip`, `opacity`, selected `action`, and `actions` mapping names to frame arrays. Map entities use world coordinates; UI bundle entities use their component-local coordinates. `order` is the extraction-array index, preserved across region partitioning and asynchronous arrivals. It preserves stable input order, not proof of original-client equal-depth tie semantics.

A frame has `delay` in milliseconds and `parts`. A part has a texture ID, local `x,y,z`, optional horizontal `flip`, and optional `opacity`. Local positions already include original canvas origin and avatar anchors. Entity depth then source order determine entity draw order; part depth then source order determine local draw order.

Frame delays are nonnegative milliseconds. Original Gr2D stores zero unchanged and consumes equal-time entries at the same update; zero is not a missing-delay fallback. The bounded timeline search skips leading/intermediate zero-duration frames, and one-shots retain their terminal frame. Zero-duration `alphaEnd` applies immediately without division; positive durations retain signed-integer 8-bit interpolation. A wholly zero-duration clip has no positive loop period and holds its final frame as an explicit finite browser policy. See [renderer timing evidence](client-evidence.md#timed-frame-alpha--verified).

Oversized source canvases are split losslessly into parts with exact local offsets and flip compensation. Optional frame `sourceSize:{width,height}` preserves the logical original canvas dimensions so tiling does not change background repetition periods. Tile provenance retains `sourceCanvas` and `sourceRect`; conversion independently reconstructs the original RGBA buffer.

Optional entity `background:{type,rx,ry,cx,cy}` retains original background fields. Types 0–7 and camera-relative/automatic displacement are documented in [client-evidence.md](client-evidence.md). Zero repeat periods use the logical frame size, not atlas or tile dimensions. Initial background attachment and camera-follow behavior remain explicitly distinguished from original fidelity.

## Runtime ownership

Simulation owns the character's position, movement state and action selection; keyboard input drives it independently of display cadence. `server/` remains reserved. The browser performs no WZ parsing. PNG decode runs in a dedicated worker; GPU upload admission and caches are bounded browser policies.

Current complete map state remains visible while a candidate map loads. Only a ready candidate commits; failed/superseded candidates release resources without replacing the current map. Regions commit after their atlas dependencies are ready, and shared resources remain while referenced.

Offline portal traversal validates the packaged target and exact named destination
before replacement. Missing or ambiguous names and unavailable maps fail without
redirecting. Arrival uses the original `(portal.x, portal.y - 10)` feet offset and
recovered physics attachment. Up input is dispatched before ladder/physics handling;
portal graphics update after animation. Duplicate/stale requests are guarded.
Successful local traversal is not original server authorization. Scripted/conditioned
portals are explicitly unsupported where their activation cannot be established.

Screen-space UI/audio owners survive map replacement. Field portal/life systems
belong to their candidate scene; a persistent world overlay holds nameplates and
non-authoritative preview geometry/effects across region refresh. Display objects
are destroyed before their shared subtextures/leases. UI focus clears held gameplay
input; ordinary canvas blur also clears it when browser controls take focus.

`KeyBindings` survives field replacement with the screen-owned UI and profile. `keymap.js` maps browser physical `event.code` to recovered records; movement/action owners consume that shared active map, not separate hardcoded aliases. The KeyConfig draft is live and nonmodal, while its quick-key popup and UtilDlgEx are modal. Focused chat/native text controls capture input and clear gameplay state. Committed bindings persist in schema2; edit drafts, cursor state, chat history and item-use throttle timestamps do not.

Candidate initialization and subsequent updates use the same actor-pose synchronization: position, original left-authored facing, action and contact-dependent depth are correct before the first draw, even when the scene is paused. A paused reload does not wait for a simulation tick to correct the avatar.

The animation driver samples `performance.now()` at callback entry, consistently with pause/focus clock resets. It must not subtract a newer reset from rAF's earlier frame-start timestamp: that produced a negative elapsed value and stopped cached-map transitions. Negative public simulation input still fails; the fix does not clamp or conceal an invalid delta. The executed lifecycle reproduction and corrected pixel comparison are in [physics-validation/lifecycle-smoke.json](physics-validation/lifecycle-smoke.json).

## Inspection API

`window.maple` is for observation and deterministic checks, not a substitute for input-driven gameplay acceptance:

- `ready`: latest map-load promise; `reload()` refreshes the catalog; `switchMap(id)` loads a packaged map.
- `snapshot()`: version/build, current map, packaged map IDs, pause/debug/follow/loading/error state, presentation-layer visibility, camera, held input, physics snapshot, resident entities/regions, field portal/life observations, UI/audio observations, bounded streaming/resource counters and frame/draw metrics. `actorArtworkUnsupported` names an action without reconstructed artwork.
- `pause(boolean)` and `step(ms)`: deterministic stepping requires pause, accepts finite 0–10000 ms, and remains subject to the simulation's explicit catch-up bound.
- `setDebug(boolean)` toggles physics geometry/labels/settings; `setFollow(boolean)` toggles the browser camera policy.
- `setCamera(x,y)` enters manual inspection; `setAction(id,action)`, `setVisible(id,bool)` and `setLayer(id,z)` inspect entities. Simulation resumes ownership of the character's action and contact-dependent depth on its next update; pause for persistent manual inspection.
- `setPosition(id,x,y)` moves non-player entities only; player teleportation is rejected because movement belongs to simulation.
- `setPresentationVisible(boolean)`: explicitly isolate world artwork by hiding UI and the separate world presentation overlay. Used only for scoped interchange-oracle captures, not to claim UI/effect parity.
- `captureAudio(seconds)`: capture up to five seconds of live stereo Float32 PCM after the actual BGM/SE gains; rejects disabled output/invalid or overlapping requests. The result includes bounded raw PCM and RMS/peak/hash metadata. Snapshots retain metadata only.
- `destroy()` cancels loading/scheduling and releases owned scenes, textures, workers, listeners and overlay state.

## Human controls and evidence

Click empty map space to focus gameplay. Arrows move/climb; recovered defaults bind Alt to Jump and Control to Attack. Down+the bound Jump requests eligible drop-through; Up requests supported local portal traversal. I/E/S/K open Item/Equip/Stat/Skill, C KeyConfig, H MiniMap, Q Quest and ] quick slots. Enter opens chat without granting message delivery; typing is not gameplay input. Space/Talk, X/Sit and Z/Pickup are not legacy jump/attack aliases and currently report unavailable actions. Nearby NPC artwork invokes the data-backed quest owner. Browser camera/debug/pause/step controls remain inspection; diagnostics and unsupported-operation messages stay in the sidebar rather than the original HUD or chat log. Audio requires a native enable gesture. See [UI/input contracts and pending native acceptance](ingame-ui.md).

Receiver geometry remains distinct from the foothold contact point. Geometry previews do not establish damaging phases: the separate [offline combat authority](offline-combat.md) explicitly supplies local impact timing and equations. Whole world compositions/camera vectors use signed integer projection before GPU submission; simulation remains binary64. External parity requires [original Windows references](windows-reference-captures.md), not browser self-consistency.
