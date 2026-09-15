# Online browser scene contract

This is the OpenMS browser interchange, not an original WZ format or original-client API. [Online integration](reconstruction-contract.md) owns the client/server boundary; [coding style](coding-style.md) owns implementation rules.

## Catalog and map bundles

`/generated/catalog.json` is the mutable asset entry point. Schema version 2 contains a content-derived `buildId`, map descriptors, packaged neighbor IDs, names and independent UI/audio/effect indexes. The server handshake supplies the required asset build and catalog hash; the browser hashes the catalog before accepting it.

Resource descriptors contain an absolute generated URL, SHA-256 and exact encoded byte length. Generated resources are immutable and content-addressed. HTTP compression may reduce transfer bytes without changing descriptor identity.

Map manifests contain bounds, camera data, original physics, visual entities, texture/atlas descriptors and independently loadable regions. Authored monster and NPC placements remain distinct from live server entities. The server owns spawn, movement, combat, drops, reactors, portals and quest outcomes; map data and artwork do not authorize those outcomes by themselves.

Independent visual bundles use `{schemaVersion:1,id,entities,metadata,textures,atlases}`. They share the same verified network, lossless atlases, worker decode, upload admission and reference-counted atlas store. Sound descriptors retain original encoded bytes and recovered metadata; decoded PCM has separate bounded ownership.

## Entities and animation frames

Visual entity fields include `id`, `kind`, `x`, `y`, depth `z`, stable `order`, visibility, flip, opacity, selected action and an action-to-frames map. Map entities use world coordinates. UI-bundle entities use component-local coordinates.

A frame has a nonnegative millisecond `delay` and `parts`. Each part names a texture plus local position/depth and optional flip/opacity. Extracted local positions already include original canvas origins and avatar anchors. Entity depth then source order determines entity ordering; part depth then source order determines composition inside an entity.

Zero-delay frames remain zero and are consumed at the same animation time. Zero-duration alpha transitions apply immediately. A wholly zero-duration clip holds its final frame as a finite browser policy.

The first frame may carry an original `repeat` integer. `-1` and `-2` select one-shot playback; a nonnegative value identifies the first frame in a repeating suffix. It is not a repeat count. Extraction validates that the suffix index exists.

Oversized canvases split into lossless parts with exact offsets. Optional `sourceSize` preserves the logical source dimensions so background repetition does not inherit atlas-tile dimensions. Optional background records retain the original repeat and camera-relative fields documented in [rendering evidence](client-evidence.md).

## Online runtime ownership

The server owns field membership, mobs, combat outcomes and durable character state. The browser owns its character's ordinary XY and velocity and reports them with held input. The server observes those reports, applies the movement watchdog and publishes acknowledgements and controls without correcting ordinary motion. Only initial synchronization and explicitly server-owned transitions replace the local kernel; see [movement ownership](movement-parity.md#client-owned-motion). Remote characters and mobs draw from server observations.

Same-character profile refreshes preserve the current simulation, input history and pending impulses. Flash Jump begins locally at the key press; its accepted server impulse is consumed once. Replayed skill artwork starts at the new cast origin, identified by the published `playbackId`.

A candidate field owns its assets independently. The current complete scene remains visible while a destination loads. A ready candidate commits atomically; failed or superseded candidates release resources without replacing the current scene. Screen UI and audio survive field replacement, while field-owned visuals and effects retire with their scene.

Input is blocked during account/login stages, unresolved field replacement, modal native UI and transport recovery. A same-field skill or inventory refresh does not block movement. Connection loss freezes online command admission. A resumed session can report its local motion for watchdog review; the authenticated baseline then establishes the new connection before prediction resumes.

The browser performs no WZ parsing. PNG decoding runs in a worker; decoded atlas and GPU-upload ownership are bounded. Asset requests have a 30-second idle deadline and five-minute total deadline. Timeout releases request admission and reports a timeout rather than fabricating missing content.

Before login, a bounded [common asset preload](development.md#startup-asset-cache) fills the same persistent cache used by field streaming. Cold startup obtains its catalog, decoration and common assets through one [verified startup pack](asset-delivery.md#startup-pack); warm startup reads the member files locally. The pack is temporary encoded-byte storage, bounded independently to 128 MiB compressed and unpacked. Bundle manifests are validated before following their atlas descriptors; map manifests also declare the region downloads. Duplicate URLs are admitted once, conflicting hashes/lengths fail, and cancellation or failure retires the current batch before returning. The 64 MiB encoded preload allowance is separate from decoded CPU and GPU residency. It does not change map authority, simulation readiness or the existing scene-recovery deadlines.

## Inspection APIs

`window.maple` exposes read-only state and presentation/debug operations:

- `ready`: initialization promise.
- `snapshot()`: current map, loading/presentation, prediction, camera, UI/audio, entity and bounded diagnostic state. `skillVisuals` contains detached effect IDs, source IDs, playback IDs, frame/visibility, rendered position and published target position for appearance checks.
- `setDebug(boolean)` and `setGeometryReference(id)`: demand-load and select diagnostic geometry.
- `setAction(id, action)`: presentation-only action override for non-character, non-mob entities. Live actor poses remain server-owned.
- `setVisible(id, boolean)` and `setLayer(id, z)`: local render previews.
- `setFollow(boolean)` and `setCamera(x, y)`: local camera inspection.
- `mapName(id)` and `monsterCatalog()`: detached catalog lookups.
- `captureAudio(seconds)`: bounded post-gain PCM capture from the actual audio graph.
- `destroy()`: close transport and release browser-owned resources.
- `agent` and `dev`: human-gated normal actions and audited server development operations described in the [agent interface](agent-interface.md).

`window.mapleOnline` exposes online-specific diagnostics:

- `snapshot()`: transport and prediction state.
- `observation()`: current server read model.
- `command(intent)`: submit a closed authenticated gameplay intent.
- `reconnect()`: request transport recovery.
- `project(x, y)`: project a world point through the current scene.

These APIs aid inspection and focused checks. They do not substitute for trusted input when a validation claim requires the real player control path.

## Human controls and evidence

Click empty map space to focus gameplay. Arrows move and climb; Alt jumps; Control attacks; Down plus Jump requests eligible drop-through; Up requests an admitted portal. I/E/S/K open Item/Equip/Stat/Skill, M cycles MiniMap, Backslash opens Set Key, Q opens Quest, `[` opens ShortCut and `]` opens quick slots. Z picks up and Space talks to an admitted nearby NPC.

Native windows operate on server-published state and send closed intents for mutations. Geometry previews never create hitboxes or authorize damage. Browser self-consistency does not establish original Windows parity; external parity still requires the [requested original references](windows-reference-captures.md).
