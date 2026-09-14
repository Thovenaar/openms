# Character selection and inspection travel regression

The September 13, 2026 fix uses the original `../Maplestory-Client/Maplestory_UNPACKED.exe`, read-only Ghidra exports and `UI.wz:Login.img`. The supplied original directory contains the executable and assets, not C/C++ source. The source addresses, WZ paths and recovered constants are indexed in [client evidence](client-evidence.md#native-login-scene-and-stage-geometry). The adjacent Cosmic `WarpCommand.java` and `ChangeMapHandler.java` provide server-side warp context; browser development travel remains an audited authoritative transaction.

## Findings and changes

- Selection used a standing preview for every character, and browser button-content positioning shifted the portrait anchor. The selected preview now uses the original weapon-specific walking family; the other slots stand. Changing selection retains prepared or in-flight artwork. Portraits, information text, class banners and vacant-slot shadows use the recovered coordinates and WZ origins, with the information panel above the banners.
- Inspection travel to map100010000 reproduced a destination-preparation exception at `LifeSystem.createSlot`: `scene.simulation.geometry` was absent because the candidate's predictor had not been installed. Native life contact artwork now uses that candidate's validated foothold endpoints. It does not borrow the source field's simulation.
- The resulting abort retired server baselines while the browser immediately resumed acknowledging its old baseline. Abort now waits for a replacement snapshot/readiness handshake. The gateway drains known in-flight source ACKs using their snapshot ID and bounded event cursor; the actual ACK wire schema has no field epoch. Arbitrary stale or unknown snapshots remain rejected.

The [before-fix failure](native-ui-validation/selection-travel/before-teleport.json) retains the original destination-loading stack and closed connection. [Protocol details](server/protocol.md) describe the corrected preparation and handoff contracts.

## Focused proof

[Browser report](native-ui-validation/selection-travel/report.json): **pass**, using an isolated developer fixture and native mouse/keyboard input:

1. Selecting another roster character changes its original walk-frame pixels after180ms of the presentation clock. Portrait feet match `(280+125*slot,370)` and the selected information origin matches `(180+130*slot,160)`.
2. Page two exposes the fourth character and two vacant slots. The layout is captured at1280×800 and the supported minimum800×600.
3. An intentionally rejected map100000000 manifest restores the live source map without changing the connection epoch.
4. The inspector's Go button commits travel to map100010000. Native movement changes X from−123 to−117.792 and presents `walk1`; reconnect restores the same character in that destination. No server `closing` message occurs during the case.

The arrival capture/report deliberately retain the earlier injected404 and `TRANSITION_FAILED` error journal entries. Those establish recovery; they are not a second spontaneous destination failure.

- [Selection capture](native-ui-validation/selection-travel/selection.png)
- [800×600 selection capture](native-ui-validation/selection-travel/selection-800x600.png)
- [Destination capture](native-ui-validation/selection-travel/arrival.png)

The report records matching workspace/served source identity and the unchanged asset catalog, plus identity, acquisition, selection, travel and teardown timings. No asset extraction was needed. These are Chromium checks against recovered binary/asset evidence, not pixel parity against an original Windows runtime capture.

Reproduce the browser case with the dedicated `runOnlineSelectionTravel` module described in [validation method](validation-method.md#online-browser-scenarios). Supply a fresh developer account with four characters; accounts that have already traveled or entered combat are not equivalent fresh fixtures. The runner logs out its fixture and closes only its own context.

Scoped checks passed:

```sh
bun test client/test/login-selection.test.js client/test/login-motion.test.js client/test/online-transport.test.js client/test/life-interaction.test.js
bun test server/test/lifecycle.test.js --test-name-pattern 'transfer drains'
```

These run22 passing tests. Changed JavaScript also passed Prettier/ESLint with zero warnings and the nonpublishing online import-graph build (905 modules). An initial whole-file lifecycle run exposed two unrelated existing fixture failures: logout fixtures lack valid animation/equipment state. Those cases were not changed or counted as passing; this fix uses the targeted transfer-admission case. No comprehensive smoke or release gate was run.
