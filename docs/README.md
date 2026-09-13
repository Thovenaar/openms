# openms.dev client

Plain JavaScript + JSDoc, Bun workspaces, PixiJS WebGL. Original v83 assets are decoded locally; no third-party client is an implementation source. Offline play remains independent; the [Bun server](server/index.md) provides a separate authoritative online runtime backed by PostgreSQL.

## Documentation conventions

`docs/` is the source of truth for project guidance, contracts, recovered behavior, and validation.

All coding agents must follow [coding-style.md](coding-style.md), including its JavaScript adaptations of the Power of Ten. [reconstruction-contract.md](reconstruction-contract.md) defines the current subsystem interfaces and ownership.

- The [root README](../README.md) is a short introduction and quick start for humans.
- [AGENTS.md](../AGENTS.md) indexes the guidance and records the desktop target: minimum viewport800×600; mobile support is not required.
- Update the authoritative page here when behavior or guidance changes; keep root entry points brief and linked rather than duplicating detailed documentation.
- Record recovered behavior with original input identities and source locations or Ghidra addresses. Label inference and unverified behavior explicitly.
- Keep measured results separate from procedures: [validation-method.md](validation-method.md) defines world-oracle and integrated checks; [offline-gameplay.md](offline-gameplay.md) records the current local-gameplay checklist. [validation.md](validation.md) indexes the latest original-behavior corrections and the historical rendering baseline. [ingame-validation/results.md](ingame-validation/results.md) and [physics-validation/results.md](physics-validation/results.md) retain earlier integrated and movement runs.

## Run

From the workspace root:

```sh
bun install --frozen-lockfile
bun tools/openms.js extract
bun run client:dev:offline
```

Open **http://127.0.0.1:3100** by default. Configure the offline listener with `HOST` and `PORT` in the repository-root `.env.client`. The development server builds the browser bundle with Bun at startup; restart it after source or configuration changes. It serves only the client surface and generated assets, not the original input directory.

The startup gate verifies the shell, catalog and saved character's current-map dependency closure before creating the renderer; a new character uses the default map. Other maps verify on entry, not during startup. Historical measurements recorded a48.9MiB Henesys closure versus2,450.1MiB for an optional complete379-map release; they do not measure the expanded inspection-root selection. An intact scoped cache starts without the origin; an uncached offline destination is refused without losing the field. Updates reuse verified bytes and decoded artwork/GPU residency remain demand-bounded. See [delivery lifecycle](asset-delivery.md#native-initialization-and-lifecycle).

`bun tools/openms.js extract` defaults to `/Users/k/Development/tensorfish/Maplestory-Client` and incrementally reuses only verified content-keyed conversion units. It reports elapsed time and current work on **stderr** from startup through cache checks, reference-data scanning, image conversion, map assembly and publication; stdout remains the machine-readable JSON result. Progress is work completed, not an estimated finish time, and success is reported only after publication and cleanup. Its eight acceptance seeds plus source-backed beginner, historical training and jump-course inspection roots expand through supported named portals, supported on-map NPC dependencies and the explicit offline Free Market translation. The observed selection contains **735 packaged maps**; the earlier379-map release remains historical. New profiles start in **Mushroom Town (`000010000`)**; existing saves retain their current map. An explicit map-limited extraction that omits Mushroom Town uses its first selected map. Override inputs with `--assets <existing-directory>` or `MAPLE_ASSETS`; `--map <id>` or `--maps <comma-separated-ids>` explicitly limits selection. Packaging does not authorize blocked scripts, quest admission, course completion or rewards.

Drop and reference-data extraction also requires the authorized Cosmic checkout at `/Users/k/Development/tensorfish/Cosmic`, or `MAPLE_SERVER_REFERENCE=<checkout>`. The converter reads the actual schema, companion data and script inventory without executing SQL or scripts. `catalog.serverData` links immutable domain datasets; existing drop authority consumes the converted per-mob rows. Cosmic is server-reference policy, not original Nexon source. See [data coverage and commands](offline-data.md), [drop motion](drop-motion.md), and [local combat policy](offline-combat.md).

### Online development

After extraction, start these in separate root terminals:

```sh
bun run server:dev
bun run client:dev:online
```

Open **http://127.0.0.1:3102** by default, then log in using the development credentials printed by the server launcher. `.env.client` configures the online listener with `ONLINE_HOST`/`ONLINE_PORT` and its backend connection with `OPENMS_SERVER_URL`; `.env.server` configures the backend listener with `OPENMS_HOST`/`OPENMS_PORT` and pins the browser's exact `OPENMS_ORIGIN`. Loopback remains the default. The online client proxies `/api/` on its own origin. Start the dedicated externally managed Podman PostgreSQL container first; JavaScript does not create or manage a database cluster. See [container setup, scoped environment defaults and production configuration](server/index.md#online-development).

This entry builds a separate original-asset browser shell, without offline release extraction/verification churn. It never opens local character saves or installs an offline service worker. Server snapshots own characters, inventory, field membership, mobs and drops. Shared motion predicts presentation only; errors/disconnection freeze admission rather than granting local authority or merging offline earnings.

Browser presentation is policy, not authority: the online client draws the local player from the newest two authenticated 30 ms kernel states interpolated between fixed-scheduler steps (`OnlinePrediction.interpolate`), the same presentation model the offline client applies to its accumulator, so timer jitter stretches one quantum instead of stalling the pose. Checkpoint restores and replays reproduce states that were already presented and never move the interpolation anchor, and the drawn pose never feeds back into prediction, input pacing or server state. Peers, mobs and drops keep the server's 90 ms publication cadence (`ENTITY_PUBLISH_MS`) and are chased over that interval; they are not per-tick sampled.

Input timing stays inside the authenticated field horizon: both outgoing input and local prediction are capped at the latest authoritative field tick plus the protocol's four-tick lead. The arrival clock and heartbeat RTT choose only within that bound; elapsed browser time cannot expand server permission. Hello duration includes lease/content work and is not an RTT sample. Committed travel invalidates field timing while preserving measured network latency; epoch-less heartbeat data cannot advance field ticks. High-latency hints can therefore arrive late and be retired under server policy rather than widening the accepted lead.

The sign-in, character-selection and Explorer-creation surfaces use the original `UI.wz:Login.img` controls over the recovered `UI.wz:MapLogin.img` scene, not unrelated field scenery. Original background/object animation and the native camera interpolation carry the controls between stages. The roster shows **three characters per page**, each composed from its own authoritative appearance and equipment; arrows expose every account-owned character. Creation follows the recovered **name → appearance** phases, without an invented dice step. The nine appearance rows use only `Etc.wz:MakeCharInfo.img/Info` choices and authored labels, with gender last; every offered appearance is packaged and the server admits against the same table. Only Explorer creation is supported; there is no fabricated race, world or channel authority.

**Homepage** opens [docs.openms.dev](https://docs.openms.dev). **Register** opens a separate Windows95-themed account popup. Saved-ID and password/ID-recovery controls are absent. Native notices and deletion confirmation use the original parchment and matching `Basic/BtOK2` / `Basic/BtCancel2` buttons, without an unrelated top-right close control. Delete remains an account-owned server soft deletion; Cancel preserves the roster. Progress is visible in **World → Login scene**, not as bare text over the book. The same disclosure exposes pause, exact30ms stepping and transition replay before authentication; those controls cannot mutate gameplay.

Login retains the shared audio owner's extracted `Sound.wz:BgmUI.img/Title` track and original `UI` button cues, queued while the browser requires a gesture. A committed field replaces the title track through the ordinary scene audio owner. [Native login evidence and limitations](client-evidence.md#native-login-scene-and-stage-geometry) and the [focused browser result](validation.md#native-login-reconstruction) distinguish recovered assets/callsites from original-Windows pixel parity.

Online development controls send bounded authenticated server requests for map travel, presets/scalar edits, spawning and simulation controls. The server checks developer role, origin, CSRF and current actor; gameplay messages cannot carry these actions. Camera/geometry controls remain presentation-only. Production has no development endpoint. Read the [protocol](server/protocol.md), including the server-only motion checkpoint and the explicit development/reference rules limitations. [Validation results](validation.md) distinguish exercised behavior from required proof.

For presets, use **Character → Presets → Stage preset**, review the draft, then press **Apply staged preset** or **Apply changes**. See [inspection instructions](inspection-tools.md#character-editing-and-presets) and the [drop, preset and chat recovery](original-resource-audit.md) for the original evidence, two-player verification and remaining gaps. Restart both development commands and reload the browser after pulling runtime changes so the client and server agree on their rules identity; these fixes do not require asset extraction.

### Iteration commands

Operational tools use `bun tools/openms.js <command>`, not package-script aliases. Commands are `extract [--full]`, `preflight`, `scenario`, `smoothness`, `smoke`, `scan`, `data server`, `audit skills`, `audit origins`, `audit worldmap` and `validate`. Help is available through `--help`, `help <command>` or `<command> --help`; it prints metadata without starting the tool. Other options and positional arguments pass unchanged to the existing implementation, with relative paths resolved from the repository root even when the wrapper is invoked by absolute path from another working directory. The wrapper preserves child exit status and signals; SIGINT/SIGTERM/SIGHUP stop the active tool, while SIGUSR1 forwards a smoke rerun. Package scripts remain for client/server, docs, test, lint and format.

```sh
bun tools/openms.js preflight --report /tmp/maple-preflight.json
bun tools/openms.js extract                         # incremental; includes selected-world preflight
bun tools/openms.js scenario list                   # names, recipe, maps and dependencies; no browser
bun tools/openms.js scenario all --output artifacts/native-current
bun tools/openms.js scenario world-tour-return --output artifacts/native-world
bun tools/openms.js scenario --rerun artifacts/native-world/world-tour-return/inputs.json --output artifacts/native-rerun
bun tools/openms.js smoke                           # persistent owned dev server + Chrome, default port3101
bun tools/openms.js smoke --once                    # one generation, then owned-resource teardown
```

Standalone scenarios require the current dev server; `smoke` owns its separate server and browser. It hashes declared inputs, coalesces changes, rebuilds the served source and reruns affected native scenarios in isolated, canonical seed-before-page contexts. A successful-extraction receipt reuses unchanged static assets across sessions; only a missing/changed receipt runs preflight and incremental extraction. Runtime-only edits do not force reconversion, while transitive compiler changes still invalidate their recipes. Reports preserve source/catalog identities, seeded-not-earned inputs, native-action deltas and failures. See [exact options, replay and loop ownership](validation-method.md#native-scenarios-and-replay).

Broad gates remain explicit: `bun tools/openms.js extract --full` forces conversion rather than cache reuse; `bun tools/openms.js validate` runs the world/physics oracle; native full-release installation and stopped-origin cold reload require separate acceptance. None is silently run for every edit by `smoke`. No timing improvement is implied without a retained measurement. [Current validation](validation.md) indexes the final evidence and caveats; [delivery](asset-delivery.md#incremental-extraction-and-preflight) documents the cache contract.

```sh
bun tools/openms.js scan       # full Map/Character/UI IMG metadata + checksum sweep
bun test           # decoding, animation, physics and input boundary regressions
bun run lint       # strict JavaScript checks; zero warnings
bun tools/openms.js validate   # explicit broad world/physics oracle and loading/performance gate
bun run format
```

`bun tools/openms.js smoothness` samples the presented local-player pose per animation frame while a real key is held and reports kernel-gated stall and jerk ratios plus a raw-kernel control from the same trace:

```sh
bun tools/openms.js smoothness --mode offline --output docs/validation/online-movement/offline
bun tools/openms.js smoothness --mode online --url http://127.0.0.1:3102 \
  --account dev_player --password <launcher password> --output docs/validation/online-movement/online
```

The offline run needs the offline dev server; the online run needs `server:dev` and `client:dev:online` (the server pins its accepted client origin, so log in from the origin it was started with). Both modes sample only the real render loop; the tool never steps the simulation itself. [Presented movement smoothness](validation.md#presented-movement-smoothness) records the retained measurements.

`validate` uses installed Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; `--chrome`, `--url`, `--duration`, `--maps`, `--output` and `--headed` override its settings. The server must already be running. Missing original assets fail explicitly; the browser never substitutes fabricated demo artwork. Use a distinct evidence output directory and the [validation procedure](validation-method.md), including its labeled noncombat fixture.

`bun client/tools/ingame-inventory.js` regenerates the lossless metadata inventory without decoding pixels or audio. Its optional positional arguments are the original-input directory and inventory output directory. See [ingame-inventory.md](ingame-inventory.md) for exact coverage and archive-member lookup.

## Documentation site

The documentation site uses **VitePress**, JavaScript configuration with JSDoc, and Bun. It builds from the retained documentation without extracting or installing the original game inputs.

```sh
bun install --frozen-lockfile
bun run dev:docs --host 127.0.0.1
bun run docs:build
bun run docs:preview --host 127.0.0.1
```

Development defaults to port5173; the built preview uses port4173. The site is branded **openms.dev**. Global sidebar **Client** and **Server** buttons expand in place, keeping both services available on every page; nested groups organize setup, architecture, assets, physics, UI, offline gameplay, evidence, validation and server operations/protocol. Top navigation uses dropdowns rather than immediate section navigation. Small SVG section icons are hidden from assistive technology beside readable labels. Local search indexes the published routes. Generated `.vitepress/cache` and `.vitepress/dist` are ignored.

Keep implementation contracts and measured results synchronized on their existing authoritative pages. Markdown pages and embedded images remain local; checked source-file, archive and directory links resolve to their exact repository locations instead of copying the entire evidence archive into the site. Missing raw targets and dead page links fail the build. Run the build and inspect the actual browser surface before publishing documentation changes.

Authoritative Markdown files remain at their existing repository paths; `docs/README.md` publishes as `/client/`, other existing client pages publish below `/client/`, and `docs/server/` publishes below `/server/`. The shared repository-link resolver translates source-relative Markdown links into their canonical site routes while preserving evidence/source GitHub paths. Write authored links relative to their source files and use canonical routes in navigation configuration. The project rename does not rename the Git remote or rewrite retained historical evidence.

The [earlier full-route site browser report](client-audit/site/browser.json) records its 32 routes, native local search to the audit's performance section, exact repository evidence links, and a 390-pixel article with native menu/cross-route/backdrop interaction. All three embedded audit figures loaded. Retained captures: [desktop](client-audit/site/desktop.png), [search](client-audit/site/search.png), [mobile article](client-audit/site/mobile.png), and [mobile menu](client-audit/site/mobile-menu.png). No page-script or same-origin resource errors occurred in that route pass. The [31-route baseline](validation/docs-site/browser.json) is also historical. The [correction-wave report](ingame-validation/fidelity/report.json) separately records native navigation through the newer skill, profile and agent contracts; it does not claim another complete route sweep.

The [native acceptance site report](native-ui-validation/site/report.json) records the current article's built embedded image and exact repository evidence destinations, native local-search selection of its performance section,390px/DPR2 Menu navigation and destination-content commit. Desktop and compact page widths have no document-level horizontal overflow. This is scoped page/navigation proof, not a rerun of every documentation route.

## Structure

- `client/src/` retains only the entry/integration modules `main.js`, `ingame.js` and `ingame-interfaces.js`; subsystem modules keep their descriptive filenames under the following domain directories, without root-level aliases or barrel exports.
- `client/src/assets/`: bounded archive IO, recovered WZ crypto/strings/directories/properties, canvas inflation/pixels, lossless PNG encoding. Decoder runs under Bun, off the browser render thread.
- `client/src/physics/`: recovered fixed-step movement, foothold transitions, buoyant modes, ladders and explicitly qualified hitbox geometry.
- `client/src/rendering/`: animation, camera, progressive scene/atlas streaming, worker decode, staged uploads, shared visual resources and speech bubbles.
- `client/src/audio/`: committed-scene audiovisual dispatch, bounded native PCM ownership and pass-through output capture.
- `client/src/character/`: avatar composition, persistent character development, progression, recovery, revival, pets and monster-book state. See [character development](offline-profile.md).
- `client/src/combat/`: fixed-tick offline field/mob ownership, damage, knockback, weapon rules and combat presentation.
- `client/src/delivery/`: offline startup/destination delivery and loading decoration, separate from character saves.
- `client/src/development/`: diagnostics, inspection controls and opt-in agent observations/scenarios. See the [agent interface](agent-interface.md).
- `client/src/input/`: physical bindings, key maps, player input and normal player-action dispatch.
- `client/src/items/`: inventory, item conditions/effects/use, equipment enhancement/effects and cash commerce.
- `client/src/npc/`: NPC interactions, script admission/compiler-facing contracts/runtime, shops, storage and world presentation.
- `client/src/profile/`: versioned IndexedDB persistence, schema/domain validation, account storage and atomic profile transactions.
- `client/src/quests/`: declarative quest transactions and journal models.
- `client/src/skills/`: learned-skill admission, bounded original-resource ownership and skill state/combat/world controllers. See [skill coverage](skills.md).
- `client/src/social/`: explicit local chat, trade, family/group/social authority and MapleTV playback.
- `client/src/ui/`: integrated original-art windows, HUD, dialogs, input configuration, projections and quest views.
- `client/src/world/`: portals, field transitions, life geometry/ownership, reactors, drops and pickup effects.
- `client/tools/extract.js`, `atlas.js`, `canvas-tiles.js`, `packaging.js`: original IMG loading, avatar assembly, lossless atlas/oversized-canvas conversion, independently downloadable regions and atomic versioned catalog.
- `client/tools/{ui,portal,life,audiovisual}-data.js`: original in-game extraction through the shared decoder and packer.
- [Inspection console and port tools](inspection-tools.md): five task-based Play/Character/Inspect/Settings/Agent tabs below the persistent toolbar, preserved drafts, scoped XP/Windows95/Y2K themes, validated presets, bounded entity search and offline tools. Native in-game artwork remains unthemed. [Binding actions](offline-binding-actions.md) records exact native IDs and remote dependencies.
- `client/public/service-worker.js`, `offline-manifest.js`, `client/tools/release-manifest.js`: verified current-map startup, destination gates and optional full-release installation with pinned offline launch, separate from character saves.
- `client/tools/validate.js`: independent Canvas2D pixel oracle, screenshots, state transitions, real rAF/loading/heap measurements.
- `client/tools/movement-smoothness.js`: per-frame presented-pose sampling for offline and online movement, with kernel-gated stall/jerk ratios and a raw-kernel control computed from the same trace.
- `client/public/generated/`, `client/dist/`: generated, gitignored. Original artwork is not bundled into the source package.
- `client/tools/dev.js` resolves domain-organized worker sources while retaining the public bundle basenames `main.js`, `atlas-worker.js`, `audio-capture-worklet.js` and `browser-oracle.js` under `/dist/`.
- `client/src/online/`, `client/online.html`: separate transport, prediction, read models and original-asset presentation; no offline profile authority. World NPC artwork stays region-owned and its server reference only gates interaction, so `npc.open` is admitted by live field identity rather than an invented reach limit. Authored dialogue prose and choice labels are projected from the token stream for the accessible intent controls, and `mapleOnline.project(x,y)` exposes a read-only world-to-canvas projection for inspection and browser verification.
- `shared/`: closed protocol and shared fixed-step motion/checkpoint contracts.
- `server/src/`, `server/sql/`, `server/tools/`: authoritative Bun runtime, PostgreSQL migrations and development provisioning.

Click empty map space for keyboard play. Arrows move/climb; **Alt jumps**, Down+bound Jump requests eligible drop-through, Up enters supported portals, and **Control attacks**. Recovered defaults are I/E/S/K for Item/Equip/Stat/Skill, **M MiniMap, Backslash Set Key, Q Quest, [ ShortCut and ] QuickSlot**. **Z picks up** eligible nearby local drops. Enter opens chat and accepted All-channel text produces a five-second local, not-sent speech bubble. Escape closes the top window or opens the menu. KeyConfig edits a live nonmodal draft; parent OK persists, while dirty close offers original Save/Discard and the nested quick-key popup owns a separate draft. See the [full UI/input contract](ingame-ui.md).

Pause, reload, key bindings and audio controls are visible; diagnostics remain in collapsed advanced sections. The first trusted pointer/key interaction unlocks enabled original audio; **Enable / resume audio** remains an explicit retry. Saved BGM/SE mute and volume are preserved. Received damage uses Violet digits, natural HP recovery uses Blue, and ordinary death opens the original confirmation before return-map revival. The [combat contract](offline-combat.md) distinguishes recovered presentation from local damage/AI rules.

Agent control is off by default. The **Agent tab**, not the header, contains the trusted **Allow agent control** permission and scenario controls; permission UI stays within that panel. Native human input interrupts temporary control immediately. `window.maple.agent` routes normal actions and observes the actual game. Separate `window.maple.dev.scenarios` retains the durable baseline while running a labeled memory-only experiment, with recording/replay and an always-available Exit control. [Permission, command schemas and replay boundaries](agent-interface.md) are documented separately from original gameplay evidence.

**[Schema8](offline-profile.md#schema-8)** checkpoints character/AP/SP, inventory/equipment instances, appearance/base vitals, quests, location and typed map-ID saved-location slots, settings/bindings, learned records, pet/mount state, cash locker/gifts, Monster Book, macros and local social domains together in IndexedDB. Typed saved locations replace schema7's `freeMarket` record. Valid v1–v7 saves migrate without granting progress, skills, points, cash or memberships. Native equip/use/drop/trade and supported NPC/quest/Cash actions share the atomic profile authority; multi-character exchanges commit affected profiles together. Window coordinates persist separately as browser preferences. The [character editor](offline-profile.md) remains outside-game development policy. Verified asset caching is separate from saves; site-data deletion/eviction remains outside the save guarantee.

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
- [Current validation](validation.md) indexes this iteration's native, UI, offline, smoke and explicit world-gate evidence and remaining failures; [Native offline UI acceptance](native-ui-validation.md) retains the detailed acceptance history. Source/asset identities and each report's actual scope, rather than a neighboring historical pass, determine what was proved.
- [Earlier external-controls acceptance](validation.md#current-external-controls-acceptance) and the [console report](ingame-validation/console-simple/report.json): native draft/save/reload, failure recovery, keyboard navigation, responsive/DPR checks, and retained review corrections.
- The earlier [expanded report](ingame-validation/expanded/report.json) retains server-stopped installed gameplay, world comparisons and its 147-test/876-assertion gate. The [skill contract](skills.md) distinguishes 534 catalogued skills from 35 supported controllers and 499 unavailable entries.
- [ingame-validation/](ingame-validation/): integrated actual-input screenshots, waveform and runtime evidence. [physics-validation/results.md](physics-validation/results.md) and [physics-validation/report.json](physics-validation/report.json) retain the earlier movement pass; [validation/report.json](validation/report.json) retains the rendering-only baseline.
- The [earlier systematic audit](client-audit.md) records 25 native UI scenarios, independent chat/combat evidence, its defect replays, 66 regressions/414 assertions and a 410-check integrated pass. Those counts describe that historical run, not the later correction wave. Neither browser agreement nor recovered artwork establishes original Windows fidelity.
- `ghidra-assets/`, `ghidra-client/`, [feature-specific exports](ghidra-client-features/) and [analysis tools](tools/): retained address-bearing evidence and reproducible Ghidra scripts. Decompiled C is evidence, **not original source**.

## Deliberate boundaries and unverified fidelity

This is a client-first reconstruction with playable **local offline authority** and a separate **authoritative online development runtime**, not the complete original game or a completed fidelity claim. Local mobs/combat/progression, supported declarative quests, durable state, portals/reactors, Cosmic-reference per-mob drops with original item assets, and current-map-scoped offline launch remain independent; full-release download is optional. The online runtime reuses versioned development/reference policies where original server rules are missing. Arbitrary scripts, unsupported skill/projectile/summon controllers and original progression/damage equations are not invented; unavailable dependencies and production gates remain explicit.

The initial original appearance is body/head skin0, face20000 and hair30000. Catalog-backed owned equipment and detached Cash previews compose through recovered anchors, original `islot`/`vslot` arbitration, normal/cash slot selection, weapon action metadata and death substitution. Missing appearance/action resources refuse publication; this is not an archive-wide wardrobe or advanced-transformation claim. Entry uses the exact named portal at `(x,y-10)`; Family travel selects original portal0 by ID because names such as `sp` need not be unique. Ordinary depth follows recovered contact plane/group rules. See [inventory](ingame-inventory.md), [UI](ingame-ui.md) and [avatar evidence](avatar-actions.md).

Player follow uses the recovered Shape2D filter (`0x1e0000`, coefficient100,28-pixel deadband), retaining history across same-map teleport. Clipping derives missing VR edges from the original **physical bounds**, including the300px upper margin, rather than raw foothold extrema. Other viewport sizes generalize native half-extents; interpolation between recovered30-ms simulation states remains browser policy. Whole compositions/cameras project to signed integer world pixels before GPU submission. Background displacement/repetition and integer alpha are recovered; absolute startup attachment, special resize backgrounds, non-normal blends and original equal-z ties remain qualified. See the [camera contract](ingame-portals.md#recovered-camera-filter-dynamics).

No original C/C++ source, gameplay recordings or input traces were found in the supplied tree, and the original cannot run on this Mac. Pixel checks use independently composited extracted assets, not original-client captures. Deterministic refresh partitioning is distinct from physically testing every refresh rate. See the Windows reference request before interpreting any browser measurement as original parity.

The archive reader targets the recovered encrypted v83 archive mode. Alternative object headers, nonzero Property headers, the complete List.wz mode-selection policy and uncommon object classes remain unsupported. Selected original MP3 envelopes and encoded bytes are preserved exactly and decoded natively in the browser; original DirectSound mixer/device parity, BGM fade interpolation and settings-slider mapping remain unresolved. DXT3 is identified from the original renderer and tested with synthetic blocks; the scanned original archives did not supply a DXT3 canvas example. Original RGB565 software rounding is reproduced; GPU hardware rounding may differ.
