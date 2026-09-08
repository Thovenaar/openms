# Maple

A browser reconstruction of MapleStory's original v83 assets and rendering, written in JavaScript with JSDoc, Bun, and PixiJS.

The client progressively streams eight original maps and supports keyboard-driven base-avatar movement, footholds, ladders, swimming, flight and collision inspection. It is not a complete game: combat, NPC/mob simulation, networking and the backend remain absent.

## Run

Requires [Bun](https://bun.sh) and local original client assets, which are not included in this repository. See [setup and asset configuration](docs/README.md#run).

```sh
bun install --frozen-lockfile
bun run extract
bun run dev
```

Open **http://127.0.0.1:3100**. Click the map, then use arrows/WASD and Space; Down+Space requests drop-through. Mouse controls switch maps, inspect hitbox geometry, toggle overlays, move the camera, and pause or step.

## Project

- `client/` — asset decoding, browser rendering, and tooling.
- `server/` — reserved for future backend work.
- `docs/` — the source of truth for setup, reverse-engineering evidence, validation, and known limitations.

See [the documentation](docs/README.md) for details and [current validation results](docs/physics-validation/results.md) for measured coverage, original evidence, and remaining fidelity limits.
