# Agent navigation

[`docs/`](docs/) is the source of truth for project guidance, contracts, findings, and validation. This file is only an index.

## Documentation

- [Start here: overview, setup, scope, and limitations](docs/README.md)
- [Required coding style for all coding agents](docs/coding-style.md)
- [Original inputs and provenance](docs/inputs.md)
- [Original file hashes](docs/input-manifest.json)
- [Asset formats and decoder evidence](docs/asset-evidence.md)
- [Original client and rendering evidence](docs/client-evidence.md)
- [Scene format and browser API contract](docs/scene-contract.md)
- [In-game inventory and priority boundaries](docs/ingame-inventory.md)
- [UI](docs/ingame-ui.md), [portals](docs/ingame-portals.md), [life](docs/ingame-life.md), and [audio/effects](docs/ingame-audiovisual.md)
- [Validation procedure](docs/validation-method.md)
- [Validation results](docs/validation.md)
- [Extraction report](docs/extraction.json) and [archive scan](docs/archive-scan.json)
- [Browser report and captures](docs/validation/)
- [Integrated in-game acceptance evidence](docs/ingame-validation/) and [Windows reference requests](docs/windows-reference-captures.md)
- [Asset Ghidra evidence](docs/ghidra-assets/), [client Ghidra evidence](docs/ghidra-client/), and [analysis scripts](docs/tools/)

## Implementation

- [Workspace scripts and packages](package.json)
- [Asset decoding](client/src/assets/)
- [Scene extraction](client/tools/extract.js) and [archive scanning](client/tools/scan.js)
- [Browser rendering](client/src/main.js) and [animation](client/src/animation.js)
- [In-game integration](client/src/ingame.js), [shared visual ownership](client/src/visual-resources.js), and [native audio](client/src/audio-engine.js)
- [Browser markup](client/index.html) and [styles](client/style.css)
- [Development server](client/tools/dev.js) and [browser validation](client/tools/validate.js)
- [Regression tests](client/test/)
- [Reserved server workspace](server/)
