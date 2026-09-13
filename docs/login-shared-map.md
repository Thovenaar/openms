# Development login, original layout and shared maps

The September 13, 2026 correction provides `admin/password` with developer controls and `player/password` as a normal player through `bun run server:dev`. `OPENMS_DEV_PASSWORD` remains an optional override. Legacy development accounts are renamed when the target name is absent, retaining their account and character IDs. Existing target accounts with a conflicting role are refused. [Database identity evidence](native-ui-validation/login-shared-map/accounts.json) and native login exercised the migration and default credentials in a dedicated database.

## Corrected behavior

Developer accounts previously entered `development:<accountId>`, while players entered `public`. They therefore had different authoritative map instances. Ordinary joins now share `public` regardless of role. The existing field publications distribute player appearance/motion, attacks, monster damage/state and drops to that map's clients. Private character data retains its existing recipient restrictions.

The two-client replay also exposed a control interruption: joining peers and committed operations publish full snapshots, and every snapshot temporarily marked the browser as synchronizing. That cleared physical keys and hid native windows. Refreshing an active baseline in the same field now keeps the active status through preparation. Initial entry, travel, explicit resynchronization and reconnect still gate input. [Before-fix held-input failure](native-ui-validation/login-shared-map/before-held-input.json) retains both players at the same instance but stationary after a native held key.

Cosmic provides authorized server-reference context, not original Nexon source: `MapleMap.java:2297` adds entrants, `:2451/:2874` sends existing map objects, `:2664–2739` broadcasts to map members; `MovePlayerHandler.java:43` broadcasts movement, `CloseRangeDamageHandler.java:81` broadcasts attacks, and `ItemPickupHandler.java:61` delegates authoritative pickup. Our existing `OnlineWorld.entities/broadcast`, `skill-hooks.js`, and `action-inventory.js` already implement the corresponding shared publication paths. No client is allowed to choose damage or inventory results.

The original executable and `UI.wz:Login.img` establish the UI changes:

| Surface | Recovered layout |
| --- | --- |
| Selected information banner | Origin `(180+130*slot,160)`;183×112 translucent yellow backing (`ARGB30ffff00`) before the WZ artwork; black12px Arial text |
| Explorer appearance pane |225×377 at `(509,95)`; option rows at `(520,200+18*row)`; OK/Cancel at `(546,425)/(620,425)` |
| Explorer name pane |201×224 at `(509,95)`; its separate OK/Cancel row remains `(536,273)/(610,273)` |

[Address-bearing information/creation instructions](ghidra-client/login-functions/information-creation-layout.txt), [font table](ghidra-client/login-functions/font-table.txt) and [font1 consumer](ghidra-client/login-functions/0098a7df-font1.txt) retain the evidence. The information backing is a bounded bitmap sprite so it participates in the browser's existing raster compositor. The previous [selected-avatar animation and inspection-travel correction](login-selection-travel.md) remains included.

## Focused verification

[Final browser report](native-ui-validation/login-shared-map/report.json): **pass**, with no browser errors, using the actual two development commands, an isolated database and two independent browser contexts:

- Default admin and player logins succeeded. Both creation phases, the face selector and original action rows were exercised. Selection and appearance were captured at800×600.
- Both accounts saw both players in the same instance. A native held Right key moved the admin fromX−93 to−56.775; the other client received its movement and showed its avatar.
- Native attacks delivered matching public attack/impact events, including8 damage, to both clients. Both combat presentations emitted damage numbers with zero overflow.
- The native inventory dialog dropped10 mesos. Both clients observed the same grounded drop; the native pickup removed its ID from both models and delivered the same pickup event/animation.
- Reconnect restored the same character and shared map membership.

The fixture explicitly grants100 STR,500 base HP/current HP and1000 mesos, and requests a snail spawn through the authenticated developer API. These are prerequisites, not earned progression. The retained server was reused between bounded replays and retained an earlier fixture snail. Combat outcomes use the server RNG. Earlier fixture failures waited on predicted grounding too early and used a zero-duration synthetic attack press; the final replay waits for authoritative grounding and holds attack120ms across the30ms input sampler.

| Reviewed capture | Evidence |
| --- | --- |
| Selection | [800×600](native-ui-validation/login-shared-map/selection-800x600.png) |
| Creation | [Name](native-ui-validation/login-shared-map/creation-name.png), [appearance800×600](native-ui-validation/login-shared-map/creation-800x600.png) |
| Other player's client | [Both avatars](native-ui-validation/login-shared-map/shared-map-1.png), [damage](native-ui-validation/login-shared-map/peer-combat.png), [drop](native-ui-validation/login-shared-map/peer-drop.png), [pickup](native-ui-validation/login-shared-map/peer-pickup.png) |

The report records matching served/workspace identity and the unchanged asset catalog. Timings: identity369ms, browser acquisition212ms, login/creation10.97s, shared-map actions/reconnect11.48s, teardown108ms. Combat8.97s and loot1.71s are included in the shared-map interval, not additional totals. No extraction was required. These checks establish Chromium behavior and recovered geometry/artwork, not pixel parity with an unavailable original Windows capture or coverage of every skill and map.

Thirty focused tests pass across account bootstrap, logging/role admission, login selection/motion, transport refresh/travel and life contact preparation, including the scoped `transfer drains` lifecycle test. Changed JavaScript/CSS passes Prettier and ESLint with zero warnings. The real online startup built907 modules successfully. No comprehensive smoke or release checks were run.

## Standard output

Both launchers now print actual startup boundaries and elapsed time. The client also prints source/rules/catalog identities and build stages; both print HTTP outcomes, WebSocket lifecycle and closure details. The backend prints map joins/leaves and development/gameplay command results. Movement packets and individual static asset requests are not logged per frame. A closed metadata allowlist excludes request bodies, cookies, tickets, and query strings. The existing development bootstrap explicitly prints its credentials.

[Server stdout](native-ui-validation/login-shared-map/server-stdout.log) includes earlier fixture attempts and the successful replay; [client stdout](native-ui-validation/login-shared-map/client-stdout.log) records the final startup/replay. Bootstrap password lines are redacted in retained logs. Restart both development commands to load the changes.
