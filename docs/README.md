# Maple original-asset browser client

Plain JavaScript + JSDoc, Bun workspaces, PixiJS WebGL. Original v83 assets are decoded locally; no third-party client is an implementation source. `server/` contains only its reserved package manifest. No backend implementation.

## Documentation conventions

`docs/` is the source of truth for project guidance, contracts, recovered behavior, and validation.

All coding agents must follow [coding-style.md](coding-style.md), including its JavaScript adaptations of the Power of Ten. [reconstruction-contract.md](reconstruction-contract.md) defines the current subsystem interfaces and ownership.

- The [root README](../README.md) is a short introduction and quick start for humans.
- [AGENTS.md](../AGENTS.md) is navigation only: links to the relevant documentation and implementation, not a separate set of requirements or findings.
- Update the authoritative page here when behavior or guidance changes; keep root entry points brief and linked rather than duplicating detailed documentation.
- Record recovered behavior with original input identities and source locations or Ghidra addresses. Label inference and unverified behavior explicitly.
- Keep measured results separate from procedures: [validation-method.md](validation-method.md) describes the historical renderer checks; [physics-validation/results.md](physics-validation/results.md) records current movement/streaming acceptance. [validation.md](validation.md) retains the earlier rendering-only baseline. Update results only after executing the checks.

## Run

From the workspace root:

```sh
bun install --frozen-lockfile
bun run extract
bun run dev
```

Open **http://127.0.0.1:3100**. The development server binds loopback and builds the browser bundle with Bun at startup; restart it after source changes. It serves only the client surface and generated assets, not the original input directory.

`bun run extract` defaults to `/Users/k/Development/tensorfish/Maplestory-Client` and packages eight original acceptance maps: `100000000`, `100000001`, `103040000`, `108000500`, `120000000`, `200090500`, `211040000`, and `230000000`. They cover ordinary terrain, connected-map delivery, foothold forces, local water, flight, ice and global swimming. Override the input with `--assets <existing-directory>` or `MAPLE_ASSETS`; use `--map <id>` or `--maps <comma-separated-ids>` for explicit selection. Packaging a map does not establish fidelity of its special scripts or physics options.

```sh
bun run scan       # full Map/Character/UI IMG metadata + checksum sweep
bun test           # decoding, animation and physics boundary regressions
bun run lint       # strict JavaScript checks; zero warnings
bun run validate   # real Chrome keyboard/WebGL, atlas oracle, loading/performance
bun run format
```

`validate` uses installed Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; `--chrome`, `--url`, `--duration`, and `--output` override its settings. The server must already be running. Missing original assets fail explicitly; the browser never substitutes fabricated demo artwork.

## Structure

- `client/src/assets/`: bounded archive IO, recovered WZ crypto/strings/directories/properties, canvas inflation/pixels, lossless PNG encoding. Decoder runs under Bun, off the browser render thread.
- `client/tools/extract.js`, `atlas.js`, `canvas-tiles.js`, `packaging.js`: original IMG loading, avatar assembly, lossless atlas/oversized-canvas conversion, independently downloadable regions and atomic versioned catalog.
- `client/src/main.js`, `animation.js`, `stream-*.js`, `atlas-worker.js`: progressive loading, bounded caches, worker decode, staged uploads and persistent WebGL display objects.
- `client/src/physics/`: recovered fixed-step movement, foothold transitions, buoyant modes, ladders and explicitly qualified hitbox geometry.
- `client/src/debug-overlay.js`, `hitbox-inspector.js`: foothold IDs/connections, player receiver/contact inspection, velocity/settings and original geometry previews.
- `client/tools/validate.js`: independent Canvas2D pixel oracle, screenshots, state transitions, real rAF/loading/heap measurements.
- `client/public/generated/`, `client/dist/`: generated, gitignored. Original artwork is not bundled into the source package.
- `server/package.json`: reserved Bun workspace; no backend, mock service, or pretend networking.

Click the map for keyboard play: arrows/WASD move and climb, Space jumps, Down+Space requests drop-through, and X/left Control requests attack (combat remains unsupported). Mouse controls switch packaged maps, toggle the debug overlay, select original hitbox geometry previews, inspect the camera, pause/step, and reload assets. The [scene contract](scene-contract.md) distinguishes simulation state, interpolated presentation and inspection APIs. Geometry previews are not equipped attacks or verified damaging phases.

## Evidence and results

- [inputs.md](inputs.md), [input-manifest.json](input-manifest.json): exact original inputs and hashes.
- [asset-evidence.md](asset-evidence.md): original DLL addresses, recovered layouts, compression, pixel conversion and object envelopes.
- [client-evidence.md](client-evidence.md): unpacked executable paths/version, layering, timing, background/camera contracts, Ghidra analysis corrections.
- [physics-options.md](physics-options.md), [physics-options.json](physics-options.json): original properties, consumers, defaults, overrides, unknowns and full metadata coverage.
- [physics-evidence.md](physics-evidence.md), [physics-refinements.md](physics-refinements.md), [hitboxes.md](hitboxes.md): recovered motion/geometry formulas and remaining fidelity limits.
- [asset-delivery.md](asset-delivery.md), [streaming.md](streaming.md): reproducible bundles, atlas preservation, demand/cancellation and memory policies.
- [windows-reference-captures.md](windows-reference-captures.md): missing original-source/reference inputs and requested Windows scenarios.
- [extraction.json](extraction.json), [archive-scan.json](archive-scan.json): actual decoding coverage and byte counts.
- [physics-validation/results.md](physics-validation/results.md), [physics-validation/report.json](physics-validation/report.json): current browser checks, independent agent scenarios and measured limitations. [validation.md](validation.md) and [validation/report.json](validation/report.json) retain the historical rendering-only baseline.
- `ghidra-assets/`, `ghidra-client/`, `tools/`: retained address-bearing evidence and reproducible Ghidra scripts. Decompiled C is evidence, **not original source**.

## Deliberate boundaries and unverified fidelity

This is a client-first reconstruction with keyboard-driven movement, **not the complete MapleStory client or a completed fidelity claim**. Networking, account flow, combat, NPC/mob simulation, audio playback and backend implementation remain absent. Physics evidence distinguishes recovered formulas from unresolved transition policies and special modifiers; original-reference parity remains blocked.

The demo uses original body/head, face, hair, coat, pants and shoes with `stand1`, `walk1`, `jump`, `prone`, `ladder`, `rope` and `sit`. Simulation enters ten pixels above the original spawn portal without inventing a foothold, then applies gravity and contact resolution. Ordinary actor depth follows the recovered contact plane/group formula. The complete avatar anchor solver, smap equipment hiding, weapon-dependent actions and dynamic-object depth remain unverified. `alert` still requires unresolved `handMove` attachment behavior; missing original artwork is not fabricated.

Following the player and interpolating between the recovered 30 ms physics states are explicit browser presentation policies, not claims about the original camera or rendering interpolator. Manual camera inspection remains available. Background displacement/repetition and integer alpha are recovered, but absolute startup attachment is unverified. Special resize backgrounds, non-normal blend modes, action-remapping effects and original equal-z ties are not claimed exact. Stable extraction order survives region loading. Absent VR bounds retain the approximate foothold-derived inspection rectangle.

No original C/C++ source, gameplay recordings or input traces were found in the supplied tree, and the original cannot run on this Mac. Pixel checks use independently composited extracted assets, not original-client captures. Deterministic refresh partitioning is distinct from physically testing every refresh rate. See the Windows reference request before interpreting any browser measurement as original parity.

The archive reader targets the recovered encrypted v83 archive mode. Alternative object headers, nonzero Property headers, the complete List.wz mode-selection policy and uncommon object classes remain unsupported. Sound envelopes and encoded bytes are preserved, not audio-decoded. DXT3 is identified from the original renderer and tested with synthetic blocks; the scanned original archives did not supply a DXT3 canvas example. Original RGB565 software rounding is reproduced; GPU hardware rounding may differ.
