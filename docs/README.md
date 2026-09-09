# Maple original-asset browser client

Plain JavaScript + JSDoc, Bun workspaces, PixiJS WebGL. Original v83 assets are decoded locally; no third-party client is an implementation source. `server/` contains only its reserved package manifest. No backend implementation.

## Documentation conventions

`docs/` is the source of truth for project guidance, contracts, recovered behavior, and validation.

All coding agents must follow [coding-style.md](coding-style.md), including its JavaScript adaptations of the Power of Ten. [reconstruction-contract.md](reconstruction-contract.md) defines the current subsystem interfaces and ownership.

- The [root README](../README.md) is a short introduction and quick start for humans.
- [AGENTS.md](../AGENTS.md) is navigation only: links to the relevant documentation and implementation, not a separate set of requirements or findings.
- Update the authoritative page here when behavior or guidance changes; keep root entry points brief and linked rather than duplicating detailed documentation.
- Record recovered behavior with original input identities and source locations or Ghidra addresses. Label inference and unverified behavior explicitly.
- Keep measured results separate from procedures: [validation-method.md](validation-method.md) defines world-oracle and integrated checks; [offline-gameplay.md](offline-gameplay.md) records the current local-gameplay checklist. [validation.md](validation.md) indexes the latest original-behavior corrections and the historical rendering baseline. [ingame-validation/results.md](ingame-validation/results.md) and [physics-validation/results.md](physics-validation/results.md) retain earlier integrated and movement runs.

## Run

From the workspace root:

```sh
bun install --frozen-lockfile
bun run extract
bun run dev
```

Open **http://127.0.0.1:3100**. The development server binds loopback and builds the browser bundle with Bun at startup; restart it after source changes. It serves only the client surface and generated assets, not the original input directory.

`bun run extract` defaults to `/Users/k/Development/tensorfish/Maplestory-Client`. Its eight acceptance seeds expand through supported original named portal routes to **356 maps**, including ordinary terrain, water, flight, ice, NPC/Pig quest paths and 57 reactor maps. Override inputs with `--assets <existing-directory>` or `MAPLE_ASSETS`; `--map <id>` or `--maps <comma-separated-ids>` explicitly limits selection. Packaging does not authorize special scripts or unsupported mechanics. [Portal closure evidence](ingame-portals.md) names admitted and blocked routes.

Drop extraction also requires the authorized Cosmic server-reference checkout at `/Users/k/Development/tensorfish/MapleStory-Server`, or `MAPLE_SERVER_REFERENCE=<checkout>`. It reads `src/main/resources/db/data/152-drop-data.sql`; this is server-reference data, not original Nexon client/server source. [Drop provenance and local policy](offline-combat.md#per-mob-drops-and-durable-pickup) separate these inputs from original item artwork.

```sh
bun run scan       # full Map/Character/UI IMG metadata + checksum sweep
bun test           # decoding, animation, physics and input boundary regressions
bun run lint       # strict JavaScript checks; zero warnings
bun run validate   # real Chrome keyboard/WebGL, atlas oracle, loading/performance
bun run format
```

`validate` uses installed Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; `--chrome`, `--url`, `--duration`, and `--output` override its settings. The server must already be running. Missing original assets fail explicitly; the browser never substitutes fabricated demo artwork.

`bun client/tools/ingame-inventory.js` regenerates the lossless metadata inventory without decoding pixels or audio. Its optional positional arguments are the original-input directory and inventory output directory. See [ingame-inventory.md](ingame-inventory.md) for exact coverage and archive-member lookup.

## Documentation site

The documentation site uses **VitePress**, JavaScript configuration with JSDoc, and Bun. It builds from the retained documentation without extracting or installing the original game inputs.

```sh
bun install --frozen-lockfile
bun run docs:dev --host 127.0.0.1
bun run docs:build
bun run docs:preview --host 127.0.0.1
```

Development defaults to port5173; the built preview uses port4173. Navigation covers setup, architecture, asset decoding/streaming, physics, UI, offline gameplay, reverse-engineering evidence and browser validation. Local search indexes the authored pages. Generated `.vitepress/cache` and `.vitepress/dist` are ignored.

Keep implementation contracts and measured results synchronized on their existing authoritative pages. Markdown pages and embedded images remain local; checked source-file, archive and directory links resolve to their exact repository locations instead of copying the entire evidence archive into the site. Missing raw targets and dead page links fail the build. Run the build and inspect the actual browser surface before publishing documentation changes.

The [earlier full-route site browser report](client-audit/site/browser.json) records its 32 routes, native local search to the audit's performance section, exact repository evidence links, and a 390-pixel article with native menu/cross-route/backdrop interaction. All three embedded audit figures loaded. Retained captures: [desktop](client-audit/site/desktop.png), [search](client-audit/site/search.png), [mobile article](client-audit/site/mobile.png), and [mobile menu](client-audit/site/mobile-menu.png). No page-script or same-origin resource errors occurred in that route pass. The [31-route baseline](validation/docs-site/browser.json) is also historical. The [correction-wave report](ingame-validation/fidelity/report.json) separately records native navigation through the newer skill, profile and agent contracts; it does not claim another complete route sweep.

## Structure

- `client/src/assets/`: bounded archive IO, recovered WZ crypto/strings/directories/properties, canvas inflation/pixels, lossless PNG encoding. Decoder runs under Bun, off the browser render thread.
- `client/tools/extract.js`, `atlas.js`, `canvas-tiles.js`, `packaging.js`: original IMG loading, avatar assembly, lossless atlas/oversized-canvas conversion, independently downloadable regions and atomic versioned catalog.
- `client/src/main.js`, `animation.js`, `stream-*.js`, `atlas-worker.js`: progressive loading, bounded caches, worker decode, staged uploads and persistent WebGL display objects.
- `client/src/physics/`: recovered fixed-step movement, foothold transitions, buoyant modes, ladders and explicitly qualified hitbox geometry.
- `client/src/debug-overlay.js`, `hitbox-inspector.js`: foothold IDs/connections, player receiver/contact inspection, velocity/settings and original geometry previews.
- `client/tools/{ui,portal,life,audiovisual}-data.js`: original in-game extraction through the shared decoder and packer.
- `client/src/ingame.js`, `game-ui.js`, `ui-*.js`, `keymap.js`, `key-bindings.js`, `item-use.js`, `portal-system.js`, `life-system.js`, `audiovisual-system.js`: integrated field/UI/input owners; `visual-resources.js` shares atlas ownership and `audio-engine.js` owns bounded native PCM.
- `client/src/offline-*.js`, `quest-*.js`, `profile-*.js`, `reactor-system.js`: fixed-tick local gameplay, declarative quest transactions, versioned IndexedDB persistence and original data-driven reactor transitions.
- `client/src/character-development.js`, `skill-system.js`, `skill-resources.js`, `client/tools/skill-data.js`: validated persistent character edits, learned-skill admission and bounded original-resource ownership. See [character development](offline-profile.md) and [skill coverage](skills.md).
- `client/src/passive-recovery.js`, `player-name.js`, `revival.js`: recovered field recovery, plain world-name presentation and death-confirmation routing.
- `client/src/agent-*.js`, `player-actions.js`, `player-input.js`: opt-in normal player control, bounded observations and reversible fixed-tick experiments; see the [agent interface](agent-interface.md).
- `client/public/service-worker.js`, `offline-manifest.js`, `client/tools/release-manifest.js`: complete verified release installation and pinned offline launch, separate from character saves.
- `client/tools/validate.js`: independent Canvas2D pixel oracle, screenshots, state transitions, real rAF/loading/heap measurements.
- `client/public/generated/`, `client/dist/`: generated, gitignored. Original artwork is not bundled into the source package.
- `server/package.json`: reserved Bun workspace; no backend, mock service, or pretend networking.

Click empty map space for keyboard play. Arrows move/climb; **Alt jumps**, Down+bound Jump requests eligible drop-through, Up enters supported portals, and **Control attacks**. Recovered defaults are I/E/S/K for Item/Equip/Stat/Skill, **M MiniMap, Backslash Set Key, Q Quest, [ ShortCut and ] QuickSlot**. **Z picks up** eligible nearby local drops. Enter opens chat and accepted All-channel text produces a five-second local, not-sent speech bubble. Escape closes the top window or opens the menu. KeyConfig edits a live nonmodal draft; parent OK persists, while dirty close offers original Save/Discard and the nested quick-key popup owns a separate draft. See the [full UI/input contract](ingame-ui.md).

Pause, reload, key bindings and audio controls are visible; diagnostics remain in collapsed advanced sections. The first trusted pointer/key interaction unlocks enabled original audio; **Enable / resume audio** remains an explicit retry. Saved BGM/SE mute and volume are preserved. Received damage uses Violet digits, natural HP recovery uses Blue, and ordinary death opens the original confirmation before return-map revival. The [combat contract](offline-combat.md) distinguishes recovered presentation from local damage/AI rules.

Agent control is off by default. The header's trusted **Allow agent control** grants temporary permission; native human input interrupts it immediately. `window.maple.agent` routes normal actions and observes the actual game. Separate `window.maple.dev.scenarios` retains the durable baseline while running a labeled memory-only experiment, with recording/replay and an always-available Exit control. [Permission, command schemas and replay boundaries](agent-interface.md) are documented separately from original gameplay evidence.

**Schema4** checkpoints character, AP, inventory/equipment, quests, location, audio/chat settings, bindings, ten SP pools and independent learned/master/expiration records together in IndexedDB. Valid v1/v2/v3 saves migrate without granting skills or points. The sidebar's [persistent character editor](offline-profile.md) commits validated changed fields atomically; [supported skills](skills.md) use actual learned ranks and normal input authority. Owned recovery items share a200ms throttle and consume even at full vitals. Supported Cosmic-reference drops use original item metadata and durable pickup; starter items and unsupported loot rules are not fabricated. Corrupt/future saves and concurrent writers fail visibly. Complete-release installation pins verified assets separately; site-data deletion/eviction remains outside the save guarantee.

## Evidence and results

- [inputs.md](inputs.md), [input-manifest.json](input-manifest.json): exact original inputs and hashes.
- [asset-evidence.md](asset-evidence.md): original DLL addresses, recovered layouts, compression, pixel conversion and object envelopes.
- [client-evidence.md](client-evidence.md): unpacked executable paths/version, layering, timing, background/camera contracts, Ghidra analysis corrections.
- [client-audit.md](client-audit.md): systematic callable/subsystem coverage, recovered priority corrections, independent native scenarios and surviving reference gaps.
- [physics-options.md](physics-options.md), [physics-options.json](physics-options.json): original properties, consumers, defaults, overrides, unknowns and full metadata coverage.
- [physics-evidence.md](physics-evidence.md), [physics-refinements.md](physics-refinements.md), [hitboxes.md](hitboxes.md): recovered motion/geometry formulas and remaining fidelity limits.
- [ingame-inventory.md](ingame-inventory.md), [ingame-inventory/index.json](ingame-inventory/index.json): priority inventory, complete selected metadata and omissions.
- [ingame-ui.md](ingame-ui.md), [ingame-portals.md](ingame-portals.md), [ingame-life.md](ingame-life.md), [ingame-audiovisual.md](ingame-audiovisual.md): original consumers, implemented contracts, complete branch/placement ledgers and unsupported behavior.
- [asset-delivery.md](asset-delivery.md), [streaming.md](streaming.md): reproducible bundles, atlas preservation, demand/cancellation and memory policies.
- [offline-combat.md](offline-combat.md), [ingame-quests.md](ingame-quests.md), [offline-saves.md](offline-saves.md), [offline-gameplay.md](offline-gameplay.md): local rules, supported declarative paths, persistence contracts and current executed acceptance.
- [windows-reference-captures.md](windows-reference-captures.md): missing original-source/reference inputs and requested Windows scenarios.
- [extraction.json](extraction.json), [archive-scan.json](archive-scan.json): actual decoding coverage and byte counts.
- [Current validation](validation.md#current-interaction-correction-acceptance) and the [interaction report](ingame-validation/interaction-corrections/report.json): latest source/asset identities, native-input workflows, failure injection, retained screenshots, viewport/performance measurements and140-test/822-assertion verification. The [skill contract](skills.md) distinguishes all534 catalogued skills from ten supported passive consumers, four self-stat buffs and two sword attacks.
- [ingame-validation/](ingame-validation/): integrated actual-input screenshots, waveform and runtime evidence. [physics-validation/results.md](physics-validation/results.md) and [physics-validation/report.json](physics-validation/report.json) retain the earlier movement pass; [validation/report.json](validation/report.json) retains the rendering-only baseline.
- The [earlier systematic audit](client-audit.md) records 25 native UI scenarios, independent chat/combat evidence, its defect replays, 66 regressions/414 assertions and a 410-check integrated pass. Those counts describe that historical run, not the later correction wave. Neither browser agreement nor recovered artwork establishes original Windows fidelity.
- `ghidra-assets/`, `ghidra-client/`, `tools/`: retained address-bearing evidence and reproducible Ghidra scripts. Decompiled C is evidence, **not original source**.

## Deliberate boundaries and unverified fidelity

This is a client-first reconstruction with playable **local offline authority**, not the complete original game or a completed fidelity claim. Networking, accounts and backend implementation remain absent. Local mobs/combat/progression, supported declarative quests, durable state, portals/reactors, Cosmic-reference per-mob drops with original item assets, and complete-release offline launch are implemented. Server AI, arbitrary scripts, unsupported skill/projectile/summon controllers and original progression/damage equations are not invented; local policies and unavailable dependencies remain explicit.

The fixed original loadout includes body/head, face, hair, coat, pants, shoes and weapon 1302000. All 34 standard action names plus nine ordinary aliases are composed through the recovered anchor forest, including the disconnected hand and original death substitution. General equipment conflict arbitration, advanced skill transformations and arbitrary loadouts remain outside this contract. Entry uses the exact named portal at `(x,y-10)` and ordinary depth follows recovered contact plane/group rules. See [avatar-actions.md](avatar-actions.md).

Player follow and interpolation between recovered 30-ms states are browser presentation policies, not recovered original camera smoothing. Follow bounds use original VR rules; other viewport sizes generalize their half-extents. Whole compositions and camera positions project to signed integer world pixels before GPU submission, avoiding half-pixel blur and per-vertex rounding distortion. Manual camera inspection remains available. Background displacement/repetition and integer alpha are recovered, but absolute original startup attachment, special resize backgrounds, non-normal blends and original equal-z ties remain qualified. Stable extraction order survives region loading.

No original C/C++ source, gameplay recordings or input traces were found in the supplied tree, and the original cannot run on this Mac. Pixel checks use independently composited extracted assets, not original-client captures. Deterministic refresh partitioning is distinct from physically testing every refresh rate. See the Windows reference request before interpreting any browser measurement as original parity.

The archive reader targets the recovered encrypted v83 archive mode. Alternative object headers, nonzero Property headers, the complete List.wz mode-selection policy and uncommon object classes remain unsupported. Selected original MP3 envelopes and encoded bytes are preserved exactly and decoded natively in the browser; original DirectSound mixer/device parity, BGM fade interpolation and settings-slider mapping remain unresolved. DXT3 is identified from the original renderer and tested with synthetic blocks; the scanned original archives did not supply a DXT3 canvas example. Original RGB565 software rounding is reproduced; GPU hardware rounding may differ.
