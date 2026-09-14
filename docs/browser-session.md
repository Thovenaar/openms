# One game tab per browser storage origin

The online client holds an exclusive `openms.game-tab` Web Lock until its document closes, navigates away, reloads or crashes. A second tab shows **MapleStory is already open** with **Try again**. It does not construct the client, initialize login or make gameplay API requests.

The lock stays held while the owner is hidden, at login, signed out or reconnecting. This protects the shared login cookie and prevents two tabs from competing for the same browser session. Missing or refused browser locking stops startup with a readable retry message; there is no timestamp/localStorage fallback.

## Scope and implementation

The scope is one browser storage origin within a browser profile. `localhost` and `127.0.0.1`, different ports, separate profiles and separate private-browsing sessions have independent locks. For multiplayer development, use separate browser profiles or isolated contexts. This browser coordination does not replace server account/session authorization.

The [Web Locks specification](https://www.w3.org/TR/web-locks/#termination-of-locks) defines atomic exclusive acquisition and release when the document terminates. The client uses `ifAvailable:true` and keeps the callback pending for the document lifetime. The retry button reloads; retries never evict the current owner.

[game-tab.js](../client/src/browser/game-tab.js) owns the admission screen. The [online entry](../client/src/browser/online/main.js) defers its runtime import until admission succeeds. Keeping the gate outside pending runtime initialization lets the document finish loading even when play is blocked. A persisted `pageshow` reloads to re-enter admission instead of resuming a retired client.

## Focused validation

[runSingleGameTab](../client/tools/scenarios/single-game-tab.js) takes `{browser,url,output,credentials}`. The caller owns a current online runtime, dedicated database/account and Puppeteer browser. The scenario creates isolated contexts and closes only those it owns.

The retained Chrome report predates removal of the offline client, but its online checks remain useful historical evidence: simultaneous opens admitted exactly one owner; retry while occupied stayed blocked; navigation and close released ownership; a separate context held an independent slot; and unavailable Web Locks stopped startup safely. New validation should run only the current online entry and must not claim the historical offline-entry subcase.
