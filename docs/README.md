# Maple original-asset browser client

Plain JavaScript + JSDoc, Bun workspaces, PixiJS WebGL. Original v83 assets are decoded locally; no third-party client is an implementation source. `server/` contains only its reserved package manifest. No backend implementation.

## Run

From the workspace root:

```sh
bun install --frozen-lockfile
bun run extract
bun run dev
```

Open **http://127.0.0.1:3100**. The development server binds loopback and builds the browser bundle with Bun at startup; restart it after source changes. It serves only the client surface and generated assets, not the original input directory.

`bun run extract` defaults to the supplied `/Users/k/Development/tensorfish/Maplestory-Client` directory and the original Henesys map `100000000`. Override with `--assets <existing-directory>` or `MAPLE_ASSETS`; select an existing nine-digit map ID with `--map`. The explicitly exercised map is Henesys. Other maps can contain unsupported behaviors and are not claimed fully reconstructed.

```sh
bun run scan       # full Map/Character/UI IMG metadata + checksum sweep
bun test           # decoding boundaries, timing, integer-alpha regressions
bun run validate   # actual Chrome/WebGL pixels, controlled changes, performance
bun run format
```

`validate` uses installed Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; `--chrome`, `--url`, `--duration`, and `--output` override its settings. The server must already be running. Missing original assets fail explicitly; the browser never substitutes fabricated demo artwork.

## Structure

- `client/src/assets/`: bounded archive IO, recovered WZ crypto/strings/directories/properties, canvas inflation/pixels, lossless PNG encoding. Decoder runs under Bun, off the browser render thread.
- `client/tools/extract.js`: checksum-checked original IMG loading, map resource resolution, avatar anchor assembly, content-addressed texture output and scene manifest.
- `client/src/main.js`, `animation.js`: asynchronous image decode/upload, atomic scene swaps, persistent sprites, original map depth equations, frame timing and integer alpha, background repetition/parallax.
- `client/tools/validate.js`: independent Canvas2D pixel oracle, screenshots, state transitions, real rAF/loading/heap measurements.
- `client/public/generated/`, `client/dist/`: generated, gitignored. Original artwork is not bundled into the source package.
- `server/package.json`: reserved Bun workspace; no backend, mock service, or pretend networking.

Controls select actions/entities, visibility, front/back ordering, camera movement, pause/step, and asset reload. The validation API is documented in [scene-contract.md](scene-contract.md). The manifest is our interchange, **not an invented claim about WZ**.

## Evidence and results

- [inputs.md](inputs.md), [input-manifest.json](input-manifest.json): exact original inputs and hashes.
- [asset-evidence.md](asset-evidence.md): original DLL addresses, recovered layouts, compression, pixel conversion and object envelopes.
- [client-evidence.md](client-evidence.md): unpacked executable paths/version, layering, timing, background/camera contracts, Ghidra analysis corrections.
- [extraction.json](extraction.json), [archive-scan.json](archive-scan.json): actual decoding coverage and byte counts.
- [validation.md](validation.md), [validation/report.json](validation/report.json): observed verification and performance, with captures in `validation/`.
- `ghidra-assets/`, `ghidra-client/`, `tools/`: retained address-bearing evidence and reproducible Ghidra scripts. Decompiled C is evidence, **not original source**.

## Deliberate boundaries and unverified fidelity

This is an operational client-first rendering/decoding reconstruction, **not the complete MapleStory client**. Gameplay, networking, account flow, combat, NPC/mob simulation, audio playback, and a backend are not implemented.

The demo uses original body/head, face, hair, coat, pants, and shoes with `stand1`, `walk1`, `jump`, `prone`, `ladder`, `rope`, and `sit`. Original anchor names and origins are recovered, but the complete original anchor solver, smap equipment hiding, weapon-dependent actions, and actor/foothold depth are not. The unarmed demo does not offer `alert`: its `lHand` requires the unresolved `handMove` attachment. Actor placement is the original spawn portal position without gravity; its demo depth is explicitly selected, not claimed recovered gameplay placement.

Camera controls are free inspection controls, not the original camera-follow implementation. Background displacement/repetition and integer alpha are recovered, but their absolute original startup attachment position is unverified. The demo attaches parallax at its own initial camera. Nonzero-scale background seam conventions, special resize backgrounds, non-normal blend modes, action-remapping/rotation/movement effects and equal-z original tie order are not claimed exact. Stable source order is used for ties. Absent VR bounds use an explicitly approximate foothold-derived inspection rectangle, not the original geometry-global fallback.

The supplied inputs contain no original gameplay screenshots/video or original source. No Windows client was executed. Pixel tests compare the reconstruction to independently composited extracted assets, not to an original-client capture. No claim of pixel-perfect original parity. Actual display testing ran at 60 Hz; 144 Hz timing partitioning is regression-tested, not physically display-verified.

The archive reader targets the recovered encrypted v83 archive mode. Alternative object headers, nonzero Property headers, the complete List.wz mode-selection policy and uncommon object classes remain unsupported. Sound envelopes and encoded bytes are preserved, not audio-decoded. DXT3 is identified from the original renderer and tested with synthetic blocks; the scanned original archives did not supply a DXT3 canvas example. Original RGB565 software rounding is reproduced; GPU hardware rounding may differ.
