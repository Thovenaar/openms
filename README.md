# Maple

A browser reconstruction of MapleStory's original v83 assets and rendering, written in JavaScript with JSDoc, Bun, and PixiJS.

The client progressively streams eight original maps, keyboard-driven avatar physics, original UI artwork, portals, NPC/mob metadata previews, BGM and sound effects. It is not a complete game: live character/inventory state, NPC scripts, mob AI, combat, networking and the backend remain absent.

## Run

Requires [Bun](https://bun.sh) and local original client assets, which are not included in this repository. See [setup and asset configuration](docs/README.md#run).

```sh
bun install --frozen-lockfile
bun run extract
bun run dev
```

Open **http://127.0.0.1:3100**. Click the map: arrows move/climb, Space jumps, Down+Space requests drop-through, and Up enters supported packaged portals. I/E/S/K open UI windows; M opens the minimap. Enable audio with its explicit gesture button. [Controls and fidelity boundaries](docs/README.md) distinguish reconstructed behavior from inspection-only previews.

## Project

- `client/` — asset decoding, browser rendering, and tooling.
- `server/` — reserved for future backend work.
- `docs/` — the source of truth for setup, reverse-engineering evidence, validation, and known limitations.

See [the documentation](docs/README.md), [original in-game inventory](docs/ingame-inventory.md), and [validation procedure](docs/validation-method.md). [Integrated in-game results](docs/ingame-validation/results.md) include actual-input screenshots, live PCM recordings, frame times and limitations. [Earlier physics results](docs/physics-validation/results.md) remain separate; neither substitutes for original Windows reference captures.
