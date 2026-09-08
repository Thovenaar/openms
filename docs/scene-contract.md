# Browser scene and inspection contract

This is our versioned interchange, **not an original WZ format or original-client API**. Coding rules are in [coding-style.md](coding-style.md); subsystem schemas are in [reconstruction-contract.md](reconstruction-contract.md).

## Bundles

`/generated/catalog.json` is the atomic mutable entry point: schema version 2, content-derived `buildId`, `defaultMap`, per-map immutable resource descriptors and packaged neighbor IDs. `hitboxes` points to small original-metadata geometry previews, not combat activation data. `ui` and `audiovisual` index separately demand-loaded original UI, minimap, sound and effect resources; both participate in `buildId`. Resource descriptors contain `url`, SHA-256 and exact encoded byte length.

Each map manifest contains bounds, initial camera, complete collision/physics metadata, character actors, texture subrect descriptors, atlas descriptors and independently fetchable region descriptors. Region JSON contains entities, including original portal graphics and explicitly non-authoritative life previews. `portalPresentation` describes graphics against the existing `physics.portals` and `physics.map.$portalProperties`; `life` retains authored placements, templates and geometry separately from server-owned live actors. Original artwork is losslessly packed into content-addressed PNG atlases shared across maps/regions/UI/effects. Only visible/always/actor and initial HUD dependencies are critical; other windows/effects load on demand. The prior `/generated/scene.json` all-at-once path is no longer supported.

Independent visual bundles use `{schemaVersion:1,id,entities,metadata,textures,atlases}`.
They share the existing hash-verified network, lossless atlas packing, worker decode,
upload admission and refcounted atlas store; they are not a second rendering/decoding path.
Sound descriptors retain original encoded MP3 bytes and Sound_DX8 metadata. Native
decoded PCM has separate bounded ownership and byte accounting.

## Entities and frames

Entity fields: `id`, `kind` (`map`, `character`, `ui`, `portal`, `mob`, `npc` or `effect`), `x,y`, depth `z`, stable `order`, `visible`, `flip`, `opacity`, selected `action`, and `actions` mapping names to frame arrays. Map entities use world coordinates; UI bundle entities use their component-local coordinates. `order` is the extraction-array index, preserved across region partitioning and asynchronous arrivals. It preserves stable input order, not proof of original-client equal-depth tie semantics.

A frame has `delay` in milliseconds and `parts`. A part has a texture ID, local `x,y,z`, optional horizontal `flip`, and optional `opacity`. Local positions already include original canvas origin and avatar anchors. Entity depth then source order determine entity draw order; part depth then source order determine local draw order.

Optional frame `alphaEnd` uses original signed-integer 8-bit interpolation from part opacity over positive frame delay. One-frame character poses may have zero delay; multiframe animations require positive delays. Original endpoint carry behavior is preserved by extraction, with unresolved original cases noted in the evidence.

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

Click the map to focus gameplay. Arrows move/climb; Space jumps; Down+Space requests drop-through; Up requests supported offline portal traversal. I/E/S/K open inventory/equipment/stat/skill presentation; UI consumes S rather than treating it as the former WASD down alias. Browser camera/debug/pause/step controls remain independent. Unsupported attacks/server state remain explicit, not fabricated movement/artwork/combat. Audio requires an actual enable gesture; BGM/SE volume/mute and effect previews are labeled reconstruction controls.

Body receiver geometry is separate from the foothold contact point. Attack/damage preview geometry, where provided, must not be presented as a verified damaging frame or an implemented combat system. External parity requires [original Windows references](windows-reference-captures.md), not just browser self-consistency.
