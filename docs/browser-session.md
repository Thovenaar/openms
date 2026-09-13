# One game tab per browser storage origin

Online and offline startup share an exclusive `openms.game-tab` Web Lock. The first tab owns the client until that document closes, navigates away, reloads or crashes. A second tab shows **MapleStory is already open**, with **Try again**. It does not construct the game, open an offline save, initialize login or make gameplay API requests. Close the first tab and retry to use the second; retries never evict the existing owner or automatically start a background game.

The lock stays held while the owner is hidden, at login, signed out or reconnecting. This protects shared login cookies as well as offline state. Missing or refused browser locking stops startup with a readable retry message; there is no timestamp/localStorage fallback that can expire while Chrome suspends a tab.

## Scope and implementation

The scope is one browser storage origin (scheme, hostname and port) within a browser profile. `localhost` and `127.0.0.1`, different ports, separate Chrome profiles and separate private-browsing sessions have independent storage/locks. For multiplayer development, use separate browser profiles/isolated contexts. Tabs in the same private-browsing session still share the lock. This is browser coordination, not server account authorization.

The [Web Locks specification](https://www.w3.org/TR/web-locks/#termination-of-locks) defines atomic exclusive acquisition and automatic release when the document/agent terminates. We use `ifAvailable:true` and keep the callback's promise pending for the document's lifetime. There is one attempt per document; the native retry button reloads. The lock name is stable across account and asset/build changes.

[game-tab.js](../client/src/browser/game-tab.js) owns the small DOM admission screen. Both [offline](../client/src/browser/offline/main.js) and [online](../client/src/browser/online/main.js) entry points defer their runtime import until admission succeeds. The build still publishes `/dist/main.js` and `/dist/online/main.js`. Keeping the gate outside a pending top-level runtime initialization lets the document finish loading even when play is blocked. On a persisted `pageshow`, the page reloads to re-enter admission instead of resuming an old client. Lock ownership is not released just because focus/visibility changes; see Chrome's [page lifecycle documentation](https://developer.chrome.com/docs/web-platform/page-lifecycle-api).

## Focused validation

[runSingleGameTab](../client/tools/scenarios/single-game-tab.js) takes `{browser,url,output,credentials,offlineBundle}`. The caller owns a current online runtime, dedicated database/account and Puppeteer browser. `offlineBundle` is the path to a nonpublishing Bun build of `client/src/browser/offline/main.js` (`target:"browser"`, `format:"esm"`, `write:false`); no extraction or offline release conversion is necessary for the blocked-startup check. The scenario creates its own isolated browser contexts and closes them.

The [retained Chrome report](native-ui-validation/single-game-tab/report.json) covers:

- Simultaneous opens yield exactly one owner; blocked pages have no client API, canvas or `/api/` requests.
- Retry while occupied stays blocked. Owner reload, native login/play and native reconnect retain exclusive admission, including when the other tab is foreground.
- Navigation releases ownership. Back navigation goes through admission again. Closing the owner lets a blocked tab retry successfully.
- A separate browser context can own its independent slot. Injecting an unavailable Web Locks capability stops initialization.
- The actual compiled offline entry is delivered in the online owner's origin through interception of only that page's shell/bundle. It is blocked before creating the offline save database or client. This proves shared admission, not offline gameplay or persistence acceptance.

The report compares browser/workspace source identities, retains the offline bundle hash and requires empty browser/game error journals. [The blocked-tab screenshot](native-ui-validation/single-game-tab/second-tab.png) was reviewed at800×600. Scoped Prettier/ESLint and both browser entry-point builds passed. Browser automation must foreground the tab before native clicks; a background headless page can otherwise drop the retry click and create a false navigation timeout.
