# Browser validation method

## Validation scope

Validation is proportional to the change. Use the smallest check that covers the changed contract, then stop.

- **Documentation/comments only:** review edited instructions and run the documentation link check. No browser, extraction or gameplay run is required.
- **Compose/environment/setup configuration:** use the relevant parser or configuration check. Do not start databases, migrate data or exercise gameplay unless startup behavior itself changed.
- **Application logic:** run the affected existing test or a narrow reproduction.
- **UI behavior/appearance:** check the changed interaction or surface only.
- **Asset/extraction logic:** check the affected decoder or recipe. Reuse existing generated assets for unrelated edits.

Comprehensive end-to-end runs, full extraction and concurrency benchmarks require an explicitly requested validation, release or performance scope. Documentation/configuration work needs no new screenshots, timing report or `validation.md` entry.

## Shorten the loop

- Prove one complete vertical slice first: native input → transaction → recipient update → reconnect.
- Work in small file-disjoint batches with fixed interfaces and run cheap validation after each batch stabilizes.
- Reuse generated assets, running authority and isolated browser contexts when their source, rules and catalog identities match.
- Build a domain-scoped tool when repeated manual work is the bottleneck.

### Immediate online iteration sequence

1. Name the intent, server admission, committed result, recipient publication and reconnect-restored state.
2. Run Prettier `--check` and ESLint on the edited JavaScript files, followed by affected tests.
3. Check the online import graph with a nonpublishing Bun build using `onlineBuildGraph` from `client/tools/online-build-graph.js`. The guard rejects browser imports of server-side authority modules.
4. Restart only stale owners. Browser-only changes do not require asset extraction.
5. Run the affected online scenario with a disposable account/database and isolated browser context. Capture images only for appearance or failure context.
6. Retain one bounded report with source/rules/catalog identities and stop.

### Current invalidation and reuse constraints

| Change                               | Required owner refresh                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Browser JavaScript                   | Rebuild/restart the frontend; restart the backend when its conservative rules identity includes the changed module |
| Server JavaScript or shared protocol | Restart backend and frontend so protocol/rules identities agree                                                    |
| CSS or HTML shell                    | Rebuild/restart frontend only                                                                                      |
| Original inputs or extraction recipe | Run affected extraction/preflight checks, then restart owners using the new catalog                                |

Do not delete the extraction cache or rebuild assets merely because browser code changed. A matching generated catalog remains reusable across sessions.

## Run the current client

Start the authoritative server and client in separate terminals:

```sh
bun run server:dev
bun run client:dev
```

Open `http://127.0.0.1:3102`. The client development server builds the online entry, serves generated assets and proxies `/api/` HTTP and WebSocket traffic to the backend.

For a production bundle:

```sh
bun client/tools/build-online.js
```

The build verifies the current catalog/rules identities, compiles the guarded browser graph and writes the deployable shell, bundles and deployment metadata to `client/dist/online/site/`. Its HTML excludes the development sidebar and its startup skips inspection controls; `client:dev` retains both. It does not regenerate assets.

`bun run client:prod` performs the same build and then serves the production site, generated assets and API proxy using `.env.client` listener settings.

## Online browser scenarios

Domain checks under `server/tools/check-*.js` own disposable databases, server/client listeners, accounts and browser contexts. Scenario modules under `client/tools/scenarios/online-*.js` operate through native controls and received state. Reuse an existing browser when practical, but never share a mutable game session between checks.

For production client presentation checks, pass `productionClient: true` to `isolatedOnlineCheck`. This compiles and serves the production shell through the fixture's local HTTP/API proxy, including real WebSocket connections. Its disposable backend still uses development authentication; this verifies browser behavior, not public HTTPS deployment.

Every browser report should identify the served source, rules and asset catalog. A stale source or mismatched catalog is a failed check. Use fresh module processes after editing scenario code so an older imported module cannot be mistaken for current evidence.

For two-player behavior, give each participant a separate browser context and account. Verify the sender receipt, other recipient's visible state and reconnect-restored result. The server fixture owns cleanup; do not run mutation scenarios against personal accounts.

Movement presentation can be measured with:

```sh
bun tools/openms.js smoothness --account admin --password password
```

The tool samples the presented player and authoritative prediction state while real keyboard input is held. It reports stalls and jerk within frames where the authoritative kernel moved; it does not step the simulation itself or establish original-Windows parity.

### Timing the feedback loop

When timing is in scope, separate source/rules/catalog checks, browser acquisition, readiness, actions and teardown. Parent and child timings overlap, so do not sum hierarchical durations. Compare serial and concurrent runs only with identical scenarios and identities, and do not run competing performance probes simultaneously.

## Evidence boundaries

These checks validate browser behavior and project interchange. They do not establish original-client parity. Ghidra output is retained binary evidence, not supplied C/C++ source. The original client cannot run on this Mac; original runtime parity requires a supplied Windows capture.

- **Recovered:** an original archive field or executable/DLL consumer establishes it.
- **Browser-exercised:** actual input/output exercised the reconstructed surface.
- **Interchange-matched:** independent state/resource checks match the packaged contract.
- **Original-reference-matched:** a supplied original runtime capture was compared.
- **Unknown/unsupported:** evidence or server state is missing; no substitute behavior fills it.

## Delegated in-game acceptance

Use separate isolated browser contexts and nonoverlapping artifact directories. Each run records `sourceBuildId`, rules identity and extracted catalog identity. Restart after source edits and preserve earlier failures under their original identities.

Native input must operate the actual client controls. Read-only inspection may collect state and diagnostics; it must not manufacture a successful gameplay outcome. Server development endpoints may seed an explicitly labeled fixture, but the tested action and receipt must still use the normal gameplay path.

## Audio proof

Audio validation requires the real audio graph and output capture. Mute unrelated BGM when isolating a cue, retain exact source identity, and distinguish scheduled source start from nonzero mixed PCM. Autoplay denial is a failed readiness condition for a requested audio check.

## Performance reporting

Profile before optimizing. Retain the exact workload, source/rules/catalog identities, browser ownership and per-stage timing. Compare like with like and report measured wall time rather than inferred savings. Routine edits do not update [validation results](validation.md); requested performance or release work does.
