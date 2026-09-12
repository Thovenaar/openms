# openms.dev

A browser reconstruction of MapleStory's original v83 assets and rendering, written in JavaScript with JSDoc, Bun, and PixiJS.

The client streams 728 packaged original scenes through a directed route closure plus explicit tutorial/island and jump-course inspection roots, with keyboard-driven physics, local combat/progression, supported authored NPC quests/shops, portals/reactors and original UI/audio. Native inventory/equipment/AP, bindings/macros, social/Family, Monster Book, Cash Shop and two-character trade use schema 8 atomic offline authority. The local-peer console supplies explicit participants and prerequisites, not a network connection. Packaged scenes do not authorize missing scripts or complete every course mechanic; original Windows-runtime parity is not fabricated.

## Run

Requires [Bun](https://bun.sh), local original client assets and the authorized Cosmic server-reference checkout for drop extraction. Neither input tree is included here. See [setup and input configuration](docs/README.md#run).

```sh
bun install --frozen-lockfile
bun run extract
bun run dev:client:offline
```

Open **http://127.0.0.1:3100**. Click empty map space: arrows move/climb, Alt jumps, Down+Alt drops through eligible footholds, Up enters supported portals, Control attacks and Z picks up. I/E/S/K open graphical windows; Backslash opens KeyConfig, M cycles the minimap, Q opens the journal and Enter opens chat. Actions follow the live key configuration; unsupported actions remain explicit. Trusted input unlocks enabled audio. Verified current-map content can launch offline without a complete installation; **Download complete release**, then **Use installed release and reload**, is the optional full-catalog path. [Controls and boundaries](docs/README.md) distinguish recovered behavior from local policy.

For focused iteration, use `bun run preflight`, `bun run scenario all` against the running dev server, or `bun run smoke` for an owned rebuild/native-scenario loop on port3101. `bun run extract` reuses verified conversion units; `bun run extract:full` remains an explicit forced-conversion gate. [Commands, saved-fixture reruns and evidence](docs/validation-method.md#native-scenarios-and-replay) document the fast loop separately from broad world and complete-offline acceptance.

Development scripts use `dev:<service>[:mode]`: `bun run dev:client:offline` runs the offline client, and `bun run dev:docs` runs the documentation site. There is no implemented backend development command.

## Project

- `client/` — asset decoding, browser rendering, and tooling.
- `server/` — reserved for future backend work.
- `docs/` — [Client documentation](docs/README.md) and [Server documentation](docs/server/index.md), with setup, subsystem contracts, evidence, and known limitations.

See [the documentation](docs/README.md), [offline gameplay checklist and evidence](docs/offline-gameplay.md), and [validation procedure](docs/validation-method.md). Earlier [in-game](docs/ingame-validation/results.md) and [physics](docs/physics-validation/results.md) results remain historical baselines; browser self-consistency does not substitute for original Windows reference captures.
