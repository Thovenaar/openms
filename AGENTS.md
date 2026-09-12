# Agent navigation

[`docs/`](docs/) is the source of truth for project guidance, contracts, findings, and validation. This file is only an index.

Target desktop-sized applications with a minimum viewport of **800×600**. Mobile support is not required.

## Operating rules

If a bottleneck can be removed by a tool, or a tool would shorten the iteration/feedback loop, build the tool instead of grinding through repeated manual work. Extend the existing tooling where it fits — [asset decoding](client/src/assets/), [extraction](client/tools/extract.js), [archive scanning](client/tools/scan.js), [development server](client/tools/dev.js), [browser validation](client/tools/validate.js), [analysis scripts](docs/tools/) — rather than starting a parallel convention. Keep every tool deterministic, bounded, and reproducible, and record what it establishes in `docs/`.

Parallelize independent browser verifications when possible. Give each worker an isolated browser context, profile, service-worker/CacheStorage state, and evidence directory; never share a mutable game session. Verify the same source/catalog identity across workers and consolidate their results before delivery.

Use the [measured feedback loop](docs/validation-method.md#timing-the-feedback-loop), not repeated manual browser narration. Finish a file-disjoint edit batch, then run formatting and cheap targeted tests/static checks **before** expensive extraction; changing an extraction recipe mid-run invalidates that work. Extend `client/tools/scenarios/` for repeatable input/readiness/geometry/audio checks, and reserve image review for appearance. Run only affected named scenarios while iterating; compare serial and `--concurrency 2` on the same source/catalog before choosing concurrency. Reuse the smoke loop's browser, retain isolated contexts, and do not run competing performance probes concurrently.

Profile before optimizing: retain preflight/extraction, server identity stages, browser acquisition, readiness, action and teardown timings. Do not sum hierarchical timings. `smoke` uses extraction's own preflight report exactly once; never add a duplicate preflight subprocess or force full conversion/full-offline installation/world-oracle gates for ordinary browser-source edits. Keep those broad gates explicit. Record current measurements and failures in [validation results](docs/validation.md) so the next run can target the actual dominant stage.

Keep static extraction reusable across sessions. `smoke` checks original/reference content, the existing transitive recipe hashes, dependencies and catalog identity against its successful-extraction receipt; unchanged inputs skip both preflight and conversion. Do not delete this cache or re-run extraction for browser-only edits. The measured warm integrity pass was 53.6 seconds versus a 156 ms reuse probe; initial input scanning is separate. Dev release integrity/compression still cost about 30 seconds and remain explicit guards. Use the retained measurements, not a promise that every source edit requires rebuilding assets.

## Documentation

- [Documentation home: Client and Server sections](docs/index.md)
- [Client: overview, setup, scope, and limitations](docs/README.md)
- [Server: workspace, reference data, and authority boundaries](docs/server/index.md)
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
- [Browser rendering](client/src/main.js) and [animation](client/src/rendering/animation.js)
- [In-game integration](client/src/ingame.js), [shared visual ownership](client/src/rendering/visual-resources.js), and [native audio](client/src/audio/audio-engine.js)
- [Browser markup](client/index.html) and [styles](client/style.css)
- [Development server](client/tools/dev.js) and [browser validation](client/tools/validate.js)
- [Regression tests](client/test/)
- [Reserved server workspace](server/)
