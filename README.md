# Maple

A browser reconstruction of MapleStory's original v83 assets and rendering, written in JavaScript with JSDoc, Bun, and PixiJS.

The client streams a 356-map original route closure with keyboard-driven physics, local mobs/combat/progression, supported data-driven NPC quests, portals/reactors, original UI and audio, durable character saves, and a verified complete-release offline installer. Local authority is explicitly provisional; missing server scripts, loot/skill rules and original-runtime parity are not fabricated.

## Run

Requires [Bun](https://bun.sh) and local original client assets, which are not included in this repository. See [setup and asset configuration](docs/README.md#run).

```sh
bun install --frozen-lockfile
bun run extract
bun run dev
```

Open **http://127.0.0.1:3100**. Click empty map space: arrows move/climb, Space jumps, Down+Space drops through eligible footholds, Up enters supported portals, and X/Control attacks. I/E/S/K open UI windows; M opens the minimap. Enable audio with its explicit gesture button. Use **Download complete release**, then **Use installed release and reload** before relying on offline launch. [Controls and boundaries](docs/README.md) distinguish recovered behavior from local policy.

## Project

- `client/` — asset decoding, browser rendering, and tooling.
- `server/` — reserved for future backend work.
- `docs/` — the source of truth for setup, reverse-engineering evidence, validation, and known limitations.

See [the documentation](docs/README.md), [offline gameplay checklist and evidence](docs/offline-gameplay.md), and [validation procedure](docs/validation-method.md). Earlier [in-game](docs/ingame-validation/results.md) and [physics](docs/physics-validation/results.md) results remain historical baselines; browser self-consistency does not substitute for original Windows reference captures.
