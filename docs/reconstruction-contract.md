# Reconstruction integration contract

Engineering interfaces below are our browser interchange, **not original WZ or original-client APIs**. Coding agents must read and follow [coding-style.md](coding-style.md). Original behavior requires address-bearing evidence; unresolved behavior is reported explicitly.

## Ownership during implementation

- Asset packaging: `client/tools/extract.js`, new `client/tools/atlas.js` and packaging helpers; `docs/asset-delivery.md` and conversion reports.
- Streaming/rendering: `client/src/main.js`, `animation.js`, new streaming/worker modules, `client/index.html`, `client/style.css`; streaming documentation. Do not edit physics modules.
- Physics inventory: `client/tools/physics-data.js`, `docs/physics-options.md`, `docs/physics-options.json`, inventory tools and its own Ghidra output directory.
- Physics motion: `client/src/physics/` except `hitboxes.js`; `docs/physics-evidence.md` and its own Ghidra output directory.
- Hitboxes: `client/src/physics/hitboxes.js`, `docs/hitboxes.md`, its own extraction/research tools and Ghidra output directory.
- Decoder/style migration: existing `client/src/assets/`, `client/tools/scan.js`, `client/tools/dev.js`, existing decoder tests. Parent owns package/lint configuration, integration, validation tooling and final checks.
- Do not run formatters, linters, builds or test suites during concurrent mutation. Read-only original-file/Ghidra experiments are research, not integration validation. Parent verifies the integrated implementation once edits settle.

## Physics data

`client/tools/physics-data.js` exports `readPhysicsData(map, physics)` where both arguments are existing parsed `WzNode` roots; `physics` is the original global physics IMG discovered by inventory. Return JSON-safe:

```
{ schemaVersion: 1, globals: { originalKey: scalar },
  map: { originalInfoKey: scalar },
  footholds: [{ id, layer, group, x1, y1, x2, y2, prev, next, properties }],
  ladders: [{ id, x, y1, y2, ladder, uf, page, properties }],
  portals: [{ id, x, y, name, type, targetMap, targetName }],
  areas: [{ id, properties }], unsupported: [{ path, reason }] }
```

Keep original property names/scalars in globals/map/properties. Preserve unknown fields instead of guessing. Inventory communicates the original physics IMG path to packaging and motion owners. All map footholds are modest collision metadata and may arrive together; map artwork must stream by region.

## Motion and bounds

`client/src/physics/simulation.js` exports:

- `createSimulation(world, {x,y})`: validate world and initialize reusable state.
- `advanceSimulation(sim, input, elapsedMs)`: mutate state using bounded, refresh-independent integration. Input is a reusable object with `left,right,up,down,jump,attack` held booleans and `jumpPressed` edge boolean. An accepted edge sets `input.jumpPressed=false`. Sim tracks held-key edges as needed.
- `snapshotSimulation(sim)`: allocate an inspection snapshot outside the hot loop.

Observable state: `x,y,vx,vy,state,footholdId,ladderId,facing,action,effectiveSettings,blocked,diagnostics`. State/action strings are documented by the motion owner. `blocked` names unsupported active behavior; no hidden fallback constants. Renderer uses supported avatar actions without claiming missing original artwork was reconstructed.

`client/src/physics/hitboxes.js` exports `createHitboxState()` and `updateHitboxes(output, sim, context)`; update mutates reusable rectangle slots. Context contains `action,frame,elapsedMs,attacking`. Each shape has `active,left,top,right,bottom,verified,evidence`; output has `body,attack,damage` and explicit unknown/unsupported status. Do not use sprite rectangles for body/attack/damage bounds. The hitbox owner documents recovered state dependencies and any necessary extra original data.

## Versioned asset streaming

`/generated/catalog.json`:

```
{ schemaVersion: 2, buildId, defaultMap,
  maps: { mapId: { url, sha256, bytes, neighbors: [mapId] } } }
```

Per-map manifest:

```
{ schemaVersion: 2, id, source, bounds, camera, physics,
  textures: { textureId: { atlas, x, y, width, height } },
  atlases: { atlasId: { url, sha256, bytes, width, height } },
  actors: [Entity],
  regions: [{ id, bounds, url, sha256, bytes, atlases: [atlasId], always: boolean }],
  evidence: [string] }
```

A region JSON is `{schemaVersion:2,id,entities:[Entity]}`. Entity/frame/part semantics are retained from [scene-contract.md](scene-contract.md), including original alpha, origin offsets, layering, and animation delays. `actors` contains the composed character; other entities belong to a single region, with spanning/repeating backgrounds in `always` regions. Texture IDs remain original decoded pixel identities. Atlas/region/map paths are content-addressed and deterministic, using shared global output directories for identical resources. Transparent RGBA pixels must round-trip exactly. Atlas limits/padding are documented browser engineering policies.

The initial visible regions, always regions and actor atlas set are the critical load; distant artwork is not. Runtime loads nearby regions ahead, cancels obsolete demand, keeps current complete visual state during map replacement, and enforces explicit GPU/CPU/cache bounds. Regions only become visible atomically after their required atlas set is ready. Leaving a region releases its references; shared atlas resources remain while referenced. Catalog map neighbors drive bounded map-prefetch metadata; traversal beyond packaged maps is explicitly unavailable, not a broken request.

Existing all-at-once scene loading is replaced, not retained as a second supported production path. Parent migrates validation tools to this version. Packaging keeps `bun run extract` as the entry point, accepts `--map` or `--maps` and the existing asset-path override. Default map remains Henesys. Additional original map selection is evidence-driven.

## Integration amendments

- Entities require `order`, the global extraction-array index before region partitioning; runtime tie ordering must not depend on fetch completion order.
- Optional frame `sourceSize:{width,height}` retains an oversized original canvas's logical size after lossless tiling. Default background repeat periods use this size, not tile or atlas size. Tile parts preserve provenance through `sourceCanvas` and `sourceRect`.
- Optional catalog `hitboxes` is an immutable resource descriptor for `extractHitboxReferences(image)` output: versioned, explicitly labeled geometry previews. Recovered geometry does not prove activation timing or damage application.
- Hitbox context may include explicitly resolved `attack`, `damage` or `body` descriptors; supported families and required fields are defined in `client/tools/hitbox-data.js` and `docs/hitboxes.md`. Preview shapes report geometry validity separately from `activationKnown`/`damaging`.
