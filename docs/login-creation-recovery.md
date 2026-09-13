# Login and character creation recovery

This guide records the September 2026 registration, selection-banner and creation corrections, including the restored dice step. It supersedes the earlier `(500,339)` creation-preview coordinate in historical login findings.

## Inputs and evidence boundaries

- Original input: `../Maplestory-Client`, resolved here as `/Users/k/Development/tensorfish/Maplestory-Client`. It contains `Maplestory_UNPACKED.exe`, DLLs and WZ archives. There is no original C/C++ source in that directory. Ghidra decompilation is evidence derived from the executable.
- `UI.wz:Login.img` supplies the windows, character information bitmap, dice, stat table and parchment. `UI.wz:MapLogin.img` supplies placement of scenery drawn from the original map artwork. Character body/head/equipment sprites retain their original attachment/feet origins.
- Authorized server reference: `../MapleStory-Server/src/main/java/net/server/handlers/login/CreateCharHandler.java`, with `client/creator/novice/BeginnerCreator.java`. Cosmic is a server emulator, not Nexon source. Its v83 creation packet reads name, job, appearance, equipment and gender; it does **not** read rolled STR/DEX/INT/LUK.
- The executable's Explorer flow likewise advances from name to appearance and submits. Dice resources and strings remain in its archives/string pool, but their presence does not establish an active v83 dice screen. The requested third step restores those assets with explicit browser/server policies below. No Windows runtime parity is claimed.

## Reproduce the asset investigation

Run the bounded probe from the repository root:

```sh
bun docs/tools/login-assets.js ../Maplestory-Client artifacts/login-assets
```

[The probe](tools/login-assets.js) opens only `Login.img`, resolves27 fixed canvases through the project's WZ parser, decodes them with the existing canvas decoder, and writes PNGs plus dimensions, origins, optional delays/alpha endpoints and the input SHA-256. It bounds input bytes and canvas pixels, closes its archive, and never changes extraction receipts or the generated game catalog. Compare its hash with [the original manifest](input-manifest.json). The [banner inventory](native-ui-validation/selection-banner/canvases.json) includes the separate selection-scroll frames omitted from the earlier twelve-canvas investigation; the [spotlight inventory](native-ui-validation/selection-spotlight/canvases.json) adds the11 effect frames.

| Path beneath `Login.img` | Size | Origin | Meaning |
| --- | --- | --- | --- |
| `CharSelect/charInfo` | 183×115 | (45,57) | Labels, cells and world-ranking strip are already painted |
| `CharSelect/scroll/0/3` | 217×158 | (0,0) | Fully opened parchment and outer border **behind** the information table |
| `NewChar/charName` | 201×224 | (0,0) | Name pane including lower action board |
| `NewChar/charSet` | 225×377 | (0,0) | Appearance pane including lower action board |
| `NewChar/statTb` | 65×77 | (0,0) | STR/DEX/INT/LUK labels and value cells |
| `NewChar/scroll/0/3` | 242×210 | (0,0) | Fully opened parchment |
| `NewChar/dice/0` | 37×26 | (0,−30) | Resting die at the bottom of a common56px animation envelope |
| `NewChar/dice/1` | 25×54 | (0,−2) | Animated die |
| `NewChar/dice/2` | 27×56 | (0,0) | Animated die |
| `NewChar/dice/3` | 28×43 | (0,−13) | Animated die |

The scroll-opening sequence has delays250,50,50ms on frames0–2; frame3 has no delay. The dice frames have no authored delays. Do not infer delays from frame dimensions. The whole `NewChar` branch is already included by `client/tools/ui-data.js`; restoring it required no extraction or cache deletion.

## Trace strings to consumers, then follow the coordinates

1. Read the decoded pool in [decoded-strings.txt](ghidra-client/decoded-strings.txt). `docs/tools/clientStrings.java` documents the decoder recovered at `0079ebf3/0079ecde`. Relevant IDs are `0x52a` (`CharSelect/charInfo`), `0x536` (`NewChar/charName`), `0x537` (`charSet`), `0x538` (`avatarSel`), `0x53b` (`scroll/0`), `0x53f` (`dice`) and `0x540` (`statTb`). Retained instructional text also references rolling the dice. Search instruction operands, not only raw encoded strings.
2. Locate the consumer of the selected string. Constructors establish window position and size; control constructors establish local rectangles; paint methods establish text offsets and font lookup. Inspect the Explorer route specifically: Knight/Aran functions use different layouts.
3. Follow arguments into the callee. Several native helpers use SEH prologues that yield incomplete decompiler signatures (`unaff_EBP`, `extraout_ECX`). Read PUSH order and callee stack offsets before assigning semantic names. A numerical literal next to a coordinate may be a layer order, control ID or dimension.
4. Convert world coordinates using the current camera. Keep window-local coordinates, scene anchors and bitmap origins as separate quantities.
5. Check browser **computed rectangles**, including inherited layout, against the recovered rectangles. An element's declared `top` does not prove its nested input shares that top.

Use an owned scratch Ghidra project. The bounded [clientLoginLayout.java](tools/clientLoginLayout.java) helper accepts at most24 function entry points, limits each decompilation to30seconds and each instruction dump to5000 instructions. Example after importing the unpacked executable into `artifacts/login-ghidra/login.gpr`:

```sh
/Users/k/Downloads/ghidra_12.0.4_PUBLIC/support/analyzeHeadless \
  artifacts/login-ghidra login -process Maplestory_UNPACKED.exe -noanalysis \
  -scriptPath docs/tools -postScript clientLoginLayout.java \
  artifacts/login-functions.txt 00617b6c,0045149f,004502f8,005f595b
```

Import a new scratch project with `-import ../Maplestory-Client/Maplestory_UNPACKED.exe -noanalysis` before using `-process`. Never substitute an interior instruction address for a function entry just to make a decompiler create a function. The retained [coordinate consumers](ghidra-client/login-functions/creation-coordinate-consumers.txt) are address-bearing instruction slices from the original executable; they include the caller and coordinate setter. The helper was run against the four entry points above.

## Recovered layout and the mistakes corrected

The native viewport is800×600. `005fc0e4` computes stage camera center Y as `−8 − 600*(stage + creationRaceSubstate)`. Top-left camera subtracts `(400,300)`: selection is `(−400,−1508)`, and Explorer creation (stage4, race1) is `(−400,−3308)`.

### Name field and appearance pane

- Explorer name constructor `00617aaa` creates a201×224 window at world `(109,−3213)`, yielding screen `(509,95)`.
- `00617cf8..00617d06` constructs its input with local `(36,108)`, width120, height15. Screen rectangle is therefore **(545,203),120×15**.
- The input inherited `.online-login-row`'s31px minimum height and grid centering. Its actual top was211 despite the containing block declaring203. The name pane now explicitly uses a15px block row with no minimum-height expansion.
- The Explorer appearance pane is225×377 at `(509,95)`. Its action buttons use local `(37,330)/(111,330)`, giving `(546,425)/(620,425)`; the shorter name pane uses `(536,273)/(610,273)`. Do not share their action offsets.
- Appearance-row artwork begins `(520,200)` with18px spacing. The eight original appearance choices precede gender. Do not use Knight `006183d1/00618617` as evidence for this Explorer screen.

### Avatar feet

The call at `005f55d5..005f562b` ultimately enters `0045149f`. Its position arguments are **x22** and **y−2369−600*race**. The later100 is a drawing-order argument, stored separately from position. `0045149f` forwards stack offsets`+0x1c/+0x20` to `004502f8`, which sends them to the coordinate vector at `00450418..00450429`; the100 argument is stored at owner`+0x10f4`.

For Explorer race1, feet are world `(22,−2969)`. Subtracting camera `(−400,−3308)` yields **(422,339)**. Earlier code mistook100 for x, producing `(500,339)` and placing the avatar78px too far right. The100×100 preview host now begins `(372,239)` and anchors the composed avatar at its bottom center. Do not align an avatar by its hair bounds or scale it to an arbitrary portrait box.

### Selection information banner

- `0060292f` places the183×115 information window at world x`−220 + 130*(selectedIndex % 3)`, y`−1348` when ranking detail is absent: screen **(180+130*slot,160)**. Slot avatars use125px spacing; the information window deliberately uses130px. Preserve the distinction.
- **Missing-border correction:** `charInfo` is only the table overlay. Its separators at local y17/35/53, column gaps and ranking separation contain transparent pixels. The original border is a separate parchment layer, `CharSelect/scroll/0`, which the earlier implementation omitted. A yellow backing alone cannot replace it. The prior coordinate/text checks therefore passed while the border was still absent.
- String2978 (`0xba2`) is `UI/Login.img/CharSelect/scroll/%1d`. Find its PUSH at `00603de2`, then recover the containing entry **`00603dbc`**, not the interior string instruction. [The retained consumer](ghidra-client/login-functions/selection-scroll.txt) selects variant0 without ranking data, variant2 with ranking data. At `00603e3a..00603e6f`, the layer helper receives y`−25`, x`−20`, the information window as origin/overlay and z`−1`. Thus the normal scroll begins at screen **(160+130*slot,135)**. These are local offsets, not WZ-origin corrections.
- The browser now draws the original fully opened `scroll/0/3` frame before the information backing and table, moves it with the selected slot and hides it with an empty roster. Frame3 is217×158 with origin(0,0); opening frames0–2 carry250/50/50ms delays. This correction restores the settled banner; it does not add opening/closing playback. All four frames were already extracted, so no catalog rebuild is needed.
- The information window also needs its own stacking context. `0060292f` creates it at z20, above the main selection window's z10 in `00603ff0`. Sharing the decorations' lower artwork plane let the Start/Create/Delete controls and page arrow cover the third slot's scroll edge. The banner now owns one `UISurface` inside its positioned DOM container, with text above that artwork and the entire container above the controls. Move the container once; do not independently move the text, parchment and table.
- `00602b3b..00602b4f` paints183×112 with ARGB`30ffff00`, then copies `CharSelect/charInfo`. The table labels are original pixels, not text to redraw in HTML. See [paint instructions](ghidra-client/login-functions/information-creation-layout.txt).
- Font lookup1 resolves through [the font table](ghidra-client/login-functions/font-table.txt) to [0098a7df](ghidra-client/login-functions/0098a7df-font1.txt): black Arial12. Dynamic text uses local job`(46,1)`, level/fame`(46/136,19)`, STR/INT`(46/136,37)`, DEX/LUK`(46/136,55)`, unavailable-ranking text`(36,99)`. Browser cells are now bounded so a long value cannot paint over another label or outside the bitmap. Browser font rasterization remains platform-dependent.
- `UISurface.image(path,x,y)` accepts **bitmap top-left** and adds the WZ origin internally. `stateImage` and `EntityAnimation.setPosition` use **anchors**. Moving `charInfo` directly requires `(left+45,top+57)`. Adding the origin twice or treating an anchor as top-left displaces the entire banner.

Reproduce the additional decompilation with the earlier headless command, substituting output `artifacts/selection-scroll.txt` and function list `00603dbc`. Compare the [original opened scroll](native-ui-validation/selection-banner/CharSelect-scroll-0-3.png) with the table overlay, then inspect the combined browser raster. Do not infer a complete window from one canvas named `charInfo`; follow other consumers of the same window's origin and overlay.

The focused [selection-banner scenario](../client/tools/scenarios/online-selection-banner.js) exports `runOnlineSelectionBanner({browser,url,output,account,password})`. Supply a disposable account with three characters and an existing Puppeteer browser; the caller owns the database and runtimes. Native login and clicks select all three slots at1280×800/DPR1 and800×600/DPR2. It waits for the artwork ticker after the synchronous DOM selection, then checks opacity at the previously transparent separators and all four scroll corners, captures the banner and signs out. Review the third-slot screenshot as well: opacity inside the banner's own canvas cannot establish its stacking relative to other DOM surfaces. The [report](native-ui-validation/selection-banner/report.json), [middle-slot capture](native-ui-validation/selection-banner/1280x800-slot1.png) and [minimum-size third slot](native-ui-validation/selection-banner/800x600-slot2.png) record this narrow appearance check. No gameplay acceptance is implied.

### Selected-character spotlight

The spotlight is two original animations, not a CSS gradient or a recolored character. The previous browser composition omitted both even though their frames were already extracted.

1. Find string IDs`0x521` and`0x522` in the decoded pool: `UI/Login.img/CharSelect/effect/0` and`/1`. Their PUSH instructions are`005f6518` and`005f6653`; both belong to function **`005f6482`**, called from`0060599b`. Retain [the complete consumer](ghidra-client/login-functions/selection-spotlight.txt), including its instructions, because its SEH decompilation loses some argument names.
2. The helper [005fd76d](ghidra-client/login-functions/selection-spotlight-center.txt) returns the graphics singleton pointer at`00bf14ec`. [00444fb6 and004374cb](ghidra-client/login-functions/selection-spotlight-vector.txt) dereference it and obtain the center vector through vtable slot`+0x5c`. At`005f64de..005f64f1`, the consumer supplies **(-140 +125*(selectedIndex%3), -300)** relative to that vector. Adding the800×600 viewport center gives anchor **(260+125*slot,0)**. Do not substitute the avatar's feet anchor`(280+125*slot,370)` or the banner's130px spacing.
3. The native layer order is`0xc00614a4`, or`-0x40000000+398500`: above field scenery, below login windows. The browser uses a separate full800×600 `UISurface` above `MapLogin` and below the book frame, roster and stat banner. The native negative-selection branch releases both layers; the browser hides them outside a populated selection screen and restarts them when the selected character changes.
4. `effect/0` uses Animate flag`0x20` (repeat); `effect/1` uses flag`0` (play once, hold final frame). The beam's five delays are150/100/100/100/3000ms; its final image is71×337 with origin(36,0). The gleam has six frames with300/120/120/120/120/0ms delays, negative Y origins and authored alpha endpoints. Preserve a literal zero delay and `a0/a1`; do not replace them with guessed defaults. The [bounded asset report](native-ui-validation/selection-spotlight/canvases.json) retains all11 frames and their original metadata.

Repeat the headless command above with function list`005f6482,005fd76d,00444fb6,004374cb`. Run the fixed asset probe, compare its input hash, then verify the actual composite image. The [selection scenario](../client/tools/scenarios/online-selection-banner.js) now selects all three slots at1280×800/DPR1 and800×600/DPR2 and checks the beam anchor/final-frame/once mode and repeating gleam. Its [report](native-ui-validation/selection-spotlight/browser/report.json) retains the same source/catalog identity as the [NPC check](native-ui-validation/online-npc-dialogue/report.json). Reviewed images include [slot0 at1280×800](native-ui-validation/selection-spotlight/browser/1280x800-slot0.png) and [slot1 at800×600](native-ui-validation/selection-spotlight/browser/800x600-slot1.png). These are browser reconstructions; no new Windows reference capture was obtained.

Returning to the field during reconnect can cancel a newly preparing login backdrop. `OnlineLogin.startBackdrop` now recognizes cancellation of that backdrop's owned request and prevents its late result from remounting. Actual preparation failures still report. The NPC browser check reads the game error journal as well as uncaught page errors: otherwise this normal cancellation appeared as a false `REQUEST_FAILED` login notification while reconnect itself succeeded.

### Cursor across login stages

Sign-in, character selection, creation, registration and recovery share the existing `UICursor` implementation and extracted `UI/Basic.img/Cursor` artwork. The login backdrop leases that bundle through the same atlas owner as gameplay. Its pointer-transparent cursor plane sits above login windows and popups in viewport coordinates, independently of the centered 800×600 artwork. Original cursor states, animation and WZ hotspots are retained; no CSS replacement image is generated.

`LoginCursor` adapts the existing cursor owner interface. The login host owns native-cursor suppression, so retiring it cannot clear the field canvas's cursor settings. Field entry destroys the login plane and releases its resources/listeners; returning to login prepares one replacement. Pointer cancellation, browser-window blur and document hiding clear a pressed cursor. Text-field focus changes do not cancel it. Inspection controls outside the login surface retain their native cursor.

The focused command `bun server/tools/check-login-cursor.js` owns a disposable database, servers and browser context. It checks native idle/hover/press input, popup layering, selection/creation at1280×800 and800×600, the field handoff and return after revoking only the fixture session. Captures and its source/catalog-identified report go to `/tmp/openms-login-cursor` by default. It reuses extracted assets and performs no map gameplay or server-restart benchmark.

The cursor replay passes. The fixture currently exits with a separate teardown failure after sign-out: the world is closed and HTTP requests are drained, but Bun still reports one pending WebSocket while server shutdown waits. Fixture cleanup now reports this after ten seconds and drops its disposable database. This is not a passing server-shutdown check; the browser report records only the cursor assertions.

## Restored dice step and server authority

Name → appearance → stats is now the browser creation flow. The third step uses the original opened parchment at `(493,150)`, stat table at `(526,205)` and dice anchor `(634,211)`, leaving the recovered avatar platform unchanged. These third-step positions, labels and80ms animation frame cadence are browser presentation choices; they are not attributed to an active v83 consumer. Applying each dice frame's origin keeps its bottom at the same height.

`POST /api/v1/character-roll` requires the authenticated session, CSRF token and exact configured Origin. It starts four stats at4, then distributes nine points with nine independent cryptographic draws across the four stats. This is a bounded server policy, not a recovered historical random distribution. Each result has a server-issued roll ID. Only the latest result is retained per session; the endpoint allows three rolls/second with burst three.

Creation sends that ID and the displayed values. The server requires integers4–13, total25 **and exact equality to the session's issued roll**, including another check under the account lock. An alternative distribution is refused even if its total is legal. Missing, forged, foreign-session and superseded rolls are refused. A rejected name or transaction can reuse the retained roll; it remains valid until reroll/session termination. The existing profile, appearance and starter-equipment validators still run, and SQL commits the resulting profile and items together.

Registration previously depended on loading a map, choosing a spawn, validating a profile and writing starter items because it silently created a default character. Registration now writes only the player account, then opens an empty roster. Explicit creation owns those character operations and the roll. The development launcher's admin/player starter characters remain a separate fixture policy. The generic reported registration error did not reproduce for a fresh local account before changes; no unobserved server exception is claimed as its root cause. Duplicate-account failure/retry was reproduced and now remains readable in the Windows95 popup instead of opening another game modal.

## Scoped validation and future iteration

The focused tests are:

```sh
bun test server/test/creation-roll.test.js server/test/registration.test.js \
  server/test/character-creation.test.js server/test/proof-of-work.test.js \
  client/test/login-selection.test.js client/test/online-transport.test.js
```

Result:35 passing tests. Changed JavaScript passes scoped Prettier and ESLint checks. No world smoke run or asset reconversion was needed.

[online-creation-recovery.js](../client/tools/scenarios/online-creation-recovery.js) exports `runOnlineCreationRecovery({browser,url,output,account})`. Supply an existing Puppeteer browser and a fresh dedicated account name against an isolated development database. It owns an isolated context and closes it; the caller owns runtimes, browser and database cleanup. It does not enter a map. Its native mouse/keyboard replay verifies duplicate registration retry, Enter submission, empty roster, the input and feet coordinates, appearance choice, dice click/Space, Back navigation, saved server stats and logout/login. Direct HTTP is used only for deliberately invalid creation requests; those return400 without a new character.

The [retained report](native-ui-validation/creation-recovery/report.json) includes source/catalog identity, stage timings, geometry and invalid-request results. The chosen roll survived sign-out/sign-in. Screenshots were reviewed at1280×800 and800×600:

- [Name field and platform](native-ui-validation/creation-recovery/name.png)
- [Appearance](native-ui-validation/creation-recovery/appearance.png)
- [Dice and original stat artwork](native-ui-validation/creation-recovery/dice.png)
- [Minimum viewport](native-ui-validation/creation-recovery/dice-800x600.png)
- [Selection banner with persisted rolled stats](native-ui-validation/creation-recovery/selection.png)

For future edits: finish one file batch, run the scoped checks, restart **both** online processes when shared/client source changes affect the rules hash, and reload the browser. CSS-only changes need the frontend rebuilt. Wait for `login.transition.active === false` before typing: the camera can round to its target one frame before the input plane stops being inert. Compare geometry after undoing the uniform viewport scale. Reuse existing extracted assets and the validation browser; do not delete the extraction cache to fix a DOM layout defect.
