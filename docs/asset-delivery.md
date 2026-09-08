# Deterministic original-asset delivery

`bun run extract` packages the original WZ inputs into schema v2. Reproduce the default selection explicitly with:

```sh
bun run extract --maps 100000000,100000001,230000000
```

`--map 100000000` selects a single map. `--assets /path/to/original/files` overrides `MAPLE_ASSETS`. At most 32 unique nine-digit map IDs are accepted. IDs are sorted before conversion, so argument order cannot change the build. No third-party client assets or implementation are used.

## Original selection evidence

Read-only extraction of `Map.wz:Map/Map1/100000000.img` found Henesys, `info.mapMark=Henesys`, `info.swim=0`. `Map/Map1/100000001.img` contains portal `out02` targeting `100000000`, providing an original connected nearby map. `Map/Map2/230000000.img` contains `info.mapMark=AquaRoad`, `info.swim=1`, and `info.bgm=Bgm11/Aquarium`: this is the original water/swim example, not recolored Henesys. All three retain original portal and physics metadata. Global physics comes from **`Map.wz:Physics.img`**, through `readPhysicsData(map, physics)`.

## Publication and ownership

`/generated/catalog.json` is the sole mutable runtime entry point. Its build ID is SHA-256 of the deterministic map descriptor table. Each map descriptor records its immutable URL, SHA-256, exact encoded byte length, and neighbors that are actually packaged. Original unbundled portal targets remain in map physics; they are not advertised as fetchable neighbors.

Maps, regions, and atlases are stored in shared `maps/`, `regions/`, and `atlases/` directories, with SHA-256 filenames derived from their complete encoded bytes. Every immutable resource is completely written before the catalog is atomically renamed. Failed conversion leaves the prior catalog intact. Old unreachable resources may remain cache-addressed; consumers must follow the catalog rather than enumerate the directory. Concurrent extractor processes targeting the same output directory are not supported.

Map manifests contain complete modest collision metadata, actors, texture subrects, atlas descriptors, and independently fetchable region descriptors. Region JSON contains only its owned entities. All original canvas origins, straight alpha (including transparent RGB), animation delays/alpha endpoints, object/tile depth, avatar anchors/equipment depth, flip flags, and camera-relative background metadata retain the existing scene semantics. Texture IDs remain SHA-256 over `width + "x" + height + ":"` followed by decoded original RGBA, not PNG encoding identity.

## Browser engineering limits

- Spatial cells are 1024 × 1024 world pixels. Each non-background entity belongs to its origin cell. Descriptor bounds are the union of all animation frames, including overhang, so demand intersection never clips boundary artwork.
- Every background is conservatively always-loaded because its parallax/repetition may expose it outside its nominal rectangle. Other entities wider or taller than one cell also have individually owned always regions. Actors live in the map manifest.
- Atlas dimensions are at most **2048 × 2048**, a conservative texture/upload policy, not an original-game constant. One zero-filled transparent pixel surrounds each subrect; interiors therefore cannot exceed 2046 in either dimension. Oversized canvases are losslessly partitioned into bounded tiles, never resized. Frame parts expand with original-relative offsets; horizontally flipped parts use `part.x + originalWidth - tile.x - tile.width`. Single-canvas frames retain `sourceSize:{width,height}` for original background repeat periods. Shelf packing trims unused bottom/right canvas area. At most 128 tiles per original canvas and 128 total expanded parts per frame are allowed, matching runtime limits; exhaustion fails before catalog publication.
- Within each deterministic actor/region batch, pixel IDs sort lexically before shelf placement. Previously packaged identical pixels reuse their atlas across regions/maps. This deliberately trades some shared-atlas overfetch for deduplication; atlases never exceed 16 MiB decoded RGBA. Actor resources are packed first. Per-map entity count is bounded at 100,000; WZ traversal has separate parser limits.
- PNG remains lossless RGBA8, without palette conversion, quantization, premultiplication, or color-space transforms. Runtime should sample exact integer subrects with smoothing disabled; zero padding does not reconstruct filtered edge bleed.

## Conversion report schema (v2)

`docs/extraction.json` is written after successful publication. Timing is diagnostic, not part of the build hash.

- `schemaVersion: 2`, `buildId`, `inputDirectory`.
- `maps`: ordered `{id, entities, regions, textures, physics}` counts and original map settings.
- `policy`: `{atlasLimit, padding, regionSize, maxMaps}`.
- `counts`: unique textures, unique atlases, parsed input images, map-region count.
- `bytes`: original decoded RGBA, independently round-tripped RGBA, unique encoded atlas PNG, decoded atlas RGBA (including padding), unique region JSON, encoded map JSON, catalog JSON.
- `inputs`: keyed original `Archive.wz:IMG/path`, with original directory `path,name,type,size,checksum,offset`, SHA-256 of original IMG bytes, and exact original byte length.
- `formats`, `images`, `durationMs`, and explicit `limitations`.
- `pixelRoundTrip`: `{passed:true, method}` exists only after every emitted atlas passes verification. The verifier independently parses PNG chunks, inflates IDAT scanlines, then compares every atlas subrect row against the decoded original bytes. This detects channel changes, incorrect placement, and transparent-RGB loss; it is an executable conversion invariant, not a source-text test. All zero-filter scanlines and decoded dimensions are validated.
- `tiledCanvases`: keyed original full-canvas pixel identity, retaining original dimensions/source/format/scale and each tile's identity/offset/dimensions. Tile identities use the same dimensions-plus-RGBA hash convention. Tile parts also carry `sourceCanvas` and `sourceRect`. Before atlas creation, the converter independently reconstructs every full oversized canvas from its tiles and compares every byte, including transparent RGB; `bytes.tileReconstructionCompared` records this additional proof separately from PNG round-trip comparisons.

The default reconstruction selection contains eight maps: `100000000`, `100000001`, `103040000`, `108000500`, `120000000`, `200090500`, `211040000`, and `230000000`. Browser code never downloads a WZ archive.

## Fidelity boundaries

Original camera fallback is not recovered: when VR fields are absent, the existing foothold-envelope margin remains explicit evidence debt. NPC/mob artwork and global background-effect IMG rendering are not implemented by this packaging slice. Active unsupported physics remains visible in each manifest's inventory; a packaged swim map is not itself proof of swim-motion fidelity. Browser residency/cancellation/upload behavior belongs to the streaming runtime, not this offline converter.
