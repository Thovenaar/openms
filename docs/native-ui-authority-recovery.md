# NPC, Ability and development authority recovery

September13,2026. This investigation starts from the supplied original client inputs, then the original executable, WZ metadata and authorized server references. The supplied `../Maplestory-Client` contains assets and `Maplestory_UNPACKED.exe`, not C++ client sources. No third-party client implementation is used. The independent emulator in `../MapleStory-Server` and the packaged Cosmic scripts describe server policy; they are not Nexon server source.

## NPC menu composition

The original [006d3392 decompilation](ghidra-ingame-quests/006d3392.c.txt) establishes this order:

| Order | Eligibility | Authored heading |
| --- | --- | --- |
| 1 | Active and completable | `UI/UIWindow.img/UtilDlgEx/list3` |
| 2 | Available to start | `UI/UIWindow.img/UtilDlgEx/list1` |
| 3 | Active and incomplete | `UI/UIWindow.img/UtilDlgEx/list0` |
| 4 | Ordinary supported talk route | `UI/UIWindow.img/UtilDlgEx/list2` |

Follow the actual assembly/decompiled append sequence at006d38f3–006d39fd; do not infer order from the list numbers or the quest journal tabs. An earlier browser comment and documentation reversed available/in-progress. `npcQuestGroup` now supplies one ordering rule to the shared offline menu and server menu. The server retains each offer's state/readiness, emits each group heading once and preserves quest IDs in `#L` choices. Merely browsing an incomplete quest still cannot authorize a reward.

At006d3a65–006d3bea, ordinary talk labels come from `Etc/ScriptInfo.img`, indexed by the original NPC's `info/script/0/script`. Keep that nested metadata when constructing world NPC records. `String/Npc.img` supplies NPC identity and ambient prose; neither the name nor ambient `d0` is the general menu-label source. `quest-data.js` now extracts the bounded ScriptInfo dictionary. Examples from the supplied WZ include `jane`→“Purchase Potion”, `owen`→“I heard that you can make a special item...” and `mike`→“Old Gladius”. Robin's authored script resolves to “I have something to tell you.”

For an emulator route without an authored label, the browser explicitly says `Talk to <name>`. This is an intentional readable fallback requested by the user, not a recovered native string. If no quests are offered, the original006d3d17–006d3d6b branch opens ordinary dialogue directly: do not invent an ETC-only menu. Existing route admission and that direct handoff remain in force.

The headings already exist in the UtilDlgEx visual bundle. `ui-dialog-art.js` resolves the inline `#f...#` to the existing panel resource and paints the original raster. No replacement icons, CSS text approximations or new heading images are needed. The extraction change supplies metadata only. The existing extractor rebuilt invalidated units and published735maps; its report records738converted units and4reused units. Do not repeat conversion for browser-only validation fixes.

## Ability / Stat detail

The original [Stat constructor008c4c7f](ghidra-ui-repairs/stat-constructor.txt) creates `Stat/BtDetail` unconditionally at **x124,y324**. The pool0x810 reference is at008c4d9d; child construction follows at008c4e1b. The earlier browser implementation incorrectly applied a beginner-job gate to this button. The gate in008c79f5 belongs to AP controls. The [008c5845 refresh consumer](ghidra-ui-repairs/stat-buttons.txt) also does not hide Details for beginners.

Remove the job gate, retaining the button whenever a profile is present. The existing child layout uses the recovered parent-relative position(170,144) and177×203size. Do not resize the source art to compensate for a missing control. The browser check opens Details as a level1beginner at800×600 and checks the child bounds and screenshot. The existing recovered `nativeStatDamage` consumer was also unused, leaving the attack range as a dash in both modes. `updateStatDetail` now computes that display on a copy of the observed stats, retaining their immutable ownership. Its arithmetic comes from008c2870 and the008c452c table in the retained stat-damage instructions/constants; it does not change combat results.

### Repeating the reverse engineering

1. Read [inputs/provenance](inputs.md), [client evidence](client-evidence.md) and existing function dumps first. Check that the source path and executable hash match the retained manifest.
2. For text/menu questions, inspect the original WZ property tree and decoded string pool before choosing a label or layout. Retain the exact property path, not just a screenshot.
3. Find the consumer, including constructor and refresh/teardown paths. A conditional near a neighboring control does not establish the visibility rule of another control.
4. The retained Ghidra project is `artifacts/login-peers/ghidra/login.gpr`; program `Maplestory_UNPACKED.exe`. Use the installed headless analyzer with `-noanalysis -scriptPath docs/tools -postScript clientLoginLayout.java <absolute-output> <comma-separated-entry-addresses>`. For this pane the exact entries are008c4c7f and008c5845. This bounded script retains decompilation and instructions together.
5. Ghidra's current project is partially analyzed. A failed scalar/xref search is not evidence of absence: the missing constructor was located from the PE's `PUSH 0x810` instruction, then its exact function entry was decompiled. Retain the function and callsite evidence before changing code.
6. Validate the smallest affected contract, then use native pointer/keyboard input for the visual check. Browser observation APIs must not grant progress or replace an input. No native Windows raster capture was available for this investigation.

## Development operations

The reported unknown outcome was reproduced by staging the Corsair preset and clicking Apply. A simple STR edit committed, but a preset returned HTTP400 `INVALID_MESSAGE` **before the development audit/transaction**. The generic JSON reader's256-node limit could not admit the89-key configuration and skill dictionary. This was not a password failure.

Only the audited development endpoint now uses `DEVELOPMENT_JSON`:512KiB, depth8,65,536parser nodes, covering the existing4,096skill-record and89-key limits. Normal endpoints retain their smaller envelope. Closed fields, integer bounds, learned-skill validation, development role, active socket/epoch, CSRF/origin and server transactions still apply. A larger request envelope grants no new player privilege.

A definite HTTP4xx refusal now settles/removes the pending operation. Network loss or an ambiguous5xx retains the same operation ID; a refused recovery attempt cannot change that earlier unknown outcome into a definite rejection, and post-commit audit failure cannot manufacture a rejected receipt; the UI waits for reconnect recovery. This prevents the misleading permanent “unknown” state on a parser refusal and prevents a retry from creating a second drop. The canonical digest now includes nested dynamic skill IDs, level/masterLevel/expiry and every other admitted field. The old fixed JSON replacer whitelist omitted those nested keys, allowing different requests to compare equal.

Conjure lacked an online hook. It now creates a server-owned field drop with a durable entitlement, original floor/motion preparation, normal recipient publication and atomic pickup. It does not credit the inventory before pickup. Ordinary players cannot invoke it; another player can see and later pick up the drop under the normal15-second ownership rule. Replay returns the stored receipt instead of spawning another item.

Reactor testing previously passed an item template number where the online command requires an owned item instance ID. The Character panel now resolves an owned inventory stack first; absence gives a clear pickup instruction. The server still checks proximity and the original reactor transition. Script rewards remain a separately named unsupported domain.

Character presets, scalar edits, AP/SP pools, skill ranks, key bindings and utility presets share the corrected development request path. Browser-local checkpoint/reset controls are hidden for a read-only online profile, with server autosave explained. A destructive online reset is not silently substituted for a local save operation. Revive uses the existing server-controlled return-map action.

## Buddy invitations

A fresh Developer→offlinePlayer request succeeded during reproduction. Two actual refusal paths were found: repeating Add for an already pending pair, and another sender attempting to invite a character who already had any incoming friend request.

The two-browser acceptance check exposed a deeper persistence defect: the live sender held insertion-ordered objects while PostgreSQL JSONB reloaded the recipient with reordered keys. `pendingInvitation` compared `JSON.stringify` output and falsely reported conflicting mirrored invitations. Group and atomic-social checks used the same fragile comparison. `socialEqual` now compares bounded validated records by key/value, preserving array order and every scalar but ignoring object property order. This is shared by invitation/group admission, social transaction validation and offline social/chat validation. A regression deliberately reverses one invitation's key order before acceptance; group tests preserve real-conflict rejection. `social.refused` logs the bounded internal rule/reason to server stdout while the client receives a closed result code.

The server now reuses the existing mirrored invitation for the same pending pair; different senders may queue distinct buddy invitations within the existing bounded capacity. This follows the pending buddy queue in the reference `net/server/channel/handlers/BuddylistModifyHandler.java`. Friendship is created only on recipient acceptance, and both profiles change in the same participant transaction. Blocks, invitation preferences, identity resolution, capacity and other social rules remain enforced.

Closed social result codes now explain self-targeting, full lists, existing friends, disabled invitations, pending requests and blocked contacts. The sender gets a native notice explaining that the other character must accept, including after an offline login. Server code still owns both mirrored records and publishes both recipients. Tests cover multiple senders, repeat requests, offline acceptance, blocks/preferences and useful refusal text. The user's exact failed buddy target was not provided, so these reproduced cases should not be described as proof of that particular historical request.

## Authority references and validation

The implementation keeps the server responsible for admitted input, state changes and recipient updates, consistent with [Nakama's authoritative multiplayer guidance](https://heroiclabs.com/docs/nakama/concepts/multiplayer/authoritative/). Retry behavior follows the same-operation-ID principle described in [Stripe's idempotency documentation](https://docs.stripe.com/api/idempotent_requests): a missing response is not permission to perform a second economic mutation. These are architecture references, not sources of original MapleStory rules.

The executable [online UI repair scenario](../client/tools/scenarios/online-ui-repairs.js) owns two isolated browser contexts and uses an operator-supplied disposable database/server. Seed fresh Developer and Player beside Robin atmap50000,x167,y335, optionally with Developer's pending buddy request; never seed a live player database. It checks original NPC headings/talk/cancel, beginner Details, the Corsair preset, native buddy acceptance, two-recipient conjure/pickup and reconnect. The scenario records source/rules/catalog identity, receipts, stage timings, errors and screenshots. Fixture economy must be created through the database API: replacing cached profile JSON after a preset leaves materialized item rows unchanged and can create an invalid level/equipment combination. For a new pristine run, recreate only the owned disposable database; never reset live profile JSON. Wait for an old character lease to retire before creating a replacement context; closing a page is a disconnect, not immediate logout.

The focused unit/contract batch currently passes122tests with588assertions across15files. Scoped formatting/lint and the nonpublishing online build boundary pass; the latter resolves910modules and refuses imports of offline authority owners. [The feature audit](server/online-feature-audit.json) and [parity inventory](server/offline-parity.md) distinguish static wiring from runtime and content completeness. No whole-world smoke or claim that every original skill, quest script and service is implemented is made.

Final native validation passed: [report and receipts](native-ui-validation/ui-authority-repairs/report.json), [original NPC menu](native-ui-validation/ui-authority-repairs/npc-menu.png), [beginner Ability detail](native-ui-validation/ui-authority-repairs/beginner-stat-detail.png), [focused tests](native-ui-validation/ui-authority-repairs/tests.log) and [server authority events](native-ui-validation/ui-authority-repairs/authority.log). The preset produced job522, level200,53learned skills and6equipped items. Buddy acceptance reached both participants; Player picked up the GM's two Red Potions after the ordinary ownership interval; both the buddy relation and item survived native reconnects. Both game journals and browser error lists were empty. The temporary database and owned server/browser processes were retired afterward; the operator's PostgreSQL service and development processes were not stopped.
