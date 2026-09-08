# Browser scene and inspection contract

This is our versioned interchange, **not an original WZ format or original-client API**. Coding rules are in [coding-style.md](coding-style.md); subsystem schemas are in [reconstruction-contract.md](reconstruction-contract.md).

## Bundles

`/generated/catalog.json` is the atomic mutable entry point: schema version 2, content-derived `buildId`, `defaultMap`, per-map immutable resource descriptors and packaged neighbor IDs. Optional `hitboxes` points to small original-metadata geometry previews, not combat activation data. Resource descriptors contain `url`, SHA-256 and exact encoded byte length.

Each map manifest contains bounds, initial camera, complete collision/physics metadata, character actors, texture subrect descriptors, atlas descriptors and independently fetchable region descriptors. Region JSON contains entities. Original artwork is losslessly packed into content-addressed PNG atlases shared across maps/regions. Only visible/always/actor dependencies are critical for initial play; nearby artwork is prefetched. The prior `/generated/scene.json` all-at-once path is no longer supported by the runtime.

## Entities and frames

Entity fields: `id`, `kind` (`map` or `character`), world `x,y`, depth `z`, stable `order`, `visible`, `flip`, `opacity`, selected `action`, and `actions` mapping names to frame arrays. `order` is the original extraction-array index, preserved across region partitioning and asynchronous arrivals. It preserves the previous stable input order; it is not proof of original-client equal-depth tie semantics.

A frame has `delay` in milliseconds and `parts`. A part has a texture ID, local `x,y,z`, optional horizontal `flip`, and optional `opacity`. Local positions already include original canvas origin and avatar anchors. Entity depth then source order determine entity draw order; part depth then source order determine local draw order.

Optional frame `alphaEnd` uses original signed-integer 8-bit interpolation from part opacity over positive frame delay. One-frame character poses may have zero delay; multiframe animations require positive delays. Original endpoint carry behavior is preserved by extraction, with unresolved original cases noted in the evidence.

Oversized source canvases are split losslessly into parts with exact local offsets and flip compensation. Optional frame `sourceSize:{width,height}` preserves the logical original canvas dimensions so tiling does not change background repetition periods. Tile provenance retains `sourceCanvas` and `sourceRect`; conversion independently reconstructs the original RGBA buffer.

Optional entity `background:{type,rx,ry,cx,cy}` retains original background fields. Types 0–7 and camera-relative/automatic displacement are documented in [client-evidence.md](client-evidence.md). Zero repeat periods use the logical frame size, not atlas or tile dimensions. Initial background attachment and camera-follow behavior remain explicitly distinguished from original fidelity.

## Runtime ownership

Simulation owns the character's position, movement state and action selection; keyboard input drives it independently of display cadence. `server/` remains reserved. The browser performs no WZ parsing. PNG decode runs in a dedicated worker; GPU upload admission and caches are bounded browser policies.

Current complete map state remains visible while a candidate map loads. Only a ready candidate commits; failed/superseded candidates release resources without replacing the current map. Regions commit after their atlas dependencies are ready, and shared resources remain while referenced.

Candidate initialization and subsequent updates use the same actor-pose synchronization: position, original left-authored facing, action and contact-dependent depth are correct before the first draw, even when the scene is paused. A paused reload does not wait for a simulation tick to correct the avatar.

The animation driver samples `performance.now()` at callback entry, consistently with pause/focus clock resets. It must not subtract a newer reset from rAF's earlier frame-start timestamp: that produced a negative elapsed value and stopped cached-map transitions. Negative public simulation input still fails; the fix does not clamp or conceal an invalid delta. The executed lifecycle reproduction and corrected pixel comparison are in [physics-validation/lifecycle-smoke.json](physics-validation/lifecycle-smoke.json).

## Inspection API

`window.maple` is for observation and deterministic checks, not a substitute for input-driven gameplay acceptance:

- `ready`: latest map-load promise; `reload()` refreshes the catalog; `switchMap(id)` loads a packaged map.
- `snapshot()`: version/build, current map, packaged map IDs, pause/debug/follow/loading/error state, camera, held input, physics snapshot, resident entities/regions, pending loads, bounded streaming/resource counters and frame/draw metrics. `actorArtworkUnsupported` names an action without reconstructed artwork.
- `pause(boolean)` and `step(ms)`: deterministic stepping requires pause, accepts finite 0–10000 ms, and remains subject to the simulation's explicit catch-up bound.
- `setDebug(boolean)` toggles physics geometry/labels/settings; `setFollow(boolean)` toggles the browser camera policy.
- `setCamera(x,y)` enters manual inspection; `setAction(id,action)`, `setVisible(id,bool)` and `setLayer(id,z)` inspect entities. Simulation resumes ownership of the character's action and contact-dependent depth on its next update; pause for persistent manual inspection.
- `setPosition(id,x,y)` moves non-player entities only; player teleportation is rejected because movement belongs to simulation.
- `destroy()` cancels loading/scheduling and releases owned scenes, textures, workers, listeners and overlay state.

## Human controls and evidence

Click the map to focus gameplay. Arrows/WASD move and climb; Space jumps; Down+Space requests drop-through; X/left Control requests attack. Requests for unsupported original behavior are diagnostics, not fabricated movement/artwork/combat. Map selection, debug toggle, camera inspection, pause/step and reload are mouse-operable controls.

Body receiver geometry is separate from the foothold contact point. Attack/damage preview geometry, where provided, must not be presented as a verified damaging frame or an implemented combat system. External parity requires [original Windows references](windows-reference-captures.md), not just browser self-consistency.
